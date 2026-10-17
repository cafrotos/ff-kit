import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { withNotifyPolicy, classify, normalizeMessage, readInfoEvents } from '../ff-worker/src/core/notify-policy.mjs'
import { writeTask } from '../ff-worker/src/core/task-store.mjs'

const MIN = 60000, HOUR = 3600000
function setup(t, level = 'action') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-np-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const clock = { t: Date.parse('2026-01-01T00:00:00Z') }
  const sent = []
  const inner = { name: 'fake', notify: async (e) => { sent.push(e) } }
  const make = () => withNotifyPolicy(inner, { root, level, now: () => clock.t })
  return { root, clock, sent, make, ch: make() }
}
const ev = (over = {}) => ({ kind: 'attention', taskId: '7', title: 'Claude needs your permission to use Bash', ...over })

test('classify: action vs info', () => {
  assert.equal(classify(ev()), 'action')
  assert.equal(classify(ev({ title: 'Claude is waiting for your input' })), 'action')
  for (const kind of ['gate', 'ask', 'error', 'done']) assert.equal(classify({ kind, title: 'x' }), 'action')
  assert.equal(classify({ kind: 'info', title: 'Đã nhận thẻ: A' }), 'info')
  assert.equal(classify({ kind: 'info', title: '⏸ Tạm dừng: worker gặp lỗi' }), 'action')
  assert.equal(classify({ kind: 'info', title: 'Báo cáo ff 2026-01-01' }), 'action')
  assert.equal(classify({ kind: 'attention', title: 'Phiên agent đã dừng; kiểm tra' }), 'info')
  assert.equal(classify({ kind: 'attention', taskId: '7', title: 'Phiên agent đã dừng; kiểm tra' }, { waits: () => true }), 'action')
  assert.equal(classify({ kind: 'info', title: 'x', policy: 'action' }), 'action')
})

test('info không đẩy nhưng ghi log jsonl; level=all đẩy hết', async (t) => {
  const s = setup(t)
  await s.ch.notify({ kind: 'attention', taskId: '7', title: 'Phiên agent đã dừng; kiểm tra trạng thái' })
  await s.ch.notify({ kind: 'info', title: 'Đã nhận thẻ: A' })
  assert.equal(s.sent.length, 0)
  assert.equal(readInfoEvents(s.root).length, 2)
  const a = setup(t, 'all')
  await a.ch.notify({ kind: 'info', title: 'Đã nhận thẻ: A' })
  assert.equal(a.sent.length, 1)
})

test('Stop khi thẻ đang chờ người thì đẩy', async (t) => {
  const s = setup(t)
  writeTask(s.root, { cardId: '7', waitingOn: 'GATE_A' })
  await s.ch.notify({ kind: 'attention', taskId: '7', title: 'Phiên agent đã dừng; kiểm tra' })
  assert.equal(s.sent.length, 1)
})

test('dedup 30 phút theo thẻ + kind chuẩn hoá, kể cả qua restart', async (t) => {
  const s = setup(t)
  await s.ch.notify(ev({ title: 'Lỗi 12 lúc 10:01' }))
  s.clock.t += 20 * MIN
  await s.make().notify(ev({ title: 'Lỗi 13 lúc 10:21' })) // worker khởi động lại
  assert.equal(s.sent.length, 1)
  await s.ch.notify(ev({ taskId: '8', title: 'Lỗi 13 lúc 10:21' }))
  assert.equal(s.sent.length, 2)
  s.clock.t += 11 * MIN
  await s.ch.notify(ev({ title: 'Lỗi 14 lúc 10:32' }))
  assert.equal(s.sent.length, 3)
  assert.equal(normalizeMessage(ev({ title: 'Chờ (đã 2h 5m)' })), normalizeMessage(ev({ title: 'Chờ (đã 4h)' })))
})

test('rate limit 10/giờ, phần dư gom thành 1 tin tóm tắt cuối cửa sổ', async (t) => {
  const s = setup(t)
  for (let i = 0; i < 10; i++) { await s.ch.notify(ev({ taskId: `c${i}` })); s.clock.t += MIN }
  assert.equal(s.sent.length, 10)
  await s.ch.notify(ev({ taskId: 'x1', kind: 'error', title: 'Lỗi A' }))
  await s.ch.notify(ev({ taskId: 'x2', kind: 'error', title: 'Lỗi B' }))
  assert.equal(s.sent.length, 10)
  s.clock.t += 50 * MIN + 1 // qua 1 giờ kể từ tin đầu
  await s.ch.tick()
  assert.equal(s.sent.length, 11)
  assert.match(s.sent[10].title, /^2 thông báo khác trong giờ qua: Lỗi A; Lỗi B/)
  await s.ch.tick()
  assert.equal(s.sent.length, 11)
})

test('nhắc thẻ chờ người >24h, 1 lần/ngày, state sống qua restart', async (t) => {
  const s = setup(t)
  const since = new Date(s.clock.t).toISOString()
  writeTask(s.root, { cardId: '9', waitingOn: 'GATE_B', attention: { who: 'human', since, agentMs: 0 } })
  s.clock.t += 23 * HOUR
  await s.ch.tick()
  assert.equal(s.sent.length, 0)
  s.clock.t += 2 * HOUR
  await s.ch.tick()
  assert.equal(s.sent.length, 1)
  assert.match(s.sent[0].title, /#9/)
  s.clock.t += 5 * HOUR
  await s.make().tick()
  assert.equal(s.sent.length, 1)
  s.clock.t += 20 * HOUR
  await s.make().tick()
  assert.equal(s.sent.length, 2)
})
