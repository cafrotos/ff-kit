import test from 'node:test'
import fs from 'node:fs'
import YAML from 'yaml'
import { recordGates } from '../scripts/lib/gates.mjs'
import { recordQuestion, recordAnswers } from '../scripts/lib/question-history.mjs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { workflowPackage } from './helpers/workflow.mjs'
import { prepareWorkflowSnapshot } from '../scripts/lib/workflow-snapshot.mjs'
import { listHarnessEvents } from '../scripts/lib/harness-events.mjs'
import { beginStage, finishStage } from '../scripts/lib/stage-receipts.mjs'
import assert from 'node:assert/strict'
import { makeHarnessFixture } from './helpers/harness.mjs'
import { readTask } from '../ff-worker/src/core/task-store.mjs'
import { reduceEvent, nextStage, driveTask, applyPlainTextStop } from '../ff-worker/src/core/driver.mjs'

const heads = { app: 'a'.repeat(40) }
const receipt = (stage, outcome = 'pass', overrides = {}) => ({ valid: true, hash: 'saved-hash', receipt: { cardId: '123', revision: '', runId: 'run-1', dispatchId: 'd1', stage, outcome, heads, ...overrides } })
const state = (overrides = {}) => ({ activeRevision: null, readyForBuild: true, heads, gates: { GATE_C: { status: 'pending' } }, receipts: {}, ...overrides })

test('spec 5.1 decision table and evidence scope', t => {
  const f = makeHarnessFixture(t)
  const shipped = { cardId: '123', revision: '', heads, s1Complete: true, s2Complete: true, mode: 'dev_only' }
  const rows = [
    ['pause wins', f.task({ waitingOn: 'paused' }), state(), null, {}, 'understand', 'stay', 'paused'],
    ['unhandled error wins', f.task({ executionStatus: 'blocked', waitingOn: 'setup:permission' }), state(), null, {}, 'understand', 'stay', 'setup:permission'],
    ['new revision rejects old build', f.task(), state({ activeRevision: 'rev-1', receipts: { build: receipt('build') } }), null, {}, 'build', 'dispatch', null],
    ['merged matching PR', f.task(), state(), { ...shipped, mode: 'dev_and_pr', repos: [{ repo: 'app', requiresPr: true }] }, { repos: [{ repo: 'app', merged: true, headAtMerge: heads.app, approvedSourceHead: heads.app }] }, 'done', 'done', null],
    ['merged wrong source', f.task(), state(), { ...shipped, mode: 'dev_and_pr', repos: [{ repo: 'app', requiresPr: true }] }, { repos: [{ repo: 'app', merged: true, headAtMerge: 'wrong', approvedSourceHead: heads.app }] }, 'acceptance', 'acceptance', 'acceptance'],
    ['CLI acceptance', f.task(), state(), { ...shipped, acceptance: { source: 'cli', revision: '', heads, confirmed: true } }, {}, 'done', 'done', null],
    ['shipped waits acceptance', f.task(), state(), shipped, {}, 'acceptance', 'acceptance', 'acceptance'],
    ['Gate C dispatches ship', f.task({ gateCApproval: { decisionId: 'yes', revision: '', heads, verifyReceiptHash: 'saved-hash' } }), state({ gates: { GATE_C: { status: 'approved' } }, receipts: { build: receipt('build'), verify: receipt('verify') } }), null, {}, 'ship', 'dispatch', 'ship_confirm'],
    ['auto_passed Gate C dispatches ship', f.task(), state({ gates: { GATE_C: { status: 'auto_passed' } }, receipts: { build: receipt('build'), verify: receipt('verify') } }), null, {}, 'ship', 'dispatch', 'ship_confirm'],
    ['implementation repair', f.task(), state({ receipts: { verify: receipt('verify', 'implementation_failed') } }), null, {}, 'build', 'repair', null],
    ['three exhausted repairs', f.task({ repairCycles: { '': 3 } }), state({ receipts: { verify: receipt('verify', 'implementation_failed') } }), null, {}, 'understand', 'stay', 'needs_human'],
    ['environment is setup', f.task({ stage: 'verify' }), state({ receipts: { verify: receipt('verify', 'environment_blocked') } }), null, {}, 'verify', 'stay', 'setup:e2e'],
    ['build pass verifies', f.task(), state({ receipts: { build: receipt('build') } }), null, {}, 'verify', 'dispatch', null],
    ['changed HEAD invalidates build', f.task(), state({ heads: { app: 'b'.repeat(40) }, receipts: { build: receipt('build') } }), null, {}, 'build', 'dispatch', null],
    ['invalid no change', f.task(), state({ receipts: { build: { ...receipt('build', 'no_change'), valid: false } } }), null, {}, 'build', 'dispatch', null],
    ['diagnostic build not success', f.task(), state({ receipts: { build: receipt('build', 'implementation_failed') } }), null, {}, 'build', 'dispatch', null],
    ['understand fallback', f.task(), state({ readyForBuild: false }), null, {}, 'understand', 'dispatch', null],
  ]
  for (const [label, task, s, ship, pr, stage, action, waitingOn] of rows) {
    assert.deepEqual(nextStage({ state: s, task, ship, pr }), { stage, action, waitingOn, reason: nextStage({ state: s, task, ship, pr }).reason }, label)
  }
})

