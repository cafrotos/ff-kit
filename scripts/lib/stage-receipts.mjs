import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { assertScope, normalizeRevision, RECEIPT_OUTCOMES } from './harness-contracts.mjs'
import { appendHarnessEvent, listHarnessEvents } from './harness-events.mjs'
import { withFileMutexRetry } from './file-mutex.mjs'
import { findCardDir } from './cards.mjs'
import { inspectCard } from '../cli/state.mjs'
import { git, repoDir } from '../cli/repo-common.mjs'
import { run as squashCheck } from '../cli/squash-check.mjs'
import { acMatrix, parseSpecAcs } from '../cli/spec-checks.mjs'
import { receiptOriginBlock } from './human-resolution.mjs'
import { readTask, taskPath } from '../../ff-worker/src/core/task-store.mjs'
import { readShipTest, validateShipTest, shipTestRel, shipTestRequired } from './ship-test-record.mjs'

const stages = ['understand', 'build', 'verify', 'ship']
const hash = (data) => createHash('sha256').update(data).digest('hex')
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const canonical = (value) => JSON.stringify(value, (_, v) => object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)
const equal = (a, b) => canonical(a) === canonical(b)
const insist = (yes, why) => { if (!yes) throw new Error(why) }
const relative = (root, file) => path.relative(root, file).split(path.sep).join('/')

function local(root, file, allowRoot = false) {
  insist(typeof file === 'string' && file.length > 0, 'Missing evidence path')
  const target = path.resolve(root, file), base = fs.realpathSync(root)
  const rel = path.relative(base, target)
  insist((rel || allowRoot) && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel), `Evidence path escapes workspace: ${file}. Evidence/log/artifact paths must be relative to the workspace root and inside it (e.g. <cards_dir>/<card>/evidence/<dispatchId>/stage-evidence.json); run \`ff stage protocol\` for the schema`)
  const real = fs.realpathSync(target)
  insist(real === target, 'Evidence path must not use symlinks')
  return target
}
function fileHash(root, file) {
  const target = local(root, file)
  insist(fs.statSync(target).isFile(), 'Evidence must be a file')
  return hash(fs.readFileSync(target))
}
function json(root, file) { return JSON.parse(fs.readFileSync(local(root, file), 'utf8')) }

/** Snapshot producer contract: digest hashes manifest bytes, then every listed file. */
export function validateWorkflowPin(root, workflow) {
  insist(object(workflow) && digest(workflow.digest), 'Missing workflow digest')
  const base = path.resolve(root, '.ff/workflows', workflow.digest)
  insist(path.resolve(root, workflow.path ?? '') === base, 'Invalid workflow path')
  for (const [key, suffix] of [['binDir', 'bin'], ['cliPath', 'bin/ff'], ['pluginPath', '']]) {
    insist(path.resolve(root, workflow[key] ?? '') === path.join(base, suffix), `Invalid workflow ${key}`)
  }
  insist(fileHash(root, path.join(base, 'manifest.json')) === workflow.digest, 'Workflow manifest hash mismatch')
  const manifest = json(root, path.join(base, 'manifest.json'))
  insist(manifest.version === 1 && typeof workflow.cliVersion === 'string' && workflow.cliVersion && manifest.cliVersion === workflow.cliVersion && object(manifest.files), 'Invalid workflow manifest')
  insist(manifest.files['bin/ff'] && manifest.files['dist/cli.mjs'], 'Workflow CLI layout missing')
  for (const [name, expected] of Object.entries(manifest.files)) {
    insist(!path.isAbsolute(name) && name !== 'manifest.json' && name.split(/[\\/]/).every(p => p && p !== '..' && p !== '.'), 'Invalid workflow file path')
    insist(digest(expected) && fileHash(root, path.join(base, name)) === expected, 'Workflow file hash mismatch')
  }
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name), name = relative(base, file)
      insist(!entry.isSymbolicLink(), 'Workflow symlink forbidden')
      if (entry.isDirectory()) walk(file)
      else insist(entry.isFile() && (name === 'manifest.json' || Object.hasOwn(manifest.files, name)), 'Unlisted workflow file')
    }
  }
  walk(base)
  insist((fs.statSync(path.join(base, 'bin/ff')).mode & 0o111) !== 0, 'Workflow bin/ff is not executable')
  return { digest: workflow.digest, cliVersion: workflow.cliVersion }
}

