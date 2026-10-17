import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeHarnessFixture } from './helpers/harness.mjs'
import { readTask } from '../ff-worker/src/core/task-store.mjs'
import { reconcileParking, closeIdleParkedSessions, chatPark } from '../ff-worker/src/core/park.mjs'
import * as runtime from '../ff-worker/src/core/runtime.mjs'
import { runWorker } from '../ff-worker/src/core/runtime.mjs'
import * as workerCli from '../scripts/cli/worker.mjs'

const POLL = ['Todo', 'QA Fail']
function fx(t) {
  const f = makeHarnessFixture(t)
  f.config.worker.task_source.trello.poll_lists = POLL
  const notes = []
  const channel = { notify: async n => { notes.push(n) } }
  return { f, notes, channel }
}
const seedTask = (f, id, o = {}) => f.seedTask(f.task({ cardId: id, slug: 'x', ...o }))
const polled = (...ids) => new Map(ids.map(id => [id, { cardId: id, list: 'Todo' }]))
const tasksOf = f => fs.readdirSync(path.join(f.root, '.ff/tasks')).filter(n => n.endsWith('.json')).map(n => readTask(f.root, n.slice(0, -5)))
const run = (c, source, ids = [], extra = {}) => reconcileParking({ root: c.f.root, config: c.f.config, source, channel: c.channel, tasks: tasksOf(c.f), polled: polled(...ids), now: c.f.clock.now, ...extra })

test('reconcile table', async t => {
  const c = fx(t)
  for (const id of ['1', '2', '3', '4', '5', '6', '7']) seedTask(c.f, id)
  seedTask(c.f, '8', { stage: 'acceptance' })
  const obs = {
    2: { list: 'Doing', assignedToMe: true, closed: false },
    3: { list: 'Todo', assignedToMe: false, closed: false },
    4: { list: null, assignedToMe: false, closed: true },
    5: { list: 'Todo', assignedToMe: true, closed: false },
    8: { list: 'Done', assignedToMe: true, closed: false },
  }
  const calls = []
  const source = { observeCard: async id => { calls.push(id); if (id === '6') throw new Error('net'); if (id === '7') return { list: 'QA Fail', assignedToMe: true, closed: false }; return obs[id] } }
  await run(c, source, ['1'])
  const parked = id => readTask(c.f.root, id).parked
  assert.equal(parked('1'), undefined)
  assert.equal(parked('2').reason, 'trello'); assert.equal(parked('2').list, 'Doing')
  assert.equal(parked('3').reason, 'trello')
  assert.equal(parked('4').reason, 'trello')
  assert.equal(parked('5'), undefined, 'still in a poll list and mine')
  assert.equal(parked('6'), undefined, 'observe throws keeps state')
  assert.equal(parked('7'), undefined)
  assert.equal(parked('8'), undefined); assert.ok(!calls.includes('8'), 'post-ship untouched')
  assert.equal(c.notes.length, 3)
  assert.equal(c.notes.find(n => n.taskId === '2').body, '⏸ Tạm dừng: thẻ rời Doing')
  // back in poll list -> resumes, state otherwise unchanged
  await run(c, source, ['1', '2'])
  assert.equal(parked('2'), undefined); assert.equal(readTask(c.f.root, '2').stage, 'understand')
  assert.equal(parked('3').reason, 'trello')
  // re-running does not renotify
  await run(c, source, ['1'])
  assert.equal(c.notes.length, 4)
})

test('chat park stays parked while card remains in poll list, resumes after leaving and returning', async t => {
  const c = fx(t)
  seedTask(c.f, '1')
  const moved = [], comments = []
  const source = { moveCard: async (id, l) => moved.push([id, l]), addComment: async (id, x) => comments.push([id, x]), observeCard: async () => ({ list: 'Todo', assignedToMe: true, closed: false }) }
  c.f.config.worker.task_source.trello.park_list = 'Parked'
  const r = await chatPark({ root: c.f.root, config: c.f.config, source, channel: c.channel, cardId: '1', comment: 'lý do', now: c.f.clock.now })
  assert.deepEqual(r.errors, []); assert.deepEqual(moved, [['1', 'Parked']]); assert.deepEqual(comments, [['1', 'lý do']])
  assert.equal(c.notes.length, 1); assert.equal(c.notes[0].body, '⏸ Tạm dừng: bạn đánh dấu trong chat')
  await run(c, source, ['1']); assert.equal(readTask(c.f.root, '1').parked.reason, 'chat')
  await run(c, source, []); await run(c, source, [])
  assert.equal(readTask(c.f.root, '1').parked.sawOut, true)
  await run(c, source, ['1']); assert.equal(readTask(c.f.root, '1').parked, undefined)
})

test('chat park reports moveCard/addComment errors but stays parked, one notification', async t => {
  const c = fx(t)
  seedTask(c.f, '1')
  c.f.config.worker.task_source.trello.park_list = 'Parked'
  const source = { moveCard: async () => { throw new Error('boom') }, addComment: async () => { throw new Error('bam') } }
  const r = await chatPark({ root: c.f.root, config: c.f.config, source, channel: c.channel, cardId: '1', comment: 'x', now: c.f.clock.now })
  assert.equal(r.errors.length, 2); assert.ok(readTask(c.f.root, '1').parked)
  assert.equal(c.notes.length, 1); assert.match(c.notes[0].body, /boom/)
})

