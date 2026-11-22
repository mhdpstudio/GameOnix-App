const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, Notification, protocol, safeStorage, shell, Tray } = require('electron')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const zlib = require('node:zlib')
const { spawn } = require('node:child_process')
const { Readable, Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { pathToFileURL } = require('node:url')

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])

const DEV_URL = 'http://localhost:5173'
const APP_USER_MODEL_ID = 'com.gameonix.desktop'
const TOAST_ACTIVATOR_CLSID = '{71C8C61D-96A7-40E2-AB8C-64CB4A4B6F13}'
const TRUSTED_TORRENT_PREFIX = 'https://raw.githubusercontent.com/mhdpstudio/GameOnix-Data-Content/main/downloads/'
const TRACKER_LIST_URL = 'https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt'
const FALLBACK_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://exodus.desync.com:6969/announce',
  'http://tracker.dler.org:6969/announce',
  'http://tracker.renfei.net:8080/announce',
]
const UPDATE_REPOSITORY = 'mhdpstudio/GameOnix-App'
const UPDATE_ASSET_NAME = 'GameOnix-win-unpacked.zip'
const windows = new Set()
const downloads = new Map()
const activeTorrents = new Map()
const finalizingTorrents = new Set()
const speedSamples = new Map()
let torrentClient
let downloadDirectory
let downloadTimer
let settingsPath
let authSessionPath
let downloadsPath
let updateCheckPromise
let updateDownloadPromise
let updateCheckTimer
let supplementalTrackersPromise
let tray
let isQuitting = false
let shutdownInProgress = false
let shutdownComplete = false
let unreadNotificationCount = 0
let pendingDesktopLogin = null
let appSettings = {
  closeToTray: true,
  launchAtStartup: false,
  askBeforeDownload: true,
}
let updaterState = { status: 'idle', currentVersion: app.getVersion(), availableVersion: '', progress: 0, error: '' }

if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID)

const singleInstanceLock = app.requestSingleInstanceLock()
if (!singleInstanceLock) app.quit()

function getDesktopLoginUrlFromArgs(args = []) {
  return args.map((value) => String(value).replace(/^"|"$/g, '')).find((value) => value.startsWith('gameonix://auth-callback/')) ||
    args.map((value) => String(value).replace(/^"|"$/g, '')).find((value) => value.startsWith('gameonix://auth-callback?')) || ''
}

