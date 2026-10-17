import './helpers/hermetic-home.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { makeWorkspace } from './helpers/fixture.mjs'
import { loadConfig, resolveTrelloLists } from '../scripts/lib/config.mjs'
import { readTask, writeTask } from '../ff-worker/src/core/task-store.mjs'
import { recoverTasks } from '../ff-worker/src/core/runtime.mjs'
import { closeShippedLegacyTasks, qaFailPrompt, processTasks } from '../ff-worker/src/core/worker.mjs'

const NOW = new Date().toISOString()
function setup(t, { cards = [], observed = {}, pollFails = false, attached = 0 } = {}) {
  const w = makeWorkspace(); t.after(w.cleanup)
  const cfg = loadConfig(w.root).config
  Object.assign(cfg.worker.task_source.trello, { poll_lists: ['Doing', 'QA Fail'], done_list: 'Ready For QA', doing_list: 'Doing', qa_fail_list: 'QA Fail' })
  cfg.worker.max_concurrent_tasks = 2
  const logs = [], notes = [], events = []
  const state = { cards, pollFails }
  const source = {
    name: 'fake',
    poll: async () => { events.push('poll'); if (state.pollFails) throw new Error('trello down'); return state.cards },
    observeCard: async (id) => ({ list: observed[id] ?? null, closed: false }),
    fetchDossier: async (c) => { events.push(`pull:${c.id}`); return '# d\n' },
    moveCard: async (id, list) => { events.push(`move:${id}:${list}`) },
  }
  const channel = { notify: async (n) => { notes.push(n.body) } }
  const tmux = {
    alive: new Set(), started: [], killed: [],
    hasSession(name) { return this.alive.has(name) },
    inspectPane() { return { exists: true, status: 'occupied', attached } },
    killSession(name) { this.killed.push(name); return true },
    async start(name, _cwd, cmd, prompt) { this.started.push({ name, cmd, prompt }); return { existing: false } },
    async sendLiteral() {},
  }
  const task = (id, extra = {}) => writeTask(w.root, { cardId: id, trelloCardId: id, slug: `card-${id}`, phase: 'running', startedAt: NOW, updatedAt: NOW, ...extra })
  return { w, cfg, logs, notes, events, state, source, channel, tmux, task, log: (l) => logs.push(l),
    recover: () => recoverTasks({ root: w.root, config: cfg, tmux, log: (l) => logs.push(l), source, channel }) }
}
const card = (id, list, extra = {}) => ({ id, name: `Card ${id}`, list, ...extra })

test('startup: only Doing tasks relaunch; Ready For QA closed; QA Fail left to the QA pick with no pull/resume', async (t) => {
  const s = setup(t, { cards: [card('5', 'Doing'), card('136', 'QA Fail')], observed: { 186: 'Ready For QA' } })
  s.task('186'); s.task('136'); s.task('5')
  s.tmux.alive.add('ff-186')
  await s.recover()
  assert.deepEqual(s.tmux.started.map((x) => x.name), ['ff-5'], 'only the Doing task is relaunched')
  assert.ok(!s.events.includes('pull:136') && !s.events.includes('pull:186'))
  const done = readTask(s.w.root, '186')
  assert.equal(done.phase, 'done'); assert.ok(done.doneAt); assert.equal(done.doneList, 'Ready For QA')
  assert.deepEqual(s.tmux.killed, ['ff-186'])
  assert.deepEqual(s.notes, ['✅ Thẻ đã sang Ready For QA – đóng phiên'])
  assert.equal(readTask(s.w.root, '136').phase, 'running')
  assert.ok(s.logs.some((l) => l.includes('khởi động') && l.includes('136') && l.includes('QA pick')))
  // the following poll cycle does the single QA pull + move + prompt
  s.events.length = 0
  await processTasks({ root: s.w.root, config: s.cfg, source: s.source, channel: s.channel, log: s.log, sessionAlive: () => true,
    launchTask: async () => ({ session: 'ff-136', promptSent: false }) })
  assert.equal(s.events.filter((e) => e === 'pull:136').length, 1)
  assert.ok(s.logs.some((l) => /pull thẻ 136/.test(l)) && s.logs.some((l) => /chuyển thẻ 136: QA Fail → Doing/.test(l)) && s.logs.some((l) => /prompt QA chờ pane rảnh/.test(l)))
})

