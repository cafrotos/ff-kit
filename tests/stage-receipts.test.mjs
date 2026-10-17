import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import YAML from 'yaml'
import { makeHarnessFixture } from './helpers/harness.mjs'
import { git } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'
import { main } from '../scripts/cli/main.mjs'
import { recordGates } from '../scripts/lib/gates.mjs'
import { listHarnessEvents } from '../scripts/lib/harness-events.mjs'
import { readTask } from '../ff-worker/src/core/task-store.mjs'

const api = await import('../scripts/lib/stage-receipts.mjs').catch(() => ({}))
const sha = (x) => createHash('sha256').update(x).digest('hex')
const card = 'trellocards/123-harness'
function setup(t, stage = 'build') {
  const f = makeHarnessFixture(t)
  f.config.e2e = { tests_dir: 'e2e' }
  f.config.ship = { ...f.config.ship, verify_on_ship_branch: false } // fixture repo has no ship branch/origin; ship-test binding is covered in ship-test.test.mjs
  fs.writeFileSync(path.join(f.root, 'ff.config.yaml'), YAML.stringify(f.config))
  const files = {
    [`${card}/01-dossier.md`]: '# Card\n## Branch\n```\ntask/123\n```\n',
    [`${card}/01b-ledger.md`]: '| D-01 | keep filter | dossier | |\n',
    [`${card}/brief.md`]: '# Brief\nKeep filter D-01\n',
    [`${card}/02-spec.md`]: '# Spec\n- **AC-01** Keep filter — D-01\n',
    [`${card}/03-design.md`]: '# Design\nKeep filter D-01\n',
    [`${card}/04-plan.md`]: '# Plan\nImplement filter\n',
    'e2e/123-harness/filter.spec.ts': "test('AC-01 keeps filter', async () => { expect(1).toBe(1) })\n",
  }
  for (const [p, content] of Object.entries(files)) f.writeArtifact(p, content)
  for (const gate of ['GATE_A', 'GATE_B']) {
    const question = '[#123] Duyệt?'
    recordGates(f.root, f.config, { questions: [{ header: gate, question }] }, { answers: { [question]: 'Duyệt' } })
  }
  const repo = path.join(f.root, 'worktrees/123-harness/web')
  fs.mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q', '-b', 'task/123')
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-qm', 'base')
  const fork = git(repo, 'rev-parse', 'HEAD')
  const origin = path.join(f.root, 'web-origin.git')
  git(f.root, 'clone', '--bare', repo, origin)
  git(repo, 'remote', 'add', 'origin', origin)
  git(repo, 'config', 'ff.originalFork', fork)
  git(repo, 'fetch', 'origin')
  const heads = { web: git(repo, 'rev-parse', 'HEAD') }
  const lock = 'worktrees/123-harness/.ff-test-lock'
  f.writeArtifact(lock, `${sha(files['e2e/123-harness/filter.spec.ts'])}  e2e/123-harness/filter.spec.ts\n`)
  const manifest = JSON.stringify({ version: 1, cliVersion: '0.1.0', files: { 'bin/ff': sha('#!/bin/sh\nexit 0\n'), 'dist/cli.mjs': sha('// cli\n') } })
  const digest = sha(manifest), snapshot = `.ff/workflows/${digest}`
  f.writeArtifact(`${snapshot}/manifest.json`, manifest)
  fs.chmodSync(f.writeArtifact(`${snapshot}/bin/ff`, '#!/bin/sh\nexit 0\n'), 0o755)
  f.writeArtifact(`${snapshot}/dist/cli.mjs`, '// cli\n')
  const workflow = { digest, path: snapshot, binDir: `${snapshot}/bin`, cliPath: `${snapshot}/bin/ff`, pluginPath: snapshot, cliVersion: '0.1.0' }
  const pendingDispatch = { dispatchId: 'dispatch-1', runId: 'run-1', revision: '', stage }
  const task = f.task({ stage, dispatchId: 'dispatch-1', pendingDispatch, workflow })
  f.seedTask(task)
  const log = `${card}/evidence/check.log`, review = `${card}/evidence/review.json`, matrix = `${card}/evidence/ac.json`
  f.writeArtifact(log, 'node v22 checks passed\n')
  f.writeArtifact(review, JSON.stringify({ status: 'pass', revision: '', heads, findings: [] }))
  f.writeArtifact(matrix, JSON.stringify({ revision: '', heads, criteria: [{ id: 'AC-01', status: 'pass', evidence: [log] }] }))
  const evidence = { cardId: '123', revision: '', runId: 'run-1', dispatchId: 'dispatch-1', heads, workflow: { digest, cliVersion: '0.1.0' },
    artifactHashes: Object.fromEntries([...Object.keys(files).filter(p => p.startsWith(card)), log, review, matrix].map(p => [p, sha(fs.readFileSync(path.join(f.root, p)))])),
    testLockHash: sha(fs.readFileSync(path.join(f.root, lock))), checks: [{ command: 'node -v', cwd: 'worktrees/123-harness/web', exitCode: 0, logPath: log, logHash: sha(fs.readFileSync(path.join(f.root, log))) }], reviewRefs: [review], acMatrixRef: matrix }
  const save = (value = evidence) => f.writeArtifact(`${card}/evidence/input.json`, JSON.stringify(value))
  const finish = (outcome = 'pass', value = evidence) => api.finishStage(f.root, f.config, { cardId: '123', dispatchId: 'dispatch-1', outcome, evidenceFile: save(value) })
  return { ...f, repo, task, heads, evidence, save, finish, lock, log, review, matrix, snapshot }
}

