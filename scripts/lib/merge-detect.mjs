// WRK-12: phát hiện "thay đổi của thẻ đã vào base_branch" chỉ bằng git (không forge).
// Thứ tự ưu tiên (mạnh -> yếu), kết quả đầu tiên khớp thắng:
//  1. ancestor   : source HEAD đã duyệt là ancestor của origin/<base>      -> merged (merge commit/ff)
//  2. patch      : diff gộp của thẻ (merge-base..source HEAD) đã có trên base:
//                  patch-id trùng một commit trên base (squash/cherry-pick của squash),
//                  mọi commit của thẻ có patch-id trên base (rebase/cherry-pick từng commit),
//                  hoặc diff gộp áp ngược sạch lên base (base đã đi tiếp)   -> merged
//  3. trailer    : có commit trên base mang `Trello: #<id>` hoặc `ff-card: <id>` nhưng nội dung KHÔNG khớp
//                                                                          -> edited (cần người xác nhận)
//  4. còn lại                                                             -> pending
// Trailer không bao giờ tự nó cho "merged"; chỉ nội dung (1, 2) mới ràng buộc vào bản đã duyệt/test.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'

const MAX_COMMITS = 500
const run = (cwd, args, o = {}) => spawnSync('git', args, {cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 120000, ...o})
const out = (cwd, args) => { const r = run(cwd, args); return r.status === 0 ? r.stdout.trim() : null }
const sha = /^[a-f0-9]{40}([a-f0-9]{24})?$/

/** `git patch-id --stable` trên một luồng diff; trả Map<patchId, commit>. */
function patchIds(cwd, logArgs) {
  const log = run(cwd, ['log', '-p', '--no-merges', '--format=commit %H', `-n${MAX_COMMITS}`, ...logArgs])
  if (log.status !== 0 || !log.stdout) return new Map()
  const r = run(cwd, ['patch-id', '--stable'], {input: log.stdout})
  const map = new Map()
  for (const line of (r.stdout ?? '').split('\n')) { const [id, c] = line.trim().split(/\s+/); if (id && c) map.set(id, c) }
  return map
}
function combinedPatchId(cwd, mb, head) {
  const d = run(cwd, ['diff', '--binary', mb, head])
  if (d.status !== 0 || !d.stdout) return null
  const r = run(cwd, ['patch-id', '--stable'], {input: d.stdout})
  return (r.stdout ?? '').trim().split(/\s+/)[0] || null
}
/** Diff gộp áp ngược sạch lên tree của base = nội dung đã có trên base. Dùng index tạm, không đụng worktree. */
function reverseApplies(cwd, mb, head, baseRef) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-md-')), env = {...process.env, GIT_INDEX_FILE: path.join(dir, 'index')}
  try {
    if (run(cwd, ['read-tree', baseRef], {env}).status !== 0) return false
    const d = run(cwd, ['diff', '--binary', mb, head])
    if (d.status !== 0 || !d.stdout) return false
    return run(cwd, ['apply', '--cached', '-R', '--check'], {env, input: d.stdout}).status === 0
  } finally { fs.rmSync(dir, {recursive: true, force: true}) }
}
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export function trailerRegex(cardId) { return new RegExp(`^(?:Trello:\\s*#${esc(cardId)}|ff-card:\\s*#?${esc(cardId)})\\s*$`, 'm') }

const cache = new Map()
/**
 * @returns {{state:'merged'|'edited'|'pending'|'unknown', via?:string, baseHead?:string, commit?:string}}
 * unknown = không fetch/đọc được git (không kết luận gì).
 */
export function detectLanded({cwd, baseBranch, sourceHead, cardId, fetch = true, minIntervalMs = 60000, now = Date.now}) {
  if (!sha.test(String(sourceHead ?? '')) || !baseBranch) return {state: 'unknown'}
  const key = `${cwd}\0${baseBranch}\0${sourceHead}`, hit = cache.get(key)
  if (hit && now() - hit.at < minIntervalMs) return hit.result
  const result = detect({cwd, baseBranch, sourceHead, cardId, fetch})
  if (result.state !== 'unknown') cache.set(key, {at: now(), result})
  return result
}
export const resetLandedCache = () => cache.clear()

function detect({cwd, baseBranch, sourceHead, cardId, fetch}) {
  const ref = `refs/remotes/origin/${baseBranch}`
  if (fetch && run(cwd, ['fetch', '--no-tags', 'origin', `+refs/heads/${baseBranch}:${ref}`]).status !== 0) return {state: 'unknown'}
  const baseHead = out(cwd, ['rev-parse', '--verify', ref])
  if (!baseHead || out(cwd, ['cat-file', '-t', sourceHead]) !== 'commit') return {state: 'unknown'}
  if (run(cwd, ['merge-base', '--is-ancestor', sourceHead, ref]).status === 0) return {state: 'merged', via: 'ancestor', baseHead}
  const mb = out(cwd, ['merge-base', sourceHead, ref])
  if (!mb) return {state: 'pending', baseHead}
  const want = combinedPatchId(cwd, mb, sourceHead)
  if (want) {
    const onBase = patchIds(cwd, [`${mb}..${ref}`])
    if (onBase.has(want)) return {state: 'merged', via: 'patch-id', commit: onBase.get(want), baseHead}
    const own = patchIds(cwd, [`${mb}..${sourceHead}`])
    if (own.size > 1 && [...own.keys()].every(id => onBase.has(id))) return {state: 'merged', via: 'patch-id-each', baseHead}
    if (reverseApplies(cwd, mb, sourceHead, ref)) return {state: 'merged', via: 'reverse-apply', baseHead}
  }
  if (cardId) {
    const re = trailerRegex(cardId), log = run(cwd, ['log', `-n${MAX_COMMITS}`, '--format=%H%x1f%B%x1e', `${mb}..${ref}`])
    for (const rec of (log.stdout ?? '').split('\x1e')) { const [c, body] = rec.trim().split('\x1f'); if (c && body && re.test(body)) return {state: 'edited', via: 'trailer', commit: c, baseHead} }
  }
  return {state: 'pending', baseHead}
}
