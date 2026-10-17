import './helpers/hermetic-home.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeWorkspace, baseConfig } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'
import { main } from '../scripts/cli/main.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { readTask, writeTask } from '../ff-worker/src/core/task-store.mjs'
import { planReconcile, applyReconcile, reconcileWorker, classifyColumn } from '../ff-worker/src/core/reconcile.mjs'

const T0 = '2026-10-22T00:00:00.000Z'
function setup(t, columns = {}, { alive = [], attached = 0 } = {}) {
  const w = makeWorkspace(); t.after(w.cleanup)
  const cfg = loadConfig(w.root).config
  Object.assign(cfg.worker.task_source.trello, { poll_lists: ['Doing', 'QA Fail'], done_list: 'Ready For QA', park_list: 'Todo' })
  const calls = []
  const source = {
    name: 'fake',
    observeCard: async (id) => { calls.push(`observe:${id}`); return { list: columns[id] ?? null, closed: false } },
    moveCard: async () => calls.push('MOVE'), moveTo: async () => calls.push('MOVE'), addComment: async () => calls.push('COMMENT'), comment: async () => calls.push('COMMENT'),
  }
  const tmux = { alive: new Set(alive), killed: [], hasSession(n) { return this.alive.has(n) }, inspectPane() { return { exists: true, attached } }, killSession(n) { this.killed.push(n); return true } }
  const task = (id, extra = {}) => writeTask(w.root, { cardId: id, trelloCardId: id, slug: `c-${id}`, phase: 'running', startedAt: T0, updatedAt: T0, ...extra })
  const folder = (id) => fs.mkdirSync(path.join(w.root, cfg.workspace.cards_dir, `${id}-c-${id}`), { recursive: true })
  return { w, cfg, calls, source, tmux, task, folder, logs: [], plan: () => planReconcile({ root: w.root, config: cfg, source, tmux }) }
}
const row = (rows, id) => rows.find((r) => r.cardId === id)

test('classifyColumn: poll/park/delivered/other', (t) => {
  const { cfg } = setup(t)
  assert.deepEqual(['Doing', 'qa fail', 'Todo', 'Ready For QA', 'Ready to release', 'Done'].map((c) => classifyColumn(cfg, c)), ['poll', 'poll', 'park', 'delivered', 'other', 'other'])
})

test('134: running ở done_list, không tmux -> đóng "đã giao", nhả slot, không đụng Trello', async (t) => {
  const s = setup(t, { 134: 'Ready For QA' }); s.task('134')
  const rows = await s.plan()
  assert.equal(row(rows, '134').action, 'close_delivered')
  assert.equal(readTask(s.w.root, '134').phase, 'running') // dry run không ghi
  const res = await applyReconcile({ root: s.w.root, config: s.cfg, tmux: s.tmux, rows, log: (l) => s.logs.push(l) })
  assert.equal(res[0].done, true)
  const t134 = readTask(s.w.root, '134')
  assert.equal(t134.phase, 'done'); assert.equal(t134.doneVia, 'task_source'); assert.equal(t134.doneColumn, 'Ready For QA'); assert.equal(t134.accepted, false)
  assert.ok(Date.parse(t134.doneAt))
  assert.match(s.logs.join(''), /reconcile thẻ 134/)
  assert.ok(!s.calls.some((c) => c === 'MOVE' || c === 'COMMENT'))
})

test('136: park (lifetime) + cột sau QA + có bằng chứng -> đóng đã nghiệm thu; cột lạ không bằng chứng -> chỉ báo', async (t) => {
  const s = setup(t, { 136: 'Ready to release', 140: 'Backlog' })
  s.task('136', { phase: 'parked', parked: { reason: 'failed', at: T0 }, acceptedAt: T0 }); s.task('140')
  const rows = await s.plan()
  assert.equal(row(rows, '136').action, 'close_accepted')
  assert.equal(row(rows, '140').action, 'release_slot') // cột lạ, không bằng chứng, giữ slot, không tmux
  await applyReconcile({ root: s.w.root, config: s.cfg, tmux: s.tmux, rows })
  const r = readTask(s.w.root, '136')
  assert.equal(r.phase, 'done'); assert.equal(r.accepted, true); assert.equal(r.parked, undefined); assert.equal(r.parkedBefore.reason, 'failed')
  assert.equal(readTask(s.w.root, '140').phase, 'released')
})

test('93: chỉ có thư mục thẻ + worktree, cột Done -> chỉ báo, gợi ý dọn, không xóa', async (t) => {
  const s = setup(t, { 93: 'Done' }); s.folder('93')
  const wt = path.join(s.w.root, 'worktrees', '93-c-93'); fs.mkdirSync(wt, { recursive: true })
  const rows = await s.plan()
  assert.equal(row(rows, '93').action, 'report')
  assert.match(row(rows, '93').cleanup[0], /worktrees\/93-c-93 có thể dọn/)
  await applyReconcile({ root: s.w.root, config: s.cfg, tmux: s.tmux, rows })
  assert.ok(fs.existsSync(wt)); assert.equal(readTask(s.w.root, '93'), null)
})

