import './helpers/hermetic-home.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { makeWorkspace } from './helpers/fixture.mjs'
import { processTasks } from '../ff-worker/src/core/worker.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { checkCompletedTasks, runWorker } from '../ff-worker/src/core/runtime.mjs'
import { recordGates } from '../scripts/lib/gates.mjs'
import { writeTask, readTask } from '../ff-worker/src/core/task-store.mjs'

test('worker persists tasks and dossier independently of channel', async (t) => {
  const w = makeWorkspace()
  t.after(w.cleanup)
  const cards = [{ id: '123', name: 'Add search', url: 'https://example.test/123', list: 'Doing' }]
  const moved = []
  const notified = []
  const source = {
    name: 'fake', poll: async () => cards,
    fetchDossier: async () => '# Dossier\n', moveTo: async (...args) => moved.push(args),
  }
  const channel = { name: 'test', notify: async (event) => notified.push(event) }
  await processTasks({ root: w.root, config: loadConfig(w.root).config, source, channel })
  await processTasks({ root: w.root, config: loadConfig(w.root).config, source, channel })
  const dossier = path.join(w.root, 'trellocards', '123-add-search', '01-dossier.md')
  assert.equal(fs.readFileSync(dossier, 'utf8'), '# Dossier\n')
  assert.equal(JSON.parse(fs.readFileSync(path.join(w.root, '.ff/tasks/123.json'), 'utf8')).cardId, '123')
  assert.equal(notified[0].taskId, '123')
  assert.equal(notified.length, 1)
  assert.deepEqual(moved, [])
})

test('channel errors are logged and do not reject task ingestion', async (t) => {
  const w = makeWorkspace()
  t.after(w.cleanup)
  const errors = []
  const source = { name: 'fake', poll: async () => [{ id: '9', name: 'No channel failure' }], fetchDossier: async () => '# Card\n', moveTo: async () => {} }
  await processTasks({ root: w.root, config: loadConfig(w.root).config, source, channel: { notify: async () => { throw new Error('offline') } }, log: (s) => errors.push(s) })
  assert.ok(errors.some((e) => /offline/.test(e)))
  assert.ok(fs.existsSync(path.join(w.root, '.ff/tasks/9.json')))
})

test('worker respects max concurrency and records the remote Trello card id', async (t) => {
  const w = makeWorkspace()
  t.after(w.cleanup)
  const source = { name: 'fake', poll: async () => [1, 2, 3].map((n) => ({ id: String(n), trelloCardId: `remote-${n}`, name: `Task ${n}` })), fetchDossier: async () => '# Card\n', moveTo: async () => {} }
  const launched = []
  const channel = { notify: async () => {} }
  const config = loadConfig(w.root).config
  const tasks = await processTasks({ root: w.root, config, source, channel, launchTask: async (_card, task) => { launched.push(task.cardId); return { session: `ff-${task.cardId}` } } })
  assert.deepEqual(launched, ['1', '2'])
  assert.equal(tasks.length, 2)
  assert.equal(JSON.parse(fs.readFileSync(path.join(w.root, '.ff/tasks/1.json'), 'utf8')).trelloCardId, 'remote-1')
})

test('worker validates config, polls once, and shuts down cleanly', async (t) => {
  const w = makeWorkspace({ files: { '.ff.env': 'TRELLO_API_KEY=test-key\nTRELLO_API_TOKEN=test-token\n' } })
  t.after(w.cleanup)
  const source = { name: 'fake', poll: async () => [], fetchDossier: async () => '', moveTo: async () => {} }
  const events = []
  const channel = { name: 'fake', notify: async (event) => events.push(event) }
  const processLike = new EventEmitter()
  processLike.pid = 123
  let closed = false
  let markReady
  const ready = new Promise((resolve) => { markReady = resolve })
  const httpStarter = async ({ root }) => {
    const statusPath = path.join(root, '.ff/worker.json')
    fs.mkdirSync(path.dirname(statusPath), { recursive: true })
    fs.writeFileSync(statusPath, JSON.stringify({ state: 'ready', token: 'x', port: 1234 }), { mode: 0o600 })
    markReady()
    return { address: { port: 1234 }, statusPath, close: async () => { closed = true } }
  }
  const stopped = runWorker({ configPath: path.join(w.root, 'ff.config.yaml'), source, channel, processLike, watch: false, httpStarter, log: () => {} })
  await ready
  processLike.emit('SIGTERM')
  assert.equal(await stopped, 0)
  assert.equal(closed, true)
  assert.equal(JSON.parse(fs.readFileSync(path.join(w.root, '.ff/worker.json'), 'utf8')).state, 'stopped')
  assert.deepEqual(events, [])
})

