import './helpers/hermetic-home.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeWorkspace } from './helpers/fixture.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { readTask, writeTask } from '../ff-worker/src/core/task-store.mjs'
import { expireTask, processTasks, attemptTaskLaunch } from '../ff-worker/src/core/worker.mjs'

const H = 3600000
const ago = (ms) => new Date(Date.now() - ms).toISOString()
function setup(t, { parkList = 'Park' } = {}) {
  const w = makeWorkspace(); t.after(w.cleanup)
  const config = loadConfig(w.root).config
  Object.assign(config.worker.task_source.trello, { poll_lists: ['Doing', 'QA Fail'], doing_list: 'Doing', qa_fail_list: 'QA Fail', ...(parkList ? { park_list: parkList } : {}) })
  const calls = [], notes = [], logs = []
  let cards = []
  const source = {
    poll: async () => cards,
    fetchDossier: async () => '# d\n',
    moveCard: async (id, list) => { calls.push(`move:${id}:${list}`) },
    addComment: async () => { calls.push('comment') },
  }
  const channel = { notify: async (n) => { notes.push(n.body) } }
  const task = (id, extra = {}) => { const t = { cardId: id, trelloCardId: id, slug: `card-${id}`, phase: 'running', startedAt: ago(30 * H), updatedAt: ago(1000), ...extra }; writeTask(w.root, t); return t }
  const ledger = (id) => { try { return fs.readFileSync(path.join(w.root, config.workspace.cards_dir, `${id}-card-${id}`, '01b-ledger.md'), 'utf8') } catch { return null } }
  return { w, config, calls, notes, source, channel, task, ledger, log: (l) => logs.push(l), logs, setCards: (c) => { cards = c } }
}

test('expireTask: waiting for human never expires, even when startedAt is old', (t) => {
  const s = setup(t)
  const task = s.task('1', { attention: { who: 'human', kind: 'question', since: ago(25 * H), agentMs: 2 * H } })
  assert.equal(expireTask({ root: s.w.root, config: s.config, task, log: s.log }), false)
  assert.equal(readTask(s.w.root, '1').phase, 'running')
  assert.equal(readTask(s.w.root, '1').parked, undefined)
})

test('expireTask: agentMs over limit parks (system), ledger noted, no Trello comment', async (t) => {
  const s = setup(t)
  const task = s.task('2', { attention: { who: 'agent', since: ago(H), agentMs: 24 * H } })
  assert.equal(expireTask({ root: s.w.root, config: s.config, task, log: s.log }), true)
  const stored = readTask(s.w.root, '2')
  assert.equal(stored.parked.reason, 'failed')
  assert.notEqual(stored.phase, 'failed')
  assert.match(stored.lastError, /lifetime/)
  assert.match(s.ledger('2'), /## Nhật ký worker\n\n- \S+ park hệ thống: Session lifetime/)
  s.setCards([])
  await processTasks({ root: s.w.root, config: s.config, source: s.source, channel: s.channel, log: s.log })
  assert.deepEqual(s.calls, ['move:2:Park'])
  assert.match(s.notes[0], /Tạm dừng/)
  await processTasks({ root: s.w.root, config: s.config, source: s.source, channel: s.channel, log: s.log })
  assert.equal(s.calls.length, 1)
  assert.equal(s.notes.length, 1)
})

test('expireTask without attention falls back to the latest reload mark', (t) => {
  const s = setup(t)
  const task = s.task('3', { qaReopenedAt: ago(H) })
  assert.equal(expireTask({ root: s.w.root, config: s.config, task, log: s.log }), false)
})

test('ledger section is appended to an existing ledger', (t) => {
  const s = setup(t, { parkList: null })
  const dir = path.join(s.w.root, s.config.workspace.cards_dir, '4-card-4')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, '01b-ledger.md'), '# Ledger\n\n## Nhật ký worker\n\n- cũ\n\n## Khác\n\nx\n')
  const task = s.task('4', { attention: { who: 'agent', since: ago(1), agentMs: 25 * H } })
  expireTask({ root: s.w.root, config: s.config, task, log: s.log })
  const text = s.ledger('4')
  assert.match(text, /- cũ\n- \S+ park hệ thống[^\n]*\n\n## Khác/)
})

