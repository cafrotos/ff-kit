// Bộ đếm vòng sửa duy nhất theo revision (VER-06): `repairCycles[revision]` trong task harness `.ff/tasks/<id>.json`,
// cùng bộ đếm và giới hạn `worker.driver.max_repair_cycles` mà driver dùng. Chưa có task (legacy) → ghi tạm
// `.ff/repair-cycles/<id>.json`; driver nhận lại số đó khi tạo task (adoptLegacyRepairCycles).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { readTask, updateHarnessTask } from '../../ff-worker/src/core/task-store.mjs'

export const DEFAULT_MAX_REPAIR_CYCLES = 3
export const maxRepairCycles = (config) => config?.worker?.driver?.max_repair_cycles ?? DEFAULT_MAX_REPAIR_CYCLES
const sidecar = (root, cardId) => {
  if (!/^[A-Za-z0-9]+$/.test(String(cardId))) throw new Error('id thẻ không hợp lệ')
  return path.join(root, '.ff', 'repair-cycles', `${cardId}.json`)
}
const readSidecar = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return {} } }

/** Số vòng đã dùng ở legacy, để driver nhận khi tạo task. */
export const adoptLegacyRepairCycles = (root, cardId) => readSidecar(sidecar(root, cardId))

export function readRepairCycles(root, cardId, revision = '') {
  const task = readTask(root, cardId)
  return (task?.stateVersion ? task.repairCycles : readSidecar(sidecar(root, cardId)))?.[revision] ?? 0
}

/** Tăng bộ đếm; ném lỗi (code 'EXHAUSTED') nếu vượt giới hạn. */
export async function nextRepairCycle(root, config, cardId, revision = '', reason = '', now = new Date()) {
  const max = maxRepairCycles(config), at = now.toISOString(), task = readTask(root, cardId)
  const over = () => { const e = new Error(`đã hết ${max} vòng sửa — escalate cho người`); e.code = 'EXHAUSTED'; return e }
  if (task?.stateVersion) {
    const next = await updateHarnessTask(root, cardId, task.stateVersion, (cur) => {
      const n = (cur.repairCycles?.[revision] ?? 0) + 1
      if (n > max) throw over()
      return { ...cur, repairCycles: { ...cur.repairCycles, [revision]: n }, history: [...(cur.history ?? []), { at, from: cur.stage, to: cur.stage, reason: `fix_round: ${reason}` }] }
    })
    return { count: next.repairCycles[revision], max }
  }
  const file = sidecar(root, cardId), all = readSidecar(file), n = (all[revision] ?? 0) + 1
  if (n > max) throw over()
  all[revision] = n
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(tmp, file)
  return { count: n, max }
}
