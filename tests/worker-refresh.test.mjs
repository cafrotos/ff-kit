import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeWorkspace } from './helpers/fixture.mjs'
import { loadConfig, resolveTrelloLists } from '../scripts/lib/config.mjs'
import { processTasks, launchAgentTask } from '../ff-worker/src/core/worker.mjs'
import { readTask, writeTask } from '../ff-worker/src/core/task-store.mjs'
import { checkBoardLists } from '../ff-worker/src/core/runtime.mjs'
import { TrelloTaskSource } from '../ff-worker/src/adapters/task-source/trello.mjs'

const NOW = new Date().toISOString()
function setup(t, { cards = [], failFetch = false, failMove = false, config } = {}) {
  const w = makeWorkspace(); t.after(w.cleanup)
  const cfg = loadConfig(w.root).config
  Object.assign(cfg.worker.task_source.trello, config ?? {})
  const log = [], notes = [], fetched = [], moved = [], launched = []
  const state = { cards, failFetch, failMove }
  const source = {
    name: 'fake',
    poll: async () => state.cards,
    fetchDossier: async (card) => { log.push(`fetch:${card.id}`); if (state.failFetch) throw new Error('trello down'); fetched.push(card.id); return `# dossier ${card.id}\n` },
    moveCard: async (id, list) => { log.push(`move:${id}:${list}`); if (state.failMove) throw new Error('move boom'); moved.push([id, list]) },
  }
  const channel = { notify: async (n) => { notes.push(n.body) } }
  const run = (extra = {}) => processTasks({ root: w.root, config: cfg, source, channel, log: (l) => log.push(`log:${l}`),
    launchTask: async (card, task, opts) => { log.push(`launch:${card.id}`); launched.push({ id: card.id, task: { ...task }, opts }); return { session: `ff-${task.cardId}` } }, ...extra })
  return { w, cfg, log, notes, fetched, moved, launched, state, source, run }
}
const card = (id, list, extra = {}) => ({ id, name: `Card ${id}`, list, ...extra })

test('R1 new task: dossier is fetched before launch; fetch failure blocks the start and leaves no task', async (t) => {
  const s = setup(t, { cards: [card('1', 'Doing')], failFetch: true })
  await s.run()
  assert.deepEqual(s.launched, []); assert.equal(readTask(s.w.root, '1'), null)
  s.state.failFetch = false
  await s.run()
  assert.deepEqual(s.launched.map((l) => l.id), ['1'])
  assert.ok(s.log.indexOf('fetch:1') < s.log.indexOf('launch:1'))
})

test('R1 resume: dossier is refreshed before resuming a task without a live session; failure keeps it waiting', async (t) => {
  const s = setup(t, { cards: [card('1', 'Doing')] })
  writeTask(s.w.root, { cardId: '1', trelloCardId: '1', slug: 'card-1', phase: 'running', startedAt: NOW, updatedAt: NOW })
  s.state.failFetch = true
  await s.run({ sessionAlive: () => false })
  assert.deepEqual(s.launched, [])
  s.state.failFetch = false
  await s.run({ sessionAlive: () => false })
  assert.deepEqual(s.launched.map((l) => l.id), ['1'])
  assert.ok(s.log.indexOf('fetch:1') < s.log.indexOf('launch:1'))
  // live session: no refresh churn
  s.log.length = 0
  await s.run({ sessionAlive: () => true })
  assert.ok(!s.log.includes('fetch:1'))
})

test('R2 Doing cards run before QA Fail; QA Fail only when no Doing candidate waits', async (t) => {
  const s = setup(t, { cards: [card('9', 'QA Fail', { pos: 1 }), card('3', 'Doing', { pos: 5 }), card('2', 'Doing', { pos: 2 })], config: { poll_lists: ['QA Fail', 'Doing'] } })
  s.cfg.worker.max_concurrent_tasks = 1
  await s.run()
  assert.deepEqual(s.launched.map((l) => l.id), ['2'], 'pos order inside Doing, QA Fail untouched')
  assert.deepEqual(s.moved, [])
  // Doing card 3 still waiting (no slot) -> QA Fail still not picked
  s.cfg.worker.max_concurrent_tasks = 3
  await s.run({ sessionAlive: () => true })
  assert.deepEqual([...new Set(s.launched.map((l) => l.id))], ['2', '3'])
  assert.deepEqual(s.moved, [], 'QA Fail waited for the Doing candidate in the same cycle')
  await s.run({ sessionAlive: () => true })
  assert.deepEqual(s.moved, [['9', 'Doing']])
})