test('questions use identities, answer-first tombstones, and current scope', t => {
  const f = makeHarnessFixture(t)
  let task = f.task({ dispatchId: 'd1' })
  const e = (id, type, questionId, extra = {}) => f.event({ eventId: id, dispatchId: 'd1', type, payload: { questionId, header: 'Q', ...extra } })
  task = reduceEvent(task, e('a', 'question_answered', 'q0'), {})
  task = reduceEvent(task, e('b', 'question_opened', 'q0'), {})
  assert.equal(task.waitingOn, null)
  task = reduceEvent(task, e('c', 'question_opened', 'q1'), {})
  task = reduceEvent(task, e('d', 'question_opened', 'q2'), {})
  task = reduceEvent(task, e('e', 'question_answered', 'q1'), {})
  assert.equal(task.waitingOn, 'Q')
  task = reduceEvent(task, e('f', 'question_answered', 'q2'), {})
  assert.equal(task.waitingOn, null)
  assert.equal(task.questions.filter(q => q.status === 'answered').length, 3)
  assert.deepEqual(reduceEvent(task, e('old', 'question_opened', 'q3', {}), {}), reduceEvent(task, e('old', 'question_opened', 'q3', {}), {}))
  const fresh = f.task({ runId: 'new-run', dispatchId: 'new-dispatch' })
  assert.deepEqual(reduceEvent(fresh, e('stale', 'stage_finished', 'q3'), {}), fresh)
})

test('stage finish requires exact validated receipt hash and outcome', t => {
  const f = makeHarnessFixture(t)
  const task = f.task({ stage: 'build', dispatchId: 'd1', pendingDispatch: { stage: 'build', revision: '', runId: 'run-1', dispatchId: 'd1' } })
  const event = f.event({ type: 'stage_finished', dispatchId: 'd1', payload: { stage: 'build', outcome: 'pass', receiptHash: 'wrong' } })
  const observed = { heads, receipts: { build: receipt('build') } }
  assert.ok(reduceEvent(task, event, observed).pendingDispatch)
  const done = reduceEvent(task, { ...event, payload: { ...event.payload, receiptHash: 'saved-hash' } }, observed)
  assert.equal(done.pendingDispatch, null)
  assert.equal(done.executionStatus, 'idle')
})

test('blocked session overrides confirmation and runner idle', t => {
  const f = makeHarnessFixture(t)
  let task = f.task({ claudeSessionId: 'uuid' })
  task = reduceEvent(task, f.event({ eventId: 'block', type: 'session_started', payload: { status: 'blocked', reason: 'session_mismatch' } }), {})
  task = reduceEvent(task, f.event({ eventId: 'confirm', type: 'session_started', payload: { status: 'confirmed', claudeSessionId: 'uuid' } }), {})
  task = reduceEvent(task, f.event({ eventId: 'idle', type: 'runner_idle' }), {})
  assert.equal(task.executionStatus, 'blocked')
  assert.equal(task.waitingOn, 'setup:session_mismatch')
})

test('Gate answer cannot make an old Gate artifact current approval', t => {
  const f = makeHarnessFixture(t)
  const task = reduceEvent(f.task(), f.event({ type: 'question_answered', payload: { questionId: 'q', header: 'GATE_C', normalizedValue: 'reject' } }), {})
  assert.notEqual(nextStage({ task, state: state({ gates: { GATE_C: { status: 'approved' } } }) }).stage, 'ship')
})

