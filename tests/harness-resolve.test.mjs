import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeHarnessFixture } from './helpers/harness.mjs'
import { listHarnessEvents } from '../scripts/lib/harness-events.mjs'
import { readTask } from '../ff-worker/src/core/task-store.mjs'
import { nextStage, driveTask, resumeFromEvidence } from '../ff-worker/src/core/driver.mjs'
import { classifyBlock } from '../scripts/lib/human-resolution.mjs'

const heads = { app: 'a'.repeat(40) }
const OLD = '2026-10-15T00:00:00.000Z', NEW = '2026-10-15T01:00:00.000Z'
const receipt = (stage, outcome = 'pass', overrides = {}, entry = {}) => ({ valid: true, hash: 'new-hash', receipt: { cardId: '123', revision: '', runId: 'run-1', dispatchId: 'd1', stage, outcome, heads, at: NEW, ...overrides }, ...entry })
const state = (overrides = {}) => ({ activeRevision: null, readyForBuild: true, heads, gates: { GATE_C: { status: 'pending' } }, receipts: {}, ...overrides })
const blockedTask = (f, overrides = {}) => f.task({ stage: 'build', dispatchId: 'd1', executionStatus: 'blocked', waitingOn: 'needs_human', blockReason: 'build_needs_human',
  completedReceipt: { stage: 'build', outcome: 'needs_human', receiptHash: 'old-hash', at: OLD }, ...overrides })

test('evidence resume: newer valid passing receipt clears a receipt-origin block and advances', t => {
  const f = makeHarnessFixture(t)
  const task = blockedTask(f), s = state({ receipts: { build: receipt('build') } })
  assert.equal(nextStage({ state: s, task }).action, 'stay')
  const resumed = resumeFromEvidence(task, s, NEW)
  assert.equal(resumed.executionStatus, 'idle'); assert.equal(resumed.waitingOn, null); assert.equal(resumed.blockReason, null)
  assert.deepEqual(resumed.history.at(-1), { at: NEW, from: 'build', to: 'build', reason: 'evidence_resume', receiptHash: 'new-hash' })
  assert.deepEqual(nextStage({ state: s, task: resumed }), { stage: 'verify', waitingOn: null, reason: 'build_receipt', action: 'dispatch' })
  for (const [reason, stage] of [['verify_decision', 'verify'], ['understand_implementation_failed', 'understand']]) {
    const other = blockedTask(f, { stage, blockReason: reason, completedReceipt: { stage, outcome: reason === 'verify_decision' ? 'needs_human' : 'implementation_failed', receiptHash: 'old-hash', at: OLD } })
    assert.equal(resumeFromEvidence(other, state({ receipts: { [stage]: receipt(stage) } }), NEW).executionStatus, 'idle', reason)
  }
})

test('evidence resume: stale, foreign, older or unsuccessful receipts never resume', t => {
  const f = makeHarnessFixture(t)
  const task = blockedTask(f)
  const cases = {
    invalid: receipt('build', 'pass', {}, { valid: false }),
    'other revision': receipt('build', 'pass', { revision: 'rev-1' }),
    'stale heads': receipt('build', 'pass', { heads: { app: 'b'.repeat(40) } }),
    'other run': receipt('build', 'pass', { runId: 'run-2' }),
    'other dispatch': receipt('build', 'pass', { dispatchId: 'd0' }),
    'same receipt': receipt('build', 'pass', {}, { hash: 'old-hash' }),
    older: receipt('build', 'pass', { at: '2026-10-14T00:00:00.000Z' }),
    'still failing': receipt('build', 'needs_human'),
    other: receipt('verify'),
  }
  for (const [label, entry] of Object.entries(cases)) {
    const s = state({ receipts: { build: entry } })
    assert.strictEqual(resumeFromEvidence(task, s, NEW), task, label)
  }
  assert.strictEqual(resumeFromEvidence(task, state({ receipts: {} }), NEW), task)
})