async function completeDesktopLogin(deepLink) {
  if (!pendingDesktopLogin || !deepLink) return
  let url
  try { url = new URL(deepLink) } catch { return }
  const pending = pendingDesktopLogin
  if (url.protocol !== 'gameonix:' || url.hostname !== 'auth-callback' || url.searchParams.get('state') !== pending.state) return
  try {
    const iv = Buffer.from(url.searchParams.get('iv') || '', 'base64url')
    const payload = Buffer.from(url.searchParams.get('payload') || '', 'base64url')
    if (iv.length !== 12 || payload.length < 17 || payload.length > 12000) throw new Error('The website returned an invalid sign-in response.')
    const decipher = crypto.createDecipheriv('aes-256-gcm', pending.key, iv)
    decipher.setAuthTag(payload.subarray(payload.length - 16))
    const token = Buffer.concat([decipher.update(payload.subarray(0, payload.length - 16)), decipher.final()]).toString('utf8')
    if (!token || token.length > 8192) throw new Error('The website returned an invalid account session.')
    const check = await net.fetch('https://gameonix-backend.vercel.app/api/auth/me', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
    if (!check.ok) throw new Error('The website session expired. Sign in on the website, then try again.')
    const data = await check.json()
    await fs.writeFile(authSessionPath, safeStorage.encryptString(token))
    clearTimeout(pending.timer)
    pendingDesktopLogin = null
    pending.resolve({ username: data.user?.username || '' })
  } catch (error) {
    clearTimeout(pending.timer)
    pendingDesktopLogin = null
    pending.reject(new Error(error.message || 'Could not import the website session.'))
  }
}

app.on('second-instance', (_event, commandLine) => {
  const deepLink = getDesktopLoginUrlFromArgs(commandLine)
  if (deepLink) void completeDesktopLogin(deepLink)
  showMainWindow()
})

function publishUpdaterState() {
  for (const window of windows) {
    if (!window.isDestroyed()) window.webContents.send('updates:state', { ...updaterState })
  }
}

function setUpdaterState(patch) {
  updaterState = { ...updaterState, ...patch }
  publishUpdaterState()
}

function updateTaskbarNotificationOverlay(count = unreadNotificationCount) {
  unreadNotificationCount = Math.max(0, Math.min(999999, Math.floor(Number(count) || 0)))
  let overlay = null
  if (process.platform === 'win32' && unreadNotificationCount > 0) {
    const label = unreadNotificationCount > 99 ? '99+' : String(unreadNotificationCount)
    overlay = nativeImage.createFromBuffer(createNotificationBadgePng(label))
  }
  for (const window of windows) {
    if (!window.isDestroyed()) {
      window.setOverlayIcon(overlay, unreadNotificationCount ? `${unreadNotificationCount} unread notifications` : '')
    }
  }
}

function createNotificationBadgePng(label) {
  const glyphs = {
    '0': ['111', '101', '101', '101', '111'],
    '1': ['010', '110', '010', '010', '111'],
    '2': ['111', '001', '111', '100', '111'],
    '3': ['111', '001', '111', '001', '111'],
    '4': ['101', '101', '111', '001', '001'],
    '5': ['111', '100', '111', '001', '111'],
    '6': ['111', '100', '111', '101', '111'],
    '7': ['111', '001', '010', '010', '010'],
    '8': ['111', '101', '111', '101', '111'],
    '9': ['111', '101', '111', '001', '111'],
    '+': ['010', '010', '111', '010', '010'],
  }
  const width = 32
  const height = 32
  const scale = label.length === 1 ? 4 : label.length === 2 ? 3 : 2
  const charWidth = 3 * scale
  const spacing = scale
  const textWidth = label.length * charWidth + Math.max(0, label.length - 1) * spacing
  const textHeight = 5 * scale
  const textX = Math.floor((width - textWidth) / 2)
  const textY = Math.floor((height - textHeight) / 2)
  const pixels = Buffer.alloc(width * height * 4)
  const putPixel = (x, y, color) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const offset = (y * width + x) * 4
    pixels[offset] = color[0]
    pixels[offset + 1] = color[1]
    pixels[offset + 2] = color[2]
    pixels[offset + 3] = color[3]
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x + 0.5 - width / 2
      const dy = y + 0.5 - height / 2
      if (dx * dx + dy * dy <= 15.5 * 15.5) putPixel(x, y, [239, 73, 102, 255])
    }
  }

  [...label].forEach((character, characterIndex) => {
    const rows = glyphs[character]
    if (!rows) return
    rows.forEach((row, rowIndex) => {
      for (let column = 0; column < row.length; column += 1) {
        if (row[column] !== '1') continue
        for (let y = 0; y < scale; y += 1) {
          for (let x = 0; x < scale; x += 1) {
            putPixel(
              textX + characterIndex * (charWidth + spacing) + column * scale + x,
              textY + rowIndex * scale + y,
              [255, 255, 255, 255],
            )
          }
        }
      }
    })
  })

  const rows = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) pixels.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  const crcTable = createNotificationPngCrcTable()
  const chunk = (type, data) => {
    const typeBuffer = Buffer.from(type)
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const checksumInput = Buffer.concat([typeBuffer, data])
    let checksum = 0xffffffff
    for (const byte of checksumInput) checksum = crcTable[(checksum ^ byte) & 0xff] ^ (checksum >>> 8)
    const checksumBuffer = Buffer.alloc(4)
    checksumBuffer.writeUInt32BE((checksum ^ 0xffffffff) >>> 0)
    return Buffer.concat([length, typeBuffer, data, checksumBuffer])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function createNotificationPngCrcTable() {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
}

function showWindowsNotification(title, body, route = '/notifications') {
  if (!Notification.isSupported()) return false
  const notification = new Notification({
    title: String(title || 'GameOnix').slice(0, 120),
    body: String(body || '').slice(0, 500),
    icon: getTrayIconPath(),
  })
  notification.on('click', () => openMainRoute(route === '/downloads' ? '/downloads' : '/notifications'))
  notification.show()
  return true
}

function registerWindowsNotificationShortcut() {
  if (process.platform !== 'win32' || !app.isPackaged) return
  const startMenuDirectory = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'GameOnix')
  fsSync.mkdirSync(startMenuDirectory, { recursive: true })
  const shortcutPath = path.join(startMenuDirectory, 'GameOnix.lnk')
  const details = {
    target: process.execPath,
    cwd: path.dirname(process.execPath),
    description: 'GameOnix Desktop',
    icon: getAppIconPath(),
    iconIndex: 0,
    appUserModelId: APP_USER_MODEL_ID,
    toastActivatorClsid: TOAST_ACTIVATOR_CLSID,
  }
  const operation = fsSync.existsSync(shortcutPath) ? 'update' : 'create'
  if (!shell.writeShortcutLink(shortcutPath, operation, details)) {
    throw new Error('Windows could not register the GameOnix notification shortcut.')
  }

  // Portable releases are often moved from a versioned extraction folder into
  // a stable folder such as D:\Programs\GameOnix. Repair existing user pins
  // after the app is launched from the new location so they stop targeting the
  // deleted extraction path and keep the same taskbar identity/icon.
  const shortcutDirectories = [
    app.getPath('desktop'),
    path.join(app.getPath('appData'), 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'),
    path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ]
  for (const directory of shortcutDirectories) {
    let entries = []
    try { entries = fsSync.readdirSync(directory, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.lnk') continue
      const existingPath = path.join(directory, entry.name)
      try {
        const existing = shell.readShortcutLink(existingPath)
        const shortcutName = path.basename(entry.name, '.lnk').toLowerCase()
        const targetName = path.basename(existing.target || '').toLowerCase()
        if (shortcutName !== 'gameonix' && targetName !== 'gameonix.exe') continue
        if (path.resolve(existing.target || '') === path.resolve(process.execPath) && existing.appUserModelId === APP_USER_MODEL_ID) continue
        shell.writeShortcutLink(existingPath, 'update', {
          ...existing,
          ...details,
          args: existing.args || '',
        })
      } catch (error) {
        console.warn(`Could not repair GameOnix shortcut ${existingPath}:`, error.message)
      }
    }
  }
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
  const updaterLogPath = path.join(app.getPath('userData'), 'updater.log')
  const script = `
$ErrorActionPreference = 'Stop'
$processToWaitFor = ${Number(process.pid)}
$installDirectory = ${psString(installDirectory)}
$archivePath = ${psString(archivePath)}
$executablePath = ${psString(executablePath)}
$logPath = ${psString(updaterLogPath)}
$stageDirectory = Join-Path $env:TEMP ('GameOnix-update-${version}-' + [guid]::NewGuid().ToString('N'))
$installSucceeded = $false
function Write-UpdateLog([string]$message) {
  $logDirectory = Split-Path -Parent $logPath
  if (-not (Test-Path -LiteralPath $logDirectory)) { New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null }
  Add-Content -LiteralPath $logPath -Value ('[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $message) -ErrorAction SilentlyContinue
}
try {
  Write-UpdateLog 'Waiting for GameOnix to close before applying the update.'
  $deadline = [DateTime]::UtcNow.AddMinutes(2)
  while ($true) {
    $process = Get-Process -Id $processToWaitFor -ErrorAction SilentlyContinue
    if (-not $process) { break }
    try {
      $processPath = $process.Path
      if ($processPath -and ([IO.Path]::GetFullPath($processPath) -ine [IO.Path]::GetFullPath($executablePath))) { break }
    } catch {}
    if ([DateTime]::UtcNow -ge $deadline) { throw 'Timed out waiting for GameOnix to close.' }
    Start-Sleep -Milliseconds 400
  }
  Write-UpdateLog ('Extracting update ' + '${version}' + '.')
  Expand-Archive -LiteralPath $archivePath -DestinationPath $stageDirectory -Force
  Write-UpdateLog ('Copying update files into ' + $installDirectory + '.')
  $robocopy = Join-Path $env:SystemRoot 'System32\\robocopy.exe'
  & $robocopy $stageDirectory $installDirectory /E /R:5 /W:1 /NFL /NDL /NJH /NJS
  $copyExitCode = $LASTEXITCODE
  Write-UpdateLog ('Robocopy finished with code ' + $copyExitCode + '.')
  if ($copyExitCode -ge 8) { throw ('Copying the update failed with robocopy code ' + $copyExitCode) }
  $installSucceeded = $true
  Write-UpdateLog ('Update ' + '${version}' + ' installed. Restarting GameOnix.')
  Start-Process -FilePath $executablePath -WorkingDirectory $installDirectory
} catch {
  Write-UpdateLog ('Update failed: ' + $_.Exception.Message)
  if (Test-Path -LiteralPath $executablePath) { Start-Process -FilePath $executablePath -WorkingDirectory $installDirectory }
} finally {
  Remove-Item -LiteralPath $stageDirectory -Recurse -Force -ErrorAction SilentlyContinue
  if ($installSucceeded) {
    Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
  }
}
`
  await fs.writeFile(scriptPath, script, 'utf8')
  await new Promise((resolve, reject) => {
    // Start a second PowerShell process through Start-Process. The first
    // process only launches it, so the installer is independent of Electron
    // shutting down and remains alive while replacing the app files.
    const launcher = `Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ${psString(scriptPath)}) -WindowStyle Hidden`
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', launcher], {
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
    trackerCount: Number(item.trackerCount) || 0,
    privateTorrent: Boolean(item.privateTorrent),
    trackerLastAnnounceAt: item.trackerLastAnnounceAt || null,
    dhtLastAnnounceAt: item.dhtLastAnnounceAt || null,
    lastPeerConnectedAt: item.lastPeerConnectedAt || null,
    peerSearchSources: Array.isArray(item.peerSearchSources) ? item.peerSearchSources : [],
    discoveryWarning: item.discoveryWarning || '',
    error: item.error || '',
    files: Array.isArray(item.files) ? item.files.map((file, index) => ({ ...file, selected: (item.selectedFiles || []).includes(index) })) : [],
    selectedFiles: Array.isArray(item.selectedFiles) ? item.selectedFiles : [],
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
  const records = [...downloads.values()].map(({ samples, smoothedSpeed, targetDirectory, lastBitfieldCheckpointAt, ...item }) => item)
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
  const announce = await loadSupplementalTrackers()
  torrentClient = new WebTorrent({ maxConns: 160, tracker: { announce }, natUpnp: true, natPmp: true, utp: true, utPex: true, lsd: true })
  torrentClient.on('error', (error) => console.error('Torrent client error:', error))
  return torrentClient
}

function parseTrackerList(value) {
  const trackers = String(value || '').split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(udp|https?):\/\//i.test(line))
    .filter((line) => {
      try {
        const url = new URL(line)
        return ['udp:', 'http:', 'https:'].includes(url.protocol) && url.hostname && url.pathname.length < 180
      } catch { return false }
    })
  return [...new Set(trackers)].slice(0, 20)
}

async function loadSupplementalTrackers() {
  if (supplementalTrackersPromise) return supplementalTrackersPromise
  supplementalTrackersPromise = (async () => {
    const cachePath = path.join(app.getPath('userData'), 'public-trackers-cache.json')
    let cachedTrackers = []
    let cachedAt = 0
    try {
      const cache = JSON.parse(await fs.readFile(cachePath, 'utf8'))
      cachedTrackers = parseTrackerList(Array.isArray(cache.trackers) ? cache.trackers.join('\n') : '')
      cachedAt = Number(cache.savedAt) || 0
    } catch {}
    if (cachedTrackers.length && Date.now() - cachedAt < 24 * 60 * 60 * 1000) return cachedTrackers

    try {
      const response = await net.fetch(TRACKER_LIST_URL, { signal: AbortSignal.timeout(3500) })
      if (!response.ok) throw new Error(`Tracker list returned ${response.status}.`)
      const trackers = parseTrackerList(await response.text())
      if (!trackers.length) throw new Error('Tracker list was empty.')
      await fs.writeFile(cachePath, JSON.stringify({ savedAt: Date.now(), trackers }), 'utf8')
      return trackers
    } catch (error) {
      console.warn('Could not refresh public tracker list; using cached/default trackers:', error.message)
      return cachedTrackers.length ? cachedTrackers : FALLBACK_TRACKERS
    }
  })().finally(() => { supplementalTrackersPromise = null })
  return supplementalTrackersPromise
}

function pauseTorrentRequests(torrent) {
  torrent.pause()
  if (!torrent.ready || !torrent.pieces?.length) return

  torrent.deselect(0, torrent.pieces.length - 1)
  for (const wire of torrent.wires || []) {
    for (const request of [...(wire.requests || [])]) {
      wire.cancel(request.piece, request.offset, request.length)
    }
  }
}

function resumeTorrentRequests(torrent) {
  if (torrent.destroyed) return
  torrent.resume()
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

function finalizeCompletedTorrent(item, torrent) {
  if (!torrent || torrent.destroyed || finalizingTorrents.has(item.id)) return
  finalizingTorrents.add(item.id)
  const selectedFiles = (item.selectedFiles || []).map((index) => torrent.files?.[index]).filter(Boolean)
  const total = selectedFiles.length
    ? selectedFiles.reduce((sum, file) => sum + (Number(file.length) || 0), 0)
    : Number(torrent.length) || Number(item.total) || 0
  item.status = 'finalizing'
  item.progress = 1
  item.downloaded = total
  item.total = total
  item.speed = 0
  item.etaSeconds = 0
  item.updatedAt = new Date().toISOString()
  if (torrent.bitfield?.buffer) item.bitfield = Buffer.from(torrent.bitfield.buffer).toString('base64')

  syncTray()
  void saveAndPublish()

  // Close the store to release Windows file handles and flush final file sizes.
  // destroyStore:false closes storage without deleting any downloaded files.
  torrent.destroy({ destroyStore: false }, (error) => {
    if (activeTorrents.get(item.id) === torrent) activeTorrents.delete(item.id)
    finalizingTorrents.delete(item.id)
    item.status = 'completed'
    item.progress = 1
    item.downloaded = total
    item.total = total
    item.speed = 0
    item.etaSeconds = 0
    item.peers = 0
    item.updatedAt = new Date().toISOString()
    if (!item.completionNotified) {
      item.completionNotified = true
      showWindowsNotification('Download Has been completed', `${item.title} has finished downloading.`, '/downloads')
    }
    if (error) {
      item.error = 'The download is complete, but GameOnix could not release its file handles.'
      console.error(`Could not close completed torrent files (${item.slug}):`, error)
    }
    void saveAndPublish()
    syncTray()
  })
}

function startStatsTimer() {
  if (downloadTimer) return
  downloadTimer = setInterval(() => {
    const now = Date.now()
    for (const [id, torrent] of activeTorrents) {
      const item = downloads.get(id)
      if (!item || !torrent || torrent.destroyed || finalizingTorrents.has(id)) continue
      if (torrent.ready && now - (item.lastBitfieldCheckpointAt || 0) >= 10_000) {
        item.bitfield = Buffer.from(torrent.bitfield.buffer).toString('base64')
        item.lastBitfieldCheckpointAt = now
      }
      const speed = torrent.paused ? 0 : getSmoothedSpeed(torrent, item)
      const selected = Array.isArray(item.selectedFiles) ? item.selectedFiles : []
      const files = selected.map((index) => torrent.files?.[index]).filter(Boolean)
      const total = files.length ? files.reduce((sum, file) => sum + (Number(file.length) || 0), 0) : Number(torrent.length) || Number(item.total) || 0
      const downloaded = files.length ? files.reduce((sum, file) => sum + (Number(file.downloaded) || 0), 0) : Number(torrent.downloaded) || Number(item.downloaded) || 0
      const remaining = Math.max(0, total - downloaded)
      const rawEta = speed > 1024 ? remaining / speed : null
      item.speed = speed
      item.progress = total ? Math.min(1, downloaded / total) : 0
      item.downloaded = downloaded
      item.total = total
      item.peers = Number(torrent.numPeers) || 0
      const selectedComplete = files.length > 0 && files.every((file) => file.done)
      if (selectedComplete) {
        finalizeCompletedTorrent(item, torrent)
      } else item.status = item.status === 'selecting' ? 'selecting' : torrent.paused ? 'paused' : Number(torrent.numPeers) === 0 ? 'starting' : torrent.done ? 'completed' : 'downloading'
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
  const pendingFileSelection = item.status === 'selecting'

  await fs.mkdir(item.targetDirectory, { recursive: true })
  item.status = 'starting'
  item.error = ''
  item.speed = 0
  item.etaSeconds = null
  item.updatedAt = new Date().toISOString()
  item.samples = []
  item.lastSample = null

  let savedBitfield
  if (typeof item.bitfield === 'string' && item.bitfield.length <= 16_000_000) {
    try {
      const bytes = Buffer.from(item.bitfield, 'base64')
      if (bytes.length && bytes.toString('base64') === item.bitfield) savedBitfield = new Uint8Array(bytes)
    } catch {}
  }

  const torrent = client.add(item.torrentUrl, {
    path: item.targetDirectory,
    // Keep peer discovery alive while the user chooses files. `deselect: true`
    // prevents payload requests until the chosen files are selected.
    paused: paused && !pendingFileSelection,
    strategy: 'rarest',
    maxWebConns: 8,
    noPeersIntervalTime: 15,
    destroyStoreOnDestroy: false,
    deselect: true,
    ...(savedBitfield ? { bitfield: savedBitfield } : {}),
  })
  activeTorrents.set(item.id, torrent)
  let resolveTorrentReady
  let rejectTorrentReady
  torrent.gameOnixReady = new Promise((resolve, reject) => {
    resolveTorrentReady = resolve
    rejectTorrentReady = reject
  })
  // A torrent can be prepared before the user confirms files; don't let that
  // intentionally pending promise surface as an unhandled rejection.
  torrent.gameOnixReady.catch(() => {})
  item.peerSearchSources = []
  item.discoveryWarning = ''
  torrent.on('trackerAnnounce', () => {
    item.trackerLastAnnounceAt = new Date().toISOString()
    item.discoveryWarning = ''
  })
  torrent.on('dhtAnnounce', () => {
    item.dhtLastAnnounceAt = new Date().toISOString()
    item.discoveryWarning = ''
  })
  torrent.on('noPeers', (source) => {
    const sources = new Set(item.peerSearchSources || [])
    sources.add(String(source || 'unknown'))
    item.peerSearchSources = [...sources]
    item.lastPeerSearchAt = new Date().toISOString()
  })
  torrent.on('wire', () => {
    item.lastPeerConnectedAt = new Date().toISOString()
  })
  torrent.on('warning', (error) => {
    item.discoveryWarning = String(error?.message || error || 'Peer discovery warning').slice(0, 220)
    console.warn(`Torrent discovery warning (${item.slug}):`, error)
  })
  torrent.on('metadata', () => {
    item.total = Number(torrent.length) || item.total
    item.title = item.title || torrent.name || item.slug
    item.privateTorrent = Boolean(torrent.private)
    item.trackerCount = Array.isArray(torrent.announce) ? torrent.announce.length : 0
    item.files = (torrent.files || []).map((file) => ({ name: file.name, length: Number(file.length) || 0 }))
    if (!Array.isArray(item.selectedFiles)) item.selectedFiles = pendingFileSelection ? [] : torrent.files.map((_, index) => index)
  })
  torrent.on('ready', () => {
    if (pendingFileSelection) torrent.deselect(0, Math.max(0, torrent.pieces.length - 1))
    else if (torrent.paused) pauseTorrentRequests(torrent)
    else {
      torrent.deselect(0, Math.max(0, torrent.pieces.length - 1))
      for (const index of item.selectedFiles || []) torrent.files[index]?.select()
    }
    item.status = pendingFileSelection ? 'selecting' : torrent.paused ? 'paused' : 'downloading'
    item.total = Number(torrent.length) || item.total
    item.title = item.title || torrent.name || item.slug
    item.infoHash = torrent.infoHash
    resolveTorrentReady()
    void saveAndPublish()
  })
  torrent.on('done', () => {
    finalizeCompletedTorrent(item, torrent)
  })
  torrent.on('error', (error) => {
    rejectTorrentReady(error)
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
  authSessionPath = path.join(app.getPath('userData'), 'gameonix-session-token.bin')
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

function hasActiveDownloads() {
  return [...downloads.values()].some((item) => ['downloading', 'starting', 'finalizing'].includes(item.status))
}

function hasHiddenWindow() {
  return [...windows].some((window) => !window.isDestroyed() && !window.isVisible())
}

function showMainWindow() {
  let window = getMainWindow()
  if (!window) window = createWindow()
  if (window.isMinimized()) window.restore()
  window.maximize()
  window.show()
  window.focus()
  syncTray()
  return window
}

function openMainRoute(route) {
  const window = showMainWindow()
  const navigate = () => window.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify(`#${route}`)}`).catch(() => {})
  if (window.webContents.isLoading()) window.webContents.once('did-finish-load', navigate)
  else navigate()
}

function syncTray() {
  if (!appSettings.closeToTray && !appSettings.launchAtStartup && !hasActiveDownloads() && !hasHiddenWindow()) {
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
    if (['downloading', 'starting', 'selecting'].includes(item.status)) {
      const wasSelecting = item.status === 'selecting'
      void startTorrent(item, { paused: wasSelecting }).catch((error) => {
        item.status = 'error'
        item.error = error.message
        void saveAndPublish()
      })
    }
  }
}

function createWindow({ startHidden = false } = {}) {
  const appIconPath = getAppIconPath()
  const appIcon = nativeImage.createFromPath(appIconPath)
  const window = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 960,
    minHeight: 650,
    backgroundColor: '#0b0d12',
    frame: false,
    icon: appIconPath,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  const applyWindowsTaskbarIdentity = () => {
    if (process.platform === 'win32') {
      window.setAppDetails({
        appId: APP_USER_MODEL_ID,
        appIconPath,
        appIconIndex: 0,
        relaunchCommand: `"${process.execPath}"`,
        relaunchDisplayName: 'GameOnix',
      })
    }
    if (!appIcon.isEmpty()) window.setIcon(appIconPath)
  }
  applyWindowsTaskbarIdentity()
  windows.add(window)
  updateTaskbarNotificationOverlay()
  const publishWindowState = () => {
    if (!window.isDestroyed()) window.webContents.send('window:state', window.isMaximized())
  }
  window.on('maximize', publishWindowState)
  window.on('unmaximize', publishWindowState)
  window.once('ready-to-show', () => {
    // Reapply the ICO after Windows creates the native HWND; this refreshes
    // both the title-bar and taskbar button icons for frameless windows.
    applyWindowsTaskbarIdentity()
    if (startHidden) {
      window.maximize()
      return
    }
    window.show()
    window.maximize()
    applyWindowsTaskbarIdentity()
  })
  window.on('close', (event) => {
    if (isQuitting || (!appSettings.closeToTray && !hasActiveDownloads())) return
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
  ipcMain.handle('auth-session:get', async (event) => {
    requireTrustedFrame(event)
    if (!safeStorage.isEncryptionAvailable()) return ''
    try {
      return safeStorage.decryptString(await fs.readFile(authSessionPath))
    } catch {
      return ''
    }
  })
  ipcMain.handle('auth-session:website-login', async (event) => {
    requireTrustedFrame(event)
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure session storage is unavailable on this device.')
    if (pendingDesktopLogin) throw new Error('A website sign-in is already waiting to finish.')
    const state = crypto.randomBytes(32).toString('hex')
    const key = crypto.randomBytes(32)
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingDesktopLogin = null
        reject(new Error('Website sign-in timed out. Try again.'))
      }, 3 * 60 * 1000)
      pendingDesktopLogin = { state, key, resolve, reject, timer }
    })
    try {
      await shell.openExternal(`https://www.gameonix.shop/desktop-login#handoff?state=${state}&key=${key.toString('base64url')}`)
    } catch (error) {
      clearTimeout(pendingDesktopLogin?.timer)
      pendingDesktopLogin = null
      throw error
    }
    return result
  })
  ipcMain.handle('auth-session:set', async (event, token) => {
    requireTrustedFrame(event)
    if (typeof token !== 'string' || !token || token.length > 8192 || !safeStorage.isEncryptionAvailable()) return false
    await fs.writeFile(authSessionPath, safeStorage.encryptString(token))
    return true
  })
  ipcMain.handle('auth-session:clear', async (event) => {
    requireTrustedFrame(event)
    await fs.rm(authSessionPath, { force: true })
    return true
  })
  ipcMain.handle('notifications:set-unread-count', (event, count) => {
    requireTrustedFrame(event)
    const unreadCount = Math.max(0, Math.min(999999, Math.floor(Number(count) || 0)))
    updateTaskbarNotificationOverlay(unreadCount)
    return unreadCount
  })
  ipcMain.handle('notifications:show', (event, { title, body, route } = {}) => {
    requireTrustedFrame(event)
    return showWindowsNotification(title, body, route)
  })
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
  ipcMain.handle('downloads:prepare', async (event, game) => {
    requireTrustedFrame(event)
    const slug = safeSlug(game?.slug)
    const title = String(game?.title || '').trim().slice(0, 160) || slug
    const torrentUrl = String(game?.torrentUrl || '')
    if (!torrentUrl.startsWith(TRUSTED_TORRENT_PREFIX) || !torrentUrl.toLowerCase().endsWith('.torrent')) {
      throw new Error('This game does not have a supported GameOnix torrent file.')
    }
    const existing = downloads.get(slug)
    if (existing) {
      if (existing.status === 'paused' || existing.status === 'error' || existing.status === 'selecting' || !activeTorrents.get(slug) || activeTorrents.get(slug).destroyed) await startTorrent(existing, { paused: true })
      return { id: slug, downloads: getSnapshot() }
    }
    const item = {
      id: slug,
      slug,
      title,
      torrentUrl,
      status: 'selecting',
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
      selectedFiles: [],
      files: [],
    }
    downloads.set(slug, item)
    syncTray()
    try {
      await startTorrent(item)
      syncTray()
      return { id: slug, downloads: getSnapshot() }
    } catch (error) {
      item.status = 'error'
      item.error = error.message || 'Could not start this torrent.'
      await saveAndPublish()
      throw error
    }
  })
  ipcMain.handle('downloads:begin', async (event, { id, fileIndices } = {}) => {
    requireTrustedFrame(event)
    const item = downloads.get(safeSlug(id))
    if (!item) throw new Error('Download not found.')
    const torrent = activeTorrents.get(item.id)
    if (!torrent || torrent.destroyed) throw new Error('Torrent is not available. Remove it and start again.')
    if (!torrent.ready) {
      let timeoutId
      try {
        await Promise.race([
          torrent.gameOnixReady || new Promise((resolve, reject) => {
            torrent.once('ready', resolve)
            torrent.once('error', reject)
          }),
          new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error('The torrent metadata is taking too long. Try again in a moment.')), 90000) }),
        ])
      } finally {
        clearTimeout(timeoutId)
      }
    }
    if (torrent.destroyed || !torrent.ready) throw new Error('Torrent stopped before its file list was ready. Try again.')
    const selected = [...new Set((Array.isArray(fileIndices) ? fileIndices : []).map(Number).filter((index) => Number.isInteger(index) && index >= 0 && index < torrent.files.length))]
    if (!selected.length) throw new Error('Choose at least one file to download.')
    item.selectedFiles = selected
    item.completionNotified = false
    item.status = 'starting'
    item.error = ''
    item.total = selected.reduce((sum, index) => sum + (Number(torrent.files[index].length) || 0), 0)
    item.downloaded = selected.reduce((sum, index) => sum + (Number(torrent.files[index].downloaded) || 0), 0)
    torrent.deselect(0, Math.max(0, torrent.pieces.length - 1))
    for (const index of selected) torrent.files[index].select()
    torrent.resume()
    item.status = Number(torrent.numPeers) === 0 ? 'starting' : 'downloading'
    await saveAndPublish()
    syncTray()
    return getSnapshot()
  })
  ipcMain.handle('downloads:pause', async (event, id) => {
    requireTrustedFrame(event)
    const item = downloads.get(safeSlug(id))
    if (!item) throw new Error('Download not found.')
    const torrent = activeTorrents.get(item.id)
    if (torrent && !torrent.destroyed) {
      const selectedFiles = (item.selectedFiles || []).map((index) => torrent.files?.[index]).filter(Boolean)
      item.total = selectedFiles.length ? selectedFiles.reduce((sum, file) => sum + (Number(file.length) || 0), 0) : Number(torrent.length) || item.total
      item.downloaded = selectedFiles.length ? selectedFiles.reduce((sum, file) => sum + (Number(file.downloaded) || 0), 0) : Number(torrent.downloaded) || item.downloaded
      item.progress = item.total ? Math.min(1, item.downloaded / item.total) : 0
      // Keep peer connections and partial-piece buffers. Cancel outstanding
      // requests so no more data is received until Resume reselects the files.
      pauseTorrentRequests(torrent)
    }
    item.status = 'paused'
    item.speed = 0
    item.etaSeconds = null
    await saveAndPublish()
    syncTray()
    return getSnapshot()
  })
  ipcMain.handle('downloads:resume', async (event, id) => {
    requireTrustedFrame(event)
    const item = downloads.get(safeSlug(id))
    if (!item) throw new Error('Download not found.')
    const torrent = activeTorrents.get(item.id)
    if (torrent && !torrent.destroyed) {
      torrent.deselect(0, Math.max(0, torrent.pieces.length - 1))
      for (const index of item.selectedFiles || []) torrent.files[index]?.select()
      resumeTorrentRequests(torrent)
      item.status = 'downloading'
      item.error = ''
      item.updatedAt = new Date().toISOString()
      await saveAndPublish()
    } else {
      await startTorrent(item)
    }
    syncTray()
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
    syncTray()
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
  if (!singleInstanceLock) return
  if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID)
  Menu.setApplicationMenu(null)
  await loadDownloadState()
  applyStartupSetting()
  syncTray()
  registerDownloadIpc()
  if (process.platform === 'win32') {
    try {
      if (app.isPackaged) app.setAsDefaultProtocolClient('gameonix')
      else app.setAsDefaultProtocolClient('gameonix', process.execPath, [path.resolve(process.argv[1] || '.')])
    } catch (error) {
      console.error('Could not register the GameOnix website sign-in link:', error)
    }
  }
  if (app.isPackaged) await registerAppProtocol()
  const startHidden = appSettings.launchAtStartup && (process.argv.includes('--startup') || app.getLoginItemSettings?.().wasOpenedAtLogin)
  createWindow({ startHidden })
  if (process.platform === 'win32' && app.isPackaged) {
    try {
      app.setToastActivatorCLSID(TOAST_ACTIVATOR_CLSID)
      registerWindowsNotificationShortcut()
      Notification.handleActivation(() => openMainRoute('/notifications'))
    } catch (error) {
      console.error('Could not register Windows notifications:', error)
    }
  }
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
  const checkpointAndPause = async () => {
    for (const [id, torrent] of activeTorrents) {
      const item = downloads.get(id)
      if (!item || !torrent || torrent.destroyed) continue
      const wasPaused = torrent.paused
      item.downloaded = Number(torrent.downloaded) || item.downloaded
      item.total = Number(torrent.length) || item.total
      item.progress = Number(torrent.progress) || item.progress
      item.status = torrent.done ? 'completed' : wasPaused ? 'paused' : 'downloading'
      if (torrent.bitfield?.buffer) item.bitfield = Buffer.from(torrent.bitfield.buffer).toString('base64')
      if (!wasPaused && !torrent.done) pauseTorrentRequests(torrent)
    }
    await persistDownloads()
  }
  void checkpointAndPause().catch((error) => console.error('Could not save download checkpoints before closing:', error)).finally(() => {
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