test('driver persists UUID and launch intent before runner start; restart reconciles', async t => {
  const f = makeHarnessFixture(t)
  const task = f.task(); f.seedTask(task)
  let called = 0
  const runner = {
    async start(saved) {
      called++
      const disk = readTask(f.root, task.cardId)
      assert.match(disk.claudeSessionId, /^[a-f0-9-]{36}$/)
      assert.equal(saved.claudeSessionId, disk.claudeSessionId)
      assert.equal(disk.pendingEffects[0].kind, 'launch')
      return { status: 'blocked', reason: 'launch_unknown' }
    },
    async inspect() { return { status: 'blocked', reason: 'launch_unknown' } },
  }
  const first = await driveTask({ root: f.root, config: f.config, task, observation: { state: state() }, runner, now: f.clock.now })
  await driveTask({ root: f.root, config: f.config, task: first, observation: { state: state() }, runner, now: f.clock.now })
  assert.equal(called, 1)
  assert.equal(first.executionStatus, 'blocked')
  assert.equal(first.waitingOn, 'setup:launch_unknown')
  assert.equal(readTask(f.root, '123').waitingOn, 'setup:launch_unknown')
})

test('dispatch intent is durable before canonical send and ambiguous send is never repeated', async t => {
  const f = makeHarnessFixture(t)
  const task = f.task({ claudeSessionId: '1f8a9f32-36c8-4479-8aee-4d745c188452', tmuxSession: 'ff-123' }); f.seedTask(task)
  let sends = 0
  const runner = {
    async inspect(saved) { return { status: 'idle', inputEmpty: true, dispatchStatus: saved.pendingDispatch ? (sends ? 'unknown' : 'prepared') : 'none' } },
    async sendStage(saved, args) {
      sends++
      assert.equal(readTask(f.root, '123').pendingDispatch.dispatchId, args.dispatchId)
      assert.match(args.prompt, /^\/ff-kit:ff-build 123/)
      throw new Error('ambiguous')
    },
  }
  const first = await driveTask({ root: f.root, config: f.config, task, observation: { state: state() }, runner })
  assert.ok(first.pendingDispatch)
  await driveTask({ root: f.root, config: f.config, task: first, observation: { state: state() }, runner })
  assert.equal(sends, 1)
})


test('three durable repairs survive restart; new revision alone resets count', async t => {
  const f = makeHarnessFixture(t)
  const packageRoot = path.join(f.root, 'plugin')
  workflowPackage(packageRoot)
  const workflow = prepareWorkflowSnapshot({ root: f.root, packageRoot, cliVersion: '0.1.0' })
  let task = f.task({ workflow, claudeSessionId: '1f8a9f32-36c8-4479-8aee-4d745c188452', tmuxSession: 'ff-123', stage: 'verify' })
  let sends = 0
  const runner = {
    async inspect(saved) { return { status: 'idle', inputEmpty: true, dispatchStatus: saved.pendingDispatch ? 'prepared' : 'none' } },
    async sendStage(saved) {
      sends++
      assert.equal(readTask(f.root, '123').repairCycles[''], sends)
      return { status: 'working', dispatchStatus: 'sent' }
    },
  }
  for (let round = 0; round <= 3; round++) {
    const dispatchId = `verify-${round}`
    task = { ...task, stage: 'verify', waitingOn: null, executionStatus: 'idle', dispatchId, pendingDispatch: { revision: '', runId: task.runId, stage: 'verify', dispatchId }, pendingEffects: [] }
    f.seedTask(task)
    const log = `diagnostic-${round}.log`
    f.writeArtifact(log, `failure ${round}`)
    const evidence = { cardId: '123', revision: '', runId: task.runId, dispatchId, workflow: { digest: workflow.digest, cliVersion: workflow.cliVersion }, heads: {}, artifactHashes: { [log]: createHash('sha256').update(`failure ${round}`).digest('hex') }, checks: [], reviewRefs: [], testLockHash: null, acMatrixRef: null }
    const evidenceFile = f.writeArtifact(`evidence-${round}.json`, JSON.stringify(evidence))
    await beginStage(f.root, f.config, { cardId: '123', dispatchId })
    await finishStage(f.root, f.config, { cardId: '123', dispatchId, outcome: 'implementation_failed', evidenceFile })
    const finish = listHarnessEvents(f.root, '123').find(e => e.type === 'stage_finished' && e.dispatchId === dispatchId)
    const eventFile = createHash('sha256').update(finish.eventId).digest('hex') + '.json'
    fs.rmSync(path.join(f.root, '.ff/harness/inbox/123', eventFile))
    task = await driveTask({ root: f.root, config: f.config, task, observation: { state: state({ heads: {} }) }, runner })
    if (round < 3) {
      assert.equal(task.repairCycles[''], round + 1)
      const restartRunner = { ...runner, inspect: async () => ({ status: 'working', dispatchStatus: 'sent', inputEmpty: false }) }
      task = await driveTask({ root: f.root, config: f.config, task: readTask(f.root, '123'), observation: { state: state({ heads: {} }) }, runner: restartRunner })
      assert.equal(task.repairCycles[''], round + 1)
    }
  }
  assert.equal(sends, 3)
  assert.equal(task.waitingOn, 'needs_human')
  assert.equal(task.repairCycles[''], 3)
  task = await driveTask({ root: f.root, config: f.config, task, observation: { state: state({ activeRevision: 'rev-1', heads: {} }), allowEffects: false }, runner })
  assert.equal(task.repairCycles['rev-1'], 0)
  assert.equal(task.repairCycles[''], 3)
})