test('stage receipt public API is available', () => {
  for (const name of ['beginStage', 'finishStage', 'readStageReceipt', 'validateStageReceipt']) assert.equal(typeof api[name], 'function', name)
})
test('begin rejects foreign dispatch; concurrent duplicate begin emits once without task mutation', async (t) => {
  const f = setup(t), before = readTask(f.root, '123')
  await assert.rejects(() => api.beginStage(f.root, f.config, { cardId: '123', dispatchId: 'wrong' }), /dispatch/i)
  const opts = { cardId: '123', dispatchId: 'dispatch-1' }
  const [a, b] = await Promise.all([api.beginStage(f.root, f.config, opts), api.beginStage(f.root, f.config, opts)])
  assert.equal(a.eventId, b.eventId)
  assert.equal(listHarnessEvents(f.root, '123').filter(e => e.type === 'stage_started').length, 1)
  assert.deepEqual(readTask(f.root, '123'), before)
})
test('build completion enforces checks, review, AC evidence and nonempty intact test manifest', async (t) => {
  const f = setup(t)
  await api.beginStage(f.root, f.config, { cardId: '123', dispatchId: 'dispatch-1' })
  for (const patch of [{ checks: [] }, { reviewRefs: [] }, { acMatrixRef: null }, { testLockHash: null }, { checks: [{ ...f.evidence.checks[0], exitCode: 1 }] }, { checks: [{ ...f.evidence.checks[0], command: 'echo pass' }] }]) {
    await assert.rejects(() => f.finish('pass', { ...f.evidence, ...patch }))
  }
  assert.equal(api.readStageReceipt(f.root, '123', 'build', ''), null)
  f.writeArtifact(f.lock, '')
  await assert.rejects(() => f.finish('pass', { ...f.evidence, testLockHash: sha('') }), /lock|manifest/i)
})
test('finish runs actual squash and AC validators, rejecting dirty git and uncovered criteria', async (t) => {
  const f = setup(t)
  await api.beginStage(f.root, f.config, { cardId: '123', dispatchId: 'dispatch-1' })
  fs.writeFileSync(path.join(f.repo, 'dirty.txt'), 'dirty')
  await assert.rejects(() => f.finish(), /squash/i)
  fs.unlinkSync(path.join(f.repo, 'dirty.txt'))
  f.writeArtifact(`${card}/02-spec.md`, '# Spec\n- **AC-02** Uncovered\n')
  for (const gate of ['GATE_A', 'GATE_B']) {
    const question = '[#123] Duyệt?'
    recordGates(f.root, f.config, { questions: [{ header: gate, question }] }, { answers: { [question]: 'Duyệt' } })
  }
  f.writeArtifact(f.matrix, JSON.stringify({ revision: '', heads: f.heads, criteria: [{ id: 'AC-02', status: 'pass', evidence: [f.log] }] }))
  const evidence = structuredClone(f.evidence)
  evidence.artifactHashes[`${card}/02-spec.md`] = sha(fs.readFileSync(path.join(f.cardDir, '02-spec.md')))
  evidence.artifactHashes[f.matrix] = sha(fs.readFileSync(path.join(f.root, f.matrix)))
  await assert.rejects(() => f.finish('pass', evidence), /ac-matrix validation failed/)
})
test('valid finish is persisted before event, idempotent, and task remains worker owned', async (t) => {
  const f = setup(t), before = readTask(f.root, '123')
  await assert.rejects(() => f.finish(), /begin|started/i)
  await api.beginStage(f.root, f.config, { cardId: '123', dispatchId: 'dispatch-1' })
  const receipt = await f.finish()
  assert.equal(api.validateStageReceipt(f.root, f.config, receipt).valid, true)
  assert.deepEqual(await f.finish(), receipt)
  assert.deepEqual(api.readStageReceipt(f.root, '123', 'build', ''), receipt)
  assert.equal(listHarnessEvents(f.root, '123').filter(e => e.type === 'stage_finished').length, 1)
  assert.deepEqual(readTask(f.root, '123'), before)
})

