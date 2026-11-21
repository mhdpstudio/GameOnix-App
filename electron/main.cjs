const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, shell, Tray } = require('electron')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const { Readable, Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { pathToFileURL } = require('node:url')

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
if (process.platform === 'win32') app.setAppUserModelId('com.gameonix.desktop')

const DEV_URL = 'http://localhost:5173'
const TRUSTED_TORRENT_PREFIX = 'https://raw.githubusercontent.com/mhdpstudio/GameOnix-Data-Content/main/downloads/'
const UPDATE_REPOSITORY = 'mhdpstudio/GameOnix-App'
const UPDATE_ASSET_NAME = 'GameOnix-win-unpacked.zip'
const windows = new Set()
const downloads = new Map()
const activeTorrents = new Map()
const speedSamples = new Map()
let torrentClient
let downloadDirectory
let downloadTimer
let settingsPath
let downloadsPath
let updateCheckPromise
let updateDownloadPromise
let updateCheckTimer
let tray
let isQuitting = false
let shutdownInProgress = false
let shutdownComplete = false
let appSettings = {
  closeToTray: true,
  launchAtStartup: false,
  askBeforeDownload: true,
}
let updaterState = { status: 'idle', currentVersion: app.getVersion(), availableVersion: '', progress: 0, error: '' }

function publishUpdaterState() {
  for (const window of windows) {
    if (!window.isDestroyed()) window.webContents.send('updates:state', { ...updaterState })
  }
}

function setUpdaterState(patch) {
  updaterState = { ...updaterState, ...patch }
  publishUpdaterState()
}

function compareVersions(left, right) {
  const a = String(left).split(/[.+-]/).slice(0, 3).map((part) => Number(part) || 0)
  const b = String(right).split(/[.+-]/).slice(0, 3).map((part) => Number(part) || 0)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1
  }
  return 0
}

async function checkForUpdates() {
  if (!app.isPackaged) return { status: 'development', currentVersion: app.getVersion() }
  if (updateCheckPromise) return updateCheckPromise
  updateCheckPromise = (async () => {
    setUpdaterState({ status: 'checking', error: '' })
    try {
      const response = await net.fetch(`https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'GameOnix-Desktop-Updater' },
      })
      if (!response.ok) throw new Error(`GitHub returned ${response.status} while checking for updates.`)
      const release = await response.json()
      const version = String(release.tag_name || '').replace(/^v/i, '')
      if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) throw new Error('The latest GitHub release has an invalid version tag.')
      if (compareVersions(version, app.getVersion()) <= 0) {
        setUpdaterState({ status: 'current', currentVersion: app.getVersion(), availableVersion: '', progress: 0, error: '' })
        return updaterState
      }
      const asset = release.assets?.find((item) => item.name === UPDATE_ASSET_NAME)
      if (!asset?.browser_download_url) throw new Error('The latest release is missing the portable app archive.')
      if (!asset.browser_download_url.startsWith(`https://github.com/${UPDATE_REPOSITORY}/releases/download/`)) {
        throw new Error('The update archive URL is not from the configured GitHub repository.')
      }
      if (!/^sha256:[a-f0-9]{64}$/i.test(asset.digest || '')) throw new Error('GitHub did not provide a SHA-256 digest for the update archive.')
      setUpdaterState({ status: 'available', availableVersion: version, progress: 0, error: '' })
      void downloadAndInstallUpdate(asset, version)
      return updaterState
    } catch (error) {
      setUpdaterState({ status: 'error', error: error?.message || 'Could not check for updates.' })
      return updaterState
    } finally {
      updateCheckPromise = null
    }
  })()
  return updateCheckPromise
}

