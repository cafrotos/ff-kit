import { accessHint } from '../../../scripts/lib/access-hint.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { assertHarnessEvent, assertScope, normalizeRevision } from '../../../scripts/lib/harness-contracts.mjs'
import { listHarnessEvents } from '../../../scripts/lib/harness-events.mjs'
import { readStageReceipt, validateStageReceipt, isVerifyPreflightFailure, archiveVerifyPreflightFailure } from '../../../scripts/lib/stage-receipts.mjs'
import { readRunnerBinding, readQuestionHistory } from '../../../scripts/lib/question-history.mjs'
import { APPROVE_LABEL } from '../../../scripts/lib/gates.mjs'
import { updateHarnessTask } from './task-store.mjs'
import { adoptLegacyRepairCycles } from '../../../scripts/lib/repair-cycles.mjs'
import { observeShippedTask, renderShipMilestone } from './ship-watch.mjs'
import { reopenTask } from '../../../scripts/cli/reopen.mjs'
import { safeOutcome } from '../../../scripts/lib/knowledge-log.mjs'
import { preflightStage } from '../../../scripts/lib/doctor.mjs'
import { inspectAdoption, adoptionSummary } from './adopt.mjs'
import { buildStagePrompt } from './tmux-claude-runner.mjs'
import { blockFingerprint, classifyBlock, receiptOriginBlock } from '../../../scripts/lib/human-resolution.mjs'

const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item)
const digest = value => createHash('sha256').update(canonical(value)).digest('hex')
const equal = (a, b) => canonical(a) === canonical(b)
const sameScope = (a, b) => ['cardId', 'revision', 'runId', 'dispatchId'].every(k => a[k] === b[k])
const approved = value => value?.status === 'approved'
const decision = (stage, waitingOn, reason, action = 'stay') => ({ stage, waitingOn, reason, action })
const STARTUP_GRACE_MS = 2 * 60 * 1000
const PLAIN_STOP_GRACE_MS = 2 * 60 * 1000
const normalizeAnswer = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi')
const openQuestions = task => (task.questions ?? []).filter(q => q.status === 'open' && q.revision === task.revision && q.runId === task.runId)
const receiptMatches = (entry, task, state, stage) => entry?.valid === true && entry.receipt?.cardId === task.cardId && entry.receipt.stage === stage && entry.receipt.revision === revisionOf(state, task) && equal(entry.receipt.heads, state.heads)
const revisionOf = (state, task) => normalizeRevision(Object.hasOwn(state, 'activeRevision') ? state.activeRevision : task.revision)
const successful = entry => ['pass', 'no_change'].includes(entry?.receipt?.outcome)
const failureKey = entry => entry?.hash

/** Pure spec 5.1 precedence. Receipt entries are validated saved checkpoints, not schema claims. */
export function nextStage({ state = {}, task, ship, pr = {} }) {
  const current = task.stage
  if (current === 'done') return decision('done', null, 'already_done', 'done')
  if (task.waitingOn === 'stuck') return decision(current, 'stuck', 'wait_preserved')
  const question = openQuestions(task)[0]
  if (question) return decision(current, question.header || 'Q', 'question_pending')
  const derivedWaits = ['GATE_A', 'GATE_B', 'GATE_C', 'acceptance', 'ship_confirm', 'verify_lock']
  if (task.waitingOn && !derivedWaits.includes(task.waitingOn)) return decision(current, task.waitingOn, 'wait_preserved')
  if (['blocked', 'failed'].includes(task.executionStatus)) return decision(current, task.waitingOn || 'needs_human', 'blocked_preserved')
  const revision = revisionOf(state, task)
  const gateDecisions = (task.gateDecisions ?? []).filter(d => d.revision === revision)
  const gateRejected = gate => {
    const answers = gateDecisions.filter(d => d.header === gate)
    return answers.length && answers.at(-1).normalizedValue !== normalizeAnswer(APPROVE_LABEL)
  }
  const active = state.receipts?.[current]
  if (current !== 'verify' && receiptMatches(active, task, state, current) && !successful(active)
    && !(task.consumedFailures ?? []).includes(failureKey(active))) {
    if (active.receipt.outcome === 'environment_blocked') return decision(current, `setup:${current}`, `${current}_environment`)
    return decision(current, 'needs_human', `${current}_${active.receipt.outcome}`)
  }
  const buildEvidence = state.receipts?.build
  const verifyEvidence = state.receipts?.verify
  const approval = task.gateCApproval
  const currentSourceApproval = approval?.revision === revision && equal(approval.heads, state.heads) && approval.verifyReceiptHash === verifyEvidence?.hash
  // N6: Gate C tự qua (auto_passed) cho phép chuyển sang ship mà không cần người duyệt; chấp nhận QA vẫn là của người.
  const gateCOk = (approved(state.gates?.GATE_C) && currentSourceApproval) || state.gates?.GATE_C?.status === 'auto_passed'
  const gateC = gateCOk && !gateRejected('GATE_C') && receiptMatches(buildEvidence, task, state, 'build') && successful(buildEvidence) && buildEvidence.hash !== task.invalidatedBuildHash && receiptMatches(verifyEvidence, task, state, 'verify') && successful(verifyEvidence)
  const feedback = state.gateFeedback
  const gateAnswer = gateDecisions.filter(d => d.header === 'GATE_C').at(-1)
  const classifiedGateRepair = gateRejected('GATE_C') && feedback?.decisionId && feedback.decisionId === gateAnswer?.decisionId && feedback.kind === 'implementation_failed' && feedback.withinApprovedScope === true
  if (gateRejected('GATE_C') && !classifiedGateRepair) return decision(current, 'GATE_C', 'gate_c_requires_human_classification')
  if (classifiedGateRepair && !(task.consumedFailures ?? []).includes(`gate:${feedback.decisionId}`)) {
    if ((task.repairCycles?.[revision] ?? 0) >= (state.maxRepairCycles ?? 3)) return decision(current, 'needs_human', 'repair_limit')
    return decision('build', null, 'gate_c_implementation', 'repair')
  }
  ship = ship && { ...ship, acceptance: task.acceptance ?? ship.acceptance }
  const shipCurrent = ship?.cardId === task.cardId && ship?.revision === revision && equal(ship.heads, state.heads)
  // WRK-12: done_on base_branch|either — thẻ xong khi thay đổi đã vào base_branch (git), không cần PR/forge.
  if (shipCurrent && ship.s1Complete && ['base_branch','either'].includes(ship.doneOn) && !gateRejected('GATE_C') && (ship.repos??[]).length) {
    const rows = ship.repos
    const prMerged = r => ship.doneOn === 'either' && r.requiresPr !== false && pr.repos?.some(p => p.repo === (r.repo ?? r.name) && p.merged === true && p.headAtMerge === state.heads?.[p.repo] && p.approvedSourceHead === state.heads?.[p.repo])
    const landed = r => r.landed?.state === 'merged' || prMerged(r)
    const open = rows.filter(r => !landed(r))
    if (!open.length) return decision('done', null, 'base_branch_landed', 'done')
    const humanOk = ship.acceptance?.source === 'cli' && ship.acceptance.confirmed === true && ship.acceptance.revision === revision && equal(ship.acceptance.heads, state.heads) && (!ship.acceptance.sourceIdentity || ship.acceptance.sourceIdentity === ship.sourceIdentity)
    if (humanOk && open.every(r => r.landed?.state === 'edited')) return decision('done', null, 'landed_edited_confirmed', 'done')
    const names = open.map(r => r.repo ?? r.name).join(',')
    if (open.some(r => r.landed?.state === 'edited')) return decision('acceptance', 'acceptance', `landed_content_differs:${names}`, 'acceptance')
    if (!humanOk && (ship.mode === 'dev_and_pr' || current === 'acceptance')) return decision('acceptance', 'acceptance', `waiting_base_merge:${names}`, 'acceptance')
  }
  if (shipCurrent && ship.s1Complete && ship.mode==='dev_and_pr' && (ship.repos??[]).some(r=>r.s2Status==='blocked:pr_closed')) return decision('acceptance','needs_human','pr_closed_use_fix')
  if (current==='acceptance' && shipCurrent && ship.s1Complete && ship.mode==='dev_and_pr' && !ship.s2Complete) return decision('acceptance','acceptance','pr_observation_pending','acceptance')
  const shipped = shipCurrent && !gateRejected('GATE_C') && ship.s1Complete === true && (ship.mode === 'dev_only' || ship.s2Complete === true)
  if (shipped) {
    if (ship.mode === 'dev_and_pr') {
      const required = (ship.repos ?? []).filter(r => r.requiresPr !== false)
      const merged = required.length > 0 && required.every(r => {
        const p = pr.repos?.find(p => p.repo === (r.repo ?? r.name))
        return p?.merged === true && p.headAtMerge === state.heads?.[r.repo ?? r.name] && p.approvedSourceHead === state.heads?.[r.repo ?? r.name]
      })
      if (merged) return decision('done', null, 'approved_source_merged', 'done')
    } else if (ship.mode === 'dev_only' && ship.acceptance?.source === 'cli' && ship.acceptance.confirmed === true && ship.acceptance.revision === revision && equal(ship.acceptance.heads, state.heads) && (!ship.acceptance.sourceIdentity || ship.acceptance.sourceIdentity === ship.sourceIdentity)) return decision('done', null, 'cli_acceptance', 'done')
    return decision('acceptance', 'acceptance', 'ship_complete', 'acceptance')
  }
  if (gateC) return decision('ship', ship?.blockedReason || 'ship_confirm', 'gate_c_approved', ship?.blockedReason ? 'stay' : 'dispatch')
  const verify = state.receipts?.verify
  const currentFailure = receiptMatches(verify, task, state, 'verify') && !successful(verify) && !(task.consumedFailures ?? []).includes(failureKey(verify))
  if (currentFailure) {
    if (verify.receipt.outcome === 'environment_blocked') return decision(current, 'setup:e2e', 'verify_environment')
    if (verify.receipt.outcome === 'needs_human') return decision(current, 'needs_human', 'verify_decision')
    if (verify.receipt.outcome === 'implementation_failed') {
      if ((task.repairCycles?.[revision] ?? 0) >= (state.maxRepairCycles ?? 3)) return decision(current, 'needs_human', 'repair_limit')
      return decision('build', null, 'verify_implementation', 'repair')
    }
  }
  const ready = state.readyForBuild === true && !gateRejected('GATE_A') && !gateRejected('GATE_B')
  if (ready) {
    const build = state.receipts?.build
    if (receiptMatches(build, task, state, 'build') && successful(build) && build.hash !== task.invalidatedBuildHash) return decision('verify', state.verifyWaitingOn || null, 'build_receipt', state.verifyWaitingOn ? 'stay' : 'dispatch')
    return decision('build', null, 'build_required', 'dispatch')
  }
  return decision('understand', task.waitingOn?.startsWith('GATE_') ? task.waitingOn : null, 'understanding_required', 'dispatch')
}

