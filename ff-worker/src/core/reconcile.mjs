// WRK-14: đối chiếu task cục bộ với cột hiện tại của thẻ trên task source. Chỉ ghi state cục bộ:
// không bao giờ move/comment thẻ, không xóa worktree/nhánh, không đụng Gate receipt.
import fs from 'node:fs'
import path from 'node:path'
import { readTask, writeTask, taskPath, updateHarnessTask } from './task-store.mjs'
import { withFileMutexRetry } from '../../../scripts/lib/file-mutex.mjs'
import { taskSourceBlock } from '../../../scripts/lib/config.mjs'
import { findCardDir } from '../../../scripts/lib/cards.mjs'
import { cardRows } from '../../../scripts/lib/card-status.mjs'
import { isApproved, activeRevision, ledgerFor } from '../../../scripts/lib/gates.mjs'

const norm = (v) => String(v ?? '').trim().toLowerCase()
const LEGACY_CLOSED = ['completed', 'failed', 'done']

/** Phân loại cột theo config: poll | park | delivered (done/accept: đã giao, chờ QA) | reopen | other (sau QA hoặc cột lạ). */
export function classifyColumn(config, column) {
  const t = taskSourceBlock(config), c = norm(column)
  const has = (list) => (Array.isArray(list) ? list : [list]).some((n) => typeof n === 'string' && n.trim() && norm(n) === c)
  if (has(t.poll_lists ?? [])) return 'poll'
  if (has(t.park_list)) return 'park'
  if (has(t.done_list) || has(t.accept_list)) return 'delivered'
  if (has(t.reopen_list)) return 'reopen'
  return 'other'
}

const isHarness = (task) => Boolean(task?.stateVersion)
// Cùng góc nhìn với `ff worker status` (cardRows): parked/attention được xét trước phase.
const view = (task) => cardRows([task])[0]
export const taskClosed = (task) => view(task)?.waiting === 'done'
const taskHoldsSlot = (task) => isHarness(task)
  ? task.stage !== 'done' && !task.waitingOn && !['blocked', 'failed'].includes(task.executionStatus) && (task.executionStatus === 'working' || task.workingReserved === true)
  : !task.parked && (['received', 'running'].includes(task.phase) || view(task)?.waiting === 'agent')

const describeLocal = (task) => task ? (taskClosed(task) ? 'đã đóng' : view(task)?.label ?? String(task.phase)) : 'không có task'

/** Bằng chứng thẻ đã được giao (để coi cột lạ sau QA là "đã nghiệm thu"). */
function shippedEvidence(root, config, task) {
  if (!task) return false
  if (task.acceptance || task.acceptedAt || ['acceptance', 'done'].includes(task.stage) || task.shipView?.s1Complete === true || ['completed', 'done'].includes(task.phase)) return true
  try {
    const card = findCardDir(root, config, task.cardId)
    if (!card.dir) return false
    const revision = activeRevision(card.dir)
    const rel = [revision, '05-verify-report.md'].filter(Boolean).join('/')
    const content = fs.readFileSync(path.join(card.dir, rel), 'utf8')
    return isApproved(root, task.cardId, 'GATE_C', rel, content, ledgerFor(card.dir, revision ?? ''))
  } catch { return false }
}

function cardFolders(root, config) {
  const base = path.resolve(root, config.workspace.cards_dir)
  try {
    return fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => ({ id: /^([A-Za-z0-9]+)-/.exec(d.name)?.[1] ?? (/^[A-Za-z0-9]+$/.test(d.name) ? d.name : null), name: d.name })).filter((d) => d.id)
  } catch { return [] }
}

function storedIds(root) {
  try { return fs.readdirSync(path.join(root, '.ff', 'tasks')).filter((n) => /^[A-Za-z0-9]+\.json$/.test(n)).map((n) => n.slice(0, -5)) } catch { return [] }
}

const sessionName = (config, task) => task.tmuxSession ?? task.session ?? `${config.worker?.tmux?.session_prefix ?? 'ff-'}${task.cardId}`

function tmuxState(root, config, tmux, task) {
  if (!tmux) return { name: sessionName(config, task), alive: false, attached: false, known: false }
  const name = sessionName(config, task)
  let alive = false, attached = false
  try {
    alive = tmux.hasSession(name, root)
    if (alive) attached = tmux.inspectPane(name, root)?.attached !== 0 // chỉ đóng khi chắc chắn không ai attach
  } catch { alive = false }
  return { name, alive, attached, known: true }
}