test('finish redelivery repairs a missing event after receipt persistence', async (t) => {
  const f = setup(t)
  await api.beginStage(f.root, f.config, { cardId: '123', dispatchId: 'dispatch-1' })
  const receipt = await f.finish()
  const finished = listHarnessEvents(f.root, '123').find(e => e.type === 'stage_finished')
  fs.unlinkSync(path.join(f.root, '.ff/harness/inbox/123', `${sha(finished.eventId)}.json`))
  assert.equal(listHarnessEvents(f.root, '123').some(e => e.type === 'stage_finished'), false)
  assert.deepEqual(await f.finish(), receipt)
  assert.equal(listHarnessEvents(f.root, '123').filter(e => e.type === 'stage_finished').length, 1)
})
test('receipt invalidates on HEAD, lock contents, evidence hash, workflow or revision drift', async (t) => {
  const f = setup(t)
  await api.beginStage(f.root, f.config, { cardId: '123', dispatchId: 'dispatch-1' })
  const receipt = await f.finish()
  fs.writeFileSync(path.join(f.repo, 'dirty.txt'), 'uncommitted source')
  assert.equal(api.validateStageReceipt(f.root, f.config, receipt).valid, false, 'dirty worktree must invalidate')
  fs.unlinkSync(path.join(f.repo, 'dirty.txt'))
  for (const file of [f.log, f.lock, `${f.snapshot}/dist/cli.mjs`]) {
    const abs = path.join(f.root, file), old = fs.readFileSync(abs)
    fs.appendFileSync(abs, 'changed')
    assert.equal(api.validateStageReceipt(f.root, f.config, receipt).valid, false, file)
    fs.writeFileSync(abs, old)
  }
  git(f.repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-qm', 'changed')
  assert.equal(api.validateStageReceipt(f.root, f.config, receipt).valid, false)
  git(f.repo, 'reset', '--hard', f.heads.web)
  fs.mkdirSync(path.join(f.cardDir, 'rev-1'))
  assert.equal(api.validateStageReceipt(f.root, f.config, receipt).valid, false)
})

test('verify binds current report and refuses failure outcomes as successful AC proof', async (t) => {
  const f = setup(t, 'verify')
  await api.beginStage(f.root, f.config, { cardId: '123', dispatchId: 'dispatch-1' })
  await assert.rejects(() => f.finish(), /artifact/i)
  const report = `${card}/05-verify-report.md`
  f.writeArtifact(report, '# Verify\nAC-01 PASS with check.log\n')
  f.evidence.artifactHashes[report] = sha(fs.readFileSync(path.join(f.root, report)))
  const receipt = await f.finish()
  assert.equal(receipt.stage, 'verify')
  fs.appendFileSync(path.join(f.root, report), 'edited')
  assert.equal(api.validateStageReceipt(f.root, f.config, receipt).valid, false)
})

test('verify requires both root and child report hashes and either report edit invalidates receipt', async (t) => {
  const f = setup(t, 'verify')
  const reports = [`${card}/05-verify-report.md`, `${card}/task-1/05-verify-report.md`]
  for (const report of reports) {
    f.writeArtifact(report, '# Verify\nAC-01 PASS with check.log\n')
    f.evidence.artifactHashes[report] = sha(fs.readFileSync(path.join(f.root, report)))
  }
  await api.beginStage(f.root, f.config, { cardId: '123', dispatchId: 'dispatch-1' })
  for (const report of reports) {
    const evidence = structuredClone(f.evidence)
    delete evidence.artifactHashes[report]
    await assert.rejects(() => f.finish('pass', evidence), /artifact.*hash-bound/i, report)
  }
  const receipt = await f.finish()
  assert.equal(api.validateStageReceipt(f.root, f.config, receipt).valid, true)
  for (const report of reports) {
    const original = fs.readFileSync(path.join(f.root, report))
    f.writeArtifact(report, '# Verify\nAC-01 FAIL\n')
    assert.equal(api.validateStageReceipt(f.root, f.config, receipt).valid, false, report)
    f.writeArtifact(report, original)
    assert.equal(api.validateStageReceipt(f.root, f.config, receipt).valid, true)
  }
})

test('failure receipts carry diagnostics without fabricating success prerequisites or Gates', async (t) => {
  const f = setup(t)
  fs.unlinkSync(path.join(f.cardDir, 'brief.md'))
  await api.beginStage(f.root, f.config, { cardId: '123', dispatchId: 'dispatch-1' })
  const evidence = { ...f.evidence, artifactHashes: { [f.log]: f.evidence.artifactHashes[f.log] }, checks: [{ ...f.evidence.checks[0], exitCode: 1 }], reviewRefs: [], acMatrixRef: null, testLockHash: null }
  const receipt = await f.finish('implementation_failed', evidence)
  assert.equal(receipt.outcome, 'implementation_failed')
  assert.equal(api.validateStageReceipt(f.root, f.config, receipt).valid, true)
  assert.equal(fs.existsSync(path.join(f.cardDir, 'brief.md')), false)
})

test('disabled standalone context is explicit and missing workflow pins fail closed', async (t) => {
  const f = setup(t)
  f.seedTask({ ...f.task, workflow: {} })
  await assert.rejects(() => api.beginStage(f.root, f.config, { cardId: '123', dispatchId: 'dispatch-1' }), /workflow/i)
  f.config.worker.driver.enabled = false
  fs.writeFileSync(path.join(f.root, 'ff.config.yaml'), YAML.stringify(f.config))
  const out = capture(f.root)
  assert.equal(await main(['stage', 'context', '123', '--json'], out.ctx), 0)
  assert.equal(JSON.parse(out.buf.out).enabled, false)
  assert.equal(JSON.parse(out.buf.out).pendingDispatch, null)
})
test('stored validated completion survives resume, unfinished old run evidence cannot finish new dispatch', async (t) => {
  const f = setup(t)
  await api.beginStage(f.root, f.config, { cardId: '123', dispatchId: 'dispatch-1' })
  const receipt = await f.finish()
  f.seedTask({ ...f.task, runId: 'run-2', dispatchId: 'dispatch-2', pendingDispatch: { ...f.task.pendingDispatch, runId: 'run-2', dispatchId: 'dispatch-2' } })
  assert.equal(api.validateStageReceipt(f.root, f.config, receipt).valid, true)
  const forged = { ...receipt, dispatchId: 'unfinished' }
  assert.equal(api.validateStageReceipt(f.root, f.config, forged).valid, false)
  await assert.rejects(() => f.finish(), /dispatch/i)
  await api.beginStage(f.root, f.config, { cardId: '123', dispatchId: 'dispatch-2' })
  await assert.rejects(() => api.finishStage(f.root, f.config, { cardId: '123', dispatchId: 'dispatch-2', outcome: 'pass', evidenceFile: f.save() }), /scope/i)
})
test('no_change still needs explicit passing AC evidence and actual checks', async (t) => {
  const f = setup(t)
  await api.beginStage(f.root, f.config, { cardId: '123', dispatchId: 'dispatch-1' })
  await assert.rejects(() => f.finish('no_change', { ...f.evidence, acMatrixRef: null }))
  assert.equal((await f.finish('no_change')).outcome, 'no_change')
})

test('receipt skips supported dropped AC forms while active AC still needs explicit proof', async (t) => {
  const f = setup(t)
  const droppedForms = ['— (bỏ) Removed', '– _(bỏ)_ Removed', '- (bỏ) Removed', '_(bỏ)_ Removed', '(bỏ) Removed']
  const spec = '# Spec\n- **AC-01** Keep filter — D-01\n' + droppedForms.map((form, i) => `- **AC-0${i + 2}** ${form}\n`).join('')
  f.writeArtifact(`${card}/02-spec.md`, spec)
  f.evidence.artifactHashes[`${card}/02-spec.md`] = sha(spec)
  for (const gate of ['GATE_A', 'GATE_B']) {
    const question = '[#123] Duyệt?'
    recordGates(f.root, f.config, { questions: [{ header: gate, question }] }, { answers: { [question]: 'Duyệt' } })
  }
  await api.beginStage(f.root, f.config, { cardId: '123', dispatchId: 'dispatch-1' })
  const badMatrix = JSON.stringify({ revision: '', heads: f.heads, criteria: [{ id: 'AC-02', status: 'pass', evidence: [f.log] }] })
  const originalMatrix = fs.readFileSync(path.join(f.root, f.matrix))
  f.writeArtifact(f.matrix, badMatrix)
  await assert.rejects(() => f.finish('pass', { ...f.evidence, artifactHashes: { ...f.evidence.artifactHashes, [f.matrix]: sha(badMatrix) } }), /Missing passing AC evidence: AC-01/)
  f.writeArtifact(f.matrix, originalMatrix)
  const receipt = await f.finish('no_change')
  assert.equal(api.validateStageReceipt(f.root, f.config, receipt).valid, true)
})

test('receipt normalizes spec AC IDs exactly as ac-matrix does', async (t) => {
  const f = setup(t)
  const spec = '# Spec\n- **AC-1** Keep filter — D-01\n'
  f.writeArtifact(`${card}/02-spec.md`, spec)
  f.evidence.artifactHashes[`${card}/02-spec.md`] = sha(spec)
  for (const gate of ['GATE_A', 'GATE_B']) {
    const question = '[#123] Duyệt?'
    recordGates(f.root, f.config, { questions: [{ header: gate, question }] }, { answers: { [question]: 'Duyệt' } })
  }
  await api.beginStage(f.root, f.config, { cardId: '123', dispatchId: 'dispatch-1' })
  assert.equal((await f.finish()).outcome, 'pass')
})
test('understand pass requires current readyForBuild and snapshots its gate artifacts', async (t) => {
  const f = setup(t, 'understand')
  await api.beginStage(f.root, f.config, { cardId: '123', dispatchId: 'dispatch-1' })
  const receipt = await f.finish()
  assert.equal(receipt.stage, 'understand')
  fs.appendFileSync(path.join(f.cardDir, 'brief.md'), 'changed')
  assert.equal(api.validateStageReceipt(f.root, f.config, receipt).valid, false)
  await assert.rejects(() => f.finish())
})
test('context only exposes safe scope/pending fields; state adds scoped receipt view', async (t) => {
  const f = setup(t)
  f.seedTask({ ...f.task, credentials: 'TOP_SECRET', pendingDispatch: { ...f.task.pendingDispatch, token: 'TOP_SECRET' } })
  let out = capture(f.root)
  assert.equal(await main(['stage', 'context', '123', '--json'], out.ctx), 0, out.buf.err)
  assert.doesNotMatch(out.buf.out, /TOP_SECRET/)
  assert.equal(JSON.parse(out.buf.out).pendingDispatch.dispatchId, 'dispatch-1')
  out = capture(f.root)
  assert.equal(await main(['stage', 'begin', '123', '--dispatch', 'dispatch-1'], out.ctx), 0, out.buf.err)
  out = capture(f.root)
  assert.equal(await main(['stage', 'finish', '123', '--dispatch', 'dispatch-1', '--outcome', 'pass', '--evidence', f.save()], out.ctx), 0, out.buf.err)
  out = capture(f.root)
  assert.equal(await main(['state', '123', '--json'], out.ctx), 0)
  const state = JSON.parse(out.buf.out)
  assert.equal(state.receipts.build.valid, true)
  assert.equal(state.receipts.build.revision, '')
  assert.equal(state.readyForBuild, true)
})
test('evidence rejects outside paths and symlinks, forged hashes and failing review/AC claims', async (t) => {
  const f = setup(t)
  await api.beginStage(f.root, f.config, { cardId: '123', dispatchId: 'dispatch-1' })
  for (const patch of [{ checks: [{ ...f.evidence.checks[0], logPath: '/etc/passwd' }] }, { checks: [{ ...f.evidence.checks[0], logHash: '0'.repeat(64) }] }, { workflow: { digest: '0'.repeat(64), cliVersion: '0.1.0' } }]) await assert.rejects(() => f.finish('pass', { ...f.evidence, ...patch }))
  const symlink = f.writeArtifact(`${card}/evidence/link`, '')
  fs.unlinkSync(symlink); fs.symlinkSync('/etc/passwd', symlink)
  await assert.rejects(() => f.finish('pass', { ...f.evidence, reviewRefs: [`${card}/evidence/link`] }))
  f.writeArtifact(f.review, JSON.stringify({ status: 'fail', revision: '', heads: f.heads, findings: ['broken'] }))
  const evidence = structuredClone(f.evidence)
  evidence.artifactHashes[f.review] = sha(fs.readFileSync(path.join(f.root, f.review)))
  await assert.rejects(() => f.finish('pass', evidence), /review/i)
})

// Driver-owned block state, as reconcileReceipt/nextStage leave it after a failed finish.
function blockOnFailure(f, receipt, patch = {}) {
  f.seedTask({ ...readTask(f.root, '123'), pendingDispatch: null, executionStatus: 'blocked', waitingOn: 'needs_human', blockReason: `${receipt.stage}_${receipt.outcome}`,
    completedReceipt: { stage: receipt.stage, outcome: receipt.outcome, receiptHash: api.receiptDigest(receipt), at: receipt.at }, ...patch })
}
test('finish may supersede a needs_human receipt of the same dispatch only while blocked on it; old evidence is archived', async (t) => {
  const f = setup(t)
  await api.beginStage(f.root, f.config, { cardId: '123', dispatchId: 'dispatch-1' })
  const failed = await f.finish('needs_human')
  // Not blocked yet (driver has not recorded the block): a different outcome is final.
  await assert.rejects(() => f.finish('pass'), /final|pending/i)
  blockOnFailure(f, failed)
  const passed = await f.finish('pass')
  assert.equal(passed.outcome, 'pass'); assert.equal(passed.dispatchId, 'dispatch-1')
  assert.deepEqual(api.readStageReceipt(f.root, '123', 'build', ''), passed)
  assert.equal(api.validateStageReceipt(f.root, f.config, passed).valid, true)
  const history = path.join(f.root, '.ff/harness/receipts/123/root/history')
  const archived = fs.readdirSync(history).map(n => JSON.parse(fs.readFileSync(path.join(history, n), 'utf8')))
  assert.deepEqual(archived, [failed])
  const finished = listHarnessEvents(f.root, '123').filter(e => e.type === 'stage_finished')
  assert.equal(finished.length, 2); assert.equal(finished.at(-1).payload.outcome, 'pass')
  assert.equal(readTask(f.root, '123').blockReason, 'build_needs_human')
})
test('finish refuses to supersede a pass, an unrelated block, a limit block, or a foreign blocking receipt', async (t) => {
  const f = setup(t)
  await api.beginStage(f.root, f.config, { cardId: '123', dispatchId: 'dispatch-1' })
  const passed = await f.finish('pass')
  blockOnFailure(f, passed, { blockReason: 'build_pass' })
  await assert.rejects(() => f.finish('needs_human'))
  blockOnFailure(f, { ...passed, outcome: 'needs_human' })
  await assert.rejects(() => f.finish('needs_human'), /blocking receipt|final|pending/i)
  assert.deepEqual(api.readStageReceipt(f.root, '123', 'build', ''), passed)
})
test('finish refuses to supersede repair_limit / working_lifetime / setup session blocks', async (t) => {
  const f = setup(t)
  await api.beginStage(f.root, f.config, { cardId: '123', dispatchId: 'dispatch-1' })
  const failed = await f.finish('needs_human')
  for (const patch of [{ blockReason: 'repair_limit' }, { failureReason: 'working_lifetime' }, { waitingOn: 'setup:session_mismatch' }, { blockReason: 'stage_retry_limit' }]) {
    blockOnFailure(f, failed, patch)
    await assert.rejects(() => f.finish('pass'), /final|pending/i, JSON.stringify(patch))
  }
  assert.deepEqual(api.readStageReceipt(f.root, '123', 'build', ''), failed)
})