test('ship intent clears derived confirmation wait so skill can ask its own CLI Gate', async t => {
  const { f, task } = await completedVerify(t)
  const runner = {
    async inspect(saved) { return { status: 'idle', inputEmpty: !saved.waitingOn, dispatchStatus: saved.pendingDispatch ? 'prepared' : 'none' } },
    async sendStage(saved, args) {
      assert.equal(saved.waitingOn, null)
      assert.match(args.prompt, /^\/ff-kit:ship-to-dev/)
      return { status: 'working', dispatchStatus: 'sent' }
    },
  }
  const result = await driveTask({ root: f.root, config: f.config, task, observation: { state: state({ heads: {}, gates: { GATE_C: { status: 'approved' } } }) }, runner })
  assert.equal(result.gateCApproval.decisionId.length, 64)
  assert.equal(result.dispatchState, 'sent')
})

test('known unaccepted sends exhaust retries without changing dispatch identity', async t => {
  const f = makeHarnessFixture(t)
  let task = f.task({ claudeSessionId: '1f8a9f32-36c8-4479-8aee-4d745c188452', tmuxSession: 'ff-123' }); f.seedTask(task)
  let calls = 0
  const runner = {
    async inspect(saved) { return { status: 'idle', inputEmpty: true, dispatchStatus: saved.pendingDispatch ? 'prepared' : 'none' } },
    async sendStage() { calls++; return { status: 'idle', inputEmpty: true, dispatchStatus: 'prepared' } },
  }
  const ids = []
  for (let i = 0; i < 4; i++) {
    task = await driveTask({ root: f.root, config: f.config, task, observation: { state: state() }, runner })
    ids.push(task.dispatchId)
  }
  assert.equal(calls, 3)
  assert.equal(new Set(ids).size, 1)
  assert.equal(task.waitingOn, 'needs_human')
})

test('classified scoped Gate C repair consumes its decision once; unclear rejection waits', t => {
  const f = makeHarnessFixture(t)
  const task = f.task({ gateDecisions: [{ header: 'GATE_C', revision: '', questionId: 'q', decisionId: 'decision-q', normalizedValue: 'cần sửa' }] })
  const s = state({ gates: { GATE_C: { status: 'approved' } }, gateFeedback: { decisionId: 'decision-q', kind: 'implementation_failed', withinApprovedScope: true } })
  assert.equal(nextStage({ task, state: s }).action, 'repair')
  assert.equal(nextStage({ task, state: { ...s, gateFeedback: null } }).waitingOn, 'GATE_C')
  assert.notEqual(nextStage({ task, state: { ...s, gateFeedback: { ...s.gateFeedback, decisionId: 'other' } } }).action, 'repair')
})

test('Gate C pending human question blocks old shipped acceptance', t => {
  const f = makeHarnessFixture(t)
  const task = f.task({ gateDecisions: [{ header: 'GATE_C', revision: '', normalizedValue: 'cần sửa' }] })
  const ship = { cardId: '123', revision: '', heads, s1Complete: true, s2Complete: true, mode: 'dev_only', acceptance: { source: 'cli', revision: '', heads, confirmed: true } }
  assert.notEqual(nextStage({ task, state: state(), ship }).action, 'done')
})