/** Pure, scoped, idempotent event reducer. Handled identity and effects are one snapshot transaction. */
export function reduceEvent(task, input, observation = {}) {
  let event
  try { event = assertHarnessEvent(input) } catch { return task }
  if (!sameScope(task, event) || (task.handledEventIds ?? []).includes(event.eventId)) return task
  let next = structuredClone(task)
  const p = event.payload
  next.handledEventIds = [...(next.handledEventIds ?? []), event.eventId]
  next.lastProgressAt = !next.lastProgressAt || Date.parse(event.at) > Date.parse(next.lastProgressAt) ? event.at : next.lastProgressAt
  const sticky = () => next.executionStatus === 'blocked' || next.executionStatus === 'failed' || next.waitingOn === 'stuck'
  // Any activity after a plain-text stop (human reply, stage progress, question) ends that wait.
  if (['prompt_submitted', 'stage_started', 'stage_finished', 'question_opened', 'question_answered', 'permission_waiting', 'runner_exited'].includes(event.type)
    && !(event.type === 'prompt_submitted' && p.source === 'worker_rejected') && (next.plainStop || next.waitingOn === 'human_reply')) {
    next.plainStop = null
    if (next.waitingOn === 'human_reply') {
      next.waitingOn = null
      next.executionStatus = ['prompt_submitted', 'stage_started'].includes(event.type) ? 'working' : 'idle'
    }
  }
  if (event.type === 'ship_observed' || event.type === 'reopen_observed') {
    const add = (kind, payload) => { next.pendingEffects.push({kind, eventId:event.eventId, revision:event.revision, sourceIdentity:observation.ship?.sourceIdentity, status:'intent', ...payload}) }
    if (p.reason) add('notify', {reason:p.reason,repo:p.repo,number:p.number})
    else if (event.type === 'reopen_observed') add('reopen', {reason:p.reasonText ?? p.reason ?? 'Trello feedback', commentId:p.commentId})
    else if (observation.ship?.s1Complete===true && p.ship?.sourceIdentity === observation.ship.sourceIdentity && equal(observation.ship.heads, observation.heads)) {
      const ready = observation.ship.mode === 'dev_only' || observation.ship.s2Complete === true
      const milestone = p.milestone ?? 'ready'
      if (milestone === 'ready' && !ready) return next
      const text = renderShipMilestone(observation.ship, milestone, p.repo, p.number)
      if (text) add('comment', {text})
      if (milestone === 'ready' && next.stage !== 'done') add('move', {list:observation.acceptList})
    }
  } else if (event.type === 'human_resolved') {
    // Only the exact block the human saw may be waived; integrity/limit blocks are re-classified here.
    const verdict = classifyBlock(next)
    if (!verdict.ok || p.fingerprint !== blockFingerprint(next)) return next
    const detail = next.blockReason ?? next.waitingOn
    const resolved = { ...next, executionStatus: 'idle', waitingOn: null, blockReason: null,
      history: [...(next.history ?? []), { at: event.at, from: next.stage, to: next.stage, reason: 'human_resolved', detail }] }
    if (verdict.consume) resolved.consumedFailures = [...new Set([...(next.consumedFailures ?? []), verdict.consume])]
    if (verdict.kind === 'stage_retry_limit') resolved.stageRetries = { ...next.stageRetries, [JSON.stringify([next.revision, next.stage])]: 0 }
    if (verdict.kind === 'working_lifetime') {
      Object.assign(resolved, { failureReason: null, workingMs: 0, workingSince: null, noProgressMs: 0, alerts: { ...next.alerts, lifetime: false } })
    }
    return resolved
  } else if (event.type === 'session_started') {
    if (p.status === 'blocked' || p.claudeSessionId !== task.claudeSessionId) {
      next.executionStatus = 'blocked'; next.waitingOn = `setup:${p.reason || 'session_mismatch'}`
    } else if (p.status === 'confirmed' && !sticky()) next.sessionConfirmed = true
  } else if (event.type === 'question_opened' || event.type === 'question_answered') {
    if (!p.questionId) return next
    next.questions ??= []
    const old = next.questions.find(q => q.questionId === p.questionId)
    if (event.type === 'question_answered') {
      const value = { ...old, questionId: p.questionId, header: p.header ?? old?.header ?? 'Q', revision: event.revision, runId: event.runId, dispatchId: event.dispatchId, status: 'answered', decisionId: p.decisionId, normalizedValue: p.normalizedValue }
      if (old) Object.assign(old, value); else next.questions.push(value)
      if (/^GATE_[ABC]$/.test(value.header)) {
        next.gateDecisions ??= []
        next.gateDecisions.push({ ...value, at: event.at })
        next.gateDecisions.sort((a, b) => a.at.localeCompare(b.at) || a.questionId.localeCompare(b.questionId))
      }
    } else if (!old) next.questions.push({ questionId: p.questionId, header: p.header || 'Q', revision: event.revision, runId: event.runId, dispatchId: event.dispatchId, status: 'open' })
    if (!sticky() && !next.permissionSince) {
      const q = openQuestions(next)[0]
      next.waitingOn = q?.header || null; next.executionStatus = q ? 'waiting_human' : 'idle'
    }
  } else if (event.type === 'permission_waiting' && !sticky()) {
    next.waitingOn = 'permission'; next.permissionSince = event.at; next.executionStatus = 'waiting_human'
  } else if (event.type === 'runner_idle' && !sticky() && !openQuestions(next).length) {
    if (next.permissionSince && Date.parse(event.at) <= Date.parse(next.permissionSince)) return next
    if (next.permissionSince) { next.permissionSince = null; if (next.waitingOn === 'permission') next.waitingOn = null }
    if (!next.pendingDispatch || next.dispatchState === 'finished') next.executionStatus = 'idle'
    else if (next.dispatchState === 'started') next.plainStop = { eventId: event.eventId, at: event.at }
  } else if (event.type === 'runner_exited' && !sticky()) next.executionStatus = 'exited'
  else if (event.type === 'stage_started' && p.stage === next.stage && next.pendingDispatch && !sticky()) {
    next.dispatchState = 'started'; next.executionStatus = 'working'
  } else if (event.type === 'stage_finished' && p.stage === next.stage && next.pendingDispatch) {
    const entry = observation.receipts?.[p.stage]
    if (receiptMatches(entry, next, { ...observation, activeRevision: next.revision }, p.stage) && sameScope(entry.receipt, event) && entry.hash === p.receiptHash && entry.receipt.outcome === p.outcome) {
      next.pendingDispatch = null; next.dispatchState = 'finished'
      next.completedReceipt = { stage: p.stage, outcome: p.outcome, receiptHash: entry.hash, at: entry.receipt.at }
      next.stageRetries = { ...next.stageRetries, [JSON.stringify([next.revision, next.stage])]: 0 }
      next.pendingEffects = (next.pendingEffects ?? []).filter(e => e.kind !== 'dispatch')
      if (!sticky()) next.executionStatus = openQuestions(next).length || next.waitingOn ? 'waiting_human' : 'idle'
    }
  }
  return next
}