test('tmux closes only after timeout, only when detached and idle', async t => {
  const c = fx(t)
  seedTask(c.f, '1', { tmuxSession: 'ff-1', parked: { reason: 'trello', at: new Date(c.f.clock.now()).toISOString(), list: 'X' } })
  const killed = []
  let pane = { exists: true, status: 'idle', attached: 0 }
  const tmux = { inspectPane: () => pane, killSession: n => { killed.push(n); return true } }
  const go = () => closeIdleParkedSessions({ root: c.f.root, config: c.f.config, tasks: tasksOf(c.f), tmux, now: c.f.clock.now })
  await go(); assert.deepEqual(killed, [])
  c.f.clock.advance(61 * 60000)
  pane = { exists: true, status: 'occupied', attached: 1 }; await go(); assert.deepEqual(killed, [])
  pane = { exists: true, status: 'occupied', attached: 0 }; await go(); assert.deepEqual(killed, [])
  pane = { exists: true, status: 'idle', attached: 0 }; await go(); assert.deepEqual(killed, ['ff-1'])
  const t1 = readTask(c.f.root, '1'); assert.ok(t1.parked.tmuxClosedAt); assert.equal(t1.stage, 'understand')
  await go(); assert.deepEqual(killed, ['ff-1'])
})

function seedCard(f, id, o) {
  const dir = path.join(f.root, 'trellocards', `${id}-harness`)
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, '01-dossier.md'), '# d')
  seedTask(f, id, { slug: 'harness', testRoot: f.root, claudeSessionId: '1f8a9f32-36c8-4479-8aee-4d745c188452', ...o })
}
test('slots: parked and waiting free slots; started tasks, then QA Fail list, take them first', async t => {
  const c = fx(t); const { f } = c
  f.config.worker.max_concurrent_tasks = 1
  const sent = []
  const runner = {
    inspect: async task => ({ status: task.executionStatus === 'working' ? 'working' : 'idle', inputEmpty: true, launchStatus: 'established', dispatchStatus: task.pendingDispatch ? 'prepared' : 'none', runId: task.runId, claudeSessionId: task.claudeSessionId }),
    start: async () => ({ status: 'idle' }), resume: async () => ({ status: 'idle' }),
    sendStage: async task => { sent.push(task.cardId); return { status: 'working', dispatchStatus: 'sent' } },
  }
  const wd = { runId: 'run-1', revision: '', dispatchId: 'd', stage: 'understand' }
  // 1 is parked while working: must not hold the slot
  seedCard(f, '1', { executionStatus: 'working', pendingDispatch: wd, dispatchId: 'd', dispatchState: 'started', parked: { reason: 'chat', at: new Date(f.clock.now()).toISOString(), sawOut: false } })
  seedCard(f, '2', { waitingOn: 'GATE_C', executionStatus: 'waiting_human', questions: [{ questionId: 'q', header: 'GATE_C', revision: '', runId: 'run-1', status: 'open' }] })
  seedCard(f, '3'); seedCard(f, '4', { lastProgressAt: new Date(f.clock.now()).toISOString() })
  const cards = ['1', '2', '3', '4'].map(id => ({ id, name: 'harness', list: id === '3' ? 'QA Fail' : 'Todo' }))
  const source = { poll: async () => cards.filter(x => x.id !== '1').concat([{ id: '1', name: 'harness', list: 'Todo' }]), fetchDossier: async () => '# d' }
  // card 1 in poll but chat-parked and never saw out -> stays parked
  await runtime.runHarnessCycle({ root: f.root, config: f.config, source, channel: c.channel, runner, now: f.clock.now })
  assert.deepEqual(sent, ['4'], 'started task beats QA Fail card; parked/waiting hold no slot')
  assert.ok(readTask(f.root, '1').parked)
})