test('186: đã done cục bộ + Ready to release -> không đổi; park khớp Todo -> ok; Doing -> để worker; không thấy -> báo', async (t) => {
  const s = setup(t, { 186: 'Ready to release', 7: 'Todo', 8: 'Doing' })
  s.task('186', { phase: 'done' }); s.task('7', { phase: 'parked', parked: { reason: 'failed' } }); s.task('8'); s.task('9')
  const rows = await s.plan()
  assert.deepEqual(['186', '7', '8', '9'].map((id) => row(rows, id).action), ['ok', 'ok', 'leave', 'report'])
  assert.equal(row(rows, '9').column, null)
})

test('b: running, không tmux, thẻ ở Todo -> nhả slot (phase released); có tmux sống -> để worker', async (t) => {
  const s = setup(t, { 5: 'Todo', 6: 'Todo' }, { alive: ['ff-6'] }); s.task('5'); s.task('6')
  const rows = await s.plan()
  assert.equal(row(rows, '5').action, 'release_slot'); assert.equal(row(rows, '6').action, 'leave')
  await applyReconcile({ root: s.w.root, config: s.cfg, tmux: s.tmux, rows })
  assert.equal(readTask(s.w.root, '5').phase, 'released')
})

test('tmux: đóng khi không attach, giữ khi đang attach', async (t) => {
  for (const [attached, killed] of [[0, ['ff-1']], [1, []]]) {
    const s = setup(t, { 1: 'Ready For QA' }, { alive: ['ff-1'], attached }); s.task('1')
    await applyReconcile({ root: s.w.root, config: s.cfg, tmux: s.tmux, rows: await s.plan() })
    assert.deepEqual(s.tmux.killed, killed)
    assert.equal(readTask(s.w.root, '1').phase, 'done')
  }
})

test('ghi an toàn: task đổi giữa lúc lập kế hoạch -> bỏ qua, không đè', async (t) => {
  const s = setup(t, { 134: 'Ready For QA' }); s.task('134')
  const rows = await s.plan()
  s.task('134', { updatedAt: '2026-10-23T00:00:00.000Z' }) // worker ghi xen vào
  const res = await applyReconcile({ root: s.w.root, config: s.cfg, tmux: s.tmux, rows })
  assert.equal(res[0].done, false)
  assert.equal(readTask(s.w.root, '134').phase, 'running')
})

test('harness: working ở done_list -> acceptance chờ nghiệm thu, nhả slot; sang cột sau -> done', async (t) => {
  const s = setup(t, { 21: 'Ready For QA', 22: 'Ready to release' })
  const h = (id, extra) => s.task(id, { stateVersion: 3, stage: 'build', waitingOn: null, executionStatus: 'working', workingReserved: true, workingSince: T0, runId: 'r', dispatchId: '', revision: '', history: [], ...extra })
  h('21'); h('22', { stage: 'acceptance', waitingOn: 'acceptance', executionStatus: 'waiting_human', workingReserved: false, acceptedAt: T0 })
  await applyReconcile({ root: s.w.root, config: s.cfg, tmux: s.tmux, rows: await s.plan() })
  const a = readTask(s.w.root, '21'), b = readTask(s.w.root, '22')
  assert.equal(a.stage, 'acceptance'); assert.equal(a.waitingOn, 'acceptance'); assert.equal(a.workingReserved, false); assert.equal(a.stateVersion, 4)
  assert.equal(b.stage, 'done'); assert.equal(b.doneVia, 'task_source'); assert.equal(b.accepted, true)
})

test('reconcileWorker: bỏ qua thẻ trong poll, chỉ ca đang mở', async (t) => {
  const s = setup(t, { 1: 'Ready For QA', 2: 'Ready For QA', 3: 'Doing' }); s.task('1'); s.task('2'); s.task('3')
  const res = await reconcileWorker({ root: s.w.root, config: s.cfg, source: s.source, tmux: s.tmux, pollIds: new Set(['2']), log: (l) => s.logs.push(l) })
  assert.deepEqual(res.map((r) => r.cardId), ['1'])
  assert.equal(readTask(s.w.root, '2').phase, 'running'); assert.equal(readTask(s.w.root, '3').phase, 'running')
})