function current(root, config, cardId) {
  const task = readTask(root, cardId)
  const card = findCardDir(root, config, cardId)
  insist(!card.error, card.error)
  const state = inspectCard(root, config, card.dir)
  const revision = normalizeRevision(state.activeRevision)
  return { task, card: card.dir, state, revision }
}
function pending(root, config, cardId, dispatchId) {
  insist(config.worker?.driver?.enabled === true, 'Stage dispatch requires enabled driver')
  const c = current(root, config, cardId), p = c.task?.pendingDispatch
  insist(p && typeof dispatchId === 'string' && dispatchId.length && p.dispatchId === dispatchId && c.task.dispatchId === dispatchId, 'No matching pending dispatch')
  assertScope({ cardId, revision: p.revision, runId: p.runId, dispatchId })
  insist(p.stage === c.task.stage && stages.includes(p.stage) && p.runId === c.task.runId && normalizeRevision(p.revision) === c.revision && normalizeRevision(c.task.revision) === c.revision, 'Pending dispatch scope mismatch')
  validateWorkflowPin(root, c.task.workflow)
  return { ...c, scope: { cardId, revision: c.revision, runId: p.runId, dispatchId }, stage: p.stage }
}
/** Same digest the driver stores as completedReceipt.receiptHash. */
export const receiptDigest = (receipt) => hash(canonical(receipt))
/**
 * A finished dispatch may be superseded only while the task is blocked on that dispatch's own
 * failed receipt (needs_human/implementation_failed/environment_blocked). The old receipt is
 * archived by the caller; a pass receipt, limit blocks and identity blocks never qualify.
 */
function supersedable(root, config, cardId, dispatchId) {
  insist(config.worker?.driver?.enabled === true, 'Stage dispatch requires enabled driver')
  const c = current(root, config, cardId), t = c.task
  const origin = receiptOriginBlock(t)
  insist(origin && !t.pendingDispatch && typeof dispatchId === 'string' && dispatchId.length && t.dispatchId === dispatchId, 'No matching pending dispatch')
  assertScope({ cardId, revision: t.revision, runId: t.runId, dispatchId })
  insist(stages.includes(t.stage) && normalizeRevision(t.revision) === c.revision, 'Pending dispatch scope mismatch')
  validateWorkflowPin(root, t.workflow)
  const saved = readStageReceipt(root, cardId, t.stage, c.revision)
  insist(saved && saved.dispatchId === dispatchId && saved.runId === t.runId && saved.outcome === origin.outcome && receiptDigest(saved) === origin.receiptHash, 'Saved receipt is not the blocking receipt')
  return { ...c, scope: { cardId, revision: c.revision, runId: t.runId, dispatchId }, stage: t.stage, superseding: true }
}
function headsNow(root, config, c, required) {
  const heads = {}
  for (const repo of config.repos) {
    const dir = repoDir(root, config.workspace.worktrees_dir, c.state.slug, repo)
    if (!fs.existsSync(dir) && !required) continue
    local(root, dir)
    const result = git(dir, ['rev-parse', 'HEAD'])
    insist(result.status === 0 && /^[a-f0-9]{40,64}$/.test(result.stdout.trim()), 'Cannot resolve repo HEAD')
    heads[repo.name] = result.stdout.trim()
  }
  return heads
}
function receiptPath(root, cardId, stage, revision) {
  insist(typeof cardId === 'string' && /^[A-Za-z0-9]+$/.test(cardId) && stages.includes(stage), 'Invalid receipt scope')
  return path.join(root, '.ff/harness/receipts', cardId, normalizeRevision(revision) || 'root', `${stage}.json`)
}
export function readStageReceipt(root, cardId, stage, revision) {
  const file = receiptPath(root, cardId, stage, revision)
  try {
    const receipt = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (receipt.cardId !== cardId || receipt.stage !== stage || receipt.revision !== normalizeRevision(revision)) return null
    return receipt
  } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error }
}
function eventFor(c, type, payload) {
  return { ...c.scope, eventId: hash(canonical({ ...c.scope, stage: c.stage, type })), type, at: new Date().toISOString(), payload }
}
export async function beginStage(root, config, { cardId, dispatchId }) {
  return withFileMutexRetry(`${taskPath(root, cardId)}.lock`, { operation: 'stage-begin' }, async () => {
    const c = pending(root, config, cardId, dispatchId)
    const event = eventFor(c, 'stage_started', { stage: c.stage, workflow: validateWorkflowPin(root, c.task.workflow) })
    const existing = listHarnessEvents(root, cardId).find(e => e.eventId === event.eventId)
    if (existing) return existing
    await appendHarnessEvent(root, event)
    return event
  })
}

