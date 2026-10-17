import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import YAML from 'yaml'
import { validate } from '../scripts/lib/schema.mjs'
import { runDoctor } from '../scripts/lib/doctor.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { applyEnvOverrides, loadServiceEnv, parseEnvFile } from '../scripts/lib/services.mjs'
import { main } from '../scripts/cli/main.mjs'
import { makeWorkspace, baseConfig, git, writeLock } from './helpers/fixture.mjs'
import { makeShipWorkspace } from './helpers/ship.mjs'
import { commitShipFixture as commit } from './helpers/ship-authorized.mjs'
import { prepareShipTest } from '../scripts/lib/ship.mjs'
import { capture } from './helpers/io.mjs'

const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) }) })
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
const listening = (port) => new Promise((resolve) => { const s = net.connect({ host: '127.0.0.1', port }); s.once('connect', () => { s.destroy(); resolve(true) }); s.once('error', () => resolve(false)) })

// Lightweight real service: records cwd + env into files, spawns a grandchild, serves HTTP.
const serverCmd = (port, extra = '') => `node -e 'const fs=require("fs");fs.writeFileSync("cwd.txt",process.cwd()+"\\n"+(process.env.FF_TEST_VAL||""));const c=require("child_process").spawn("sleep",["300"],{stdio:"ignore"});fs.writeFileSync("child.pid",String(c.pid));${extra}require("http").createServer((q,r)=>r.end("ok")).listen(${port},"0.0.0.0")'`

const e2eFiles = {
  'ff-e2e/package.json': '{}',
  'ff-e2e/node_modules/@playwright/test/package.json': '{"name":"@playwright/test"}',
  'ff-e2e/node_modules/playwright/index.js': '',
  'ff-e2e/chromium': '',
}
function e2eFixture(root) {
  for (const [rel, body] of Object.entries(e2eFiles)) { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body) }
  fs.writeFileSync(path.join(root, 'ff-e2e/node_modules/playwright/index.js'), `exports.chromium = { executablePath: () => ${JSON.stringify(path.join(root, 'ff-e2e/chromium'))} }`)
  fs.mkdirSync(path.join(root, 'ff-e2e/node_modules/.bin'), { recursive: true })
  fs.writeFileSync(path.join(root, 'ff-e2e/node_modules/.bin/playwright'), '#!/bin/sh\nexit 0\n')
  fs.chmodSync(path.join(root, 'ff-e2e/node_modules/.bin/playwright'), 0o755)
}

async function workspaceWithServices(t, services, { repoExtra } = {}) {
  const config = baseConfig()
  config.ship = { verify_on_ship_branch: false }
  Object.assign(config.repos[0], repoExtra ?? {})
  config.e2e = { dir: 'ff-e2e', services: services.map((s) => ({ repo: 'web', ...s })), apps: [{ name: 'web', base_url: 'http://localhost:3001' }] }
  const ws = makeWorkspace({ config, files: { 'trellocards/123-sample/01-dossier.md': '# Card\n\n## 🌿 Branch\n\n```text\nfeature/test\n```\n' } })
  e2eFixture(ws.root)
  const { ctx } = capture(ws.root)
  ctx.fetch = async () => ({ status: 200, ok: true })
  ctx.sleep = async () => {}
  ctx.healthAttempts = 1
  ctx.killTimeoutMs = 2000
  ctx.serviceStartTimeoutMs = 20000
  t.after(async () => { await main(['verify-down', '123', '--force-unlock'], ctx).catch(() => {}); ws.cleanup() })
  assert.equal(await main(['copy', '123'], ctx), 0)
  return { ...ws, ctx, config, wt: path.join(ws.root, 'worktrees/123-sample/web') }
}

test('schema: e2e.services valid, required fields, duplicate names, unsafe paths', () => {
  const base = () => { const c = baseConfig(); c.e2e = { dir: 'e2e', services: [{ name: 'be', repo: 'web', cmd: 'yarn start', port: 8080, env_load: ['.env.local'], health_url: 'http://localhost:8080/health', env_overrides: [{ file: '.env.development.local', from: '.env.development', set: { VITE_API_BASE_URL: 'http://x' } }] }] }; return c }
  assert.deepEqual(validate(base()), [])
  let c = base(); delete c.e2e.services[0].port; assert.ok(validate(c).some((e) => /port/.test(e)))
  c = base(); c.e2e.services[0].port = 'abc'; assert.ok(validate(c).length)
  c = base(); c.e2e.services.push({ ...c.e2e.services[0] }); assert.ok(validate(c).some((e) => /trùng/.test(e)))
  c = base(); c.e2e.services[0].cwd = '../x'; assert.ok(validate(c).some((e) => /cwd/.test(e)))
  c = base(); c.e2e.services[0].env_overrides[0].from = '/etc/passwd'; assert.ok(validate(c).some((e) => /env_overrides\.from/.test(e)))
  c = base(); c.e2e.services[0].env_overrides[0].set = { 'BAD KEY': 'x' }; assert.ok(validate(c).length)
  c = base(); c.e2e.services[0].bogus = 1; assert.ok(validate(c).length)
})