test('startup: Trello unreachable relaunches nothing', async (t) => {
  const s = setup(t, { pollFails: true })
  s.task('5')
  await s.recover()
  assert.deepEqual(s.tmux.started, [])
  assert.ok(s.logs.some((l) => l.includes('Trello không truy cập được')))
})

test('done_list close keeps an attached tmux session and never relaunches', async (t) => {
  const s = setup(t, { observed: { 7: 'Ready For QA' }, attached: 1 })
  s.task('7'); s.tmux.alive.add('ff-7')
  const r = await closeShippedLegacyTasks({ root: s.w.root, config: s.cfg, source: s.source, channel: s.channel, tmux: s.tmux, log: s.log })
  assert.deepEqual(r.closed, ['7']); assert.deepEqual(s.tmux.killed, [])
  assert.equal(readTask(s.w.root, '7').phase, 'done')
  assert.ok(s.logs.some((l) => l.includes('attach')))
  s.state.cards = [card('7', 'Doing')]
  await processTasks({ root: s.w.root, config: s.cfg, source: s.source, channel: s.channel, log: s.log, launchTask: async () => { throw new Error('must not launch') } })
})

test('QA prompt: single fixed prompt pointing at the dossier and ff-understand', async (t) => {
  const s = setup(t)
  const task = { cardId: '9', slug: 'card-9', qaPending: { n: 1 } }
  assert.equal(qaFailPrompt(s.w.root, s.cfg, task), 'Thẻ quay lại sau nghiệm thu fail (lần 1) – dossier đã pull lại tại trellocards/9-card-9/01-dossier.md. Chạy ff-understand; bước Trinh sát thẻ sẽ xử lý báo bug và các rev trước.')
})

// WRK-12 (legacy): thẻ chưa ở done_list nhưng thay đổi đã vào base_branch.
const view = (states) => ({ repos: states.map((state, i) => ({ repo: `r${i}` })), landing: { repos: states.map((state, i) => ({ repo: `r${i}`, state })) }, allLanded: states.every((x) => x === 'merged') })
test('legacy: done_on=base_branch + đã vào base_branch → chuyển sang done_list và đóng task', async (t) => {
  const s = setup(t, { observed: { 8: 'Doing' } })
  s.cfg.ship = { ...s.cfg.ship, done_on: 'base_branch' }
  const moved = []; s.source.moveTo = async (id, list) => { moved.push([id, list]) }
  s.task('8')
  const r = await closeShippedLegacyTasks({ root: s.w.root, config: s.cfg, source: s.source, channel: s.channel, tmux: s.tmux, log: s.log, landing: () => view(['merged']) })
  assert.deepEqual(r.closed, ['8']); assert.deepEqual(r.landed, ['8']); assert.deepEqual(moved, [['8', 'Ready For QA']])
  const task = readTask(s.w.root, '8')
  assert.equal(task.phase, 'done'); assert.equal(task.doneVia, 'base_branch'); assert.equal(task.doneList, 'Ready For QA')
  assert.ok(s.notes[0].includes('đã vào base_branch'))
})

test('legacy: chưa vào base_branch / nội dung khác / done_on=pr → không đóng, chỉ log', async (t) => {
  for (const [doneOn, states] of [['base_branch', ['merged', 'absent']], ['base_branch', ['edited']], ['pr', ['merged']]]) {
    const s = setup(t, { observed: { 8: 'Doing' } })
    s.cfg.ship = { ...s.cfg.ship, done_on: doneOn }
    s.source.moveTo = async () => assert.fail('must not move')
    s.task('8')
    const r = await closeShippedLegacyTasks({ root: s.w.root, config: s.cfg, source: s.source, channel: s.channel, tmux: s.tmux, log: s.log, landing: () => view(states) })
    assert.deepEqual(r.closed, [], `${doneOn} ${states}`)
    assert.equal(readTask(s.w.root, '8').phase, 'running')
  }
})

test('legacy: không có bằng chứng ship (observeLegacyLanding null) → không đóng', async (t) => {
  const s = setup(t, { observed: { 8: 'Doing' } })
  s.cfg.ship = { ...s.cfg.ship, done_on: 'either' }
  s.task('8')
  const r = await closeShippedLegacyTasks({ root: s.w.root, config: s.cfg, source: s.source, channel: s.channel, tmux: s.tmux, log: s.log })
  assert.deepEqual(r.closed, [])
})