function requiredArtifacts(root, c, stage) {
  const files = [path.join(c.card, '01-dossier.md'), path.join(c.card, '01b-ledger.md'), path.join(c.card, c.revision, c.revision ? 'delta.md' : 'brief.md')]
  const docs = ['02-spec.md', '03-design.md', ...(stage === 'understand' ? [] : ['04-plan.md']), ...(stage === 'verify' || stage === 'ship' ? ['05-verify-report.md'] : [])]
  const active = path.join(c.card, c.revision)
  const clusters = fs.readdirSync(active, { withFileTypes: true }).filter(e => e.isDirectory() && /^task-\d+(?:-[A-Za-z0-9-]+)?$/.test(e.name)).map(e => path.join(active, e.name))
  for (const name of docs) {
    const selected = [active, ...clusters].map(dir => path.join(dir, name)).filter(file => fs.existsSync(file))
    files.push(...(selected.length ? selected : [path.join(active, name)]))
  }
  return files.map(file => relative(root, file))
}
function checkLock(root, c, expected) {
  insist(digest(expected) && fileHash(root, c.state.testLock) === expected, 'Test lock hash mismatch or missing')
  const lines = fs.readFileSync(local(root, c.state.testLock), 'utf8').split(/\r?\n/).filter(line => line.trim())
  insist(lines.length > 0, 'Empty test lock manifest')
  const seen = new Set()
  for (const line of lines) {
    const m = line.match(/^([a-f0-9]{64})  (.+)$/)
    insist(m && !seen.has(m[2]), 'Invalid test lock manifest')
    insist(fileHash(root, m[2]) === m[1], 'Locked test contents changed')
    seen.add(m[2])
  }
}
function checkEvidence(root, config, c, receipt) {
  assertScope(receipt)
  insist(receipt.version === 1 && stages.includes(receipt.stage) && RECEIPT_OUTCOMES.includes(receipt.outcome) && Number.isFinite(Date.parse(receipt.at)), 'Invalid receipt schema')
  insist(receipt.revision === c.revision && normalizeRevision(c.task?.revision) === c.revision, 'Receipt revision mismatch')
  insist(equal(receipt.workflow, validateWorkflowPin(root, c.task?.workflow)), 'Workflow pin mismatch')
  const success = ['pass', 'no_change'].includes(receipt.outcome)
  const full = receipt.stage !== 'understand' && success
  insist(equal(receipt.heads, headsNow(root, config, c, full)), 'Receipt HEAD mismatch')
  insist(object(receipt.artifactHashes), 'Missing artifact hashes')
  for (const [file, expected] of Object.entries(receipt.artifactHashes)) insist(digest(expected) && fileHash(root, file) === expected, 'Artifact hash mismatch')
  const bound = (file) => insist(typeof file === 'string' && digest(receipt.artifactHashes[file]), 'Evidence artifact is not hash-bound')
  insist(Array.isArray(receipt.checks) && Array.isArray(receipt.reviewRefs), 'Missing checks/review')
  for (const check of receipt.checks) {
    insist(typeof check.command === 'string' && check.command.trim() && Number.isInteger(check.exitCode), 'Invalid check command/exitCode')
    insist(fs.statSync(local(root, check.cwd, true)).isDirectory(), 'Check cwd must be a directory')
    insist(digest(check.logHash) && fileHash(root, check.logPath) === check.logHash, 'Check log hash mismatch')
    insist(fs.statSync(local(root, check.logPath)).size > 0, 'Empty check log')
    if (success) insist(check.exitCode === 0, 'Check did not pass')
  }
  if (!success) {
    insist(receipt.checks.length > 0 || Object.keys(receipt.artifactHashes).length > 0, 'Failure needs diagnostic evidence')
    return
  }
  insist(c.state.readyForBuild, 'Current readyForBuild gates are not valid')
  const required = requiredArtifacts(root, c, receipt.stage)
  for (const file of required) { bound(file); insist(fs.statSync(local(root, file)).size > 0, 'Empty required artifact') }
  if (!full) return
  if (receipt.stage === 'verify') {
    // Verify ran on the ship-branch test checkout: bind feature squash, tested base and test commit SHAs.
    const record = readShipTest(root, receipt.cardId, c.revision)
    if (record || shipTestRequired(config)) {
      const bound3 = validateShipTest(record, receipt.heads)
      insist(bound3.valid, bound3.reason)
      bound(shipTestRel(receipt.cardId, c.revision))
    }
  }
  checkLock(root, c, receipt.testLockHash)
  insist(receipt.checks.length > 0, 'Missing checks')
  for (const repo of config.repos) {
    const cwd = repoDir(root, config.workspace.worktrees_dir, c.state.slug, repo)
    for (const [name, command] of Object.entries(repo.commands ?? {})) {
      if (!/^(?:lint|type[-_]?check|typecheck|build|test)(?:[-_].*)?$/.test(name) || !command) continue
      insist(receipt.checks.some(check => check.command === command && path.resolve(root, check.cwd) === cwd && check.exitCode === 0), `Missing configured check: ${repo.name}.${name}`)
    }
  }
  insist(receipt.reviewRefs.length > 0, 'Missing review evidence')
  for (const file of receipt.reviewRefs) {
    bound(file)
    const review = json(root, file)
    insist(review.status === 'pass' && review.revision === c.revision && equal(review.heads, receipt.heads) && Array.isArray(review.findings) && review.findings.length === 0, 'Review evidence is not passing/current')
  }
  bound(receipt.acMatrixRef)
  const matrix = json(root, receipt.acMatrixRef)
  insist(matrix.revision === c.revision && equal(matrix.heads, receipt.heads) && Array.isArray(matrix.criteria) && matrix.criteria.length > 0, 'Invalid AC evidence')
  const requiredIds = new Set(required.filter(file => file.endsWith('/02-spec.md')).flatMap(file => parseSpecAcs(fs.readFileSync(local(root, file), 'utf8')).filter(ac => !ac.dropped).map(ac => ac.id)))
  insist(requiredIds.size > 0, 'Missing active ACs')
  for (const id of requiredIds) {
    const entries = matrix.criteria.filter(entry => entry.id === id)
    insist(entries.length === 1 && entries[0].status === 'pass' && Array.isArray(entries[0].evidence) && entries[0].evidence.length > 0, `Missing passing AC evidence: ${id}`)
    for (const file of entries[0].evidence) { bound(file); insist(fs.statSync(local(root, file)).size > 0, 'Empty AC evidence') }
  }
}

