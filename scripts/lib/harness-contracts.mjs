/**
 * Shared harness vocabulary. Validation describes data, never approval/evidence.
 * Readers must still compare scope, current HEADs, hashes and checkpoints.
 *
 * @typedef {'' | `rev-${number}`} Revision Positive revision number, or root ''.
 * @typedef {{cardId:string, revision:Revision, runId:string, dispatchId:string}} Scope
 * @typedef {Scope & {eventId:string, type:string, at:string, payload:Object}} HarnessEvent
 * @typedef {Object & Scope & {stateVersion:number, stage:string, waitingOn:string|null,
 * executionStatus:string, pendingDispatch:Object|null, tmuxSession:string|null,
 * claudeSessionId:string|null, workflow:Object, questions:Array, handledEventIds:string[],
 * stageRetries:Object, repairCycles:Object, workingMs:number, workingSince:string|null,
 * lastProgressAt:string|null, history:Array, pendingEffects:Array}} HarnessTask
 * @typedef {{command:string, cwd:string, exitCode:number, logPath:string, logHash:string}} ReceiptCheck
 * @typedef {Scope & {version:1, stage:string, outcome:string, heads:Object<string,string>,
 * artifactHashes:Object<string,string>, testLockHash:string|null, checks:ReceiptCheck[],
 * reviewRefs:Array, acMatrixRef:string|null, at:string}} StageReceipt
 * @typedef {{cardId:string, revision:Revision, heads:Object<string,string>, s1Complete:boolean,
 * s2Complete:boolean, mode:string, repos:Array, acceptance:Object}} ShipView
 * @typedef {{repos:Array<{repo:string, number:number, url:string, state:string, merged:boolean,
 * headAtMerge:string|null, approvedSourceHead:string, baseHead:string, mergeability:string}>}} PrView
 * @typedef {{stage:string, waitingOn:string|null, reason:string, action:string}} StageDecision
 */

export const HARNESS_EVENT_TYPES = Object.freeze([
  'session_started', 'stage_started', 'stage_finished', 'question_opened', 'question_answered',
  'permission_waiting', 'runner_idle', 'runner_exited', 'revision_created', 'ship_observed',
  'acceptance_recorded', 'reopen_observed', 'prompt_submitted', 'human_resolved',
])
export const HARNESS_STAGES = Object.freeze(['understand', 'build', 'verify', 'ship', 'acceptance', 'done'])
export const EXECUTION_STATUSES = Object.freeze(['working', 'waiting_human', 'idle', 'blocked', 'failed', 'exited'])
export const RECEIPT_OUTCOMES = Object.freeze(['pass', 'implementation_failed', 'environment_blocked', 'needs_human', 'no_change'])
export const DECISION_ACTIONS = Object.freeze(['stay', 'dispatch', 'repair', 'acceptance', 'done'])

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
function string(value, field, empty = false) {
  if (typeof value !== 'string' || (!empty && !value.trim())) throw new TypeError(`Invalid ${field}`)
}

export function normalizeRevision(revision) {
  if (revision === null || revision === '') return ''
  if (typeof revision !== 'string' || !/^rev-[1-9]\d*$/.test(revision)) throw new TypeError('Invalid revision')
  return revision
}

export function assertScope(scope) {
  if (!object(scope)) throw new TypeError('Invalid scope')
  string(scope.cardId, 'cardId')
  if (!/^[A-Za-z0-9]+$/.test(scope.cardId)) throw new TypeError('Invalid cardId')
  string(scope.runId, 'runId')
  string(scope.dispatchId, 'dispatchId', true)
  return { ...scope, revision: normalizeRevision(scope.revision) }
}

/** Return a normalized copy; do not mutate data supplied by a hook. */
export function assertHarnessEvent(event) {
  const normalized = assertScope(event)
  string(event.eventId, 'eventId')
  if (!HARNESS_EVENT_TYPES.includes(event.type)) throw new TypeError('Invalid event type')
  string(event.at, 'at')
  if (!/^\d{4}-\d{2}-\d{2}T/.test(event.at) || !Number.isFinite(Date.parse(event.at))) throw new TypeError('Invalid at')
  if (!object(event.payload)) throw new TypeError('Invalid payload')
  return normalized
}

export function assertHarnessTask(task) {
  const normalized = assertScope(task)
  if (!Number.isSafeInteger(task.stateVersion) || task.stateVersion < 1) throw new TypeError('Invalid stateVersion')
  if (!HARNESS_STAGES.includes(task.stage)) throw new TypeError('Invalid stage')
  if (!EXECUTION_STATUSES.includes(task.executionStatus)) throw new TypeError('Invalid executionStatus')
  if (task.waitingOn !== null) string(task.waitingOn, 'waitingOn')
  return normalized
}
