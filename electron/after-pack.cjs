const { execFileSync } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')

module.exports = async function preserveThirdPartyNotices(context) {
  const appDirectory = context.appOutDir
  const names = ['LICENSE.electron.txt', 'LICENSES.chromium.html']
  const contents = []
  for (const name of names) {
    const file = path.join(appDirectory, name)
    try {
      const text = await fs.readFile(file, 'utf8')
      contents.push(`<h2>${name.replace(/[<>&"']/g, '')}</h2><pre>${text.replace(/[<>&]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[character])}</pre>`)
      await fs.rm(file, { force: true })
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  if (contents.length) {
    const noticeFile = path.join(appDirectory, 'THIRD-PARTY-NOTICES.html')
    await fs.writeFile(noticeFile, `${contents.join('\n')}\n`, 'utf8')
  }

  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const compilerCandidates = [
    path.join(systemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(systemRoot, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ]
  let compilerPath = ''
  for (const candidate of compilerCandidates) {
    try { await fs.access(candidate); compilerPath = candidate; break } catch {}
  }
  if (!compilerPath) throw new Error('The Windows C# compiler is required to build GameOnixUpdater.exe.')
  const updaterSource = path.join(__dirname, 'GameOnixUpdater.cs')
  const updaterOutput = path.join(appDirectory, 'resources', 'GameOnixUpdater.exe')
  await fs.mkdir(path.dirname(updaterOutput), { recursive: true })
  execFileSync(compilerPath, [
    '/nologo', '/target:winexe', '/optimize+', `/out:${updaterOutput}`,
    '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll',
    '/reference:System.IO.Compression.dll', '/reference:System.IO.Compression.FileSystem.dll',
    updaterSource,
  ], { stdio: 'inherit' })
}