/** Readers accept only an exact saved receipt, including after run resume. */
export function validateStageReceipt(root, config, receipt) {
  try {
    const c = current(root, config, receipt.cardId)
    const saved = readStageReceipt(root, receipt.cardId, receipt.stage, receipt.revision)
    insist(saved && equal(saved, receipt), 'Receipt was not saved and validated')
    checkEvidence(root, config, c, receipt)
    if (receipt.stage !== 'understand' && ['pass', 'no_change'].includes(receipt.outcome)) {
      for (const repo of config.repos) {
        const status = git(repoDir(root, config.workspace.worktrees_dir, c.state.slug, repo), ['status', '--porcelain'])
        insist(status.status === 0 && !status.stdout.trim(), 'Receipt source worktree is dirty')
      }
    }
    return { valid: true, reasons: [] }
  } catch (error) { return { valid: false, reasons: [error.message] } }
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    const fd = fs.openSync(temp, 'wx', 0o600)
    try { fs.writeFileSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.renameSync(temp, file)
  } finally { fs.rmSync(temp, { force: true }) }
}
export async function finishStage(root, config, { cardId, dispatchId, outcome, evidenceFile }) {
  return withFileMutexRetry(`${taskPath(root, cardId)}.lock`, { operation: 'stage-finish' }, async () => {
    const c = readTask(root, cardId)?.pendingDispatch ? pending(root, config, cardId, dispatchId) : supersedable(root, config, cardId, dispatchId)
    insist(RECEIPT_OUTCOMES.includes(outcome), 'Invalid stage outcome')
    const startedId = eventFor(c, 'stage_started', {}).eventId
    insist(listHarnessEvents(root, cardId).some(e => e.eventId === startedId && e.type === 'stage_started'), 'Stage must begin before finish')
    const evidence = json(root, evidenceFile)
    const badKeys = ['cardId', 'revision', 'runId', 'dispatchId'].filter(key => evidence[key] !== c.scope[key])
    insist(!badKeys.length, `Evidence scope mismatch: ${badKeys.map(key => `${key} must be ${JSON.stringify(c.scope[key])}`).join(', ')} (copy scope from \`ff stage context ${cardId} --json\`; root revision is "" not null; start from \`ff stage template ${cardId}\`)`)
    const saved = readStageReceipt(root, cardId, c.stage, c.revision)
    if (saved?.dispatchId === dispatchId && saved.runId === c.scope.runId && !(c.superseding && saved.outcome !== outcome)) {
      insist(saved.outcome === outcome, 'Dispatch outcome is already final')
      const validation = validateStageReceipt(root, config, saved)
      insist(validation.valid, `Saved receipt stale: ${validation.reasons.join('; ')}`)
      await appendHarnessEvent(root, eventFor(c, 'stage_finished', { stage: c.stage, outcome, receiptPath: relative(root, receiptPath(root, cardId, c.stage, c.revision)), receiptHash: hash(canonical(saved)) }))
      return saved
    }
    // Whitelist fields: credentials and arbitrary agent data never enter receipts/events.
    const receipt = { version: 1, ...c.scope, stage: c.stage, outcome, heads: evidence.heads, workflow: evidence.workflow,
      artifactHashes: evidence.artifactHashes, testLockHash: evidence.testLockHash ?? null,
      checks: evidence.checks?.map(({ command, cwd, exitCode, logPath, logHash }) => ({ command, cwd, exitCode, logPath, logHash })),
      reviewRefs: evidence.reviewRefs, acMatrixRef: evidence.acMatrixRef ?? null, at: new Date().toISOString() }
    checkEvidence(root, config, c, receipt)
    if (['build', 'verify', 'ship'].includes(c.stage) && ['pass', 'no_change'].includes(outcome)) {
      for (const [name, run] of [['squash-check', squashCheck], ['ac-matrix', acMatrix.run]]) {
        let output = ''
        const sink = { write: text => { output += text } }
        const exitCode = await run([cardId], { cwd: root, stdout: sink, stderr: sink })
        insist(exitCode === 0, `${name} validation failed`)
        const logPath = `.ff/harness/evidence/${cardId}/${c.revision || 'root'}/${hash(dispatchId)}/${name}.log`
        const target = path.join(root, logPath)
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
        fs.writeFileSync(target, output, { mode: 0o600 })
        receipt.checks.push({ command: `ff ${name} ${cardId}`, cwd: '.', exitCode, logPath, logHash: fileHash(root, logPath) })
      }
    }
    // Recheck after validators before publishing the checkpoint.
    checkEvidence(root, config, c, receipt)
    const event = eventFor(c, 'stage_finished', { stage: c.stage, outcome, receiptPath: relative(root, receiptPath(root, cardId, c.stage, c.revision)), receiptHash: hash(canonical(receipt)) })
    if (c.superseding) {
      // Evidence is never deleted: archive the superseded receipt, then publish; the new event id is receipt-bound.
      const target = path.join(path.dirname(receiptPath(root, cardId, c.stage, c.revision)), 'history', `${c.stage}-${hash(dispatchId)}-${receiptDigest(saved)}.json`)
      if (fs.existsSync(target)) insist(equal(json(root, target), saved), 'Archived receipt scope mismatch')
      else atomicJson(target, saved)
      event.eventId = hash(canonical({ ...c.scope, stage: c.stage, type: 'stage_finished', receiptHash: event.payload.receiptHash }))
    }
    atomicJson(receiptPath(root, cardId, c.stage, c.revision), receipt)
    await appendHarnessEvent(root, event)
    return receipt
  })
}

