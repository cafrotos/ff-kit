import fs from 'node:fs'
import path from 'node:path'
import { withFileMutexRetry } from '../../../scripts/lib/file-mutex.mjs'
import { assertHarnessTask } from '../../../scripts/lib/harness-contracts.mjs'

export class VersionConflictError extends Error {
  constructor(id, expectedVersion, actualVersion) {
    super(`Task ${id} version conflict: expected ${expectedVersion}, found ${actualVersion}`)
    this.name = 'VersionConflictError'
    this.cardId = id
    this.expectedVersion = expectedVersion
    this.actualVersion = actualVersion
  }
}

export function taskPath(root, id) {
  if (!/^[A-Za-z0-9]+$/.test(String(id))) throw new Error(`ID thẻ không hợp lệ: ${String(id)}`)
  return path.join(root, '.ff', 'tasks', `${id}.json`)
}

export function readTask(root, id) {
  try { return JSON.parse(fs.readFileSync(taskPath(root, id), 'utf8')) } catch (e) {
    if (e.code === 'ENOENT') return null
    throw e
  }
}

export function writeTask(root, task) {
  const target = taskPath(root, task.cardId)
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
  const temp = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(task, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temp, target)
}

/** Short local CAS transaction. Missing tasks have version zero. */
export async function updateHarnessTask(root, id, expectedVersion, reduce) {
  const target = taskPath(root, id)
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new TypeError('Invalid expectedVersion')
  return withFileMutexRetry(`${target}.lock`, { operation: 'task-update', cardId: String(id) }, () => {
    const current = readTask(root, id)
    const actualVersion = current?.stateVersion ?? 0
    if (actualVersion !== expectedVersion) throw new VersionConflictError(String(id), expectedVersion, actualVersion)
    const result = reduce(current)
    if (result && typeof result.then === 'function') throw new TypeError('Task reducer must be synchronous')
    if (!result || result.cardId !== String(id)) throw new TypeError('Task reducer must preserve cardId')
    const next = assertHarnessTask({ ...result, stateVersion: actualVersion + 1 })
    writeTask(root, next)
    return next
  })
}


/** Deliberate status whitelist: never serialize a task or arbitrary PR object. */
export function harnessTaskStatus(task) {
  const date = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)) ? value : null
  const hash = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value) ? value : null
  const wait = /^(?:GATE_[ABC]|Q[0-9]*|verify_lock|ship_confirm|acceptance|needs_human|permission|paused|stuck|setup:[a-z0-9_:-]{1,80})$/
  const prs = (Array.isArray(task.prView?.repos) ? task.prView.repos : []).map(p => ({ number: Number.isSafeInteger(p.number) && p.number > 0 ? p.number : null, state: ['open', 'closed', 'merged'].includes(p.state) ? p.state : null }))
  return {
    cardId: /^[A-Za-z0-9]+$/.test(task.cardId) ? task.cardId : null,
    stage: ['understand', 'build', 'verify', 'ship', 'acceptance', 'done'].includes(task.stage) ? task.stage : null,
    waitingOn: wait.test(task.waitingOn ?? '') ? task.waitingOn : task.waitingOn ? 'needs_human' : null,
    since: date(task.workingSince) ?? date(task.reservationAt) ?? date(task.lastProgressAt),
    revision: /^(?:|rev-[1-9][0-9]*)$/.test(task.revision ?? '') ? task.revision ?? '' : null,
    attention: { pending: (task.pendingEffects ?? []).filter(e => e.kind === 'notify' && e.status === 'intent').length, unknown: (task.pendingEffects ?? []).filter(e => e.kind === 'notify' && e.status === 'unknown').length },
    pr: prs, devHashes: Object.values(task.shipView?.devHashes ?? {}).map(hash).filter(Boolean),
  }
}