/** Gợi ý dọn (chỉ báo, không làm): worktree còn lại của thẻ đã kết thúc. */
function cleanupHints(root, config, folderName) {
  if (!folderName) return []
  const wt = path.join(root, config.workspace.worktrees_dir ?? 'worktrees', folderName)
  return fs.existsSync(wt) ? [`worktree ${path.relative(root, wt)} có thể dọn`] : []
}

/**
 * Lập kế hoạch cho từng thẻ (task đã biết ∪ thư mục thẻ). Không ghi gì.
 * @returns {Promise<Array<{cardId,name,column,local,action,summary,steps,manual,cleanup,error?}>>}
 */
export async function planReconcile({ root, config, source, tmux, only = null, concurrency = 5 }) {
  const folders = cardFolders(root, config)
  const folderOf = new Map(folders.map((f) => [f.id, f.name]))
  const ids = [...new Set([...storedIds(root), ...folders.map((f) => f.id)])].filter((id) => !only || only.has(id)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const rows = new Array(ids.length)
  let next = 0
  const work = async () => {
    for (let i = next++; i < ids.length; i = next++) rows[i] = await planOne({ root, config, source, tmux, id: ids[i], folderName: folderOf.get(ids[i]) })
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, work))
  return rows
}

/** Thẻ Trello: id ngắn (idShort) phải tra qua board (`get`); id đầy đủ của task mới dùng được cho `observeCard` (/cards/{id}). */
async function observe(source, id, task) {
  const full = task?.trelloCardId
  if (full || source.name === 'local' || typeof source.get !== 'function') return source.observeCard(full ?? id)
  try {
    const c = await source.get(id)
    return c ? { list: c.list ?? null, closed: false } : { list: null, closed: true }
  } catch (e) {
    if (/HTTP 404/.test(e.message)) return { list: null, closed: true }
    throw e
  }
}

async function planOne({ root, config, source, tmux, id, folderName }) {
  let task = null
  try { task = readTask(root, id) } catch {}
  const row = { cardId: id, name: task?.slug ?? folderName?.slice(id.length + 1) ?? '', column: null, local: describeLocal(task), action: 'ok', summary: '', steps: [], manual: [], cleanup: [] }
  if (task) row.snapshot = { stateVersion: task.stateVersion ?? null, phase: task.phase ?? null, updatedAt: task.updatedAt ?? null }
  if (!task && source.name === 'trello' && !/^\d+$/.test(id)) return { ...row, action: 'report', summary: 'thẻ local, bỏ qua' }
  let obs
  try { obs = await observe(source, id, task) }
  catch (e) { return { ...row, action: 'report', summary: `không đọc được cột Trello (${e.message})` } }
  row.column = obs?.list ?? null
  if (!row.column) return { ...row, action: 'report', summary: 'không thấy thẻ trên board (chỉ báo)' }
  const kind = classifyColumn(config, row.column)
  if (!task) {
    if (kind === 'delivered' || kind === 'other') row.cleanup = cleanupHints(root, config, folderName)
    return { ...row, action: 'report', summary: kind === 'poll' ? 'worker sẽ nhận thẻ' : 'chưa có task cục bộ; không cần làm gì' + (row.cleanup.length ? ' (có thể dọn)' : '') }
  }
  if (taskClosed(task)) {
    if (kind === 'delivered' || kind === 'other') row.cleanup = cleanupHints(root, config, folderName)
    return { ...row, summary: 'đã đóng cục bộ, không cần làm gì' + (row.cleanup.length ? ' (có thể dọn)' : '') }
  }
  if (kind === 'poll') return { ...row, action: 'leave', summary: 'thẻ trong poll_lists, để worker xử lý' }
  if (kind === 'reopen') return { ...row, action: 'leave', summary: 'thẻ ở reopen_list, để worker xử lý' }
  const tm = tmuxState(root, config, tmux, task)
  const live = tm.alive
  const tmuxStep = () => live ? (tm.attached ? [`giữ tmux ${tm.name} (đang attach/không rõ)`] : [`đóng tmux ${tm.name}`]) : []
  if (kind === 'park') {
    if (task.parked) return { ...row, summary: 'đã tạm dừng khớp cột Todo, không đổi' }
    if (taskHoldsSlot(task) && !live) return { ...row, action: 'release_slot', summary: 'thẻ rời poll_lists, không có tmux: nhả slot', steps: ['nhả slot (phiên đã chết)'] }
    return { ...row, action: 'leave', summary: live ? 'thẻ ở park_list nhưng phiên còn sống, để worker xử lý' : 'không giữ slot, không đổi' }
  }
  // delivered (đã giao, chờ QA) hoặc other (sau QA)
  const accepted = kind === 'other'
  if (accepted && !shippedEvidence(root, config, task)) {
    if (taskHoldsSlot(task) && !live) return { ...row, action: 'release_slot', summary: 'thẻ rời poll_lists, không có tmux: nhả slot', steps: ['nhả slot (phiên đã chết)'] }
    return { ...row, action: 'report', summary: 'cột ngoài cấu hình và chưa đủ bằng chứng đã giao; chỉ báo' }
  }
  if (!accepted && isHarness(task) && ['acceptance'].includes(task.stage) && !taskHoldsSlot(task)) return { ...row, summary: 'đã ở chờ nghiệm thu, không đổi' }
  row.cleanup = cleanupHints(root, config, folderName)
  const manual = []
  if (accepted && config.e2e) manual.push('chuyển test hành vi của thẻ vào e2e.done_tests_dir (VER-09, chưa có lệnh tự động)')
  return {
    ...row, action: accepted ? 'close_accepted' : 'close_delivered', manual, tmux: tm,
    summary: accepted ? `đã nghiệm thu (${row.column}): đóng task, nhả slot` : `đã giao, chờ QA (${row.column}): nhả slot, không coi là nghiệm thu`,
    steps: [accepted ? 'đánh dấu done (doneVia=task_source)' : 'đánh dấu đã giao (doneVia=task_source), chưa nghiệm thu', ...(taskHoldsSlot(task) ? ['nhả slot'] : []), ...tmuxStep()],
  }
}