function cliCtx(root, cwd, fetch, env = {}) {
  const buf = { out: '', err: '' }
  return { buf, ctx: { cwd, env, fetch, stdout: { write: s => { buf.out += s } }, stderr: { write: s => { buf.err += s } } } }
}
test('CLI park: happy path infers card from worktree cwd, sends comment; no worker -> clear error', async t => {
  const c = fx(t); const { f } = c
  seedTask(f, '123', { slug: 'x' })
  fs.writeFileSync(path.join(f.root, 'ff.config.yaml'), fs.readFileSync(path.join(f.root, 'ff.config.yaml')))
  const wt = path.join(f.root, f.config.workspace.worktrees_dir, '123-x'); fs.mkdirSync(wt, { recursive: true })
  const cf = path.join(wt, 'c.md'); fs.writeFileSync(cf, '  lý do dừng \n')
  // no worker
  let a = cliCtx(f.root, wt)
  assert.equal(await workerCli.run(['park', '--comment-file', cf], a.ctx), 1)
  assert.match(a.buf.err, /worker/); assert.equal(readTask(f.root, '123').parked, undefined)
  fs.mkdirSync(path.join(f.root, '.ff'), { recursive: true })
  fs.writeFileSync(path.join(f.root, '.ff/worker.json'), JSON.stringify({ port: 4567, token: 'tok', state: 'ready' }))
  const reqs = []
  const fetch = async (url, init) => { reqs.push([url, JSON.parse(init.body), init.headers.authorization]); return { ok: true, json: async () => ({ parked: true, errors: [] }) } }
  a = cliCtx(f.root, wt, fetch)
  assert.equal(await workerCli.run(['park', '--comment-file', cf], a.ctx), 0)
  assert.deepEqual(reqs[0], ['http://127.0.0.1:4567/park', { cardId: '123', comment: 'lý do dừng' }, 'Bearer tok'])
  // explicit other id from a worker session is refused
  a = cliCtx(f.root, wt, fetch, { FF_CARD_ID: '123' })
  assert.equal(await workerCli.run(['park', '999'], a.ctx), 1); assert.equal(reqs.length, 1)
  // worker-reported errors -> non-zero
  const bad = async () => ({ ok: true, json: async () => ({ parked: true, errors: ['không chuyển được'] }) })
  a = cliCtx(f.root, wt, bad)
  assert.equal(await workerCli.run(['park', '123'], a.ctx), 1); assert.match(a.buf.err, /không chuyển được/)
})

import { EventEmitter } from 'node:events'
import { makeWorkspace } from './helpers/fixture.mjs'
import { TrelloTaskSource } from '../ff-worker/src/adapters/task-source/trello.mjs'

function trello(t, lists) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? '/tmp'), 'park-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const envFile = path.join(dir, '.ff.env'); fs.writeFileSync(envFile, 'TRELLO_API_KEY=k\nTRELLO_API_TOKEN=s\n')
  const calls = []
  const fetchImpl = async (url, init = {}) => { calls.push([init.method ?? 'GET', String(url)]); return Response.json(String(url).includes('/boards/') ? lists.map((name, i) => ({ id: `l${i}`, name })) : {}) }
  return { calls, source: new TrelloTaskSource({ config: { board_id: 'b', poll_lists: ['Todo'] }, envFile, fetchImpl }) }
}

test('moveCard with unknown list throws and never writes or creates a list', async t => {
  const { calls, source } = trello(t, ['Todo', 'Done'])
  await assert.rejects(() => source.moveCard('c1', 'Parked'), /Parked/)
  assert.ok(calls.every(([m]) => m === 'GET'), JSON.stringify(calls))
  assert.deepEqual(await source.listNames(), ['Todo', 'Done'])
  await source.moveCard('c1', ' todo ')
  assert.ok(!calls.some(([m, u]) => m === 'POST' && /\/lists/.test(u)))
})

test('worker refuses to start when a configured list is missing (incl. park_list), notifies once', async t => {
  const w = makeWorkspace(); t.after(w.cleanup)
  const cfgPath = path.join(w.root, 'ff.config.yaml')
  fs.writeFileSync(path.join(w.root, '.ff.env'), 'TRELLO_API_KEY=k\nTRELLO_API_TOKEN=s\n')
  const notes = [], logs = []
  const source = { name: 'fake', poll: async () => assert.fail('must not poll'), fetchDossier: async () => '', moveTo: async () => {}, listNames: async () => ['Doing', 'Ready'] }
  const cfg = (await import('../scripts/lib/config.mjs')).loadConfig(w.root).config.worker.task_source.trello
  cfg.park_list = 'Parked'
  let closed = false
  const httpStarter = async ({ root }) => { const statusPath = path.join(root, '.ff/worker.json'); fs.mkdirSync(path.dirname(statusPath), { recursive: true }); fs.writeFileSync(statusPath, '{}'); return { address: { port: 1 }, statusPath, close: async () => { closed = true } } }
  // park_list is not in the config file here, so use a config-bound check directly as well
  const { checkBoardLists } = await import('../ff-worker/src/core/runtime.mjs')
  const r = await checkBoardLists({ config: { worker: { task_source: { trello: { poll_lists: ['Doing'], done_list: 'Ready', park_list: 'Parked' } } } }, source })
  assert.deepEqual(r.missing, ['Parked']); assert.equal(r.ok, false)
  const ok = await checkBoardLists({ config: { worker: { task_source: { trello: { poll_lists: ['doing '], done_list: 'Ready' } } } }, source })
  assert.equal(ok.ok, true)
  // end to end: poll list absent on board
  const bad = { ...source, listNames: async () => ['Other'] }
  await assert.rejects(() => runWorker({ configPath: cfgPath, source: bad, channel: { name: 'c', notify: async n => notes.push(n) }, processLike: new EventEmitter(), watch: false, httpStarter, log: l => logs.push(l) }), /thiếu list Trello.*Other/)
  assert.equal(notes.length, 1); assert.ok(closed)
})