test('old failed task is migrated once on start; no park_list means no Trello call', async (t) => {
  const s = setup(t, { parkList: null })
  s.task('5', { phase: 'failed', lastError: 'launch lỗi' })
  s.setCards([])
  await processTasks({ root: s.w.root, config: s.config, source: s.source, channel: s.channel, log: s.log })
  const p = readTask(s.w.root, '5')
  assert.equal(p.parked.reason, 'failed')
  assert.equal(p.parked.list, null)
  assert.deepEqual(s.calls, [])
  const at = p.parked.at
  await processTasks({ root: s.w.root, config: s.config, source: s.source, channel: s.channel, log: s.log })
  assert.equal(readTask(s.w.root, '5').parked.at, at)
  assert.equal(s.ledger('5').match(/park hệ thống/g).length, 1)
})

test('3 launch failures park instead of failing', async (t) => {
  const s = setup(t)
  const task = s.task('6', { phase: 'retrying', launchAttempts: 2, startedAt: undefined })
  const ran = await attemptTaskLaunch({ root: s.w.root, config: s.config, card: { id: '6' }, task, launchTask: async () => { throw new Error('boom') }, log: s.log })
  assert.equal(ran, false)
  const p = readTask(s.w.root, '6')
  assert.equal(p.parked.reason, 'failed')
  assert.match(p.lastError, /boom/)
})

test('parked card pulled back to Doing runs again and resets the lifetime mark', async (t) => {
  const s = setup(t)
  const task = s.task('7', { attention: { who: 'agent', since: ago(H), agentMs: 24 * H } })
  expireTask({ root: s.w.root, config: s.config, task, log: s.log })
  s.setCards([])
  await processTasks({ root: s.w.root, config: s.config, source: s.source, channel: s.channel, log: s.log })
  await new Promise((r) => setTimeout(r, 5))
  s.setCards([{ id: '7', name: 'Card 7', list: 'Doing' }])
  const launched = []
  await processTasks({ root: s.w.root, config: s.config, source: s.source, channel: s.channel, log: s.log, launchTask: async (card, tk) => { launched.push(tk.cardId); return { session: 'ff-7' } } })
  assert.deepEqual(launched, ['7'])
  const r = readTask(s.w.root, '7')
  assert.equal(r.parked, undefined)
  assert.equal(r.phase, 'running')
  assert.equal(r.attention.who, 'agent')
  assert.equal(r.attention.agentMs, 0)
})

test('lifetime: chờ người rất lâu (đồng hồ treo) không park; chỉ giờ agent tính', (t) => {
  const s = setup(t)
  const task = s.task('5', { startedAt: ago(40 * H), attention: { who: 'human', kind: 'permission', since: ago(30 * H), agentMs: 3 * H } })
  assert.equal(expireTask({ root: s.w.root, config: s.config, task, log: s.log }), false)
  const t2 = s.task('6', { startedAt: ago(40 * H), attention: { who: 'agent', since: ago(2 * H), agentMs: 3 * H } })
  assert.equal(expireTask({ root: s.w.root, config: s.config, task: t2, log: s.log }), false)
})

test('vòng poll: phiên còn sống (existing) không log "tiếp tục phiên" và không ghi lại task', async (t) => {
  const s = setup(t)
  const task = s.task('7', { attention: { who: 'agent', since: ago(H), agentMs: 0 }, updatedAt: '2026-01-01T00:00:00.000Z', session: 'ff-7' })
  let launches = 0
  const launchTask = async () => { launches++; return { session: 'ff-7', existing: true } }
  for (let i = 0; i < 3; i++) assert.equal(await attemptTaskLaunch({ root: s.w.root, config: s.config, card: { id: '7' }, task: readTask(s.w.root, '7'), launchTask, resume: true, log: s.log }), true)
  assert.equal(launches, 3)
  assert.equal(s.logs.filter((l) => /tiếp tục phiên/.test(l)).length, 0)
  assert.equal(readTask(s.w.root, '7').updatedAt, '2026-01-01T00:00:00.000Z')
  // phiên thật sự được dựng lại (không existing) vẫn log
  await attemptTaskLaunch({ root: s.w.root, config: s.config, card: { id: '7' }, task: readTask(s.w.root, '7'), launchTask: async () => ({ session: 'ff-7' }), resume: true, log: s.log })
  assert.equal(s.logs.filter((l) => /tiếp tục phiên/.test(l)).length, 1)
})