test('late older idle and question answers cannot erase a permission wait', t => {
  const f = makeHarnessFixture(t)
  let task = reduceEvent(f.task(), f.event({ eventId: 'permission', type: 'permission_waiting', at: '2026-10-15T00:00:10Z' }), {})
  task = reduceEvent(task, f.event({ eventId: 'answer', type: 'question_answered', at: '2026-10-15T00:00:11Z', payload: { questionId: 'q', header: 'Q' } }), {})
  assert.equal(task.waitingOn, 'permission')
  task = reduceEvent(task, f.event({ eventId: 'old-idle', type: 'runner_idle', at: '2026-10-15T00:00:09Z' }), {})
  assert.equal(task.waitingOn, 'permission')
  task = reduceEvent(task, f.event({ eventId: 'new-idle', type: 'runner_idle', at: '2026-10-15T00:00:12Z' }), {})
  assert.equal(task.waitingOn, null)
})

test('explicit null inspect revision means root rather than reuse task revision', t => {
  const f = makeHarnessFixture(t)
  const task = f.task({ revision: 'rev-1' })
  const s = state({ activeRevision: null, receipts: { build: receipt('build', 'pass', { revision: 'rev-1' }) } })
  assert.equal(nextStage({ task, state: s }).stage, 'build')
})

test('classified rejection remains a ship barrier after repair intent is consumed', t => {
  const f = makeHarnessFixture(t)
  const task = f.task({ consumedFailures: ['gate:d'], gateDecisions: [{ header: 'GATE_C', revision: '', decisionId: 'd', normalizedValue: 'cần sửa' }] })
  const s = state({ gates: { GATE_C: { status: 'approved' } }, gateFeedback: { decisionId: 'd', kind: 'implementation_failed', withinApprovedScope: true } })
  const ship = { cardId: '123', revision: '', heads, s1Complete: true, mode: 'dev_only', acceptance: { confirmed: true, source: 'cli', revision: '', heads } }
  assert.notEqual(nextStage({ task, state: s, ship }).action, 'done')
  assert.equal(nextStage({ task: f.task({ gateCApproval: { decisionId: 'yes', revision: '', heads, verifyReceiptHash: 'saved-hash' } }), state: state({ gates: { GATE_C: { status: 'approved' } }, receipts: { build: receipt('build'), verify: receipt('verify') } }), ship: { blockedReason: 'setup:ship' } }).action, 'stay')
})


test('durable human rejection without inbox events overrides older valid Gate artifact', async t => {
  const f = makeHarnessFixture(t)
  const task = f.task({ claudeSessionId: '1f8a9f32-36c8-4479-8aee-4d745c188452', tmuxSession: 'ff-123' }); f.seedTask(task)
  const context = { cardId: '123', revision: '', runId: task.runId, dispatchId: '', claudeSessionId: task.claudeSessionId }
  const question = '[#123] Duyệt?'
  const input = { session_id: task.claudeSessionId, tool_use_id: 'gate-c', tool_input: { questions: [{ header: 'GATE_C', question, options: [{ label: 'Duyệt' }, { label: 'Cần sửa' }] }] } }
  await recordQuestion(f.root, context, input)
  await recordAnswers(f.root, context, { ...input, tool_response: { answers: { [question]: 'Cần sửa' } } })
  fs.rmSync(path.join(f.root, '.ff/harness/inbox/123'), { recursive: true })
  const result = await driveTask({ root: f.root, config: f.config, task, observation: { state: state({ gates: { GATE_C: { status: 'approved' } } }), allowEffects: false } })
  assert.equal(result.waitingOn, 'GATE_C')
  assert.notEqual(result.stage, 'ship')
})

test('durable answer without delivered answer event clears only its recovered question wait', async t => {
  const f = makeHarnessFixture(t)
  const task = f.task({ claudeSessionId: '1f8a9f32-36c8-4479-8aee-4d745c188452', tmuxSession: 'ff-123' })
  const context = { cardId: '123', revision: '', runId: task.runId, dispatchId: '', claudeSessionId: task.claudeSessionId }
  const question = '[#123] Which option?'
  const input = { session_id: task.claudeSessionId, tool_use_id: 'q', tool_input: { questions: [{ header: 'Q', question }] } }
  const [q] = await recordQuestion(f.root, context, input)
  await recordAnswers(f.root, context, { ...input, tool_response: { answers: { [question]: 'one' } } })
  fs.rmSync(path.join(f.root, '.ff/harness/inbox/123'), { recursive: true })
  const saved = { ...task, questions: [q], waitingOn: 'Q', executionStatus: 'waiting_human' }; f.seedTask(saved)
  const result = await driveTask({ root: f.root, config: f.config, task: saved, observation: { state: state(), allowEffects: false } })
  assert.equal(result.waitingOn, null)
  assert.equal(result.questions[0].status, 'answered')
})


