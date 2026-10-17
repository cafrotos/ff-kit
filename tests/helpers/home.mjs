import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const pkgVersion = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version

/** Point HOME at a fixture whose installed_plugins.json matches the CLI version (hermetic doctor). */
export function fakeHome(t, version = pkgVersion) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-home-'))
  fs.mkdirSync(path.join(home, '.claude/plugins'), { recursive: true })
  fs.writeFileSync(path.join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'ff-kit@ff-kit': [{ scope: 'user', version }] } }))
  const prev = process.env.HOME
  process.env.HOME = home
  t.after(() => { process.env.HOME = prev; fs.rmSync(home, { recursive: true, force: true }) })
}
