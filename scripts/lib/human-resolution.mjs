import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { withFileMutexRetry } from './file-mutex.mjs'

const FAILURES = ['needs_human', 'implementation_failed', 'environment_blocked']
const STAGES = ['understand', 'build', 'verify', 'ship']
// Identity/delivery must be proven by the runner, never waived by a human note.
export const INTEGRITY_WAITS = Object.freeze(['setup:session_mismatch', 'setup:workflow_pin_invalid', 'setup:dispatch_unknown', 'setup:launch_unknown', 'setup:resume_unknown'])
const sha = value => createHash('sha256').update(value).digest('hex')

/** Identity of one concrete block. A resolution applies only to the block it was written for. */
export function blockFingerprint(task) {
  return sha(JSON.stringify([task.stage, task.waitingOn ?? null, task.blockReason ?? null, task.failureReason ?? null, task.dispatchId ?? '', task.completedReceipt?.receiptHash ?? null]))
}

/**
 * A block caused by the failed stage receipt of the current dispatch. Shared by
 * stage finish (supersede check) and the driver (evidence auto-resume).
 */
export function receiptOriginBlock(task) {
  if (task?.executionStatus !== 'blocked' || task.failureReason === 'working_lifetime') return null
  const { stage, blockReason: reason, waitingOn: wait, completedReceipt: failed } = task
  if (!STAGES.includes(stage) || !failed || failed.stage !== stage || !FAILURES.includes(failed.outcome) || typeof failed.receiptHash !== 'string') return null
  const ok = wait === 'needs_human' && (reason === `${stage}_needs_human` || reason === `${stage}_implementation_failed` || (stage === 'verify' && reason === 'verify_decision'))
    || (stage !== 'verify' && wait === `setup:${stage}` && reason === `${stage}_environment`)
  return ok ? { stage, outcome: failed.outcome, receiptHash: failed.receiptHash } : null
}

/**
 * Can a human waive this block with `ff worker resolve`?
 * Returns { ok:true, kind } or { ok:false, code } (code names the refusal).
 */
export function classifyBlock(task) {
  if (task?.executionStatus !== 'blocked') return { ok: false, code: 'not_blocked' }
  const wait = task.waitingOn ?? null, reason = task.blockReason ?? null
  if (reason === 'repair_limit') return { ok: false, code: 'repair_limit' }
  if (reason === 'pr_closed_use_fix') return { ok: false, code: 'pr_closed_use_fix' }
  if (INTEGRITY_WAITS.includes(wait)) return { ok: false, code: 'integrity' }
  if (typeof wait === 'string' && /^setup:/.test(wait)) return { ok: true, kind: 'setup', consume: receiptOriginBlock(task)?.receiptHash ?? null }
  if (wait !== 'needs_human') return { ok: false, code: 'unsupported' }
  if (task.failureReason === 'working_lifetime') return { ok: true, kind: 'working_lifetime' }
  if (reason === 'stage_retry_limit') return { ok: true, kind: 'stage_retry_limit' }
  const origin = receiptOriginBlock(task)
  if (origin) return { ok: true, kind: 'receipt', consume: origin.receiptHash }
  return { ok: false, code: 'unsupported' }
}

/** Append-only audit record; the task snapshot stays owned by the driver. */
export async function appendResolutionRecord(root, record) {
  if (typeof record?.cardId !== 'string' || !/^[A-Za-z0-9]+$/.test(record.cardId)) throw new TypeError('Invalid cardId')
  const file = path.join(root, '.ff', 'harness', 'resolutions', `${record.cardId}.jsonl`)
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  return withFileMutexRetry(`${file}.lock`, { operation: 'resolution-append' }, () => {
    const fd = fs.openSync(file, 'a', 0o600)
    try { fs.writeFileSync(fd, `${JSON.stringify(record)}\n`); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    return file
  })
}