test('ff task reconcile: mặc định in bảng không ghi; --apply ghi; --json', async (t) => {
  const s = setup(t, { 134: 'Ready For QA' }); s.task('134')
  const run = async (args) => { const { ctx, buf } = capture(s.w.root); ctx.source = s.source; ctx.tmux = s.tmux; const code = await main(['task', 'reconcile', ...args], ctx); return { code, ...buf } }
  let r = await run([])
  assert.equal(r.code, 0)
  assert.match(r.out, /Thẻ\s+\| Cột Trello\s+\| Trạng thái máy\s+\| Việc sẽ làm/)
  assert.match(r.out, /#134\s+\| Ready For QA\s+\| chưa rõ \(running\)\s+\| ĐÓNG \(đã giao, chờ QA\)/)
  assert.equal(readTask(s.w.root, '134').phase, 'running')
  r = await run(['--json'])
  assert.equal(JSON.parse(r.out).rows[0].action, 'close_delivered')
  r = await run(['--apply'])
  assert.match(r.out, /Việc đã làm/); assert.match(r.out, /xong/)
  assert.equal(readTask(s.w.root, '134').phase, 'done')
})

test('worker: khởi động và mỗi vòng poll nhả slot thẻ đã rời poll_lists', async (t) => {
  const { recoverTasks, reconcileCycle } = await import('../ff-worker/src/core/runtime.mjs')
  const s = setup(t, { 134: 'Todo', 94: 'Doing', 77: 'Ready to release' })
  s.source.poll = async () => [{ id: '94', name: 'x', list: 'Doing' }]
  s.source.fetchDossier = async () => '# d\n'
  s.tmux.hasSession = () => false
  s.task('134', { phase: 'running' })
  await recoverTasks({ root: s.w.root, config: s.cfg, tmux: s.tmux, log: (l) => s.logs.push(l), source: s.source, channel: { notify: async () => {} } })
  assert.match(s.logs.join(''), /thẻ 134 không còn trong poll_lists/)
  assert.equal(readTask(s.w.root, '134').phase, 'released')
  assert.match(s.logs.join(''), /reconcile thẻ 134: nhả slot/)
  s.task('77', { phase: 'running', acceptedAt: T0 })
  await reconcileCycle({ root: s.w.root, config: s.cfg, source: s.source, tmux: s.tmux, log: (l) => s.logs.push(l) })
  assert.equal(readTask(s.w.root, '77').doneVia, 'task_source')
  assert.ok(!s.calls.some((c) => c === 'MOVE' || c === 'COMMENT'))
})

test('khớp `ff worker status`: completed + attention agent (134) và failed + parked (136) không bị coi là đã đóng', async (t) => {
  const { cardRows } = await import('../scripts/lib/card-status.mjs')
  const s = setup(t, { 134: 'Ready For QA', 136: 'Ready to release', 135: 'Doing' })
  s.task('134', { phase: 'completed', attention: { who: 'agent', since: T0, agentMs: 0 } })
  s.task('136', { phase: 'failed', parked: { reason: 'failed', at: T0, list: 'Todo' }, lastError: 'Session lifetime', acceptedAt: T0 })
  s.task('135', { attention: { who: 'agent', since: T0, agentMs: 0 } })
  const status = (id) => cardRows([readTask(s.w.root, id)])[0].waiting
  assert.deepEqual(['134', '136'].map(status), ['agent', 'parked'])
  const rows = await s.plan()
  assert.deepEqual(['134', '136', '135'].map((id) => row(rows, id).action), ['close_delivered', 'close_accepted', 'leave'])
  await applyReconcile({ root: s.w.root, config: s.cfg, tmux: s.tmux, rows })
  assert.deepEqual(['134', '136', '135'].map(status), ['done', 'done', 'agent'])
})

test('nhả slot cũng bỏ attention agent (status hết báo "agent đang làm"); thẻ quay lại thì reset', async (t) => {
  const { cardRows } = await import('../scripts/lib/card-status.mjs')
  const s = setup(t, { 5: 'Backlog' }); s.task('5', { attention: { who: 'agent', since: T0, agentMs: 0 } })
  const rows = await s.plan()
  assert.equal(row(rows, '5').action, 'release_slot') // cột lạ không bằng chứng + giữ slot + không tmux
  await applyReconcile({ root: s.w.root, config: s.cfg, tmux: s.tmux, rows })
  const r = readTask(s.w.root, '5')
  assert.equal(r.phase, 'released'); assert.notEqual(cardRows([r])[0].waiting, 'agent')
})

test('id thẻ: không có task -> tra bằng source.get (idShort), thẻ local* bị bỏ qua, không gọi observeCard', async (t) => {
  const s = setup(t, {}); s.folder('93'); s.folder('local1'); s.folder('94')
  s.source.name = 'trello'
  s.source.get = async (id) => { s.calls.push(`get:${id}`); if (id === '94') throw new Error('Trello API trả HTTP 404'); return { id, list: 'Done' } }
  const rows = await s.plan()
  assert.equal(row(rows, '93').column, 'Done')
  assert.equal(row(rows, 'local1').summary, 'thẻ local, bỏ qua')
  assert.equal(row(rows, '94').column, null)
  assert.ok(!s.calls.some((c) => c === 'observe:93' || c === 'observe:local1'))
})
