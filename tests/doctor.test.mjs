import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { runDoctor, preflightStage } from '../scripts/lib/doctor.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { doctorStatus } from '../scripts/lib/state.mjs'
import { main } from '../scripts/cli/main.mjs'
import { makeWorkspace, baseConfig, git } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'
import { fakeHome, pkgVersion } from './helpers/home.mjs'

const ENV = { '.ff.env': 'TRELLO_API_KEY=SECRET123\nTRELLO_API_TOKEN=SECRET456\n' }
const fails = (r) => r.checks.filter((c) => !c.ok).map((c) => c.msg).join('\n')
const plugins = (t, version, scope = 'user') => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-plug-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'installed_plugins.json')
  fs.writeFileSync(file, JSON.stringify({ version: 2, plugins: { 'ff-kit@ff-kit': [{ scope, version }] } }))
  return file
}
const doctor = (root, t, opts = {}) => runDoctor(root, loadConfig(root), { installedPluginsPath: plugins(t, pkgVersion), ...opts })

function green(t, opts = {}) {
  const ws = makeWorkspace({ ...opts, files: { ...ENV, ...(opts.files ?? {}) } })
  t.after(ws.cleanup)
  return ws
}

test('workspace đủ → xanh, không lộ giá trị secret', (t) => {
  const ws = green(t)
  const r = doctor(ws.root, t)
  assert.equal(r.ok, true, fails(r))
  assert.doesNotMatch(JSON.stringify(r), /SECRET/)
  assert.ok(Array.isArray(r.warnings))
  assert.ok(r.warnings.some((warning) => /Playwright/.test(warning)))
})

test('thiếu thư mục repo', (t) => {
  const ws = green(t)
  fs.rmSync(path.join(ws.root, 'web'), { recursive: true })
  assert.match(fails(doctor(ws.root, t)), /repo web: không có thư mục web/)
})

test('repo không phải git', (t) => {
  const ws = green(t, { gitRepos: false })
  assert.match(fails(doctor(ws.root, t)), /không phải git repo/)
})