/**
 * Plain-text stop: the agent ended its turn (Stop hook) mid-dispatch with no open question and no
 * further activity, i.e. it asked the human in plain text. After a grace period, wait for a human
 * (once, with one notification). The next prompt/stage activity clears it in reduceEvent.
 */
export function applyPlainTextStop(task, at, graceMs = PLAIN_STOP_GRACE_MS) {
  const stop = task.plainStop
  if (!stop || stop.flagged || !task.pendingDispatch || task.dispatchState !== 'started') return task
  if (['blocked', 'failed'].includes(task.executionStatus) || task.waitingOn || task.permissionSince || openQuestions(task).length) return task
  if (!(Date.parse(at) - Date.parse(stop.at) >= graceMs)) return task
  return { ...task, waitingOn: 'human_reply', executionStatus: 'waiting_human', plainStop: { ...stop, flagged: true },
    pendingEffects: [...(task.pendingEffects ?? []), { kind: 'notify', eventId: `plain-stop:${stop.eventId}`, revision: task.revision, reason: 'human_reply', status: 'intent' }],
    history: [...(task.history ?? []), { at, from: task.stage, to: task.stage, reason: 'plain_text_stop' }] }
}

/**
 * Evidence-based resume (no human command): a block caused by the failed receipt of the
 * current dispatch ends when a newer, valid, current and successful receipt of the same
 * dispatch supersedes it. Limit, identity and setup blocks never qualify.
 */
export function resumeFromEvidence(task, state, at) {
  const origin = receiptOriginBlock(task)
  const entry = state.receipts?.[task.stage]
  if (!origin || !receiptMatches(entry, task, state, task.stage) || !successful(entry)) return task
  const done = task.completedReceipt
  if (entry.receipt.runId !== task.runId || entry.receipt.dispatchId !== task.dispatchId || entry.hash === origin.receiptHash
    || entry.receipt.revision !== task.revision || (done.at && !(Date.parse(entry.receipt.at) > Date.parse(done.at)))) return task
  return { ...task, executionStatus: 'idle', waitingOn: null, blockReason: null,
    completedReceipt: { stage: task.stage, outcome: entry.receipt.outcome, receiptHash: entry.hash, at: entry.receipt.at },
    history: [...(task.history ?? []), { at, from: task.stage, to: task.stage, reason: 'evidence_resume', receiptHash: entry.hash }] }
}

function receipts(root, config, task) {
  return Object.fromEntries(['understand', 'build', 'verify', 'ship'].map(stage => {
    const receipt = readStageReceipt(root, task.cardId, stage, task.revision)
    return [stage, receipt ? { receipt, ...validateStageReceipt(root, config, receipt), hash: digest(receipt) } : null]
  }))
}

