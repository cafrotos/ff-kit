import './helpers/hermetic-home.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { cardRows, formatRows, formatDuration } from '../scripts/lib/card-status.mjs'
import { main } from '../scripts/cli/main.mjs'
import { makeWorkspace } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'
import { writeTask } from '../ff-worker/src/core/task-store.mjs'

const NOW = Date.parse('2026-10-19T12:00:00Z')
const ago = (ms) => new Date(NOW - ms).toISOString()
const H = 3600000
const tasks = [
  { cardId: '186', slug: 'bug-thu-moi-ve-gi-do', phase: 'done', doneList: 'Ready For QA' },
  { cardId: '135', slug: 'luu-lich-su-cuoc-goi', phase: 'parked', lastError: 'Session lifetime vượt', parked: { reason: 'failed', at: ago(30 * H) } },
  { cardId: '134', slug: 'goi-dien-cho-khach', phase: 'running', attention: { who: 'agent', since: ago(4 * H), agentMs: 0 } },
  { cardId: '136', slug: 'thiet-lap-sip-trunk-moi', phase: 'running', attention: { who: 'human', kind: 'question', since: ago(2 * H + 10 * 60000), agentMs: 5 } },
  { cardId: '140', slug: 'cho-lau-hon', phase: 'running', attention: { who: 'human', kind: 'permission', since: ago(5 * H), agentMs: 5 } },
]

test('cardRows orders human (longest first) -> agent -> parked -> done and labels', () => {
  const rows = cardRows(tasks, { now: NOW })
  assert.deepEqual(rows.map((r) => r.cardId), ['140', '136', '134', '135', '186'])
  assert.deepEqual(rows.map((r) => r.waiting), ['human', 'human', 'agent', 'parked', 'done'])
  assert.equal(rows[1].kind, 'question')
  assert.equal(rows[1].hint, 'tmux attach -t ff-136')
  assert.equal(rows[2].hint, null)
})

test('formatRows renders one line per card', () => {
  const lines = formatRows(cardRows(tasks, { now: NOW })).split('\n')
  assert.equal(lines.length, 5)
  assert.match(lines[1], /^⏳ 136 thiet-lap-sip-trunk…\s+chờ bạn: câu hỏi · 2h10\s+tmux attach -t ff-136$/)
  assert.match(lines[2], /^⚙\s+134 .*agent đang làm · 4h$/)
  assert.match(lines[3], /^⏸ 135 .*park \(failed.*\) · 1 ngày$/)
  assert.match(lines[4], /^✓\s+186 .*xong → Ready For QA$/)
  assert.equal(formatDuration(35 * 60000), '35p')
})

test('ff worker status prints card rows even when driver is off, and --json', async (t) => {
  const w = makeWorkspace(); t.after(w.cleanup)
  writeTask(w.root, { cardId: '136', slug: 'thiet-lap-sip', phase: 'running', attention: { who: 'human', kind: 'question', since: new Date(Date.now() - 2 * H).toISOString(), agentMs: 0 } })
  const a = capture(w.root)
  a.ctx.runTmux = () => ({ status: 1, stdout: '', stderr: '' })
  assert.equal(await main(['worker', 'status'], a.ctx), 0)
  assert.match(a.buf.out, /⏳ 136 thiet-lap-sip\s+chờ bạn: câu hỏi · 2h/)
  const b = capture(w.root)
  b.ctx.runTmux = () => ({ status: 1, stdout: '', stderr: '' })
  assert.equal(await main(['worker', 'status', '--json'], b.ctx), 0)
  const rows = JSON.parse(b.buf.out)
  assert.equal(rows[0].waiting, 'human')
})

test('nhãn trạng thái: chờ bạn: tin thư mục', () => {
  const rows = cardRows([{ cardId: '9', slug: 'x', phase: 'running', attention: { who: 'human', kind: 'trust', since: new Date(NOW - 60000).toISOString(), agentMs: 0 } }], { now: NOW })
  assert.equal(rows[0].label, 'chờ bạn: tin thư mục')
})
