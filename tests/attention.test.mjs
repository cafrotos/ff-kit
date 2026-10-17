import './helpers/hermetic-home.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeWorkspace } from './helpers/fixture.mjs'
import { nextAttention, recordAttention } from '../scripts/lib/attention.mjs'
import { taskPath } from '../ff-worker/src/core/task-store.mjs'

const T0 = '2026-01-01T00:00:00.000Z'
const at = (s) => new Date(Date.parse(T0) + s * 1000)

test('nextAttention: thiếu prev', () => {
  assert.deepEqual(nextAttention(undefined, { who: 'human', kind: 'question' }, at(0)), { who: 'human', kind: 'question', since: T0, agentMs: 0 })
  assert.deepEqual(nextAttention(null, { who: 'agent' }, at(0)), { who: 'agent', since: T0, agentMs: 0 })
})
test('nextAttention: agent→human cộng agentMs', () => {
  const r = nextAttention({ who: 'agent', since: T0, agentMs: 500 }, { who: 'human', kind: 'idle' }, at(10))
  assert.deepEqual(r, { who: 'human', kind: 'idle', since: at(10).toISOString(), agentMs: 10500 })
})
test('nextAttention: human→agent giữ agentMs, bỏ kind', () => {
  const r = nextAttention({ who: 'human', kind: 'idle', since: T0, agentMs: 700 }, { who: 'agent' }, at(60))
  assert.deepEqual(r, { who: 'agent', since: at(60).toISOString(), agentMs: 700 })
})
test('nextAttention: cùng who giữ since, đổi kind', () => {
  const r = nextAttention({ who: 'human', kind: 'question', since: T0, agentMs: 9 }, { who: 'human', kind: 'permission' }, at(30))
  assert.deepEqual(r, { who: 'human', kind: 'permission', since: T0, agentMs: 9 })
})

function ws(t, task) {
  const w = makeWorkspace({})
  t.after(w.cleanup)
  if (task) {
    fs.mkdirSync(path.join(w.root, '.ff', 'tasks'), { recursive: true })
    fs.writeFileSync(taskPath(w.root, 'c1'), typeof task === 'string' ? task : JSON.stringify(task))
  }
  return w.root
}
const read = (root) => JSON.parse(fs.readFileSync(taskPath(root, 'c1'), 'utf8'))

test('recordAttention ghi vào task, giữ trường khác', async (t) => {
  const root = ws(t, { cardId: 'c1', version: 3 })
  await recordAttention(root, 'c1', { who: 'human', kind: 'question' }, at(0))
  const task = read(root)
  assert.equal(task.version, 3)
  assert.deepEqual(task.attention, { who: 'human', kind: 'question', since: T0, agentMs: 0 })
})
test('recordAttention không tạo file khi task chưa có', async (t) => {
  const root = ws(t)
  await recordAttention(root, 'c1', { who: 'agent' })
  assert.equal(fs.existsSync(taskPath(root, 'c1')), false)
})
test('recordAttention nuốt lỗi khi JSON hỏng hoặc id sai', async (t) => {
  const root = ws(t, '{broken')
  await recordAttention(root, 'c1', { who: 'agent' })
  await recordAttention(root, '../x', { who: 'agent' })
  assert.equal(fs.readFileSync(taskPath(root, 'c1'), 'utf8'), '{broken')
})

function runHook(name, input, env) {
  return new Promise((resolve) => {
    const e = { ...process.env }
    delete e.FF_CARD_ID
    const p = spawn('node', [fileURLToPath(new URL(`../scripts/hooks/${name}.mjs`, import.meta.url))], { env: { ...e, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
    p.on('close', resolve)
    p.stdin.end(JSON.stringify(input))
  })
}

test('hook stop ghi attention khi có FF_CARD_ID, không ghi khi thiếu', async (t) => {
  const root = ws(t, { cardId: 'c1' })
  await runHook('stop', { cwd: root }, {})
  assert.equal(read(root).attention, undefined)
  await runHook('stop', { cwd: root }, { FF_CARD_ID: 'c1' })
  assert.equal(read(root).attention.who, 'human')
  assert.equal(read(root).attention.kind, 'idle')
  await runHook('user-prompt', { cwd: root, prompt: 'hi' }, { FF_CARD_ID: 'c1' })
  assert.equal(read(root).attention.who, 'agent')
})
test('hook notification permission_prompt → human/permission', async (t) => {
  const root = ws(t, { cardId: 'c1' })
  await runHook('notification', { cwd: root, notification_type: 'permission_prompt', message: 'x' }, { FF_CARD_ID: 'c1' })
  assert.equal(read(root).attention.kind, 'permission')
})

test('nextAttention: mang theo notifiedAt/via khi được truyền, không thì không thêm khóa', () => {
  const r = nextAttention({ who: 'agent', since: T0, agentMs: 0 }, { who: 'human', kind: 'permission', via: 'pane', notifiedAt: 'N' }, at(5))
  assert.equal(r.via, 'pane'); assert.equal(r.notifiedAt, 'N')
  const same = nextAttention({ who: 'human', kind: 'permission', since: T0, agentMs: 0, via: 'pane', notifiedAt: 'N' }, { who: 'human', kind: 'permission' }, at(9))
  assert.equal('via' in same, false); assert.equal('notifiedAt' in same, false)
  const keep = nextAttention({ who: 'human', kind: 'permission', since: T0, agentMs: 0, via: 'pane', notifiedAt: 'N' }, { who: 'human', kind: 'permission', via: 'pane', notifiedAt: 'M' }, at(9))
  assert.equal(keep.notifiedAt, 'M'); assert.equal(keep.since, T0)
})
