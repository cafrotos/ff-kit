import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { runDoctor } from '../scripts/lib/doctor.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { doctorStatus } from '../scripts/lib/state.mjs'
import { main } from '../scripts/cli/main.mjs'
import { makeWorkspace, baseConfig, git } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'

const ENV = { '.ff.env': 'TRELLO_API_KEY=SECRET123\nTRELLO_API_TOKEN=SECRET456\n' }
const fails = (r) => r.checks.filter((c) => !c.ok).map((c) => c.msg).join('\n')
const doctor = (root) => runDoctor(root, loadConfig(root))

function green(t, opts = {}) {
  const ws = makeWorkspace({ ...opts, files: { ...ENV, ...(opts.files ?? {}) } })
  t.after(ws.cleanup)
  return ws
}

test('workspace đủ → xanh, không lộ giá trị secret', (t) => {
  const ws = green(t)
  const r = doctor(ws.root)
  assert.equal(r.ok, true, fails(r))
  assert.doesNotMatch(JSON.stringify(r), /SECRET/)
})

test('thiếu thư mục repo', (t) => {
  const ws = green(t)
  fs.rmSync(path.join(ws.root, 'web'), { recursive: true })
  assert.match(fails(doctor(ws.root)), /repo web: không có thư mục web/)
})

test('repo không phải git', (t) => {
  const ws = green(t, { gitRepos: false })
  assert.match(fails(doctor(ws.root)), /không phải git repo/)
})

test('không có base_branch', (t) => {
  const ws = green(t)
  git(path.join(ws.root, 'web'), 'branch', '-m', 'dev', 'khac')
  assert.match(fails(doctor(ws.root)), /không có nhánh dev \(base_branch/)
})

test('binary của lệnh không có trong PATH', (t) => {
  const config = baseConfig()
  config.repos[0].commands.build = 'khong-ton-tai-xyz build'
  const ws = green(t, { config })
  assert.match(fails(doctor(ws.root)), /lệnh build cần "khong-ton-tai-xyz"/)
})

test('thiếu file .ff.env và thiếu key → chỉ nhóm worker đỏ', (t) => {
  const ws = makeWorkspace()
  t.after(ws.cleanup)
  const r0 = doctor(ws.root)
  assert.match(fails(r0), /\.ff\.env chưa có — cần: TRELLO_API_KEY, TRELLO_API_TOKEN/)
  assert.deepEqual(r0.groups, { core: true, worker: false, e2e: true })
  fs.writeFileSync(path.join(ws.root, '.ff.env'), 'TRELLO_API_KEY=SECRET123\n')
  const msg = fails(doctor(ws.root))
  assert.match(msg, /thiếu key: TRELLO_API_TOKEN/)
  assert.doesNotMatch(msg, /SECRET/)
})

test('thiếu thư mục e2e → chỉ nhóm e2e đỏ; không có task_source → chỉ nhóm worker đỏ', (t) => {
  const config = baseConfig()
  config.e2e = { dir: 'ff-e2e' }
  delete config.worker.task_source
  const ws = green(t, { config })
  const r = doctor(ws.root)
  assert.deepEqual(r.groups, { core: true, worker: false, e2e: false })
  assert.match(fails(r), /e2e\.dir không tồn tại/)
  assert.match(fails(r), /chưa cấu hình worker\.task_source/)
})

test('lệnh có export/subshell/redirect không bị báo thiếu binary', (t) => {
  const config = baseConfig()
  config.repos[0].commands = { test: 'export NODE_ENV=test && node -v', build: '(cd . && node -v) 2>&1 | cat' }
  const ws = green(t, { config })
  const r = doctor(ws.root)
  assert.equal(r.groups.core, true, fails(r))
})

test('thiếu cards_dir', (t) => {
  const ws = green(t)
  fs.rmSync(path.join(ws.root, 'trellocards'), { recursive: true })
  assert.match(fails(doctor(ws.root)), /workspace\.cards_dir không tồn tại/)
})

test('schema sai → chỉ báo schema', (t) => {
  const config = baseConfig()
  config.version = 2
  const ws = green(t, { config })
  const r = doctor(ws.root)
  assert.equal(r.ok, false)
  assert.ok(r.checks.every((c) => c.msg.startsWith('schema')))
})

test('thiếu lock → đỏ', (t) => {
  const ws = green(t, { lock: false })
  assert.match(fails(doctor(ws.root)), /ff\.config\.lock\.json/)
})

test('CLI: xanh → exit 0 và ghi trạng thái green', async (t) => {
  const ws = green(t)
  const { ctx, buf } = capture(ws.root)
  assert.equal(await main(['doctor'], ctx), 0)
  assert.match(buf.out, /ff doctor: xanh/)
  assert.equal(doctorStatus(ws.root), 'green')
})

test('CLI: chỉ thiếu key → exit 1, core xanh, worker đỏ', async (t) => {
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
  const ws = green(t)
  fs.rmSync(path.join(ws.root, 'trellocards'), { recursive: true })
  const { ctx } = capture(ws.root)
  assert.equal(await main(['doctor'], ctx), 1)
  assert.equal(doctorStatus(ws.root), 'red')
})

test('CLI: YAML hỏng → exit 1, in dòng lỗi, trạng thái red', async (t) => {
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