test('applyEnvOverrides: template copied once, keys set, idempotent, no sed', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? '/tmp'), 'ff-env-'))
  fs.mkdirSync(path.join(dir, 'apps/crm'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'apps/crm/.env.development'), '# c\nVITE_HOME_URL=https://prod\nOTHER=keep\n')
  const o = [{ file: 'apps/crm/.env.development.local', from: 'apps/crm/.env.development', set: { VITE_HOME_URL: 'http://localhost:3000', VITE_API_BASE_URL: 'http://localhost:8080/api/v1' } }]
  assert.equal(applyEnvOverrides(dir, o).length, 1)
  const first = fs.readFileSync(path.join(dir, 'apps/crm/.env.development.local'), 'utf8')
  assert.equal(first, '# c\nVITE_HOME_URL=http://localhost:3000\nOTHER=keep\nVITE_API_BASE_URL=http://localhost:8080/api/v1\n')
  assert.deepEqual(applyEnvOverrides(dir, o), []) // idempotent: nothing changes
  fs.appendFileSync(path.join(dir, 'apps/crm/.env.development'), 'NEW=1\n') // template change does not clobber the existing local file
  applyEnvOverrides(dir, o)
  assert.equal(fs.readFileSync(path.join(dir, 'apps/crm/.env.development.local'), 'utf8'), first)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('env_load: dotenv parsing, process env wins over file values', () => {
  assert.deepEqual(parseEnvFile('# x\nA=1\nexport B="two words"\nC=\'q\'\nD=3 # c\n'), { A: '1', B: 'two words', C: 'q', D: '3' })
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? '/tmp'), 'ff-env-'))
  fs.writeFileSync(path.join(dir, '.env.local'), 'A=file\nB=file\n')
  const env = loadServiceEnv({ env_load: ['.env.local', '.missing'] }, dir, { A: 'proc' })
  assert.equal(env.A, 'proc'); assert.equal(env.B, 'file')
  fs.rmSync(dir, { recursive: true, force: true })
})

function driverConfig(services, extra = {}) {
  const c = baseConfig()
  c.worker.driver = { enabled: true }
  c.worker.task_source.trello.accept_list = 'Todo'; c.worker.task_source.trello.reopen_list = 'Reopen'
  c.e2e = { dir: 'ff-e2e', ...(services ? { services } : {}), ...extra }
  return c
}
const doctorMsgs = (t, config, files = {}) => {
  const ws = makeWorkspace({ config, files: { '.ff.env': 'TRELLO_API_KEY=a\nTRELLO_API_TOKEN=b\n', ...files } }); t.after(ws.cleanup)
  e2eFixture(ws.root)
  const r = runDoctor(ws.root, loadConfig(ws.root))
  return { r, bad: r.checks.filter((c) => !c.ok && c.group === 'e2e').map((c) => c.msg).join('\n') }
}
const svc = (o = {}) => ({ name: 'be', repo: 'web', cmd: 'node -v', port: 8080, ...o })

test('doctor (driver on): e2e red without services or up_cmd+down_cmd; green with either', (t) => {
  assert.match(doctorMsgs(t, driverConfig(null)).bad, /e2e\.services/)
  assert.match(doctorMsgs(t, driverConfig(null, { up_cmd: 'node -v' })).bad, /e2e\.services/)
  assert.doesNotMatch(doctorMsgs(t, driverConfig(null, { up_cmd: 'node -v', down_cmd: 'node -v' })).bad, /e2e\.services/)
  assert.doesNotMatch(doctorMsgs(t, driverConfig([svc()])).bad, /e2e\.services|cổng|template/)
})