test('evidence resume never applies to repair_limit, retry, lifetime, pin, session or dispatch blocks', t => {
  const f = makeHarnessFixture(t)
  const s = state({ receipts: { build: receipt('build') } })
  const ineligible = [
    { blockReason: 'repair_limit' }, { blockReason: 'stage_retry_limit' }, { blockReason: 'build_needs_human', failureReason: 'working_lifetime' },
    { blockReason: 'pr_closed_use_fix' }, { waitingOn: 'setup:session_mismatch' }, { waitingOn: 'setup:workflow_pin_invalid' },
    { waitingOn: 'setup:dispatch_unknown', blockReason: 'dispatch_unknown' }, { executionStatus: 'idle' },
  ]
  for (const patch of ineligible) {
    const task = blockedTask(f, patch)
    assert.strictEqual(resumeFromEvidence(task, s, NEW), task, JSON.stringify(patch))
  }
})

const cliContext = (f, out = { out: '', err: '' }) => ({ out, ctx: { cwd: f.root, runTmux: () => ({ status: 0 }), stdout: { write: v => { out.out += v } }, stderr: { write: v => { out.err += v } } } })
const resolveFile = f => path.join(f.root, '.ff/harness/resolutions/123.jsonl')
const seed = (f, overrides = {}) => { const task = blockedTask(f, { stage: 'understand', blockReason: 'understand_needs_human', completedReceipt: { stage: 'understand', outcome: 'needs_human', receiptHash: 'h1', at: OLD }, claudeSessionId: '1f8a9f32-36c8-4479-8aee-4d745c188452', tmuxSession: 'ff-123', repairCycles: { '': 1 }, ...overrides }); f.seedTask(task); return task }
const fakeRunner = sent => ({
  async inspect(saved) { return { status: 'idle', inputEmpty: true, dispatchStatus: saved.pendingDispatch ? 'prepared' : 'none' } },
  async sendStage(saved, args) { sent.push(args); return { status: 'working', dispatchStatus: 'sent' } },
})

test('ff worker resolve records intent and event without touching the task; driver re-dispatches same stage', async t => {
  const f = makeHarnessFixture(t), { run } = await import('../scripts/cli/worker.mjs')
  const task = seed(f)
  const before = fs.readFileSync(path.join(f.root, '.ff/tasks/123.json'), 'utf8')
  const { ctx, out } = cliContext(f)
  assert.equal(await run(['resolve', '123', '--reason', 'đã sửa env password=hunter2'], ctx), 0, out.err)
  assert.equal(fs.readFileSync(path.join(f.root, '.ff/tasks/123.json'), 'utf8'), before)
  const records = fs.readFileSync(resolveFile(f), 'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(records.length, 1)
  assert.match(records[0].reason, /đã sửa env/); assert.doesNotMatch(records[0].reason, /hunter2/)
  assert.deepEqual({ cardId: records[0].cardId, revision: records[0].revision, runId: records[0].runId, stage: records[0].stage, blockReason: records[0].blockReason, stateVersion: records[0].stateVersion }, { cardId: '123', revision: '', runId: 'run-1', stage: 'understand', blockReason: 'understand_needs_human', stateVersion: 1 })
  assert.ok(records[0].at)
  const event = listHarnessEvents(f.root, '123').find(e => e.type === 'human_resolved')
  assert.ok(event); assert.equal(event.dispatchId, 'd1')
  const sent = []
  const after = await driveTask({ root: f.root, config: f.config, task, observation: { state: state({ readyForBuild: false }) }, runner: fakeRunner(sent), now: f.clock.now })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].stage, 'understand'); assert.notEqual(sent[0].dispatchId, 'd1')
  assert.equal(after.executionStatus, 'working'); assert.equal(after.blockReason ?? null, null)
  assert.ok(after.consumedFailures.includes('h1'))
  assert.deepEqual(after.repairCycles, { '': 1 })
  assert.equal(after.history.at(-1).reason === 'human_resolved' || after.history.some(h => h.reason === 'human_resolved'), true)
  // The handled event never re-applies to a later identical block.
  const again = await driveTask({ root: f.root, config: f.config, task: readTask(f.root, '123'), observation: { state: state({ readyForBuild: false }) }, runner: fakeRunner([]), now: f.clock.now })
  assert.equal(again.consumedFailures.filter(h => h === 'h1').length, 1)
})