test('R3 QA Fail without task: refresh -> move -> run, notification, qaFailCount', async (t) => {
  const s = setup(t, { cards: [card('9', 'QA Fail')] })
  await s.run()
  assert.deepEqual(s.log.filter((l) => !l.startsWith('log:')), ['fetch:9', 'move:9:Doing', 'launch:9'])
  assert.equal(readTask(s.w.root, '9').qaFailCount, 1)
  assert.deepEqual(s.notes.filter((n) => n.startsWith('🔁')), ['🔁 QA fail lần 1 – đã kéo về Doing, bắt đầu sửa'])
  assert.equal(s.launched[0].opts.qaPrompt, undefined, 'new task runs the normal flow from the start')
})

test('R3 failure at each step keeps the card in QA Fail and does not run', async (t) => {
  const s = setup(t, { cards: [card('9', 'QA Fail')] })
  s.state.failFetch = true
  await s.run()
  assert.deepEqual(s.log.filter((l) => /^(move|launch)/.test(l)), [])
  s.state.failFetch = false; s.state.failMove = true
  await s.run(); await s.run()
  assert.deepEqual(s.launched, [])
  assert.equal(readTask(s.w.root, '9'), null)
  assert.equal(s.notes.filter((n) => n.startsWith('⚠')).length, 1, 'one notification for repeated move failure')
  s.state.failMove = false
  await s.run()
  assert.deepEqual(s.launched.map((l) => l.id), ['9'])
})

test('R3 existing task: QA prompt passed on resume with count; max_reopen parks without running', async (t) => {
  const s = setup(t, { cards: [card('9', 'QA Fail')] })
  writeTask(s.w.root, { cardId: '9', trelloCardId: '9', slug: 'card-9', phase: 'completed', startedAt: NOW, updatedAt: NOW, qaFailCount: 1 })
  await s.run()
  const l = s.launched[0]
  assert.equal(l.opts.resume, true)
  assert.match(l.opts.qaPrompt, /^Thẻ quay lại sau nghiệm thu fail \(lần 2\) – dossier đã pull lại tại trellocards\/9-card-9\/01-dossier\.md\. Chạy ff-understand;/)
  assert.equal(readTask(s.w.root, '9').qaFailCount, 2)
  // exceed max_reopen (default 3)
  const s2 = setup(t, { cards: [card('8', 'QA Fail')] })
  writeTask(s2.w.root, { cardId: '8', trelloCardId: '8', slug: 'card-8', phase: 'completed', updatedAt: NOW, qaFailCount: 3 })
  await s2.run()
  assert.deepEqual(s2.launched, [])
  assert.deepEqual(s2.moved, [['8', 'Doing']])
  assert.equal(readTask(s2.w.root, '8').parked.reason, 'max_reopen')
  assert.ok(s2.log.includes('fetch:8'))
  assert.ok(s2.notes.some((n) => n.startsWith('⏸') && n.includes('max_reopen')))
  await s2.run(); assert.deepEqual(s2.launched, [])
})

