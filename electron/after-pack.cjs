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
}