test('R1 document Gate C alone cannot ship stale or missing source evidence', t => {
  const f = makeHarnessFixture(t)
  const approved = { GATE_C: { status: 'approved' } }
  const current = { build: receipt('build'), verify: receipt('verify') }
  const task = f.task({ gateCApproval: { decisionId: 'approved', revision: '', heads, verifyReceiptHash: 'saved-hash' } })
  assert.equal(nextStage({ task, state: state({ gates: approved, receipts: current }) }).stage, 'ship')
  assert.notEqual(nextStage({ task, state: state({ gates: approved, heads: { app: 'b'.repeat(40) }, receipts: current }) }).stage, 'ship')
  assert.notEqual(nextStage({ task, state: state({ gates: approved, receipts: { ...current, verify: { ...current.verify, valid: false } } }) }).stage, 'ship')
  assert.notEqual(nextStage({ task: f.task(), state: state({ gates: approved, receipts: current }) }).stage, 'ship')
})

test('R3 pre-start crash starts same persisted UUID only with unattempted pane proof', async t => {
  const f = makeHarnessFixture(t)
  const task = f.task({ claudeSessionId: '1f8a9f32-36c8-4479-8aee-4d745c188452', tmuxSession: 'ff-123', pendingEffects: [{ kind: 'launch', status: 'intent', runId: 'run-1' }] }); f.seedTask(task)
  let starts = 0, resumes = 0
  const runner = {
    async inspect() { return { status: 'exited', launchStatus: 'unattempted', dispatchStatus: 'none' } },
    async start(saved) { starts++; assert.equal(saved.claudeSessionId, task.claudeSessionId); return { status: 'blocked', reason: 'session_unconfirmed' } },
    async resume() { resumes++; return { status: 'blocked' } },
  }
  const result = await driveTask({ root: f.root, config: f.config, task, observation: { state: state() }, runner })
  assert.equal(starts, 1)
  assert.equal(resumes, 0)
  assert.equal(result.claudeSessionId, task.claudeSessionId)
  assert.equal(result.waitingOn, 'setup:session_unconfirmed')
})


async function completedVerify(t) {
  const f = makeHarnessFixture(t), sha = text => createHash('sha256').update(text).digest('hex')
  f.config.repos = []
  f.config.e2e = { tests_dir: 'e2e' }
  fs.writeFileSync(path.join(f.root, 'ff.config.yaml'), YAML.stringify(f.config))
  const prefix = 'trellocards/123-harness/'
  const files = { '01-dossier.md': '# Card\n', '01b-ledger.md': '| D-01 | keep | source | |\n', 'brief.md': '# Brief\n', '02-spec.md': '# Spec\n- **AC-01** Keep — D-01\n', '03-design.md': '# Design\n', '04-plan.md': '# Plan\n', '05-verify-report.md': '# Verify\n' }
  for (const [name, text] of Object.entries(files)) f.writeArtifact(prefix + name, text)
  const testFile = 'e2e/123-harness/a.spec.ts'
  f.writeArtifact(testFile, "test('AC-01 keep', async () => { expect(1).toBe(1) })\n")
  const lock = f.writeArtifact('worktrees/123-harness/.ff-test-lock', `${sha(fs.readFileSync(path.join(f.root, testFile)))}  ${testFile}\n`)
  for (const gate of ['GATE_A', 'GATE_B']) recordGates(f.root, f.config, { questions: [{ header: gate, question: '[#123] Duyệt?' }] }, { answers: { '[#123] Duyệt?': 'Duyệt' } })
  const packageRoot = path.join(f.root, 'plugin'); workflowPackage(packageRoot)
  const workflow = prepareWorkflowSnapshot({ root: f.root, packageRoot, cliVersion: '0.1.0' })
  const log = prefix + 'evidence/log.txt', review = prefix + 'evidence/review.json', matrix = prefix + 'evidence/ac.json'
  f.writeArtifact(log, 'checks pass\n')
  f.writeArtifact(review, JSON.stringify({ status: 'pass', revision: '', heads: {}, findings: [] }))
  f.writeArtifact(matrix, JSON.stringify({ revision: '', heads: {}, criteria: [{ id: 'AC-01', status: 'pass', evidence: [log] }] }))
  let task
  for (const stage of ['build', 'verify']) {
    const dispatchId = stage + '-complete'
    task = f.task({ stage, dispatchId, pendingDispatch: { stage, dispatchId, revision: '', runId: 'run-1' }, workflow, claudeSessionId: '1f8a9f32-36c8-4479-8aee-4d745c188452', tmuxSession: 'ff-123' }); f.seedTask(task)
    await beginStage(f.root, f.config, { cardId: '123', dispatchId })
    if (stage === 'verify') {
      const context = { cardId: '123', revision: '', runId: task.runId, dispatchId, claudeSessionId: task.claudeSessionId }
      const input = { session_id: task.claudeSessionId, tool_use_id: 'gate-c', tool_input: { questions: [{ header: 'GATE_C', question: '[#123] Duyệt?' }] } }
      await recordQuestion(f.root, context, input)
      await recordAnswers(f.root, context, { ...input, tool_response: { answers: { '[#123] Duyệt?': 'Duyệt' } } })
      recordGates(f.root, f.config, input.tool_input, { answers: { '[#123] Duyệt?': 'Duyệt' } })
    }
    const evidence = { cardId: '123', revision: '', runId: task.runId, dispatchId, heads: {}, workflow: { digest: workflow.digest, cliVersion: workflow.cliVersion }, artifactHashes: Object.fromEntries([...Object.keys(files).map(n => prefix + n), log, review, matrix].map(file => [file, sha(fs.readFileSync(path.join(f.root, file)))])), testLockHash: sha(fs.readFileSync(lock)), checks: [{ command: 'true', cwd: '.', exitCode: 0, logPath: log, logHash: sha(fs.readFileSync(path.join(f.root, log))) }], reviewRefs: [review], acMatrixRef: matrix }
    await finishStage(f.root, f.config, { cardId: '123', dispatchId, outcome: 'pass', evidenceFile: f.writeArtifact(prefix + 'evidence/input.json', JSON.stringify(evidence)) })
  }
  return { f, task }
}