function fakeTmux({ exists, status }) {
  const calls = []
  return { calls, hasSession: () => exists, inspectPane: () => ({ status }), sendLiteral: async (...a) => { calls.push(['send', a[2]]) }, start: async (...a) => { calls.push(['start', a[2], a[3]]); return { existing: false } } }
}
test('QA prompt is sent into the existing session only when the pane is idle', async (t) => {
  const s = setup(t)
  const task = { cardId: '9', slug: 'card-9', qaPending: { n: 2 } }
  const base = { root: s.w.root, config: s.cfg, card: card('9', 'Doing'), task, resume: true, qaPrompt: 'QA fail lần 2 – x' }
  const busy = fakeTmux({ exists: true, status: 'occupied' })
  assert.equal((await launchAgentTask({ ...base, tmux: busy })).promptSent, false); assert.deepEqual(busy.calls, [])
  const idle = fakeTmux({ exists: true, status: 'idle' })
  assert.equal((await launchAgentTask({ ...base, tmux: idle })).promptSent, true); assert.deepEqual(idle.calls, [['send', 'QA fail lần 2 – x']])
  const gone = fakeTmux({ exists: false, status: 'exited' })
  await launchAgentTask({ ...base, tmux: gone })
  assert.equal(gone.calls[0][0], 'start'); assert.match(gone.calls[0][1], /--continue/); assert.equal(gone.calls[0][2], 'QA fail lần 2 – x')
})

test('busy pane keeps qaPending and retries next cycle without re-counting', async (t) => {
  const s = setup(t, { cards: [card('9', 'QA Fail')] })
  writeTask(s.w.root, { cardId: '9', trelloCardId: '9', slug: 'card-9', phase: 'running', startedAt: NOW, updatedAt: NOW })
  let sent = false
  const launchTask = async (_c, _t, opts) => { s.launched.push(opts); return { session: 'ff-9', promptSent: sent } }
  await s.run({ launchTask })
  assert.equal(readTask(s.w.root, '9').qaPending.n, 1)
  s.state.cards = [card('9', 'Doing')]; sent = true
  await s.run({ launchTask, sessionAlive: () => true })
  assert.equal(s.launched.length, 2); assert.match(s.launched[1].qaPrompt, /sau nghiệm thu fail \(lần 1\)/)
  const done = readTask(s.w.root, '9'); assert.equal(done.qaPending, undefined); assert.equal(done.qaFailCount, 1)
})

test('list defaults and board-list check include doing_list and qa_fail_list', async () => {
  assert.deepEqual(resolveTrelloLists({ poll_lists: ['Todo', 'QA Fail', 'Doing'] }), { doing: 'Todo', qaFail: 'QA Fail' })
  assert.deepEqual(resolveTrelloLists({ poll_lists: ['A', 'B'], doing_list: 'B', qa_fail_list: 'Bug' }), { doing: 'B', qaFail: 'Bug' })
  const source = { listNames: async () => ['Doing', 'Ready'] }
  const r = await checkBoardLists({ config: { worker: { task_source: { trello: { poll_lists: ['Doing'], done_list: 'Ready', doing_list: 'Working', qa_fail_list: 'Bugs' } } } }, source })
  assert.deepEqual(r.missing, ['Working', 'Bugs'])
})

test('trello pullDossier lists all comments, no QA-log or new-comment sections, marker is a timestamp', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-pull-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const env = path.join(dir, 'e.env'); fs.writeFileSync(env, 'TRELLO_API_KEY=k\nTRELLO_API_TOKEN=s\n')
  const actions = [
    { id: 'a2', date: '2026-02-02T00:00:00Z', data: { text: 'bug QA' }, memberCreator: { fullName: 'QA' } },
    { id: 'a1', date: '2026-01-01T00:00:00Z', data: { text: 'cũ' }, memberCreator: { fullName: 'Dev' } },
  ]
  const fetchImpl = async (url) => { const u = String(url); return Response.json(u.includes('/actions') ? actions : u.includes('/checklists') ? [] : { idShort: 7, name: 'T', desc: 'd', labels: [] }) }
  const src = new TrelloTaskSource({ config: { board_id: 'b', poll_lists: ['Doing'] }, envFile: env, fetchImpl })
  const first = await src.pullDossier({ id: '7' }, { now: () => Date.parse('2026-03-01T00:00:00Z') })
  assert.ok(!first.text.includes('Comment mới') && !first.text.includes('Log bug QA'))
  assert.deepEqual(first.marker, { at: '2026-03-01T00:00:00.000Z' })
  assert.match(first.text, /## Comments\n- Dev · 2026-01-01: cũ\n- QA · 2026-02-02: bug QA\n/)
})