function psString(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

async function launchPortableUpdater(archivePath, version) {
  const installDirectory = path.dirname(process.execPath)
  const executablePath = process.execPath
  const scriptPath = path.join(path.dirname(archivePath), 'install-gameonix-update.ps1')
  const script = `
$ErrorActionPreference = 'Stop'
$processToWaitFor = ${Number(process.pid)}
$installDirectory = ${psString(installDirectory)}
$archivePath = ${psString(archivePath)}
$executablePath = ${psString(executablePath)}
$stageDirectory = Join-Path $env:TEMP ('GameOnix-update-${version}-' + [guid]::NewGuid().ToString('N'))
while (Get-Process -Id $processToWaitFor -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 400 }
try {
  Expand-Archive -LiteralPath $archivePath -DestinationPath $stageDirectory -Force
  $copyArguments = @(('"' + $stageDirectory + '"'), ('"' + $installDirectory + '"'), '/MIR', '/R:5', '/W:1')
  $copy = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\robocopy.exe') -ArgumentList $copyArguments -Wait -PassThru -WindowStyle Hidden
  if ($copy.ExitCode -ge 8) { throw ('Copying the update failed with code ' + $copy.ExitCode) }
  Start-Process -FilePath $executablePath -WorkingDirectory $installDirectory
} catch {
  if (Test-Path -LiteralPath $executablePath) { Start-Process -FilePath $executablePath -WorkingDirectory $installDirectory }
} finally {
  Remove-Item -LiteralPath $stageDirectory -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
}
`
  await fs.writeFile(scriptPath, script, 'utf8')
  await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolve() })
  })
  setUpdaterState({ status: 'restarting', progress: 100, availableVersion: version })
  isQuitting = true
  app.quit()
}

async function downloadAndInstallUpdate(asset, version) {
  if (updateDownloadPromise) return updateDownloadPromise
  updateDownloadPromise = (async () => {
    const updateDirectory = path.join(app.getPath('temp'), `gameonix-update-${version}-${Date.now()}`)
    const archivePath = path.join(updateDirectory, UPDATE_ASSET_NAME)
    await fs.mkdir(updateDirectory, { recursive: true })
    try {
      setUpdaterState({ status: 'downloading', progress: 0, availableVersion: version, error: '' })
      const response = await net.fetch(asset.browser_download_url, { headers: { 'User-Agent': 'GameOnix-Desktop-Updater' } })
      if (!response.ok || !response.body) throw new Error(`GitHub returned ${response.status} while downloading the update.`)
      const expectedDigest = asset.digest.slice('sha256:'.length).toLowerCase()
      const hash = crypto.createHash('sha256')
      const totalBytes = Number(asset.size) || Number(response.headers.get('content-length')) || 0
      let receivedBytes = 0
      let lastProgressAt = 0
      const progressStream = new Transform({
        transform(chunk, _encoding, callback) {
          hash.update(chunk)
          receivedBytes += chunk.length
          const now = Date.now()
          if (totalBytes && now - lastProgressAt > 250) {
            lastProgressAt = now
            setUpdaterState({ progress: Math.min(99, Math.round(receivedBytes / totalBytes * 100)) })
          }
          callback(null, chunk)
        },
      })
      await pipeline(Readable.fromWeb(response.body), progressStream, fsSync.createWriteStream(archivePath))
      if (hash.digest('hex').toLowerCase() !== expectedDigest) throw new Error('The update archive failed its SHA-256 integrity check.')
      await launchPortableUpdater(archivePath, version)
    } catch (error) {
      await fs.rm(updateDirectory, { recursive: true, force: true }).catch(() => {})
      setUpdaterState({ status: 'error', error: error?.message || 'The update could not be installed.' })
    } finally {
      updateDownloadPromise = null
    }
  })()
  return updateDownloadPromise
}

function startUpdateMonitor() {
  if (!app.isPackaged) return
  updateCheckTimer = setTimeout(() => { void checkForUpdates() }, 12000)
  updateCheckTimer.unref?.()
  const timer = setInterval(() => { void checkForUpdates() }, 4 * 60 * 60 * 1000)
  timer.unref?.()
}

function safeSlug(value) {
  const slug = String(value || '').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) throw new Error('This game has an invalid download ID.')
  return slug
}

function publicDownload(item) {
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    status: item.status,
    progress: Number(item.progress) || 0,
    downloaded: Number(item.downloaded) || 0,
    total: Number(item.total) || 0,
    speed: Number(item.speed) || 0,
    etaSeconds: Number.isFinite(item.etaSeconds) ? item.etaSeconds : null,
    peers: Number(item.peers) || 0,
    error: item.error || '',
    updatedAt: item.updatedAt || null,
  }
}

function getSnapshot() {
  return [...downloads.values()].map(publicDownload).sort((left, right) => {
    const order = { downloading: 0, starting: 1, paused: 2, error: 3, completed: 4 }
    return (order[left.status] ?? 5) - (order[right.status] ?? 5) || String(left.title).localeCompare(String(right.title))
  })
}