test('không có base_branch', (t) => {
  const ws = green(t)
  git(path.join(ws.root, 'web'), 'branch', '-m', 'dev', 'khac')
  assert.match(fails(doctor(ws.root, t)), /không có nhánh dev \(base_branch/)
})

test('binary của lệnh không có trong PATH', (t) => {
  const config = baseConfig()
  config.repos[0].commands.build = 'khong-ton-tai-xyz build'
  const ws = green(t, { config })
  assert.match(fails(doctor(ws.root, t)), /lệnh build cần "khong-ton-tai-xyz"/)
})

test('thiếu file .ff.env và thiếu key → chỉ nhóm worker đỏ', (t) => {
  const ws = makeWorkspace()
  t.after(ws.cleanup)
  const r0 = doctor(ws.root, t)
  assert.match(fails(r0), /\.ff\.env chưa có — cần: TRELLO_API_KEY, TRELLO_API_TOKEN/)
  assert.deepEqual(r0.groups, { core: true, worker: false, e2e: true })
  fs.writeFileSync(path.join(ws.root, '.ff.env'), 'TRELLO_API_KEY=SECRET123\n')
  const msg = fails(doctor(ws.root, t))
  assert.match(msg, /thiếu key: TRELLO_API_TOKEN/)
  assert.doesNotMatch(msg, /SECRET/)
})

test('thiếu thư mục e2e → chỉ nhóm e2e đỏ; không có task_source → chỉ nhóm worker đỏ', (t) => {
  const config = baseConfig()
  config.e2e = { dir: 'ff-e2e' }
  delete config.worker.task_source
  const ws = green(t, { config })
  const r = doctor(ws.root, t)
  assert.deepEqual(r.groups, { core: true, worker: false, e2e: false })
  assert.match(fails(r), /e2e\.dir không tồn tại/)
  assert.match(fails(r), /chưa cấu hình worker\.task_source/)
})

test('db.env_file thiếu chỉ làm đỏ nhóm e2e', (t) => {
  const config = baseConfig()
  config.db = { driver: 'postgres', env_file: 'system/.env.db' }
  const ws = green(t, { config })
  const r = doctor(ws.root, t)
  assert.deepEqual(r.groups, { core: true, worker: true, e2e: false })
  assert.match(fails(r), /db\.env_file không tồn tại/)
})

test('jwt-mint doctor kiểm file secret và chỉ báo key có/thiếu', (t) => {
  const config = baseConfig()
  config.e2e = { dir: 'ff-e2e', auth: { strategy: 'jwt-mint', jwt: {
    secret: { file: 'api/.env', key: 'JWT_SECRET' },
    algorithm: 'HS256', payload: { sub: '{user.id}' },
    deliver: [{ via: 'local_storage', name: 'token' }],
  } } }
  const ws = green(t, { config, files: { 'ff-e2e/package.json': '{"devDependencies":{"@playwright/test":"1.0.0"}}', 'api/.env': 'JWT_SECRET=SUPER_SECRET_VALUE\n' } })
  const r = doctor(ws.root, t)
  assert.equal(r.groups.e2e, false, 'thiếu node_modules/@playwright/test và browser phải làm nhóm e2e đỏ')
  assert.doesNotMatch(fails(r), /SUPER_SECRET_VALUE/)
  assert.match(fails(r), /playwright/i)
})

test('jwt-mint thiếu secret key chỉ báo tên key, không đọc lộ giá trị', (t) => {
  const config = baseConfig()
  config.e2e = { dir: 'ff-e2e', auth: { strategy: 'jwt-mint', jwt: {
    secret: { file: 'api/.env', key: 'JWT_SECRET' },
    algorithm: 'HS256', payload: { sub: '{user.id}' },
    deliver: [{ via: 'cookie', name: 'session' }],
  } } }
  const ws = green(t, { config, files: { 'ff-e2e/package.json': '{}', 'api/.env': 'OTHER_SECRET=SUPER_SECRET_VALUE\n' } })
  const msg = fails(doctor(ws.root, t))
  assert.match(msg, /JWT_SECRET/)
  assert.doesNotMatch(msg, /SUPER_SECRET_VALUE/)
})

test('lệnh có export/subshell/redirect không bị báo thiếu binary', (t) => {
  const config = baseConfig()
  config.repos[0].commands = { test: 'export NODE_ENV=test && node -v', build: '(cd . && node -v) 2>&1 | cat' }
  const ws = green(t, { config })
  const r = doctor(ws.root, t)
  assert.equal(r.groups.core, true, fails(r))
})

test('thiếu cards_dir', (t) => {
  const ws = green(t)
  fs.rmSync(path.join(ws.root, 'trellocards'), { recursive: true })
  assert.match(fails(doctor(ws.root, t)), /workspace\.cards_dir không tồn tại/)
})

test('schema sai → chỉ báo schema', (t) => {
  const config = baseConfig()
  config.version = 2
  const ws = green(t, { config })
  const r = doctor(ws.root, t)
  assert.equal(r.ok, false)
  assert.ok(r.checks.every((c) => c.msg.startsWith('schema')))
})

test('thiếu lock → đỏ', (t) => {
  const ws = green(t, { lock: false })
  assert.match(fails(doctor(ws.root, t)), /ff\.config\.lock\.json/)
})

test('CLI: xanh → exit 0 và ghi trạng thái green', async (t) => {
  fakeHome(t)
  const ws = green(t)
  const { ctx, buf } = capture(ws.root)
  assert.equal(await main(['doctor'], ctx), 0)
  assert.match(buf.out, /ff doctor: xanh/)
  assert.equal(doctorStatus(ws.root), 'green')
})

test('CLI: chỉ thiếu key → exit 1, core xanh, worker đỏ', async (t) => {
  fakeHome(t)
  const ws = makeWorkspace()
  t.after(ws.cleanup)
  const { ctx, buf } = capture(ws.root)
  assert.equal(await main(['doctor'], ctx), 1)
  assert.match(buf.out, /✗ \[worker\]/)
  assert.match(buf.out, /skill vẫn chạy/)
  assert.equal(doctorStatus(ws.root), 'green')
  assert.equal(doctorStatus(ws.root, 'worker'), 'red')
})

test('CLI: core đỏ → trạng thái core red', async (t) => {
  fakeHome(t)
  const ws = green(t)
  fs.rmSync(path.join(ws.root, 'trellocards'), { recursive: true })
  const { ctx } = capture(ws.root)
  assert.equal(await main(['doctor'], ctx), 1)
  assert.equal(doctorStatus(ws.root), 'red')
})

test('CLI: YAML hỏng → exit 1, in dòng lỗi, trạng thái red', async (t) => {
  fakeHome(t)
  const ws = green(t, { files: { 'ff.config.yaml': 'version: 1\nrepos: [\n' } })
  const { ctx, buf } = capture(ws.root)
  assert.equal(await main(['doctor'], ctx), 1)
  assert.match(buf.out, /lỗi YAML dòng/)
  assert.equal(doctorStatus(ws.root), 'red')
})

test('CLI: --schema-only không ghi trạng thái; ngoài workspace exit 4', async (t) => {
  const ws = green(t)
  const { ctx } = capture(ws.root)
  assert.equal(await main(['doctor', '--schema-only'], ctx), 0)
  assert.equal(doctorStatus(ws.root), 'missing')
  assert.equal(await main(['doctor'], capture('/').ctx), 4)
})

test('stage preflight scopes e2e, ship remote/branch and gh only to S2', () => {
  const config = baseConfig()
  config.e2e = { dir: 'missing-e2e', tests_dir: 'missing-e2e/tests', playwright_config: 'missing-e2e/playwright.config.js' }
  const { root, cleanup } = makeWorkspace({ config, files: ENV })
  try {
    const command = (_cmd, args) => ({ status: args[0] === 'auth' ? 127 : 0, stdout: args[0] === 'get-url' ? 'https://host/repo.git' : 'task/123', stderr: '' })
    for (const stage of ['understand', 'build']) assert.equal(preflightStage(root, { config }, { stage, runCommand: command }).ok, true, stage)
    assert.equal(preflightStage(root, { config }, { stage: 'verify', runCommand: command }).reason, 'setup:e2e')
    assert.equal(preflightStage(root, { config }, { stage: 'ship', mode: 'S1', runCommand: command }).ok, true)
    const s2 = preflightStage(root, { config }, { stage: 'ship', mode: 'S2', runCommand: command })
    assert.equal(s2.ok, false)
    assert.equal(s2.reason, 'blocked:gh')
    assert.doesNotMatch(JSON.stringify(s2), /token|password|secret/i)
  } finally { cleanup() }
})

test('verify preflight accepts direct config and returns only safe status when Playwright prints a secret', (t) => {
  const config = baseConfig()
  config.e2e = { dir: 'ff-e2e', tests_dir: 'ff-e2e/tests', playwright_config: 'ff-e2e/playwright.config.js' }
  const ws = green(t, { config, files: {
    'ff-e2e/tests/.keep': '',
    'ff-e2e/playwright.config.js': '',
    'ff-e2e/node_modules/@playwright/test/index.js': '',
    'ff-e2e/node_modules/.bin/playwright': '',
  } })
  let invoked = false
  const secret = 'DOCTOR_PREFLIGHT_SECRET_SENTINEL'
  const result = preflightStage(ws.root, config, { stage: 'verify', runCommand: (cmd) => {
    if (cmd === 'git') return { status: 0, stdout: 'ok', stderr: '' }
    invoked = true
    return { status: 1, stdout: `failed loading config ${secret}`, stderr: '' }
  } })
  assert.equal(invoked, true, 'verify preflight should exercise the failed Playwright listing path')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'setup:e2e')
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret))
})