export function stageContext(root, config, cardId) {
  const c = current(root, config, cardId), task = c.task
  const enabled = config.worker?.driver?.enabled === true
  if (enabled && task?.pendingDispatch) pending(root, config, cardId, task.pendingDispatch.dispatchId)
  const p = enabled ? task?.pendingDispatch : null
  return { enabled, cardId, revision: c.revision, runId: task?.runId ?? '', dispatchId: p?.dispatchId ?? '',
    stage: task?.stage ?? null, activeDir: c.state.activeDir, testLock: c.state.testLock,
    workflow: enabled && task?.workflow?.digest ? validateWorkflowPin(root, task.workflow) : null,
    pendingDispatch: p ? { dispatchId: p.dispatchId, runId: p.runId, revision: normalizeRevision(p.revision), stage: p.stage } : null }
}

export function stageReceiptStatus(root, config, cardId, revision) {
  return Object.fromEntries(stages.map(stage => {
    const receipt = readStageReceipt(root, cardId, stage, revision)
    return [stage, receipt ? { revision: receipt.revision, outcome: receipt.outcome, ...validateStageReceipt(root, config, receipt) } : null]
  }))
}

/** A failed phase setup is a durable truthful receipt, never a repair failure. */
export async function blockStagePreflight(root, config, { cardId, dispatchId, preflight }) {
  const c = pending(root, config, cardId, dispatchId)
  insist(c.stage === 'verify' && preflight?.ok === false, 'Invalid preflight failure')
  const base = `.ff/harness/evidence/${cardId}/${c.revision || 'root'}/${hash(dispatchId)}`
  const logPath = `${base}/preflight.json`
  const report = { ok: false, reason: preflight.reason, checks: preflight.checks }
  atomicJson(path.join(root, logPath), report)
  const evidenceFile = `${base}/preflight-input.json`
  atomicJson(path.join(root, evidenceFile), { ...c.scope, heads: headsNow(root, config, c, false), workflow: validateWorkflowPin(root, c.task.workflow), artifactHashes: { [logPath]: fileHash(root, logPath) }, checks: [], reviewRefs: [] })
  await beginStage(root, config, { cardId, dispatchId })
  return finishStage(root, config, { cardId, dispatchId, outcome: 'environment_blocked', evidenceFile })
}


