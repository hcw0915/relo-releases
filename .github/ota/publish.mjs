// Uploads signed OTA records pushed to queue/<tag>/ as assets of release <tag> (history-* first, current.json last).
// Pushed by hcw0915/Relo emergency-rollback.yml via a write deploy key. Every record must verify against the app's
// embedded certificate and match its tag (line/platform/runtime) — anything else is refused. Assets are content-addressed
// and must already exist in the release (re-promotion only), so this never uploads code.
import crypto from 'node:crypto'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
const cert = new crypto.X509Certificate(fs.readFileSync('.github/ota/certificate.pem', 'utf8')).publicKey
const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8' })
const files = (process.env.CHANGED || '').split('\n').filter((f) => /^queue\/ota-[0-9.]+-(android|ios)-[0-9a-f]{40}\/(current|history-[0-9TZ-]+-(update|rollBackToEmbedded))\.json$/.test(f) && fs.existsSync(f))
if (!files.length) { console.log('nothing to publish'); process.exit(0) }
const byTag = {}
for (const f of files) { const [, tag, name] = f.split('/'); (byTag[tag] ??= []).push({ f, name }) }
for (const [tag, list] of Object.entries(byTag)) {
  const [, line, platform, runtime] = /^ota-([0-9.]+)-(android|ios)-([0-9a-f]{40})$/.exec(tag)
  const assets = new Set(JSON.parse(gh('release', 'view', tag, '--json', 'assets')).assets.map((a) => a.name))
  for (const { f, name } of list) {
    const r = JSON.parse(fs.readFileSync(f, 'utf8'))
    const m = /sig="([^"]+)"/.exec(r.signature || '')
    if (r.schema !== 1 || r.line !== line || r.platform !== platform || r.runtimeVersion !== runtime) throw new Error(`${f}: record does not match its tag`)
    if (!m || !crypto.verify('sha256', Buffer.from(r.body, 'utf8'), cert, Buffer.from(m[1], 'base64'))) throw new Error(`${f}: signature does not verify`)
    if (r.kind === 'update') {
      const man = JSON.parse(r.body)
      if (man.runtimeVersion !== runtime) throw new Error(`${f}: manifest runtime mismatch`)
      for (const a of [man.launchAsset, ...(man.assets || [])]) {
        const key = String(a.url).split('/').pop()
        if (!assets.has(key)) throw new Error(`${f}: asset ${key} is not already in ${tag} (re-promotion only)`)
      }
    }
    console.log(`verified ${f} (${r.kind}${r.kind === 'update' ? ' ' + JSON.parse(r.body).id : ''})`)
  }
  for (const { f, name } of list.filter((x) => x.name !== 'current.json')) gh('release', 'upload', tag, f, '--clobber')
  for (const { f } of list.filter((x) => x.name === 'current.json')) gh('release', 'upload', tag, f, '--clobber')
  console.log(`published ${tag}`)
}