test('a freshly scaffolded e2e dir with no tests yet is not a doctor failure', (t) => {
  const config = baseConfig()
  config.e2e = { dir: 'ff-e2e', tests_dir: 'ff-e2e/tests', playwright_config: 'ff-e2e/playwright.config.js' }
  const ws = green(t, { config, files: {
    'ff-e2e/tests/README.md': '',
    'ff-e2e/playwright.config.js': '',
    'ff-e2e/node_modules/@playwright/test/index.js': '',
    'ff-e2e/node_modules/.bin/playwright': '',
  } })
  const calls = []
  preflightStage(ws.root, config, { stage: 'verify', runCommand: (cmd, args) => {
    calls.push([cmd, ...(args ?? [])])
    return { status: 0, stdout: 'Total: 0 tests in 0 files', stderr: '' }
  } })
  const listing = calls.find(c => c.includes('--list'))
  assert.ok(listing, 'Playwright listing is exercised')
  assert.ok(listing.includes('--pass-with-no-tests'), 'zero tests before any card wrote one must not fail doctor')
})

test('version plugin khác CLI → lỗi kèm lệnh sửa; khớp → ok; thiếu file → cảnh báo', (t) => {
  const ws = green(t)
  const bad = doctor(ws.root, t, { installedPluginsPath: plugins(t, '0.0.1') })
  assert.equal(bad.ok, false)
  assert.match(fails(bad), /claude plugin marketplace update ff-kit && claude plugin update ff-kit@ff-kit/)
  const good = doctor(ws.root, t)
  assert.ok(good.checks.some((c) => c.ok && c.msg.includes(pkgVersion)))
  const missing = doctor(ws.root, t, { installedPluginsPath: path.join(ws.root, 'nope.json') })
  assert.equal(missing.ok, true, fails(missing))
  assert.ok(missing.warnings.some((w) => /nope\.json/.test(w)))
})