// The CLI decision append is durable before answer events or Gate application. Read it
// in append order so an interrupted/reordered hook cannot resurrect older approval.
function humanEvidence(root, task) {
  let decisions = []
  try { decisions = fs.readFileSync(path.join(root, '.ff/decisions.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const current = decisions.filter(d => d.cardId === task.cardId && d.revision === task.revision).map(d => {
    assertScope(d)
    if (d.provenance?.source !== 'cli' || typeof d.questionId !== 'string' || typeof d.decisionId !== 'string' || typeof d.normalizedValue !== 'string') throw new Error('Invalid durable CLI decision')
    return d
  })
  return { decisions: current, questions: readQuestionHistory(root, task.cardId).filter(q => q.revision === task.revision && q.runId === task.runId) }
}
function reconcileHuman(task, evidence) {
  const next = { ...task, questions: [...(task.questions ?? [])], gateDecisions: [...(task.gateDecisions ?? [])] }
  for (const q of evidence.questions) {
    const answer = evidence.decisions.find(d => d.questionId === q.questionId)
    const old = next.questions.find(v => v.questionId === q.questionId)
    const row = { questionId: q.questionId, header: q.header, revision: q.revision, runId: q.runId, dispatchId: q.dispatchId, status: answer || old?.status === 'answered' ? 'answered' : q.status }
    next.questions = [...next.questions.filter(v => v.questionId !== q.questionId), row]
  }
  for (const d of evidence.decisions) {
    const header = d.snapshot?.header ?? d.header
    if (!/^GATE_[ABC]$/.test(header) || d.snapshot?.question?.match(/^\s*\[#([A-Za-z0-9]+)\]/)?.[1] !== task.cardId) continue
    next.gateDecisions = [...next.gateDecisions.filter(v => v.questionId !== d.questionId), { questionId: d.questionId, decisionId: d.decisionId, header, revision: d.revision, runId: d.runId, dispatchId: d.dispatchId, normalizedValue: d.normalizedValue, at: d.answeredAt }]
  }
  if (!['blocked', 'failed'].includes(next.executionStatus) && next.waitingOn !== 'stuck' && !next.permissionSince) {
    const question = openQuestions(next)[0]
    if (question) { next.waitingOn = question.header || 'Q'; next.executionStatus = 'waiting_human' }
    else if ((task.questions ?? []).some(q => q.status === 'open' && q.header === task.waitingOn)) { next.waitingOn = null; next.executionStatus = 'idle' }
  }
  return next
}

function reconcileReceipt(task, state) {
  const entry = state.receipts?.[task.stage]
  if (!task.pendingDispatch || !receiptMatches(entry, task, state, task.stage) || !sameScope(entry.receipt, task)) return task
  // The validated immutable saved receipt is itself the durable completion checkpoint.
  return reduceEvent(task, { eventId: `receipt:${entry.hash}`, cardId: task.cardId, revision: task.revision, runId: task.runId, dispatchId: task.dispatchId, type: 'stage_finished', at: entry.receipt.at, payload: { stage: task.stage, outcome: entry.receipt.outcome, receiptHash: entry.hash } }, state)
}
function bindGateCApproval(task, state) {
  const answer = (task.gateDecisions ?? []).filter(d => d.revision === task.revision && d.header === 'GATE_C').at(-1)
  if (!answer || task.gateCApproval?.decisionId === answer.decisionId || answer.normalizedValue !== normalizeAnswer(APPROVE_LABEL) || !approved(state.gates?.GATE_C)) return task
  const verify = state.receipts?.verify, build = state.receipts?.build
  if (!receiptMatches(verify, task, state, 'verify') || !successful(verify) || !receiptMatches(build, task, state, 'build') || !successful(build) || verify.receipt.runId !== answer.runId || verify.receipt.dispatchId !== answer.dispatchId) return task
  return { ...task, gateCApproval: { decisionId: answer.decisionId, revision: task.revision, heads: structuredClone(state.heads), verifyReceiptHash: verify.hash } }
}

/** Recover only a finished, current CLI setup failure after independent checks. */
async function recoverVerifySetup({ root, config, task, state, runner, save, at }) {
  const entry = state.receipts?.verify
  const eligible = current => current.stage === 'verify' && current.executionStatus === 'blocked' && current.waitingOn === 'setup:e2e'
    && !current.pendingDispatch && current.dispatchState === 'finished' && !current.permissionSince && !openQuestions(current).length
    && entry?.valid && sameScope(current, entry.receipt) && equal(entry.receipt.heads, state.heads)
    && current.completedReceipt?.receiptHash === entry.hash && !(current.consumedFailures ?? []).includes(entry.hash)
    && !(current.pendingEffects ?? []).some(effect => ['launch', 'resume', 'dispatch'].includes(effect.kind) && effect.status === 'unknown')
  const confirmed = current => {
    const binding = readRunnerBinding(root, current.runId)
    return binding?.status === 'confirmed' && binding.cardId === current.cardId && binding.runId === current.runId && binding.claudeSessionId === current.claudeSessionId
  }
  if (!runner || !eligible(task) || !confirmed(task) || !isVerifyPreflightFailure(root, config, entry.receipt)) return task
  const observed = await runner.inspect(task)
  if (observed.runId !== task.runId || observed.claudeSessionId !== task.claudeSessionId || observed.launchStatus !== 'established' || observed.dispatchStatus !== 'finished'
    || !['waiting_human', 'idle'].includes(observed.status)) return task
  let preflight
  try { preflight = preflightStage(root, config, { stage: 'verify' }) } catch { return task }
  if (!preflight.ok) return task
  return save(current => {
    // Runner inspection awaited I/O. Recheck source, pin, failed receipt and
    // confirmed identity inside the CAS; no cached observation grants recovery.
    const reconciled = reconcileHuman(current, humanEvidence(root, current))
    const build = state.receipts?.build
    if (!eligible(reconciled) || !confirmed(reconciled) || !isVerifyPreflightFailure(root, config, entry.receipt)
      || !receiptMatches(build, reconciled, state, 'build') || !successful(build) || !validateStageReceipt(root, config, build.receipt).valid) return current
    const recovered = { ...reconciled, waitingOn: null, executionStatus: 'idle', consumedFailures: [...(current.consumedFailures ?? []), entry.hash] }
    const plan = nextStage({ state, task: recovered })
    if (plan.stage !== 'verify' || (plan.action !== 'dispatch' && plan.waitingOn !== 'verify_lock')) return current
    const archivePath = archiveVerifyPreflightFailure(root, config, entry.receipt)
    return { ...recovered, setupRecoveries: [...(current.setupRecoveries ?? []), { failureHash: entry.hash, revision: current.revision, runId: current.runId, dispatchId: current.dispatchId, heads: entry.receipt.heads, workflow: entry.receipt.workflow, archivePath, at }] }
  })
}

/** Driver writes intents before side effects; runtime owns scheduling and supplies fresh inspected evidence. */
export async function driveTask(args) {
  let task = await driveTaskInternal(args)
  const { root, config, observation = {} } = args
  const at = new Date(typeof args.now === 'function' ? args.now() : args.now ?? Date.now()).toISOString()
  task = await updateHarnessTask(root, task.cardId, task.stateVersion, current => {
    const next = { ...current, pendingEffects: [...current.pendingEffects] }
    const ship = observation.ship
    const valid = (!observation.validateShip || observation.validateShip() === true)
      && ship?.cardId === current.cardId && ship.revision === current.revision && ship.sourceIdentity
      && equal(ship.heads, observation.heads ?? observation.state?.heads ?? observation.inspectCard?.heads)
    // A prior local terminal transition may predate the final intent. Re-prove
    // completion from current scoped delivery evidence before repairing it.
    if (current.stage === 'done' && valid && nextStage({task:{...current,stage:'acceptance',waitingOn:null,executionStatus:'idle'},state:{heads:ship.heads},ship,pr:observation.pr}).action === 'done') {
      const eventId = `done:${digest([current.cardId,current.revision,ship.sourceIdentity,ship.heads])}`
      if (!next.pendingEffects.some(e => e.eventId === eventId)) next.pendingEffects.push({kind:'move',eventId,revision:current.revision,sourceIdentity:ship.sourceIdentity,list:observation.doneList ?? config.worker.task_source?.trello?.done_list,status:'intent'})
    }
    const reason = current.waitingOn === 'stuck' ? 'stuck' : current.failureReason === 'working_lifetime' && current.executionStatus === 'blocked' ? 'lifetime'
      : current.executionStatus === 'blocked' && (current.waitingOn === 'needs_human' || /^setup:[a-z0-9_:-]{1,80}$/i.test(current.waitingOn ?? '')) ? current.waitingOn : null
    // Chờ khởi động (session_unconfirmed/runner_unproven) thường tự hết; chỉ báo khi kẹt quá STARTUP_GRACE_MS
    // tính từ lần launch/resume gần nhất trong pendingEffects (fallback lastProgressAt), vd. Claude kẹt ở hộp thoại "trust this folder".
    const startup = ['setup:session_unconfirmed','setup:runner_unproven'].includes(reason)
    const startedAt = Math.max(...[...current.pendingEffects.filter(e => ['launch','resume'].includes(e.kind)).map(e => e.at), current.lastProgressAt].map(Date.parse).filter(Number.isFinite))
    if (reason && (!startup || Number.isFinite(startedAt) && Date.parse(at) - startedAt > STARTUP_GRACE_MS)) {
      const detail = /^[a-z0-9_:-]{1,80}$/i.test(current.blockReason ?? '') ? current.blockReason : reason
      const eventId = `attention:${digest([current.cardId,current.revision,current.runId,current.stage,reason,detail])}`
      if (!next.pendingEffects.some(e => e.eventId === eventId)) next.pendingEffects.push({kind:'notify',eventId,revision:current.revision,reason,detail,attention:true,...(startup?{startup:true}:{}),status:'intent'})
    }
    if ((current.waitingOn && current.waitingOn !== 'ship_confirm') || ['blocked','failed'].includes(current.executionStatus) || current.stage === 'done') {
      next.workingReserved = false; next.reservationEpoch = null; next.reservationAt = null; next.workingSince = null
      if (next.clockCheckpoint) next.clockCheckpoint = {...next.clockCheckpoint,verifiedWorking:false}
    }
    return next
  })
  return performLifecycleEffects({root,config,task,observation,at})
}

async function driveTaskInternal({ root, config, task, observation = {}, runner, now = Date.now }) {
  if (config.worker?.driver?.enabled !== true) throw new Error('Harness driver is disabled')
  const at = new Date(typeof now === 'function' ? now() : now).toISOString()
  const options = config.worker.driver
  if (!task.stateVersion) {
    const card = observation.discovery
    if (!card || card.cardId !== task.cardId) throw new Error('New harness task requires discovery')
    // Thẻ làm tay/phiên bản cũ: nhận trạng thái từ thư mục thẻ (không tạo duyệt), thay vì bắt đầu lại từ revision gốc.
    const adoption = inspectAdoption(root, config, task.cardId)
    const adopted = adoption?.adopted ? { ...adoption, at, source: 'card_dir' } : null
    const revision = adopted?.revision ?? ''
    task = await updateHarnessTask(root, task.cardId, 0, () => ({
      cardId: task.cardId, trelloCardId: card.trelloCardId, slug: card.slug, runId: randomUUID(), revision, dispatchId: '',
      stage: adopted?.stage ?? 'understand', waitingOn: null, executionStatus: 'idle', pendingDispatch: null, tmuxSession: null, claudeSessionId: null,
      workflow: observation.workflow, questions: [], handledEventIds: [], stageRetries: {}, repairCycles: { '': 0, ...(revision ? { [revision]: 0 } : {}), ...adoptLegacyRepairCycles(root, task.cardId) },
      workingMs: 0, workingSince: null, lastProgressAt: at,
      history: adopted ? [{ at, from: '', to: adopted.stage, reason: 'adopted', detail: adoptionSummary(adopted) }] : [],
      pendingEffects: adopted ? [{ kind: 'notify', eventId: `adopted:${task.cardId}:${revision || 'root'}`, revision, reason: 'adopted', detail: adoptionSummary(adopted), status: 'intent' }] : [],
      ...(adopted ? { adoption: adopted } : {}),
    }))
  }
  // blockReason is only meaningful while blocked; never let it outlive the block (human-resolution reads it).
  const clearStaleBlock = value => value && value.executionStatus !== 'blocked' && value.blockReason ? { ...value, blockReason: null } : value
  const save = reduce => updateHarnessTask(root, task.cardId, task.stateVersion ?? 0, current => clearStaleBlock(reduce(current ?? task)))
  const state = { ...(observation.state ?? observation.inspectCard ?? {}), heads: observation.heads ?? observation.state?.heads ?? observation.inspectCard?.heads, maxRepairCycles: options.max_repair_cycles ?? 3 }
  const revision = revisionOf(state, task)
  const changedRevision = revision !== task.revision
  if (changedRevision) {
    // A renamed revision can be visible before its event is durable. Recover
    // the old operation before the revision CAS drops its only replay intent.
    for (const effect of task.pendingEffects ?? []) {
      if (effect.kind === 'reopen' && effect.revision === task.revision && effect.status !== 'done') {
        await reopenTask({root,config,id:task.cardId,reason:effect.reason,eventId:effect.eventId,recoverOnly:true})
      }
    }
    task = await save(current => ({ ...current, revision, dispatchId: '', pendingDispatch: null, pendingEffects: [], stage: 'understand', waitingOn: null, executionStatus: 'idle', acceptance:null, shipView:null, prView:null, questions: [], repairCycles: { ...current.repairCycles, [revision]: 0 }, consumedFailures: [], invalidatedBuildHash: null, history: [...current.history, { at, from: current.stage, to: 'understand', reason: 'revision_changed' }] }))
  }
  state.receipts = receipts(root, config, task)
  const binding = observation.binding ?? readRunnerBinding(root, task.runId)
  const lifecycleScopeValid=()=>!observation.validateShip||observation.validateShip()===true
  let lifecycle = await observeShippedTask({task,ship:observation.ship,source:observation.source,now:()=>Date.parse(at),reopenList:observation.reopenList,maxReopen:config.ship?.max_reopen??3})
  if(!lifecycleScopeValid()) lifecycle=[]
  const events = [...lifecycle, ...listHarnessEvents(root, task.cardId), ...(observation.events ?? [])].sort((a, b) => a.at.localeCompare(b.at) || a.eventId.localeCompare(b.eventId))
  const human = humanEvidence(root, task)
  task = await save(current => {
    let next = current
    for (const event of events) next = reduceEvent(next, event, {...state,ship:observation.ship,acceptList:observation.acceptList})
    next = reconcileHuman(next, human)
    const acceptance = human.decisions.filter(d => d.header === 'ACCEPTANCE' && d.provenance?.source === 'cli').at(-1)
    const bound = acceptance?.decisionContext?.acceptanceBinding
    if (bound && lifecycleScopeValid() && (observation.ship?.mode === 'dev_only' || ['base_branch','either'].includes(observation.ship?.doneOn)) && observation.ship.s1Complete && bound.sourceIdentity === observation.ship.sourceIdentity && bound.revision === next.revision && equal(bound.heads, state.heads)) next.acceptance = acceptance.normalizedValue!==normalizeAnswer(APPROVE_LABEL)?null:{source:'cli',confirmed:true,revision:bound.revision,heads:bound.heads,sourceIdentity:bound.sourceIdentity,decisionId:acceptance.decisionId}

    if(lifecycleScopeValid() && observation.ship?.revision===next.revision && observation.ship.sourceIdentity && equal(observation.ship.heads,state.heads)){
      next.shipView=observation.ship
      next.prView={repos:(observation.ship.repos??[]).filter(r=>r.pr).map(r=>({repo:r.repo,approvedSourceHead:r.approvedSourceHead,...r.pr,state:r.pr.merged?'merged':'open'}))}
    }
    next = reconcileReceipt(next, state)
    next = resumeFromEvidence(next, state, at)
    next = applyPlainTextStop(next, at, options.plain_stop_grace_ms ?? PLAIN_STOP_GRACE_MS)
    next = bindGateCApproval(next, state)
    next = applyAccounting(next, observation.accounting, config, at)
    next = applyControl(next, observation.control, at)
    if (binding?.status === 'blocked') next = { ...next, executionStatus: 'blocked', waitingOn: `setup:${binding.reason || 'session_mismatch'}` }
    return next
  })
  task = await performLifecycleEffects({root,config,task,observation,at})
  task = await recoverVerifySetup({root,config,task,state,runner,save,at})
  // A launched process may return before its asynchronous SessionStart hook.
  // Reinspect this narrow wait before the normal sticky-wait gate; only the
  // runner's matching binding, later idle event and empty live pane can clear it.
  if (runner && task.executionStatus === 'blocked' && (task.waitingOn === 'setup:runner_unproven' || task.waitingOn === 'setup:session_unconfirmed' && task.pendingEffects?.some(e => ['launch', 'resume'].includes(e.kind)))) {
    const startup = await runner.inspect(task)
    const confirmed = binding?.status === 'confirmed' && binding.cardId === task.cardId && binding.claudeSessionId === task.claudeSessionId
    if (confirmed && startup.status === 'idle' && startup.inputEmpty === true && startup.launchStatus === 'established' && startup.runId === task.runId && startup.claudeSessionId === task.claudeSessionId) {
      task = await save(current => applyRunner({ ...current, executionStatus: 'idle', waitingOn: null, sessionConfirmed: true }, startup, at))
    } else if (startup.status === 'blocked' && !['session_unconfirmed', 'runner_unproven'].includes(startup.reason)) {
      task = await save(current => applyRunner({ ...current, executionStatus: 'idle' }, startup, at))
    }
  }
  let plan = nextStage({ state, task, ship: lifecycleScopeValid()?observation.ship:undefined, pr: observation.pr })
  // KNW-05: thẻ kết thúc (WRK-10/12) là kết quả thật; idempotent theo (thẻ, revision, outcome) nên lặp tick vô hại.
  if (plan.action === 'done' && task.stage !== 'done' && lifecycleScopeValid()) {
    if (['base_branch_landed', 'landed_edited_confirmed', 'approved_source_merged'].includes(plan.reason)) await safeOutcome(root, {cardId: task.cardId, revision: task.revision ?? '', outcome: 'merged', source: plan.reason})
    await safeOutcome(root, {cardId: task.cardId, revision: task.revision ?? '', outcome: 'done', source: plan.reason})
  }
  const updatePlan = current => {
    if (plan.action === 'done' && current.stage !== 'done' && !lifecycleScopeValid()) return {...current,waitingOn:'acceptance',executionStatus:'waiting_human'}
    const blocked = plan.waitingOn?.startsWith('setup:') || plan.waitingOn === 'needs_human'
    const blockReason = blocked && !['wait_preserved','blocked_preserved'].includes(plan.reason) ? plan.reason : current.blockReason
    const executionStatus = plan.action === 'done' ? 'idle'
      : ['stay','acceptance'].includes(plan.action) ? blocked ? 'blocked' : plan.waitingOn ? 'waiting_human' : current.executionStatus : 'idle'
    return { ...current, blockReason, stage:plan.stage, waitingOn:plan.waitingOn, executionStatus,
      history: plan.stage === current.stage ? current.history : [...current.history,{at,from:current.stage,to:plan.stage,reason:plan.reason}],
    }
  }
  if (plan.action === 'stay' || plan.action === 'acceptance' || plan.action === 'done') return save(updatePlan)
  // A Gate wait is derived from an open question. Once the plan no longer waits, clear it here:
  // the scheduler skips any task with waitingOn and the runner reports waiting_human on it.
  if (['GATE_A', 'GATE_B', 'GATE_C'].includes(task.waitingOn) && !plan.waitingOn && !openQuestions(task).length) {
    task = await save(current => current.waitingOn === task.waitingOn ? { ...current, waitingOn: null } : current)
  }
  if (observation.allowEffects === false) {
    // A released verify lock resumes eligibility, never dispatches here. No
    // missing/invalid build checkpoint can redirect this wait to understand.
    if (task.waitingOn === 'verify_lock' && plan.stage === 'verify' && plan.action === 'dispatch') return save(updatePlan)
    return task
  }
  // A scheduler reservation is durable before launch/resume/send. The scheduler
  // serializes the capacity decision and supplies this typed control.
  if (observation.control && task.workingReserved !== true) return task
  if (!runner) throw new Error('Driver requires runner for effects')
  if (!task.claudeSessionId) {
    task = await save(current => ({ ...current, claudeSessionId: randomUUID(), tmuxSession: current.tmuxSession ?? `${config.worker.tmux?.session_prefix ?? 'ff-'}${current.cardId}`, pendingEffects: [...current.pendingEffects, { kind: 'launch', status: 'intent', runId: current.runId, at }] }))
    try {
      const result = await runner.start(task)
      return save(current => applyRunner(current, result, at))
    } catch { return save(current => ({ ...current, waitingOn: 'setup:launch_unknown', executionStatus: 'blocked' })) }
  }
  // Existing intent is always reconciled first. Ambiguous delivery never creates another dispatch.
  let observed = await runner.inspect(task)
  if (task.pendingEffects?.some(e => e.kind === 'launch')) {
    if (observed.status === 'exited' && observed.launchStatus === 'unattempted') {
      try { const result = await runner.start(task); return await save(current => applyRunner(current, result, at)) } catch { return save(current => applyRunner(current, { status: 'blocked', reason: 'launch_unknown' }, at)) }
    }
    if (observed.status === 'blocked' || observed.launchStatus !== 'established') return save(current => applyRunner(current, { ...observed, status: 'blocked', reason: observed.reason || 'launch_unknown' }, at))
    task = await save(current => ({ ...current, pendingEffects: current.pendingEffects.filter(e => e.kind !== 'launch') }))
  }
  if (observed.status === 'blocked') return save(current => applyRunner(current, observed, at))
  if (observed.status === 'exited' && !task.pendingEffects?.some(e => e.kind === 'resume')) {
    task = await save(current => ({ ...current, pendingEffects: [...current.pendingEffects, { kind: 'resume', status: 'intent', runId: current.runId, at }] }))
    try {
      const result = await runner.resume(task)
      return await save(current => applyRunner(current, result, at))
    } catch { return save(current => ({ ...current, executionStatus: 'blocked', waitingOn: 'setup:resume_unknown' })) }
  }
  if (task.pendingDispatch) {
    if (observed.dispatchStatus !== 'prepared' || task.dispatchState === 'unknown') return task
  } else {
    if (observed.status !== 'idle' || observed.inputEmpty !== true) return task
    const pending = { runId: task.runId, revision: task.revision, dispatchId: randomUUID(), stage: plan.stage }
    task = await save(current => {
      const next = updatePlan(current)
      if (plan.action === 'repair') {
        next.repairCycles = { ...current.repairCycles, [revision]: (current.repairCycles?.[revision] ?? 0) + 1 }
        next.consumedFailures = [...(current.consumedFailures ?? []), plan.reason === 'gate_c_implementation' ? `gate:${state.gateFeedback.decisionId}` : failureKey(state.receipts.verify)]
        next.invalidatedBuildHash = state.receipts.build?.hash ?? null
      }
      return { ...next, waitingOn: null, dispatchId: pending.dispatchId, pendingDispatch: pending, dispatchState: 'prepared', pendingEffects: [...current.pendingEffects, { kind: 'dispatch', status: 'intent', ...pending, at }] }
    })
    observed = await runner.inspect(task)
  }
  if (observed.status === 'blocked') return save(current => applyRunner(current, observed, at))
  if (observed.status !== 'idle' || observed.inputEmpty !== true || observed.dispatchStatus !== 'prepared') return task
  const retryKey = JSON.stringify([task.revision, task.stage])
  if ((task.stageRetries?.[retryKey] ?? 0) >= (options.max_stage_retries ?? 3)) return save(current => ({ ...current, executionStatus: 'blocked', waitingOn: 'needs_human', blockReason: 'stage_retry_limit' }))
  task = await save(current => ({ ...current, stageRetries: { ...current.stageRetries, [retryKey]: (current.stageRetries?.[retryKey] ?? 0) + 1 } }))
  try {
    const result = await runner.sendStage(task, { stage: task.stage, dispatchId: task.dispatchId, prompt: buildStagePrompt(task) })
    return save(current => applyRunner(current, result, at))
  } catch {
    return save(current => ({ ...current, dispatchState: 'unknown', executionStatus: 'blocked', waitingOn: 'setup:dispatch_unknown', blockReason: 'dispatch_unknown' }))
  }
}

function applyRunner(task, result, at) {
  if (result.runId && result.runId !== task.runId) return task
  if (result.claudeSessionId && result.claudeSessionId !== task.claudeSessionId) return { ...task, executionStatus: 'blocked', waitingOn: 'setup:session_mismatch' }
  if (task.executionStatus === 'blocked' || task.executionStatus === 'failed') return task
  const next = { ...task, runnerObservation: { status: result.status, inputEmpty: result.inputEmpty === true, dispatchStatus: result.dispatchStatus, heartbeatAt: result.heartbeatAt ?? null, reason: /^[a-z0-9_:-]{1,80}$/i.test(result.reason ?? '') ? result.reason : null, at } }
  if (result.status === 'blocked') {
    const reason = next.runnerObservation.reason || 'runner_blocked'
    next.blockReason = reason
    next.executionStatus = 'blocked'; next.waitingOn = reason.startsWith('setup:') || reason === 'needs_human' ? reason : `setup:${reason}`
  }
  if (['idle', 'working', 'waiting_human'].includes(result.status)) next.pendingEffects = (task.pendingEffects ?? []).filter(e => !['launch', 'resume'].includes(e.kind))
  if (['sent', 'started', 'unknown'].includes(result.dispatchStatus)) next.dispatchState = result.dispatchStatus
  if (result.status !== 'blocked' && ['sent', 'started'].includes(result.dispatchStatus)) next.executionStatus = 'working'
  return next
}


function applyControl(task, control, at) {
  if (!control) return task
  if (control.kind !== 'slot' || typeof control.reserved !== 'boolean' || typeof control.epoch !== 'string' || !control.epoch) throw new TypeError('Invalid scheduler control')
  const reserved = control.reserved && (!task.waitingOn || task.waitingOn === 'ship_confirm') && !['blocked', 'failed'].includes(task.executionStatus) && task.stage !== 'done'
  return { ...task, workingReserved: reserved, reservationEpoch: reserved ? control.epoch : null, reservationAt: reserved ? at : null }
}

function applyAccounting(task, checkpoint, config, at) {
  if (!checkpoint) return task
  if (checkpoint.kind !== 'checkpoint' || typeof checkpoint.epoch !== 'string' || !checkpoint.epoch || typeof checkpoint.verifiedWorking !== 'boolean' || !Number.isFinite(Date.parse(checkpoint.at)) || checkpoint.at !== at) throw new TypeError('Invalid accounting checkpoint')
  const prior = task.clockCheckpoint
  const currentMs = Date.parse(at)
  const previousMs = Date.parse(prior?.at)
  // Only contiguous, independently verified observations in this daemon epoch
  // establish working time. A restart never charges its unobserved interval.
  const working = checkpoint.verifiedWorking && task.executionStatus === 'working' && !task.waitingOn
  const elapsed = working && prior?.verifiedWorking && prior.epoch === checkpoint.epoch && currentMs > previousMs ? currentMs - previousMs : 0
  const workingMs = (task.workingMs ?? 0) + elapsed
  const alerts = { ...task.alerts }
  const lifetime = workingMs >= (config.worker.tmux?.max_session_lifetime_hours ?? 24) * 3600000
  const progressMs = Date.parse(task.lastProgressAt ?? at)
  // Stuck is based on verified active duration, so daemon/Gate downtime cannot
  // accidentally create a stuck alert on resume.
  const progressChanged = task.clockProgressAt !== task.lastProgressAt
  const noProgressMs = progressChanged ? 0 : (task.noProgressMs ?? 0) + elapsed
  if (working && noProgressMs >= (config.worker.driver.stuck_after_minutes ?? 90) * 60000 && Number.isFinite(progressMs)) alerts.stuck = true
  const stuck = working && alerts.stuck === true
  if (lifetime) alerts.lifetime = true
  return { ...task, workingMs, noProgressMs, clockProgressAt: task.lastProgressAt, alerts,
    clockCheckpoint: { ...checkpoint, verifiedWorking: working && !lifetime && !stuck, at: prior?.epoch === checkpoint.epoch && previousMs > currentMs ? prior.at : at },
    workingSince: working && !lifetime && !stuck ? task.workingSince ?? at : null,
    ...(stuck ? { executionStatus: 'waiting_human', waitingOn: 'stuck', workingReserved: false, reservationEpoch: null, reservationAt: null } : {}),
    ...(lifetime ? { executionStatus: 'blocked', waitingOn: 'needs_human', workingReserved: false, failureReason: 'working_lifetime' } : {}),
  }
}

async function performLifecycleEffects({root,config,task,observation,at}) {
 const save=reduce=>updateHarnessTask(root,task.cardId,task.stateVersion,reduce)
 const source=observation.source,id=task.trelloCardId??task.cardId
 for(const effect of task.pendingEffects.filter(e=>['move','comment','notify','reopen'].includes(e.kind))) {
   if(effect.status==='done'||effect.kind==='notify'&&effect.status==='unknown')continue
   if((effect.revision!==undefined&&effect.revision!==task.revision)||(effect.sourceIdentity&&effect.sourceIdentity!==observation.ship?.sourceIdentity))continue
   if(!source&&effect.kind!=='notify')continue
   try {
     if(effect.sourceIdentity && observation.validateShip && !observation.validateShip())continue
     if(effect.kind==='move') {
       if(task.stage==='done' && !effect.eventId.startsWith('done:'))continue
       if(!effect.list||!source.observeCard)continue
       const card=await source.observeCard(id)
       if(effect.sourceIdentity && observation.validateShip && !observation.validateShip())continue
       const currentList=String(card.list ?? "").trim().toLowerCase()
       const waitingForFeedback=effect.list===observation.acceptList && currentList===observation.reopenList?.trim().toLowerCase()
       if(!waitingForFeedback && currentList!==effect.list.trim().toLowerCase())await source.moveTo(id,effect.list)
     } else if(effect.kind==='comment') {
       if(!source.findComment||!source.comment)continue
       const found=await source.findComment(id,effect.eventId)
       if(effect.sourceIdentity && observation.validateShip && !observation.validateShip())continue
       if(!found)await source.comment(id,`[ff] ${effect.eventId} ${effect.text}`)
     } else if(effect.kind==='notify') {
       if(!observation.channel?.notify)continue
       // The channel has no idempotent delivery/lookup contract. Claim unknown
       // before sending for at-most-once delivery; preserve uncertainty on error
       // or crash rather than falsely recording success or sending duplicates.
       task=await save(current=>({...current,pendingEffects:current.pendingEffects.map(e=>e.eventId===effect.eventId&&e.kind===effect.kind?{...e,status:'unknown'}:e)}))
       await observation.channel.notify({kind:'attention',taskId:task.cardId,title:(effect.startup||effect.attention||effect.reason==='human_reply')&&observation.setupDialog?.(task)?'Phiên Claude đang mở hộp thoại "auto-mode setup" (không thuộc việc của thẻ): attach tmux, chọn Discard and exit / Esc rồi nhắc agent làm tiếp; không lưu cấu hình':effect.startup&&observation.trustDialog?.(task)?'Phiên Claude đang chờ bạn tin thư mục: attach tmux, chọn "Yes, I trust this folder" rồi Enter; thẻ tự chạy tiếp, không cần ff worker resolve':effect.startup?'Phiên Claude chưa khởi động xong: attach tmux và kiểm tra hộp thoại trust/permission':effect.attention?'Task cần người kiểm tra; xử lý tại CLI':effect.reason==='adopted'?`Nhận thẻ có sẵn vào luồng chuẩn: ${effect.detail}`:effect.reason==='human_reply'?'Agent đã dừng và có vẻ đang hỏi bằng văn bản: cần trả lời trong phiên Claude':effect.reason==='pr_conflict'?'PR conflict: chờ người xử lý; tiếp tục poll':['reopen_description','reopen_feedback'].includes(effect.reason)?'Reopen cần mô tả lỗi mới từ người; chờ cập nhật':'Dùng thẻ Fix mới',body:accessHint({config,cardId:task.cardId,slug:task.slug,session:task.tmuxSession??undefined}),fields:{stage:task.stage,reason:effect.reason,...(effect.detail?{detail:effect.detail}:{}),...(effect.repo?{repo:effect.repo,pr:String(effect.number)}:{})}})
       task=await save(current=>({...current,pendingEffects:current.pendingEffects.map(e=>e.eventId===effect.eventId&&e.kind===effect.kind?{...e,status:'done'}:e)}))
       continue
     } else {
       await safeOutcome(root,{cardId:task.cardId,revision:task.revision??'',outcome:'qa_fail',source:'reopen_feedback',key:effect.eventId,detail:String(effect.reason??'').slice(0,300)})
       await reopenTask({root,config,id:task.cardId,reason:effect.reason,eventId:effect.eventId,expectedSourceIdentity:effect.sourceIdentity,github:observation.github})
     }
     task=await save(current=>({...current,pendingEffects:current.pendingEffects.map(e=>e.eventId===effect.eventId&&e.kind===effect.kind?{...e,status:'done'}:e)}))
   } catch {
     task=await save(current=>({...current,pendingEffects:current.pendingEffects.map(e=>e.eventId===effect.eventId&&e.kind===effect.kind&&e.status!=='done'?{...e,status:'unknown'}:e)}))
   }
 }
 return task
}
