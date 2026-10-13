import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { main } from '../scripts/cli/main.mjs'
import { makeWorkspace, baseConfig } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'

test('two-repo workspace accepts config, doctor and e2e scaffold without network', async (t) => {
  const config = baseConfig()
  config.repos.push({ name: 'api', path: 'api', base_branch: 'main', ship_branch: 'main', commands: { test: 'node --version' } })
  const ws = makeWorkspace({ config, files: { '.ff.env': 'TRELLO_API_KEY=local\nTRELLO_API_TOKEN=local\n' } })
  t.after(ws.cleanup)

  const doctor = capture(ws.root)
  assert.equal(await main(['doctor'], doctor.ctx), 0, doctor.buf.out + doctor.buf.err)
  assert.match(doctor.buf.out, /repo web: base_branch dev có/)
  assert.match(doctor.buf.out, /repo api: ship_branch main có/)
  assert.doesNotMatch(doctor.buf.out, /local/)
  assert.match(doctor.buf.out, /\[optional\].*Playwright/)

  const cfg = capture(ws.root)
  assert.equal(await main(['cfg', 'get', 'workspace.cards_dir'], cfg.ctx), 0, cfg.buf.err)
  assert.match(cfg.buf.out, /trellocards/)

  const scaffold = capture(ws.root)
  scaffold.ctx.install = async () => ({ status: 0 })
  assert.equal(await main(['e2e-scaffold'], scaffold.ctx), 0, scaffold.buf.out + scaffold.buf.err)
  const e2e = path.join(ws.root, 'ff-e2e')
  assert.equal(fs.existsSync(path.join(e2e, 'playwright.config.ts')), true)
  assert.equal(fs.existsSync(path.join(e2e, '.git')), false)
  assert.equal(fs.existsSync(path.join(e2e, 'helpers/db.ts')), false)
})