/** Recognize the hash-bound CLI preflight failure, never a caller readiness flag. */
export function isVerifyPreflightFailure(root, config, receipt) {
  try {
    if (receipt?.stage !== 'verify' || receipt.outcome !== 'environment_blocked' || !validateStageReceipt(root, config, receipt).valid) return false
    const reportPath = `.ff/harness/evidence/${receipt.cardId}/${receipt.revision || 'root'}/${hash(receipt.dispatchId)}/preflight.json`
    if (receipt.artifactHashes[reportPath] !== fileHash(root, reportPath)) return false
    const report = json(root, reportPath)
    return report.ok === false && report.reason === 'setup:e2e'
  } catch { return false }
}

/** Archive before superseding a setup receipt; existing evidence must stay exact. */
export function archiveVerifyPreflightFailure(root, config, receipt) {
  insist(isVerifyPreflightFailure(root, config, receipt), 'Preflight failure is not current')
  const target = path.join(path.dirname(receiptPath(root, receipt.cardId, 'verify', receipt.revision)), 'history', `verify-${hash(receipt.dispatchId)}.json`)
  if (fs.existsSync(target)) insist(equal(json(root, target), receipt), 'Archived failure scope mismatch')
  else atomicJson(target, receipt)
  return relative(root, target)
}