test('R2 saved successful verify without finish event reconciles without resending verify', async t => {
  const { f, task } = await completedVerify(t)
  const finish = listHarnessEvents(f.root, '123').find(e => e.type === 'stage_finished' && e.dispatchId === task.dispatchId)
  fs.rmSync(path.join(f.root, '.ff/harness/inbox/123', createHash('sha256').update(finish.eventId).digest('hex') + '.json'))
  const result = await driveTask({ root: f.root, config: f.config, task, observation: { state: state({ heads: {}, gates: { GATE_C: { status: 'approved' } } }), allowEffects: false } })
  assert.equal(result.pendingDispatch, null)
  assert.equal(result.completedReceipt.outcome, 'pass')
  assert.equal(result.gateCApproval.verifyReceiptHash, result.completedReceipt.receiptHash)
  const olderCheckpoint = { ...result, gateCApproval: { ...result.gateCApproval, verifyReceiptHash: 'older-checkpoint' } }; f.seedTask(olderCheckpoint)
  const repeated = await driveTask({ root: f.root, config: f.config, task: olderCheckpoint, observation: { state: state({ heads: {}, gates: { GATE_C: { status: 'approved' } } }), allowEffects: false } })
  assert.equal(repeated.gateCApproval.verifyReceiptHash, 'older-checkpoint', 'same CLI decision never refreshes its source checkpoint')
})

test('R3 uncertain launch intent blocks concretely without start or resume', async t => {
  const f = makeHarnessFixture(t)
  const task = f.task({ claudeSessionId: '1f8a9f32-36c8-4479-8aee-4d745c188452', tmuxSession: 'ff-123', pendingEffects: [{ kind: 'launch', status: 'intent', runId: 'run-1' }] }); f.seedTask(task)
  const runner = { inspect: async () => ({ status: 'exited', launchStatus: 'unknown' }), start: () => assert.fail('ambiguous start'), resume: () => assert.fail('ambiguous resume') }
  const result = await driveTask({ root: f.root, config: f.config, task, observation: { state: state() }, runner })
  assert.equal(result.waitingOn, 'setup:launch_unknown')
  assert.equal(result.pendingEffects[0].kind, 'launch')
})

