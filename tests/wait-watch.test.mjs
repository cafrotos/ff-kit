import './helpers/hermetic-home.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeWorkspace } from './helpers/fixture.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { readTask, writeTask } from '../ff-worker/src/core/task-store.mjs'
import { detectDialog, watchHumanWaits, REMIND_MS } from '../ff-worker/src/core/wait-watch.mjs'

const H = 3600000
const T0 = Date.parse('2026-01-01T00:00:00Z')
const PERM = 'Claude wants to open artifact\n\nThis artifact was made by someone else.\n\n ❯ 1. Yes\n   2. No\n\n Esc to cancel'
const ASK = '[#7] Chọn hướng?\n\n ❯ 1. Phương án A\n   2. Phương án B\n   3. Type something.\n\n Enter to select · ↑/↓ to navigate · Esc to cancel'
const BUSY = '● Đang đọc file...\n✻ Thinking… (esc to interrupt)\n❯ '

test('detectDialog: nhận quyền và câu hỏi, bỏ qua pane thường', () => {
  assert.deepEqual(detectDialog(PERM), { kind: 'permission' })
  assert.deepEqual(detectDialog(ASK), { kind: 'question' })
  assert.equal(detectDialog(BUSY), null)
  assert.equal(detectDialog('1. Yes\n2. No'), null)
  assert.equal(detectDialog(''), null)
  assert.equal(detectDialog(undefined), null)
})

function setup(t, pane, taskExtra = {}) {
  const w = makeWorkspace(); t.after(w.cleanup)
  const config = loadConfig(w.root).config
  const state = { pane, alive: true, cmds: [] }
  const tmux = {
    hasSession: () => state.alive,
    capture: (name, cwd, lines) => { state.cmds.push(['capture', name]); return state.pane },
  }
  const notes = []
  const channel = { notify: async (n) => { notes.push(n) } }
  writeTask(w.root, { cardId: '135', slug: 'x', phase: 'running', session: 'ff-135', ...taskExtra })
  let now = T0
  const run = () => watchHumanWaits({ root: w.root, config, tmux, channel, now: () => now, log: () => {} })
  return { w, state, notes, run, task: () => readTask(w.root, '135'), advance: (ms) => { now += ms }, set: (extra) => writeTask(w.root, { ...readTask(w.root, '135'), ...extra }) }
}
const agentAt = (ms = 0) => ({ who: 'agent', since: new Date(T0 - 2 * H).toISOString(), agentMs: ms })

test('hộp thoại quyền khi hook cũ: attention human/permission, cộng agentMs, notify một lần với cách attach', async (t) => {
  const s = setup(t, PERM, { attention: agentAt(5) })
  await s.run()
  const a = s.task().attention
  assert.equal(a.who, 'human'); assert.equal(a.kind, 'permission'); assert.equal(a.via, 'pane')
  assert.equal(a.agentMs, 5 + 2 * H)
  assert.equal(s.notes.length, 1)
  assert.equal(s.notes[0].kind, 'attention'); assert.equal(s.notes[0].taskId, '135')
  assert.match(s.notes[0].title, /quyền/)
  assert.match(s.notes[0].body, /tmux attach -t ff-135/)
  s.advance(60000); await s.run()
  assert.equal(s.notes.length, 1, 'không báo lại trong khoảng nhắc')
  assert.equal(s.task().attention.since, a.since)
})

test('nhắc lại sau REMIND_MS, kèm thời gian chờ', async (t) => {
  assert.equal(REMIND_MS, 2 * H)
  const s = setup(t, ASK, { attention: agentAt() })
  await s.run(); assert.match(s.notes[0].title, /câu hỏi/)
  s.advance(REMIND_MS - 1000); await s.run(); assert.equal(s.notes.length, 1)
  s.advance(2000); await s.run()
  assert.equal(s.notes.length, 2)
  assert.match(s.notes[1].title, /2h/)
  s.advance(60000); await s.run(); assert.equal(s.notes.length, 2)
})

test('hook mới đã đặt human/question (và đã tự báo): worker không báo trùng, chỉ nhắc sau khoảng nhắc', async (t) => {
  const s = setup(t, ASK, { attention: { who: 'human', kind: 'question', since: new Date(T0).toISOString(), agentMs: 9 } })
  await s.run(); assert.equal(s.notes.length, 0)
  s.advance(REMIND_MS + 1000); await s.run()
  assert.equal(s.notes.length, 1)
  assert.equal(s.task().attention.agentMs, 9)
})

test('hộp thoại biến mất (đã duyệt): về agent sau thời gian ân hạn, không trước', async (t) => {
  const s = setup(t, PERM, { attention: agentAt(7) })
  await s.run()
  s.state.pane = BUSY
  s.advance(10000); await s.run()
  assert.equal(s.task().attention.who, 'human', 'chưa hết ân hạn')
  s.advance(120000); await s.run()
  const a = s.task().attention
  assert.equal(a.who, 'agent'); assert.equal(a.agentMs, 7 + 2 * H)
})

test('human/idle không bị nhắc và không bị đổi khi pane không có hộp thoại', async (t) => {
  const s = setup(t, BUSY, { attention: { who: 'human', kind: 'idle', since: new Date(T0 - 5 * H).toISOString(), agentMs: 1 } })
  await s.run()
  assert.equal(s.notes.length, 0); assert.equal(s.task().attention.kind, 'idle')
})

test('bỏ qua thẻ không có phiên tmux, đã park, hoặc driver', async (t) => {
  const s = setup(t, PERM, { attention: agentAt() })
  s.state.alive = false; await s.run()
  assert.equal(s.task().attention.who, 'agent')
  s.state.alive = true; s.set({ parked: { reason: 'failed' } }); await s.run()
  assert.equal(s.task().attention.who, 'agent'); assert.equal(s.notes.length, 0)
  s.set({ parked: undefined, stateVersion: 1 }); await s.run()
  assert.equal(s.task().attention.who, 'agent')
})

test('thiếu attention (task cũ): vẫn đặt human, agentMs tính từ mốc nạp lại', async (t) => {
  const s = setup(t, PERM, { startedAt: new Date(T0 - 3 * H).toISOString() })
  await s.run()
  const a = s.task().attention
  assert.equal(a.who, 'human'); assert.equal(a.agentMs, 3 * H)
})

test('lỗi capture/notify không làm hỏng vòng', async (t) => {
  const s = setup(t, PERM, { attention: agentAt() })
  s.state.pane = null
  await s.run()
  assert.equal(s.task().attention.who, 'agent')
})

const TRUST = ' Accessing workspace:\n /path/to/workspace\n Quick safety check: Is this a project you created or one you trust? ...\n ⚠ This folder pre-approves 7 tool permissions in .claude/settings.json:\n   ...\n ❯ No, continue without these permissions\n   Yes, I trust this folder\n Enter to confirm · Esc to cancel'
test('detectDialog: nhận hộp thoại trust thư mục', () => {
  assert.deepEqual(detectDialog(TRUST), { kind: 'trust' })
})

test('detectDialog: hộp thoại đề xuất auto-mode setup của Claude Code → kind setup', () => {
  const SETUP = 'Auto-mode setup proposal\n\nWe drafted rules for auto mode.\n\n ❯ 1. Looks good — save it\n   2. Discard and exit\n\n Enter to select · Esc to cancel'
  assert.deepEqual(detectDialog(SETUP), { kind: 'setup' })
})