test('doctor: unknown repo, duplicate port, missing env template, missing env_files are red', (t) => {
  assert.match(doctorMsgs(t, driverConfig([svc({ repo: 'nope' })])).bad, /repo không có trong repos\[\]: nope/)
  assert.match(doctorMsgs(t, driverConfig([svc(), svc({ name: 'fe', port: 8080 })])).bad, /cổng 8080 trùng với service be/)
  assert.match(doctorMsgs(t, driverConfig([svc({ env_overrides: [{ file: '.env.local', from: '.env.tpl', set: { A: '1' } }] })])).bad, /thiếu template \.env\.tpl/)
  const c = driverConfig([svc()]); c.repos[0].env_files = ['.env.local']
  assert.match(doctorMsgs(t, c).bad, /env_files thiếu \.env\.local/)
  assert.doesNotMatch(doctorMsgs(t, c, { 'web/.env.local': 'A=1\n' }).bad, /env_files/)
})

test('verify-up starts services detached from the card worktree, applies env, verify-down kills the whole tree and frees the port', async (t) => {
  const port = await freePort()
  const ws = await workspaceWithServices(t, [{
    name: 'api', cwd: '.', port, cmd: serverCmd(port), env_load: ['.env.local'],
    env_overrides: [{ file: '.env.development.local', from: '.env.development', set: { VITE_API_BASE_URL: 'http://localhost:8080/api/v1' } }],
  }])
  fs.writeFileSync(path.join(ws.wt, '.env.local'), 'FF_TEST_VAL=fromfile\n')
  fs.writeFileSync(path.join(ws.wt, '.env.development'), 'VITE_API_BASE_URL=https://prod\nKEEP=1\n')
  assert.equal(await main(['verify-up', '123', 'web'], ws.ctx), 0, ws.ctx.stderr.write ? '' : '')
  assert.equal(await listening(port), true)
  const [cwdLine, val] = fs.readFileSync(path.join(ws.wt, 'cwd.txt'), 'utf8').split('\n')
  assert.equal(fs.realpathSync(cwdLine), fs.realpathSync(ws.wt)); assert.equal(val, 'fromfile')
  assert.equal(fs.readFileSync(path.join(ws.wt, '.env.development.local'), 'utf8'), 'VITE_API_BASE_URL=http://localhost:8080/api/v1\nKEEP=1\n')
  assert.ok(fs.existsSync(path.join(ws.root, '.ff/services/123/api.log')))
  const lock = JSON.parse(fs.readFileSync(path.join(ws.root, 'worktrees/.verify.lock'), 'utf8'))
  assert.equal(lock.slug, '123-sample'); assert.equal(lock.services[0].port, port); assert.ok(lock.codeDir.endsWith('worktrees/123-sample'))
  const child = Number(fs.readFileSync(path.join(ws.wt, 'child.pid'), 'utf8')), leader = lock.services[0].pid
  assert.ok(alive(child) && alive(leader))
  // second verify-up is a no-op for the running service (restart-safe state on disk)
  assert.equal(await main(['verify-up', '123', 'web'], ws.ctx), 0)
  assert.equal(JSON.parse(fs.readFileSync(path.join(ws.root, 'worktrees/.verify.lock'), 'utf8')).services[0].pid, leader)
  assert.equal(await main(['verify-down', '123'], ws.ctx), 0)
  assert.equal(alive(leader), false); assert.equal(alive(child), false); assert.equal(await listening(port), false)
  assert.equal(fs.existsSync(path.join(ws.root, 'worktrees/.verify.lock')), false)
})

test('verify-up refuses a port held by a foreign process and returns the fresh lock', async (t) => {
  const port = await freePort()
  const foreign = net.createServer(); await new Promise((r) => foreign.listen(port, '127.0.0.1', r)); t.after(() => foreign.close())
  const ws = await workspaceWithServices(t, [{ name: 'api', cwd: '.', port, cmd: serverCmd(port) }])
  const { buf } = capture(ws.root); const ctx = { ...ws.ctx, stdout: { write: (s) => { buf.out += s } }, stderr: { write: (s) => { buf.err += s } } }
  assert.equal(await main(['verify-up', '123', 'web'], ctx), 1)
  assert.match(buf.err, new RegExp(`cổng ${port}.*không phải do ff`))
  assert.equal(fs.existsSync(path.join(ws.wt, 'cwd.txt')), false)
  assert.equal(fs.existsSync(path.join(ws.root, 'worktrees/.verify.lock')), false)
})

test('verify-up fails clearly when a service exits before opening its port; verify-down cleans up', async (t) => {
  const port = await freePort()
  const ws = await workspaceWithServices(t, [{ name: 'api', cwd: '.', port, cmd: 'node -e "process.exit(3)"' }])
  const { buf } = capture(ws.root); const ctx = { ...ws.ctx, stdout: { write: (s) => { buf.out += s } }, stderr: { write: (s) => { buf.err += s } } }
  assert.equal(await main(['verify-up', '123', 'web'], ctx), 1)
  assert.match(buf.err, /không mở cổng.*tiến trình đã thoát/)
  assert.equal(await main(['verify-down', '123'], ws.ctx), 0)
  assert.equal(fs.existsSync(path.join(ws.root, 'worktrees/.verify.lock')), false)
})

