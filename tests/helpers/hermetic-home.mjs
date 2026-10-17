// Side-effect import: point HOME at a fixture whose installed_plugins.json matches this package version,
// so doctor's plugin/CLI version check never reads the real ~/.claude. Spawned children inherit process.env.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pkgVersion } from './home.mjs'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-hermetic-home-'))
fs.mkdirSync(path.join(home, '.claude/plugins'), { recursive: true })
fs.writeFileSync(path.join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'ff-kit@ff-kit': [{ scope: 'user', version: pkgVersion }] } }))
process.env.HOME = home
process.on('exit', () => { try { fs.rmSync(home, { recursive: true, force: true }) } catch {} })