async function persistDownloads() {
  if (!downloadsPath) return
  const records = [...downloads.values()].map(({ samples, smoothedSpeed, targetDirectory, ...item }) => item)
  const temporaryPath = `${downloadsPath}.tmp`
  await fs.writeFile(temporaryPath, JSON.stringify({ downloadDirectory, settings: appSettings, downloads: records }, null, 2), 'utf8')
  await fs.rename(temporaryPath, downloadsPath)
}

function publishSnapshot() {
  const snapshot = getSnapshot()
  for (const window of windows) {
    if (!window.isDestroyed()) window.webContents.send('downloads:update', snapshot)
  }
}

async function saveAndPublish() {
  await persistDownloads().catch((error) => console.error('Could not save download state:', error))
  publishSnapshot()
}

function requireTrustedFrame(event) {
  const frameUrl = event.senderFrame?.url || ''
  if (app.isPackaged) {
    if (!frameUrl.startsWith('app://gameonix/')) throw new Error('This action is only available inside GameOnix.')
  } else if (!frameUrl.startsWith(DEV_URL)) {
    throw new Error('This action is only available inside GameOnix.')
  }
}

async function ensureTorrentClient() {
  if (torrentClient) return torrentClient
  const { default: WebTorrent } = await import('webtorrent')
  torrentClient = new WebTorrent({ maxConns: 80 })
  torrentClient.on('error', (error) => console.error('Torrent client error:', error))
  return torrentClient
}

function getSmoothedSpeed(torrent, item) {
  const now = Date.now()
  const previous = item.lastSample || { at: now, downloaded: torrent.downloaded || 0 }
  const downloaded = Number(torrent.downloaded) || 0
  item.samples ||= []
  item.samples.push({ at: now, bytes: Math.max(0, downloaded - previous.downloaded) })
  item.samples = item.samples.filter((sample) => now - sample.at <= 6000)
  item.lastSample = { at: now, downloaded }
  const elapsed = item.samples.length > 1
    ? Math.max(1, (now - item.samples[0].at) / 1000)
    : 1
  return item.samples.reduce((sum, sample) => sum + sample.bytes, 0) / elapsed
}

function startStatsTimer() {
  if (downloadTimer) return
  downloadTimer = setInterval(() => {
    for (const [id, torrent] of activeTorrents) {
      const item = downloads.get(id)
      if (!item || !torrent || torrent.destroyed) continue
      const speed = getSmoothedSpeed(torrent, item)
      const total = Number(torrent.length) || Number(item.total) || 0
      const downloaded = Number(torrent.downloaded) || Number(item.downloaded) || 0
      const remaining = Math.max(0, total - downloaded)
      const rawEta = speed > 1024 ? remaining / speed : null
      item.speed = speed
      item.progress = Number(torrent.progress) || 0
      item.downloaded = downloaded
      item.total = total
      item.peers = Number(torrent.numPeers) || 0
      item.status = torrent.paused ? 'paused' : torrent.done ? 'completed' : 'downloading'
      item.etaSeconds = rawEta === null ? null : Number.isFinite(item.etaSeconds)
        ? item.etaSeconds * 0.72 + rawEta * 0.28
        : rawEta
      item.updatedAt = new Date().toISOString()
    }
    void persistDownloads().catch((error) => console.error('Could not save download progress:', error))
    publishSnapshot()
  }, 1000)
}

async function startTorrent(item, { paused = false } = {}) {
  const client = await ensureTorrentClient()
  const existingTorrent = activeTorrents.get(item.id)
  if (existingTorrent && !existingTorrent.destroyed) return item
  if (!String(item.torrentUrl || '').startsWith(TRUSTED_TORRENT_PREFIX)) {
    throw new Error('This torrent link is not from the GameOnix data server.')
  }

  await fs.mkdir(item.targetDirectory, { recursive: true })
  item.status = 'starting'
  item.error = ''
  item.speed = 0
  item.etaSeconds = null
  item.updatedAt = new Date().toISOString()
  item.samples = []
  item.lastSample = null

  const torrent = client.add(item.torrentUrl, {
    path: item.targetDirectory,
    paused,
    strategy: 'rarest',
    maxWebConns: 8,
    destroyStoreOnDestroy: false,
  })
  activeTorrents.set(item.id, torrent)
  torrent.on('metadata', () => {
    item.total = Number(torrent.length) || item.total
    item.title = item.title || torrent.name || item.slug
  })
  torrent.on('ready', () => {
    item.status = paused ? 'paused' : 'downloading'
    item.total = Number(torrent.length) || item.total
    item.title = item.title || torrent.name || item.slug
    item.infoHash = torrent.infoHash
    void saveAndPublish()
  })
  torrent.on('done', () => {
    item.status = 'completed'
    item.progress = 1
    item.downloaded = Number(torrent.length) || item.downloaded
    item.total = Number(torrent.length) || item.total
    item.speed = 0
    item.etaSeconds = 0
    void saveAndPublish()
  })
  torrent.on('error', (error) => {
    item.status = 'error'
    item.error = error?.message || 'The torrent could not be downloaded.'
    item.speed = 0
    item.etaSeconds = null
    void saveAndPublish()
  })
  startStatsTimer()
  await saveAndPublish()
  return item
}