test('verify-up runs prepare once per repo and before start; failure keeps the lock', async (t) => {
  const port = await freePort()
  const ws = await workspaceWithServices(t, [{ name: 'api', cwd: '.', port, prepare: 'echo run >> prepared.txt', cmd: serverCmd(port) }])
  assert.equal(await main(['verify-up', '123', 'web'], ws.ctx), 0)
  assert.equal(fs.readFileSync(path.join(ws.wt, 'prepared.txt'), 'utf8'), 'run\n')
  assert.equal(await main(['verify-down', '123'], ws.ctx), 0)
  const bad = await workspaceWithServices(t, [{ name: 'api', cwd: '.', port: await freePort(), prepare: 'exit 1', cmd: 'true' }])
  assert.equal(await main(['verify-up', '123', 'web'], bad.ctx), 1)
  assert.equal(fs.existsSync(path.join(bad.root, 'worktrees/.verify.lock')), true)
})

test('code dir: services run from <worktrees_dir>/<slug>.test/ when ship-test is required, with env_files copied from the base repo', async (t) => {
  const f = makeShipWorkspace(t); commit(f)
  const port = await freePort()
  fs.writeFileSync(path.join(f.root, 'web/.env.local'), 'FF_TEST_VAL=basefile\n')
  f.config.repos[0].env_files = ['.env.local']
  f.config.e2e = { dir: 'ff-e2e', services: [{ name: 'api', repo: 'web', cwd: '.', port, cmd: serverCmd(port), env_load: ['.env.local'] }], apps: [{ name: 'web', base_url: 'http://localhost:3001' }] }
  e2eFixture(f.root)
  fs.writeFileSync(path.join(f.root, 'ff.config.yaml'), YAML.stringify(f.config)); writeLock(f.root, f.config)
  const { ctx } = capture(f.root); Object.assign(ctx, { fetch: async () => ({ ok: true, status: 200 }), sleep: async () => {}, healthAttempts: 1, killTimeoutMs: 2000, serviceStartTimeoutMs: 20000 })
  t.after(() => main(['verify-down', '123', '--force-unlock'], ctx))
  assert.equal(await main(['verify-up', '123', 'web'], ctx), 1) // no ship-test record yet
  assert.equal(fs.existsSync(path.join(f.root, 'worktrees/123.test')), false)
  await prepareShipTest({ root: f.root, config: f.config, cardId: '123' })
  assert.equal(await main(['verify-up', '123', 'web'], ctx), 0)
  const testWeb = path.join(f.root, 'worktrees/123.test/web')
  const [cwdLine, val] = fs.readFileSync(path.join(testWeb, 'cwd.txt'), 'utf8').split('\n')
  assert.equal(fs.realpathSync(cwdLine), fs.realpathSync(testWeb)); assert.equal(val, 'basefile')
  assert.equal(fs.existsSync(path.join(f.copies.web, 'cwd.txt')), false) // card worktree untouched
  assert.ok(JSON.parse(fs.readFileSync(path.join(f.root, 'worktrees/.verify.lock'), 'utf8')).codeDir.endsWith('worktrees/123.test'))
  assert.equal(await main(['verify-down', '123'], ctx), 0)
  assert.equal(await listening(port), false)
})

test('guard and gate-tools do not treat <slug>.test as a card worktree', async (t) => {
  const ws = makeWorkspace({ config: baseConfig() }); t.after(ws.cleanup)
  fs.mkdirSync(path.join(ws.root, 'worktrees/123-sample.test/web'), { recursive: true })
  fs.mkdirSync(path.join(ws.root, 'worktrees/123-sample/web'), { recursive: true })
  const { makeGuard } = await import('../scripts/lib/guard-rules.mjs')
  const g = makeGuard(ws.root, loadConfig(ws.root).config, {})
  const edit = (slug) => g.evaluate({ file: `worktrees/${slug}/web/a.txt`, tool: 'Write', cwd: ws.root, mode: 'feature-flow' })
  assert.match(edit('123-sample.test'), /ff ship-test/)
  assert.doesNotMatch(String(edit('123-sample')), /ff ship-test/)
  const { ctx, buf } = capture(ws.root)
  assert.notEqual(await main(['probe-slice', '123-sample.test'], ctx), 0)
  assert.match(buf.err, /slug không hợp lệ/)
})