test('ff worker resolve: stage_retry_limit resets only that stage counter; lifetime resets session budget; setup clears wait', async t => {
  const f = makeHarnessFixture(t), { run } = await import('../scripts/cli/worker.mjs')
  const key = JSON.stringify(['', 'understand'])
  const cases = [
    [{ blockReason: 'stage_retry_limit', completedReceipt: undefined, stageRetries: { [key]: 3, other: 2 }, pendingDispatch: { runId: 'run-1', revision: '', dispatchId: 'd1', stage: 'understand' } }, task => { assert.equal(task.stageRetries[key], 0); assert.equal(task.stageRetries.other, 2) }],
    [{ blockReason: 'understand_needs_human', failureReason: 'working_lifetime', workingMs: 99, completedReceipt: undefined }, task => { assert.equal(task.failureReason ?? null, null); assert.equal(task.workingMs, 0) }],
    [{ waitingOn: 'setup:runner_unproven', blockReason: 'runner_unproven', completedReceipt: undefined }, task => { assert.equal(task.waitingOn, null) }],
  ]
  for (const [patch, check] of cases) {
    const task = seed(f, patch)
    const { ctx, out } = cliContext(f)
    assert.equal(await run(['resolve', '123', '--reason', 'ok'], ctx), 0, out.err)
    const after = await driveTask({ root: f.root, config: f.config, task, observation: { state: state({ readyForBuild: false }), allowEffects: false }, now: f.clock.now })
    assert.equal(after.executionStatus, 'idle'); assert.equal(after.repairCycles[''], 1)
    check(after)
    fs.rmSync(path.join(f.root, '.ff/harness'), { recursive: true, force: true })
  }
})

test('ff worker resolve refuses missing reason, integrity blocks, repair_limit, closed PR and unblocked tasks', async t => {
  const f = makeHarnessFixture(t), { run } = await import('../scripts/cli/worker.mjs')
  const refuse = async (patch, args = ['resolve', '123', '--reason', 'x']) => {
    seed(f, patch)
    const { ctx, out } = cliContext(f)
    const code = await run(args, ctx)
    assert.notEqual(code, 0, JSON.stringify(patch))
    assert.ok(out.err.length > 0)
    assert.equal(fs.existsSync(resolveFile(f)), false); assert.equal(listHarnessEvents(f.root, '123').length, 0)
    return out.err
  }
  assert.match(await refuse({}, ['resolve', '123']), /--reason/)
  assert.match(await refuse({}, ['resolve', '123', '--reason', '   ']), /--reason/)
  for (const wait of ['setup:session_mismatch', 'setup:workflow_pin_invalid', 'setup:dispatch_unknown', 'setup:launch_unknown', 'setup:resume_unknown']) assert.match(await refuse({ waitingOn: wait }), /danh tính|chứng minh|không thể/i, wait)
  assert.match(await refuse({ blockReason: 'repair_limit' }), /Fix|mở lại/i)
  assert.match(await refuse({ blockReason: 'pr_closed_use_fix' }), /Fix/i)
  await refuse({ executionStatus: 'idle', waitingOn: null })
  await refuse({ blockReason: 'mystery' })
  assert.equal(classifyBlock(f.task()).ok, false)
})

test('a resolve written for an older block is ignored', async t => {
  const f = makeHarnessFixture(t), { run } = await import('../scripts/cli/worker.mjs')
  const task = seed(f)
  assert.equal(await run(['resolve', '123', '--reason', 'x'], cliContext(f).ctx), 0)
  // The block changes (new failed receipt) before the driver reads the event.
  const newer = { ...task, stateVersion: 2, completedReceipt: { ...task.completedReceipt, receiptHash: 'h2' } }
  f.seedTask(newer)
  const sent = []
  const after = await driveTask({ root: f.root, config: f.config, task: newer, observation: { state: state({ readyForBuild: false }) }, runner: fakeRunner(sent), now: f.clock.now })
  assert.equal(sent.length, 0); assert.equal(after.executionStatus, 'blocked'); assert.equal(after.waitingOn, 'needs_human')
  assert.deepEqual(after.consumedFailures ?? [], [])
})

test('worker status shows block reason and the resolve hint only when eligible', async t => {
  const f = makeHarnessFixture(t), { run } = await import('../scripts/cli/worker.mjs')
  seed(f)
  let c = cliContext(f)
  await run(['status'], c.ctx)
  assert.match(c.out.out, /understand_needs_human/); assert.match(c.out.out, /ff worker resolve 123 --reason/)
  seed(f, { blockReason: 'repair_limit' })
  c = cliContext(f); await run(['status'], c.ctx)
  assert.match(c.out.out, /repair_limit/); assert.doesNotMatch(c.out.out, /ff worker resolve/)
})