test('e2e.apps có nhưng thiếu e2e.services → lỗi', (t) => {
  const ws = green(t)
  const loaded = loadConfig(ws.root)
  loaded.config.e2e = { dir: 'ff-e2e', apps: [{ name: 'web', base_url: 'http://localhost:3001' }] }
  const r = runDoctor(ws.root, loaded, { installedPluginsPath: plugins(t, pkgVersion) })
  assert.match(fails(r), /e2e\.services chưa khai báo/)
})

test('doctor: cảnh báo khi workspace chưa được Claude Code tin', (t) => {
  const ws = green(t)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-home-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const has = (r) => r.warnings.some((w) => /Yes, I trust this folder/.test(w))
  assert.ok(has(doctor(ws.root, t, { homeDir: home })))
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ projects: { [ws.root]: { hasTrustDialogAccepted: false } } }))
  assert.ok(has(doctor(ws.root, t, { homeDir: home })))
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ projects: { [ws.root]: { hasTrustDialogAccepted: true } } }))
  assert.ok(!has(doctor(ws.root, t, { homeDir: home })))
})

test('doctor: deny đọc cả .ff/ chặn workflow ghim → cảnh báo/lỗi kèm deny hẹp; deny hẹp thì sạch', (t) => {
  const ws = green(t)
  const set = (deny) => { fs.mkdirSync(path.join(ws.root, '.claude'), { recursive: true }); fs.writeFileSync(path.join(ws.root, '.claude/settings.json'), JSON.stringify({ permissions: { deny } })) }
  set(['Read(./.ff.env)', 'Read(./.ff/worker.json)', 'Edit(./.ff/**)', 'Read(./.ff/harness/**)'])
  assert.ok(!doctor(ws.root, t).warnings.some((w) => /chặn đọc cả \.ff/.test(w)))
  set(['Read(./.ff/**)', 'Edit(./.ff/**)'])
  const r = doctor(ws.root, t)
  assert.ok(r.warnings.some((w) => /chặn đọc cả \.ff.*Read\(\.\/\.ff\/worker\.json\)/.test(w)), r.warnings.join('\n'))
  set(['Bash(cat .ff/**)'])
  assert.ok(doctor(ws.root, t).warnings.some((w) => /chặn đọc cả \.ff/.test(w)))
})