test('R4 inspect block is durable and preserves classified diagnostic and repair history', async t => {
  const f = makeHarnessFixture(t)
  const task = f.task({ claudeSessionId: '1f8a9f32-36c8-4479-8aee-4d745c188452', tmuxSession: 'ff-123', completedReceipt: { stage: 'verify', outcome: 'implementation_failed', receiptHash: 'diagnostic' }, repairCycles: { '': 2 } }); f.seedTask(task)
  const runner = { inspect: async () => ({ status: 'blocked', reason: 'workflow_pin_invalid' }), sendStage: () => assert.fail('blocked send') }
  const result = await driveTask({ root: f.root, config: f.config, task, observation: { state: state() }, runner })
  assert.equal(result.executionStatus, 'blocked')
  assert.equal(result.waitingOn, 'setup:workflow_pin_invalid')
  assert.equal(result.completedReceipt.outcome, 'implementation_failed')
  assert.equal(result.repairCycles[''], 2)
})

test('scheduler reconciliation releases verify_lock only with valid saved build and refreshed lock', async t => {
  const { f, task: completed } = await completedVerify(t)
  let task = { ...completed, stage: 'verify', pendingDispatch: null, waitingOn: 'verify_lock', executionStatus: 'waiting_human' }
  f.seedTask(task)
  task = await driveTask({ root: f.root, config: f.config, task, observation: { state: state({ heads: {}, verifyWaitingOn: 'verify_lock' }), allowEffects: false } })
  assert.equal(task.waitingOn, 'verify_lock')
  task = await driveTask({ root: f.root, config: f.config, task, observation: { state: state({ heads: {}, verifyWaitingOn: null }), allowEffects: false } })
  assert.equal(task.waitingOn, null)
  assert.equal(task.executionStatus, 'idle')
  assert.equal(task.stage, 'verify')
})

const startedTask = f => {
  let task = f.task({ stage: 'build', dispatchId: 'd1', pendingDispatch: { stage: 'build', revision: '', runId: 'run-1', dispatchId: 'd1' }, dispatchState: 'prepared' })
  return reduceEvent(task, f.event({ eventId: 'st', dispatchId: 'd1', type: 'stage_started', payload: { stage: 'build' } }), {})
}

test('plain-text stop: idle after stage_started waits for human after grace, notifies once, clears on prompt', t => {
  const f = makeHarnessFixture(t)
  let task = startedTask(f)
  task = reduceEvent(task, f.event({ eventId: 'idle1', dispatchId: 'd1', type: 'runner_idle' }), {})
  const idleAt = f.clock.now()
  const early = applyPlainTextStop(task, new Date(idleAt + 60_000).toISOString(), 120_000)
  assert.equal(early.waitingOn, null)
  const late = applyPlainTextStop(task, new Date(idleAt + 121_000).toISOString(), 120_000)
  assert.equal(late.waitingOn, 'human_reply')
  assert.equal(late.executionStatus, 'waiting_human')
  assert.equal(late.pendingEffects.filter(e => e.kind === 'notify' && e.reason === 'human_reply').length, 1)
  const again = applyPlainTextStop(late, new Date(idleAt + 400_000).toISOString(), 120_000)
  assert.equal(again.pendingEffects.filter(e => e.kind === 'notify').length, 1)
  const answered = reduceEvent(late, f.event({ eventId: 'p1', dispatchId: 'd1', type: 'prompt_submitted', at: new Date(idleAt + 500_000).toISOString(), payload: { source: 'human' } }), {})
  assert.equal(answered.waitingOn, null)
  assert.equal(answered.executionStatus, 'working')
  assert.equal(answered.plainStop, null)
})

test('plain-text stop: not flagged when finished, with open question, or when activity follows the stop', t => {
  const f = makeHarnessFixture(t)
  const far = new Date(f.clock.now() + 600_000).toISOString()
  const base = startedTask(f)
  const idle = reduceEvent(base, f.event({ eventId: 'idle1', dispatchId: 'd1', type: 'runner_idle' }), {})
  const resumed = reduceEvent(idle, f.event({ eventId: 'p0', dispatchId: 'd1', type: 'prompt_submitted', at: new Date(f.clock.now() + 1000).toISOString(), payload: { source: 'human' } }), {})
  assert.equal(applyPlainTextStop(resumed, far, 120_000).waitingOn, null)
  assert.equal(applyPlainTextStop({ ...idle, questions: [{ questionId: 'q', status: 'open', revision: '', runId: 'run-1', header: 'Q' }] }, far, 120_000).waitingOn, null)
  assert.equal(applyPlainTextStop({ ...idle, dispatchState: 'finished', pendingDispatch: null }, far, 120_000).waitingOn, null)
  assert.equal(applyPlainTextStop(base, far, 120_000).waitingOn, null)
})
