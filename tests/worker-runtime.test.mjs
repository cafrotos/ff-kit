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
  assert.match(errors[0], /offline/)
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

test('worker completes only after current Gate C record matches the report hash', async (t) => {
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
  assert.deepEqual(moved, [['remote-card-123', 'Ready For QA']])
  assert.deepEqual(kills, ['ff-123'])
  assert.equal(events[0].kind, 'done')
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