test('current Gate C accepts the task without shipping or destroying its human session', async (t) => {
  const w = makeWorkspace({ files: {
    'trellocards/123-search/01-dossier.md': '# Search\n',
    'trellocards/123-search/05-verify-report.md': '# Verify\n',
    'trellocards/123-search/01b-ledger.md': '# Ledger\n',
  } })
  t.after(w.cleanup)
  const config = loadConfig(w.root).config
  const question = '[#123] Duyệt Gate C?'
  recordGates(w.root, config, { questions: [{ header: 'GATE_C', question }] }, { answers: { [question]: 'Duyệt' } })
  writeTask(w.root, { cardId: '123', trelloCardId: 'remote-card-123', slug: 'search', phase: 'running', session: 'ff-123' })
  const moved = []
  const events = []
  const kills = []
  const source = { moveTo: async (...args) => moved.push(args) }
  const completed = await checkCompletedTasks({ root: w.root, config, source, channel: { notify: async (event) => events.push(event) }, tmux: { killSession: (name) => kills.push(name) } })
  assert.equal(completed.length, 1)
  assert.equal(readTask(w.root, '123').phase, 'completed')
  assert.equal(readTask(w.root, '123').acceptance, 'accepted')
  assert.equal(readTask(w.root, '123').acceptedRevision, '')
  assert.equal(readTask(w.root, '123').shipState, 'not_shipped')
  assert.equal(readTask(w.root, '123').session, 'ff-123')
  assert.deepEqual(moved, [['remote-card-123', 'Ready For QA']])
  assert.deepEqual(kills, [])
  assert.equal(events[0].kind, 'done')
  assert.deepEqual(events[0].fields, { acceptance: 'accepted', revision: '', shipState: 'not_shipped' })
  assert.match(events[0].body, /chưa ship/i)
  assert.match(events[0].body, /xác nhận/i)
  assert.doesNotMatch(events[0].body, /đã hoàn tất|đã ship/i)
  assert.deepEqual(await checkCompletedTasks({ root: w.root, config, source, channel: { notify: async () => assert.fail('acceptance must not be notified twice') }, tmux: { killSession: () => assert.fail('retain accepted session') } }), [])
})

test('Gate C notification failure is logged while accepted work remains available to humans', async (t) => {
  const w = makeWorkspace({ files: { 'trellocards/123-search/01-dossier.md': '# Search\n', 'trellocards/123-search/05-verify-report.md': '# Verify\n' } })
  t.after(w.cleanup)
  const config = loadConfig(w.root).config
  const question = '[#123] Duyệt Gate C?'
  recordGates(w.root, config, { questions: [{ header: 'GATE_C', question }] }, { answers: { [question]: 'Duyệt' } })
  writeTask(w.root, { cardId: '123', slug: 'search', phase: 'running', session: 'ff-123' })
  const logs = []
  const accepted = await checkCompletedTasks({ root: w.root, config, source: { moveTo: async () => {} }, channel: { notify: async () => { throw new Error('private token=secret') } }, tmux: { killSession: () => assert.fail('session needed for ship approval') }, log: (line) => logs.push(line) })
  assert.equal(accepted.length, 1)
  assert.equal(readTask(w.root, '123').shipState, 'not_shipped')
  assert.match(logs.join(''), /thông báo.*thất bại/i)
  assert.doesNotMatch(logs.join(''), /private|secret/)
})

test('changed report never advances Gate C acceptance or its done-list milestone', async (t) => {
  const w = makeWorkspace({ files: { 'trellocards/123-search/01-dossier.md': '# Search\n', 'trellocards/123-search/05-verify-report.md': '# Verify\n' } })
  t.after(w.cleanup)
  const config = loadConfig(w.root).config
  const question = '[#123] Duyệt Gate C?'
  recordGates(w.root, config, { questions: [{ header: 'GATE_C', question }] }, { answers: { [question]: 'Duyệt' } })
  fs.appendFileSync(path.join(w.root, 'trellocards/123-search/05-verify-report.md'), 'Changed evidence\n')
  writeTask(w.root, { cardId: '123', slug: 'search', phase: 'running', session: 'ff-123' })
  const accepted = await checkCompletedTasks({ root: w.root, config, source: { moveTo: async () => assert.fail('stale Gate C') }, channel: { notify: async () => assert.fail('stale Gate C') }, tmux: { killSession: () => assert.fail('stale Gate C') } })
  assert.deepEqual(accepted, [])
  assert.equal(readTask(w.root, '123').phase, 'running')
})

test('worker completes Gate C before attempting to recover its agent session', async (t) => {
  const w = makeWorkspace({ files: {
    '.ff.env': 'TRELLO_API_KEY=test-key\nTRELLO_API_TOKEN=test-token\n',
    'trellocards/123-search/01-dossier.md': '# Search\n',
    'trellocards/123-search/05-verify-report.md': '# Verify\n',
  } })
  t.after(w.cleanup)
  const config = loadConfig(w.root).config
  const question = '[#123] Duyệt Gate C?'
  recordGates(w.root, config, { questions: [{ header: 'GATE_C', question }] }, { answers: { [question]: 'Duyệt' } })
  writeTask(w.root, { cardId: '123', trelloCardId: 'remote-123', slug: 'search', phase: 'running', session: 'ff-123' })
  const moved = []
  const source = { poll: async () => [], moveTo: async (...args) => moved.push(args), fetchDossier: async () => '', comment: async () => {} }
  const processLike = new EventEmitter()
  processLike.pid = 77
  let readyResolve
  const ready = new Promise((resolve) => { readyResolve = resolve })
  const httpStarter = async ({ root }) => {
    const statusPath = path.join(root, '.ff/worker.json')
    fs.mkdirSync(path.dirname(statusPath), { recursive: true })
    fs.writeFileSync(statusPath, JSON.stringify({ state: 'ready', token: 'x', port: 1234 }), { mode: 0o600 })
    readyResolve()
    return { address: { port: 1234 }, statusPath, close: async () => {} }
  }
  const tmux = { killSession: () => true, start: async () => assert.fail('completed task must not be resumed') }
  const stopped = runWorker({ configPath: path.join(w.root, 'ff.config.yaml'), source, channel: { notify: async () => {} }, processLike, watch: false, httpStarter, tmux, log: () => {} })
  await ready
  processLike.emit('SIGTERM')
  assert.equal(await stopped, 0)
  assert.deepEqual(moved, [['remote-123', 'Ready For QA']])
})