/** Ghi state một thẻ dưới khóa task; bỏ qua nếu task đổi giữa lúc lập kế hoạch và lúc ghi. Trả { changed, skipped? }. */
async function writeOne({ root, row, now }) {
  const at = new Date(typeof now === 'function' ? now() : now).toISOString()
  const id = row.cardId, snap = row.snapshot
  const accepted = row.action === 'close_accepted'
  if (!snap) return { skipped: 'không có task' }
  const common = { doneVia: 'task_source', doneColumn: row.column, doneAt: at, updatedAt: at }
  if (snap.stateVersion) {
    const reduce = (cur) => {
      const next = { ...cur, workingReserved: false, workingSince: null }
      if (row.action === 'release_slot') return { ...next, executionStatus: 'idle', history: [...(cur.history ?? []), { at, from: cur.stage, to: cur.stage, reason: `task_source_released:${row.column}` }] }
      const stage = accepted ? 'done' : 'acceptance'
      Object.assign(next, { stage, waitingOn: accepted ? null : 'acceptance', executionStatus: accepted ? 'idle' : 'waiting_human', ...common, accepted })
      if (accepted && cur.parked) { next.parkedBefore = cur.parked; delete next.parked }
      next.history = [...(cur.history ?? []), { at, from: cur.stage, to: stage, reason: `task_source:${row.column}` }]
      return next
    }
    try { await updateHarnessTask(root, id, snap.stateVersion, reduce) } catch (e) { if (e?.name === 'VersionConflictError') return { skipped: 'task vừa đổi, chạy lại sau' }; throw e }
    return { changed: true }
  }
  return withFileMutexRetry(`${taskPath(root, id)}.lock`, { operation: 'task-reconcile', cardId: id }, () => {
    const cur = readTask(root, id)
    if (!cur || cur.phase !== snap.phase || (cur.updatedAt ?? null) !== snap.updatedAt) return { skipped: 'task vừa đổi, chạy lại sau' }
    if (row.action === 'release_slot') {
      Object.assign(cur, { releasedAt: at, releasedReason: `task_source:${row.column}`, updatedAt: at })
      if (['received', 'running'].includes(cur.phase)) cur.phase = 'released'
      if (cur.attention?.who === 'agent') cur.attention = { ...cur.attention, who: 'none' } // status không còn báo "agent đang làm"
    }
    else {
      Object.assign(cur, { phase: 'done', ...common, doneList: row.column, accepted })
      if (accepted && cur.parked) { cur.parkedBefore = cur.parked; delete cur.parked }
    }
    writeTask(root, cur)
    return { changed: true }
  })
}