async function loadDownloadState() {
  settingsPath = path.join(app.getPath('userData'), 'gameonix-downloads.json')
  downloadsPath = settingsPath
  const defaultDirectory = path.join(app.getPath('downloads'), 'GameOnix')
  try {
    const state = JSON.parse(await fs.readFile(downloadsPath, 'utf8'))
    downloadDirectory = state.downloadDirectory || defaultDirectory
    if (state.settings && typeof state.settings === 'object') {
      appSettings = { ...appSettings, ...state.settings }
    }
    for (const saved of Array.isArray(state.downloads) ? state.downloads : []) {
      const id = safeSlug(saved.id)
      const item = {
        ...saved,
        id,
        slug: safeSlug(saved.slug || id),
        targetDirectory: path.join(saved.downloadDirectory || downloadDirectory, safeSlug(saved.slug || id)),
        samples: [],
        lastSample: null,
        speed: 0,
        etaSeconds: null,
      }
      downloads.set(id, item)
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not load saved downloads:', error)
    downloadDirectory = defaultDirectory
  }
  await fs.mkdir(downloadDirectory, { recursive: true })
}

function getAppIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'gameonix.ico')
    : path.join(__dirname, '..', 'build', 'gameonix.ico')
}

function getTrayIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'gameonix-icon.png')
    : path.join(__dirname, '..', 'build', 'gameonix-icon.png')
}

function getMainWindow() {
  return [...windows].find((window) => !window.isDestroyed())
}

function showMainWindow() {
  let window = getMainWindow()
  if (!window) window = createWindow()
  if (window.isMinimized()) window.restore()
  window.maximize()
  window.show()
  window.focus()
  return window
}

