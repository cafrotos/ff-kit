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
  ctx.fetch = async () => ({ status: 200, ok: true })
  ctx.sleep = async () => {}
  ctx.healthAttempts = 3
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


test('verify-up rejects unhealthy HTTP responses and retains lock until cleanup', async (t) => {
  const ws = await readyWorkspace(t)
  assert.equal(await main(['copy', '123'], ws.ctx), 0)
  let attempts = 0
  ws.ctx.fetch = async () => { attempts++; return { status: 503, ok: false } }
  assert.equal(await main(['verify-up', '123', 'web'], ws.ctx), 1)
  assert.equal(attempts, 3)
  const lock = path.join(ws.root, 'worktrees/.verify.lock')
  assert.equal(fs.existsSync(lock), true)
  assert.equal(await main(['verify-down', '123'], ws.ctx), 0)
  assert.equal(fs.existsSync(lock), false)
})

test('verify-up waits for readiness and accepts only successful responses', async (t) => {
  const ws = await readyWorkspace(t)
  assert.equal(await main(['copy', '123'], ws.ctx), 0)
  let attempts = 0
  ws.ctx.fetch = async () => { attempts++; if (attempts === 1) throw new Error('starting'); return { status: attempts === 2 ? 404 : 200 } }
  assert.equal(await main(['verify-up', '123', 'web'], ws.ctx), 0)
  assert.equal(attempts, 4)
})

test('verify-up preserves an existing same-card lock when migration fails', async (t) => {
  const ws = await readyWorkspace(t)
  assert.equal(await main(['copy', '123'], ws.ctx), 0)
  const lock = path.join(ws.root, 'worktrees/.verify.lock')
  fs.writeFileSync(lock, JSON.stringify({ slug: '123-sample' }))
  ws.ctx.runCommand = () => ({ status: 1 })
  assert.equal(await main(['verify-up', '123', 'web'], ws.ctx), 1)
  assert.equal(fs.existsSync(lock), true)
})

test('verify-down preserves lock when cleanup is not configured', async (t) => {
  const ws = await readyWorkspace(t)
  assert.equal(await main(['copy', '123'], ws.ctx), 0)
  const configFile = path.join(ws.root, 'ff.config.yaml')
  const config = YAML.parse(fs.readFileSync(configFile, 'utf8'))
  delete config.e2e.down_cmd
  fs.writeFileSync(configFile, YAML.stringify(config))
  const lock = path.join(ws.root, 'worktrees/.verify.lock')
  fs.writeFileSync(lock, JSON.stringify({ slug: '123-sample' }))
  assert.equal(await main(['verify-down', '123'], ws.ctx), 1)
  assert.equal(fs.existsSync(lock), true)
})

test('verify-up releases newly acquired lock after migration failure before startup', async (t) => {
  const ws = await readyWorkspace(t)
  assert.equal(await main(['copy', '123'], ws.ctx), 0)
  ws.ctx.runCommand = () => ({ status: 1 })
  assert.equal(await main(['verify-up', '123', 'web'], ws.ctx), 1)
  assert.equal(fs.existsSync(path.join(ws.root, 'worktrees/.verify.lock')), false)
})

test('verify-up retains lock when startup may have failed after partially starting', async (t) => {
  const ws = await readyWorkspace(t)
  assert.equal(await main(['copy', '123'], ws.ctx), 0)
  ws.ctx.runCommand = (command) => ({ status: command === 'node up.js' ? 1 : 0 })
  assert.equal(await main(['verify-up', '123', 'web'], ws.ctx), 1)
  assert.equal(fs.existsSync(path.join(ws.root, 'worktrees/.verify.lock')), true)
})
