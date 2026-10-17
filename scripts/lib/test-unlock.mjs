// Cửa sổ sửa test đã khóa: `ff relock <slug> --open` (người duyệt) mở, `ff relock <slug>` (re-hash) đóng.
import fs from 'node:fs'
import path from 'node:path'

export const UNLOCK_TTL_S = 60 * 60
export const UNLOCK_NAME_RE = /^\.ff-test-unlock(?:\.rev-\d+)?$/
export const unlockName = (suffix = '') => '.ff-test-unlock' + suffix

// -> { ts, files: [rel], active } hoặc null. rel tính từ gốc workspace (như manifest).
export function readUnlock(wt, suffix = '') {
  let lines
  try { lines = fs.readFileSync(path.join(wt, unlockName(suffix)), 'utf8').split('\n') } catch { return null }
  const ts = Number((lines[0] ?? '').match(/^ts=(\d+)$/)?.[1])
  if (!Number.isFinite(ts)) return null
  return { ts, files: lines.slice(1).map((l) => l.trim()).filter(Boolean), active: Date.now() / 1000 - ts <= UNLOCK_TTL_S }
}
