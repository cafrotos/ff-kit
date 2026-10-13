import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { main } from '../scripts/cli/main.mjs'
import { makeWorkspace, baseConfig } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'

async function readyWorkspace(t) {
  const config = baseConfig()
  config.repos[0].commands.migrate = 'node migrate.js'
  config.e2e = { dir: 'ff-e2e', up_cmd: 'node up.js', down_cmd: 'node down.js', health_urls: ['http://localhost:8080/health'], apps: [{ name: 'web', base_url: 'http://localhost:3001' }] }
  const ws = makeWorkspace({ config, files: {
    'trellocards/123-sample/01-dossier.md': '# Card\n\n## 🌿 Branch\n\n```text\nfeature/test\n```\n',
    'ff-e2e/package.json': '{}',
    'ff-e2e/node_modules/@playwright/test/package.json': '{"name":"@playwright/test"}',
    'ff-e2e/node_modules/.bin/playwright': '#!/bin/sh\nexit 0\n',
    'ff-e2e/node_modules/playwright/index.js': "exports.chromium = { executablePath: () => '/tmp/fake-chromium' }",
    'worktrees/123-sample/web/migrate.js': '',
    'worktrees/123-sample/web/.git/HEAD': 'ref: refs/heads/feature/test\n',
    'ff-e2e/up.js': '',
    'ff-e2e/down.js': '',
  } })
  fs.writeFileSync(path.join(ws.root, 'ff-e2e/node_modules/.bin/playwright'), '#!/bin/sh\nexit 0\n')
  fs.chmodSync(path.join(ws.root, 'ff-e2e/node_modules/.bin/playwright'), 0o755)
  fs.writeFileSync(path.join(ws.root, 'ff-e2e/node_modules/playwright/index.js'), `exports.chromium = { executablePath: () => ${JSON.stringify(path.join(ws.root, 'ff-e2e/chromium'))} }`)
  fs.writeFileSync(path.join(ws.root, 'ff-e2e/chromium'), '')
  // The fixture's fake .git is enough to test command dispatch; replace it with a cloned repo.
  fs.rmSync(path.join(ws.root, 'worktrees/123-sample'), { recursive: true, force: true })
  const { ctx } = capture(ws.root)
  ctx.runCommand = () => ({ status: 0, stdout: '', stderr: '' })
  ctx.fetch = async () => ({ status: 404 })
  t.after(ws.cleanup)
  return { ...ws, ctx }
}

test('verify-up acquires lock, runs migrations and health checks; verify-down releases lock', async (t) => {
  const ws = await readyWorkspace(t)
  assert.equal(await main(['copy', '123'], ws.ctx), 0)
  const configFile = path.join(ws.root, 'ff.config.yaml')
  const config = YAML.parse(fs.readFileSync(configFile, 'utf8'))
  config.repos[0].commands.install = undefined
  fs.writeFileSync(configFile, YAML.stringify(config))
  const calls = []
  ws.ctx.runCommand = (command, cwd) => { calls.push([command, path.relative(ws.root, cwd)]); return { status: 0 } }
  assert.equal(await main(['verify-up', '123', 'web'], ws.ctx), 0)
  const lock = path.join(ws.root, 'worktrees/.verify.lock')
  assert.equal(fs.existsSync(lock), true)
  assert.ok(calls.some(([cmd]) => cmd === 'node migrate.js'))
  assert.ok(calls.some(([cmd]) => cmd === 'node up.js'))
  assert.equal(await main(['verify-down', '123'], ws.ctx), 0)
  assert.equal(fs.existsSync(lock), false)
  assert.ok(calls.some(([cmd]) => cmd === 'node down.js'))
})

test('verify-up rejects a competing card lock and verify-down preserves it', async (t) => {
  const ws = await readyWorkspace(t)
  assert.equal(await main(['copy', '123'], ws.ctx), 0)
  fs.writeFileSync(path.join(ws.root, 'worktrees/.verify.lock'), JSON.stringify({ slug: '999-other' }))
  const { buf } = capture(ws.root)
  assert.equal(await main(['verify-up', '123', 'web'], { ...ws.ctx, stdout: { write: (s) => { buf.out += s } }, stderr: { write: (s) => { buf.err += s } } }), 1)
  assert.match(buf.err, /đang verify/)
  assert.equal(await main(['verify-down', '123'], ws.ctx), 1)
  assert.equal(JSON.parse(fs.readFileSync(path.join(ws.root, 'worktrees/.verify.lock'), 'utf8')).slug, '999-other')
})