/** Thực hiện các hàng có việc (close_*, release_slot). Trả danh sách { cardId, action, done, note }. */
export async function applyReconcile({ root, config, tmux, rows, log = () => {}, now = Date.now }) {
  const results = []
  for (const row of rows) {
    if (!['close_accepted', 'close_delivered', 'release_slot'].includes(row.action)) continue
    let res
    try { res = await writeOne({ root, row, now }) } catch (e) { res = { skipped: `lỗi ghi (${e.message})` } }
    const out = { cardId: row.cardId, action: row.action, done: Boolean(res.changed), note: res.skipped ?? '', manual: row.manual, cleanup: row.cleanup }
    if (res.changed) {
      log(`[ff-worker] reconcile thẻ ${row.cardId}: ${row.action === 'release_slot' ? 'nhả slot' : row.action === 'close_accepted' ? 'đã nghiệm thu' : 'đã giao, chờ QA'} (cột ${row.column}; ${row.local})\n`)
      if (row.action !== 'release_slot' && row.tmux?.alive && !row.tmux.attached && tmux) {
        try { if (tmux.killSession(row.tmux.name, root)) { log(`[ff-worker] thẻ ${row.cardId}: đã đóng tmux ${row.tmux.name}\n`); out.tmuxClosed = true } } catch (e) { log(`[ff-worker] thẻ ${row.cardId}: không đóng được tmux (${e.message})\n`) }
      }
    } else log(`[ff-worker] reconcile thẻ ${row.cardId}: bỏ qua (${out.note})\n`)
    results.push(out)
  }
  return results
}

/** Cho worker: chỉ ca a/b, chỉ cho các task chưa đóng; trả kết quả đã áp dụng. */
export async function reconcileWorker({ root, config, source, tmux, ids = null, pollIds = new Set(), log = () => {}, now = Date.now }) {
  const open = storedIds(root).filter((id) => { try { const t = readTask(root, id); return t && !taskClosed(t) } catch { return false } })
    .filter((id) => !pollIds.has(id) && (!ids || ids.has(id)))
  if (!open.length || typeof source?.observeCard !== 'function') return []
  const rows = (await planReconcile({ root, config, source, tmux, only: new Set(open) })).filter((r) => r.snapshot)
  return applyReconcile({ root, config, tmux, rows, log, now })
}

const ACTION_TEXT = { ok: 'không cần làm', leave: 'để worker xử lý', report: 'chỉ báo', release_slot: 'NHẢ SLOT', close_delivered: 'ĐÓNG (đã giao, chờ QA)', close_accepted: 'ĐÓNG (đã nghiệm thu)' }

/** Bảng tiếng Việt: thẻ, cột Trello, trạng thái máy, việc sẽ làm. */
export function formatPlan(rows, { applied = null } = {}) {
  if (!rows.length) return '(không có thẻ nào để đối chiếu)\n'
  const head = ['Thẻ', 'Cột Trello', 'Trạng thái máy', applied ? 'Việc đã làm' : 'Việc sẽ làm']
  const done = new Map((applied ?? []).map((r) => [r.cardId, r]))
  const body = rows.map((r) => {
    const a = done.get(r.cardId)
    const what = a ? (a.done ? `${ACTION_TEXT[r.action]}: xong${a.tmuxClosed ? ', đã đóng tmux' : ''}` : `${ACTION_TEXT[r.action]}: bỏ qua (${a.note})`) : `${ACTION_TEXT[r.action]}${r.summary ? ` — ${r.summary}` : ''}`
    return [`#${r.cardId}`, r.column ?? '(không thấy)', r.local, what]
  })
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => [...b[i]].length)))
  const line = (cells) => cells.map((c, i) => c + ' '.repeat(w[i] - [...c].length)).join(' | ').trimEnd()
  const out = [line(head), w.map((n) => '-'.repeat(n)).join('-+-'), ...body.map(line)]
  const extra = rows.flatMap((r) => [...(r.manual ?? []).map((m) => `cần làm tay #${r.cardId}: ${m}`), ...(r.cleanup ?? []).map((c) => `có thể dọn #${r.cardId}: ${c} (ff không tự xóa)`)])
  return `${out.join('\n')}\n${extra.length ? `\n${extra.join('\n')}\n` : ''}`
}