function openMainRoute(route) {
  const window = showMainWindow()
  window.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify(`#${route}`)}`).catch(() => {})
}

function syncTray() {
  if (!appSettings.closeToTray && !appSettings.launchAtStartup) {
    tray?.destroy()
    tray = null
    return
  }
  if (tray) return

  const icon = nativeImage.createFromPath(getTrayIconPath()).resize({ width: 24, height: 24 })
  tray = new Tray(icon)
  tray.setToolTip('GameOnix')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open GameOnix', click: showMainWindow },
    { label: 'Downloads', click: () => openMainRoute('/downloads') },
    { label: 'Settings', click: () => openMainRoute('/settings') },
    { type: 'separator' },
    { label: 'Quit GameOnix', click: () => { isQuitting = true; app.quit() } },
  ]))
  tray.on('click', showMainWindow)
  tray.on('double-click', showMainWindow)
}

function applyStartupSetting() {
  if (process.platform !== 'win32' || !app.isPackaged) return
  app.setLoginItemSettings({
    openAtLogin: Boolean(appSettings.launchAtStartup),
    args: ['--startup'],
  })
}

async function restoreDownloads() {
  for (const item of downloads.values()) {
    if (item.status === 'downloading' || item.status === 'starting') {
      void startTorrent(item).catch((error) => {
        item.status = 'error'
        item.error = error.message
        void saveAndPublish()
      })
    }
  }
}

function createWindow({ startHidden = false } = {}) {
  const window = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 960,
    minHeight: 650,
    backgroundColor: '#0b0d12',
    frame: false,
    icon: getAppIconPath(),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  windows.add(window)
  const publishWindowState = () => {
    if (!window.isDestroyed()) window.webContents.send('window:state', window.isMaximized())
  }
  window.on('maximize', publishWindowState)
  window.on('unmaximize', publishWindowState)
  window.once('ready-to-show', () => {
    window.maximize()
    if (!startHidden) window.show()
  })
  window.on('close', (event) => {
    if (isQuitting || !appSettings.closeToTray) return
    event.preventDefault()
    window.hide()
    syncTray()
  })
  window.on('closed', () => windows.delete(window))
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).protocol === 'https:') void shell.openExternal(url)
    } catch {}
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = app.isPackaged ? url.startsWith('app://gameonix/') : url.startsWith(DEV_URL)
    if (!allowed) event.preventDefault()
  })

  if (!app.isPackaged) void window.loadURL(DEV_URL)
  else void window.loadURL('app://gameonix/index.html')
  return window
}

function registerDownloadIpc() {
  ipcMain.handle('window:minimize', (event) => { requireTrustedFrame(event); BrowserWindow.fromWebContents(event.sender)?.minimize() })
  ipcMain.handle('window:toggle-maximize', (event) => {
    requireTrustedFrame(event)
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window?.isMaximized()) window.unmaximize()
    else window?.maximize()
    return Boolean(window?.isMaximized())
  })
  ipcMain.handle('window:close', (event) => { requireTrustedFrame(event); BrowserWindow.fromWebContents(event.sender)?.close() })
  ipcMain.handle('window:is-maximized', (event) => { requireTrustedFrame(event); return Boolean(BrowserWindow.fromWebContents(event.sender)?.isMaximized()) })
  ipcMain.handle('window:back', (event) => { requireTrustedFrame(event); const contents = event.sender; if (contents.canGoBack()) contents.goBack() })
  ipcMain.handle('window:forward', (event) => { requireTrustedFrame(event); const contents = event.sender; if (contents.canGoForward()) contents.goForward() })
  ipcMain.handle('updates:get-state', (event) => { requireTrustedFrame(event); return { ...updaterState } })
  ipcMain.handle('updates:check', (event) => { requireTrustedFrame(event); return checkForUpdates() })

  ipcMain.handle('settings:get', (event) => {
    requireTrustedFrame(event)
    return { ...appSettings, downloadDirectory, version: app.getVersion() }
  })
  ipcMain.handle('settings:update', async (event, patch = {}) => {
    requireTrustedFrame(event)
    for (const key of ['closeToTray', 'launchAtStartup', 'askBeforeDownload']) {
      if (typeof patch[key] === 'boolean') appSettings[key] = patch[key]
    }
    applyStartupSetting()
    syncTray()
    await persistDownloads()
    return { ...appSettings, downloadDirectory, version: app.getVersion() }
  })

  ipcMain.handle('downloads:list', (event) => { requireTrustedFrame(event); return getSnapshot() })
  ipcMain.handle('downloads:get-directory', (event) => { requireTrustedFrame(event); return downloadDirectory })
  ipcMain.handle('downloads:choose-directory', async (event) => {
    requireTrustedFrame(event)
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return downloadDirectory
    downloadDirectory = result.filePaths[0]
    await fs.mkdir(downloadDirectory, { recursive: true })
    await persistDownloads()
    return downloadDirectory
  })
  ipcMain.handle('downloads:start', async (event, game) => {
    requireTrustedFrame(event)
    const slug = safeSlug(game?.slug)
    const title = String(game?.title || '').trim().slice(0, 160) || slug
    const torrentUrl = String(game?.torrentUrl || '')
    if (!torrentUrl.startsWith(TRUSTED_TORRENT_PREFIX) || !torrentUrl.toLowerCase().endsWith('.torrent')) {
      throw new Error('This game does not have a supported GameOnix torrent file.')
    }
    const existing = downloads.get(slug)
    if (existing) {
      if (existing.status === 'paused' || existing.status === 'error') await startTorrent(existing)
      return { id: slug, downloads: getSnapshot() }
    }
    const item = {
      id: slug,
      slug,
      title,
      torrentUrl,
      status: 'starting',
      progress: 0,
      downloaded: 0,
      total: 0,
      speed: 0,
      etaSeconds: null,
      peers: 0,
      error: '',
      downloadDirectory,
      targetDirectory: path.join(downloadDirectory, slug),
      updatedAt: new Date().toISOString(),
    }
    downloads.set(slug, item)
    try {
      await startTorrent(item)
      return { id: slug, downloads: getSnapshot() }
    } catch (error) {
      item.status = 'error'
      item.error = error.message || 'Could not start this torrent.'
      await saveAndPublish()
      throw error
    }
  })
  ipcMain.handle('downloads:pause', async (event, id) => {
    requireTrustedFrame(event)
    const item = downloads.get(safeSlug(id))
    if (!item) throw new Error('Download not found.')
    const torrent = activeTorrents.get(item.id)
    if (torrent && !torrent.destroyed) {
      item.downloaded = Number(torrent.downloaded) || item.downloaded
      item.total = Number(torrent.length) || item.total
      item.progress = Number(torrent.progress) || item.progress
      await new Promise((resolve, reject) => torrent.destroy({ destroyStore: false }, (error) => error ? reject(error) : resolve()))
    }
    activeTorrents.delete(item.id)
    item.status = 'paused'
    item.speed = 0
    item.etaSeconds = null
    await saveAndPublish()
    return getSnapshot()
  })
  ipcMain.handle('downloads:resume', async (event, id) => {
    requireTrustedFrame(event)
    const item = downloads.get(safeSlug(id))
    if (!item) throw new Error('Download not found.')
    await startTorrent(item)
    return getSnapshot()
  })
  ipcMain.handle('downloads:remove', async (event, { id, deleteFiles = false } = {}) => {
    requireTrustedFrame(event)
    const safeId = safeSlug(id)
    const item = downloads.get(safeId)
    if (!item) return getSnapshot()
    const torrent = activeTorrents.get(safeId)
    if (torrent && !torrent.destroyed) await new Promise((resolve) => torrent.destroy({ destroyStore: false }, resolve))
    activeTorrents.delete(safeId)
    if (deleteFiles) {
      const expectedDirectory = path.resolve(path.join(item.downloadDirectory || downloadDirectory, safeSlug(item.slug)))
      if (path.resolve(item.targetDirectory) === expectedDirectory && expectedDirectory.startsWith(path.resolve(item.downloadDirectory || downloadDirectory) + path.sep)) {
        await fs.rm(expectedDirectory, { recursive: true, force: true })
      }
    }
    downloads.delete(safeId)
    await saveAndPublish()
    return getSnapshot()
  })
  ipcMain.handle('downloads:open-folder', async (event, id) => {
    requireTrustedFrame(event)
    const item = downloads.get(safeSlug(id))
    const folder = item?.targetDirectory || downloadDirectory
    await fs.mkdir(folder, { recursive: true })
    return shell.openPath(folder)
  })
}

async function registerAppProtocol() {
  const distDirectory = path.join(app.getAppPath(), 'dist')
  protocol.handle('app', async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'gameonix') return new Response('Not found', { status: 404 })
    let relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    if (!relativePath || relativePath.endsWith('/')) relativePath = `${relativePath}index.html`
    const absolutePath = path.resolve(distDirectory, relativePath)
    if (!absolutePath.startsWith(path.resolve(distDirectory) + path.sep) && absolutePath !== path.join(distDirectory, 'index.html')) {
      return new Response('Not found', { status: 404 })
    }
    try {
      return await net.fetch(pathToFileURL(absolutePath).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  await loadDownloadState()
  applyStartupSetting()
  syncTray()
  registerDownloadIpc()
  if (app.isPackaged) await registerAppProtocol()
  const startHidden = appSettings.launchAtStartup && (process.argv.includes('--startup') || app.getLoginItemSettings?.().wasOpenedAtLogin)
  createWindow({ startHidden })
  startUpdateMonitor()
  void restoreDownloads()
  app.on('activate', showMainWindow)
})

app.on('before-quit', (event) => {
  isQuitting = true
  if (downloadTimer) clearInterval(downloadTimer)
  if (!torrentClient || torrentClient.destroyed || shutdownComplete) {
    void persistDownloads()
    return
  }
  event.preventDefault()
  if (shutdownInProgress) return
  shutdownInProgress = true
  for (const [id, torrent] of activeTorrents) {
    const item = downloads.get(id)
    if (!item || !torrent || torrent.destroyed) continue
    item.downloaded = Number(torrent.downloaded) || item.downloaded
    item.total = Number(torrent.length) || item.total
    item.progress = Number(torrent.progress) || item.progress
    item.status = torrent.done ? 'completed' : 'downloading'
  }
  void persistDownloads().catch((error) => console.error('Could not save download state before closing:', error)).finally(() => {
    try {
      torrentClient.destroy((error) => {
        if (error) console.error('Could not close the torrent client cleanly:', error)
        void persistDownloads().catch((saveError) => console.error('Could not finish saving downloads:', saveError)).finally(() => {
          shutdownComplete = true
          app.quit()
        })
      })
    } catch (error) {
      console.error('Could not close the torrent client cleanly:', error)
      shutdownComplete = true
      app.quit()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !appSettings.closeToTray) app.quit()
})
