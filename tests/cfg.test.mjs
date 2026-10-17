import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { main } from '../scripts/cli/main.mjs'
import { writeDoctorState, doctorStatus } from '../scripts/lib/state.mjs'
import { makeWorkspace } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'

function ready(t) {
  const ws = makeWorkspace()
  t.after(ws.cleanup)
  writeDoctorState(ws.root, true)
  return ws
}

test('cfg get in giá trị scalar', async (t) => {
  const ws = ready(t)
  const { ctx, buf } = capture(ws.root)
  assert.equal(await main(['cfg', 'get', 'repos.web.base_branch'], ctx), 0)
  assert.equal(buf.out, 'dev\n')
})

test('cfg get --abs trả đường dẫn tuyệt đối', async (t) => {
  const ws = ready(t)
  const { ctx, buf } = capture(path.join(ws.root, 'web'))
  assert.equal(await main(['cfg', 'get', 'repos.web.path', '--abs'], ctx), 0)
  assert.equal(buf.out, path.join(ws.root, 'web') + '\n')
})

test('cfg get object in JSON', async (t) => {
  const ws = ready(t)
  const { ctx, buf } = capture(ws.root)
  await main(['cfg', 'get', 'repos.web.commands'], ctx)
  assert.deepEqual(JSON.parse(buf.out), { install: 'node -v', build: 'node -v' })
})

test('thiếu key → exit 3, không in stdout', async (t) => {
  const ws = ready(t)
  const { ctx, buf } = capture(ws.root)
  assert.equal(await main(['cfg', 'get', 'repos.web.commands.lint'], ctx), 3)
  assert.equal(buf.out, '')
  assert.match(buf.err, /repos\.web\.commands\.lint/)
})

test('ngoài workspace → exit 4', async () => {
  const { ctx, buf } = capture('/')
  assert.equal(await main(['cfg', 'get', 'version'], ctx), 4)
  assert.match(buf.err, /ff\.config\.yaml/)
})

test('chưa chạy doctor → exit 4', async (t) => {
  const ws = makeWorkspace()
  t.after(ws.cleanup)
  const { ctx, buf } = capture(ws.root)
  assert.equal(await main(['cfg', 'get', 'version'], ctx), 4)
  assert.match(buf.err, /ff doctor/)
})

test('config sửa sau doctor → stale → exit 4', async (t) => {
  const ws = ready(t)
  const f = path.join(ws.root, 'ff.config.yaml')
  const later = new Date(Date.now() + 5000)
  fs.utimesSync(f, later, later)
  assert.equal(doctorStatus(ws.root), 'stale')
  const { ctx } = capture(ws.root)
  assert.equal(await main(['cfg', 'get', 'version'], ctx), 4)
})

test('nhóm worker đỏ, core xanh → cfg get vẫn chạy (D20)', async (t) => {
  const ws = makeWorkspace()
  t.after(ws.cleanup)
  writeDoctorState(ws.root, false, { core: true, worker: false, e2e: true })
  const { ctx, buf } = capture(ws.root)
  assert.equal(await main(['cfg', 'get', 'repos.web.base_branch'], ctx), 0)
  assert.equal(buf.out, 'dev\n')
  assert.equal(doctorStatus(ws.root, 'worker'), 'red')
})

test('config hỏng → exit 4', async (t) => {
  const ws = ready(t)
  fs.writeFileSync(path.join(ws.root, 'ff.config.yaml'), 'repos: [\n')
  writeDoctorState(ws.root, true)
  const { ctx, buf } = capture(ws.root)
  assert.equal(await main(['cfg', 'get', 'version'], ctx), 4)
  assert.match(buf.err, /lỗi YAML/)
})

test('sai cách dùng → exit 2', async (t) => {
  const ws = ready(t)
  const { ctx } = capture(ws.root)
  assert.equal(await main(['cfg'], ctx), 2)
  assert.equal(await main(['cfg', 'set', 'x'], ctx), 2)
})