test('ship request preserves presentation fields and requests a decision without marking shipped', async (t) => {
  const w = makeWorkspace({ files: { '.ff.env': 'TRELLO_API_KEY=test-key\nTRELLO_API_TOKEN=test-token\n' } })
  t.after(w.cleanup)
  const processLike = new EventEmitter()
  const events = []
  let handlers
  let readyResolve
  const ready = new Promise((resolve) => { readyResolve = resolve })
  const stopped = runWorker({ configPath: path.join(w.root, 'ff.config.yaml'), source: { name: 'fake', poll: async () => [], moveTo: async () => {}, fetchDossier: async () => '' }, channel: { name: 'fake', notify: async (event) => events.push(event) }, processLike, watch: false, log: () => {}, httpStarter: async (options) => {
    handlers = options.handlers
    readyResolve()
    return { address: { port: 1234 }, statusPath: path.join(w.root, '.ff/worker.json'), close: async () => {} }
  } })
  await ready
  const body = { taskId: '123', title: 'Xác nhận ship?', body: 'Gate C accepted; chưa ship', fields: { revision: 'rev-2', destination: 'origin/card' }, presentation: { phase: 'ship', sections: { acceptedScope: 'Search' } } }
  assert.deepEqual(await handlers.shipRequest(body), { accepted: true })
  assert.deepEqual(events, [{ ...body, kind: 'ask' }])
  assert.equal(readTask(w.root, '123'), null)
  processLike.emit('SIGTERM')
  assert.equal(await stopped, 0)
})

test('failed poll-error notification is logged without leaking channel error details', async (t) => {
  const w = makeWorkspace({ files: { '.ff.env': 'TRELLO_API_KEY=test-key\nTRELLO_API_TOKEN=test-token\n' } })
  t.after(w.cleanup)
  const processLike = new EventEmitter()
  const logs = []
  let readyResolve
  const ready = new Promise((resolve) => { readyResolve = resolve })
  const stopped = runWorker({ configPath: path.join(w.root, 'ff.config.yaml'), source: { name: 'fake', poll: async () => { throw new Error('poll offline') }, moveTo: async () => {}, fetchDossier: async () => '' }, channel: { name: 'fake', notify: async () => { throw new Error('private channel token secret') } }, processLike, watch: false, log: (line) => { logs.push(line); if (line.includes('ready pid=')) readyResolve() }, httpStarter: async () => ({ address: { port: 1234 }, statusPath: path.join(w.root, '.ff/worker.json'), close: async () => {} }) })
  await ready
  processLike.emit('SIGTERM')
  assert.equal(await stopped, 0)
  assert.match(logs.join(''), /thông báo.*thất bại/i)
  assert.doesNotMatch(logs.join(''), /private|secret/)
})

test('ship notification failure is logged and never grants a ship decision', async (t) => {
  const w = makeWorkspace({ files: { '.ff.env': 'TRELLO_API_KEY=test-key\nTRELLO_API_TOKEN=test-token\n' } })
  t.after(w.cleanup)
  const processLike = new EventEmitter()
  const logs = []
  let handlers
  let readyResolve
  const ready = new Promise((resolve) => { readyResolve = resolve })
  const stopped = runWorker({ configPath: path.join(w.root, 'ff.config.yaml'), source: { name: 'fake', poll: async () => [], moveTo: async () => {}, fetchDossier: async () => '' }, channel: { name: 'fake', notify: async () => { throw Object.assign(new Error('private channel token secret'), { status: 400 }) } }, processLike, watch: false, log: (line) => logs.push(line), httpStarter: async (options) => {
    handlers = options.handlers
    readyResolve()
    return { address: { port: 1234 }, statusPath: path.join(w.root, '.ff/worker.json'), close: async () => {} }
  } })
  await ready
  await assert.rejects(handlers.shipRequest({ taskId: '123', title: 'Ship?' }), { message: 'ship notification failed' })
  assert.match(logs.join(''), /thông báo.*ship.*thất bại/i)
  assert.doesNotMatch(logs.join(''), /private|secret/)
  assert.equal(readTask(w.root, '123'), null)
  processLike.emit('SIGTERM')
  assert.equal(await stopped, 0)
})

