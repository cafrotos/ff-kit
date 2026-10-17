// Park/unpark: Trello is the single source of truth for which cards the worker may drive.
// Parked tasks keep worktree, branch, state and tmux session; they are simply never driven.
import fs from 'node:fs'
import path from 'node:path'
import { readTask, writeTask, updateHarnessTask } from './task-store.mjs'
import { safeOutcome } from '../../../scripts/lib/knowledge-log.mjs'
import { resolveTrelloLists, taskSourceBlock } from '../../../scripts/lib/config.mjs'

const norm = (value) => String(value ?? '').trim().toLowerCase()
export const isParked = (task) => !!task?.parked

/** Post-ship phase (shipped / acceptance watching) keeps its existing behaviour: never parked by list moves. */
export const isPostShip = (task) => ['acceptance', 'done'].includes(task.stage) || task.shipView?.s1Complete === true

export function pollListsOf(config) {
  return (taskSourceBlock(config).poll_lists ?? []).map(norm)
}

/** Resolved Doing / QA Fail list names (lowercased) for scheduling. */
export function schedulingLists(config) {
  const { doing, qaFail } = resolveTrelloLists(taskSourceBlock(config))
  return { doing: doing ? norm(doing) : null, qaFail: qaFail ? norm(qaFail) : null, doingName: doing, qaFailName: qaFail }
}
export const isQaFailList = (config, list) => { const { qaFail } = schedulingLists(config); return !!qaFail && norm(list) === qaFail }

/** Free-slot order: Doing first, previously-started first, then Trello pos, then id. QA Fail cards sort last (and are only taken when no Doing candidate waits). */
export function selectionRank(config, { list, started, pos, id, idx = Infinity }) {
  const { doing } = schedulingLists(config)
  const qa = isQaFailList(config, list) ? 1 : 0
  return [qa, !qa && doing && norm(list) === doing ? 0 : 1, started ? 0 : 1, idx, Number.isFinite(Number(pos)) && pos != null ? Number(pos) : Infinity, String(id)]
}
export function compareRank(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return 0
}

/** Legacy (non-driver) task parked after exceeding ship.max_reopen. Idempotent. */
export function parkLegacyTask({ root, task, reason, list = null, now = Date.now }) {
  if (task.parked) return task
  task.parked = { reason, at: new Date(typeof now === 'function' ? now() : now).toISOString(), list }
  writeTask(root, task)
  return task
}

export const parkNotice = (reason, list) => reason === 'chat'
  ? '⏸ Tạm dừng: bạn đánh dấu trong chat'
  : reason === 'failed'
    ? `⏸ Tạm dừng: worker gặp lỗi (${list || 'không rõ'})`
    : reason === 'max_reopen'
      ? `⏸ Tạm dừng: QA fail vượt max_reopen (${list})`
      : `⏸ Tạm dừng: thẻ rời ${list || 'danh sách theo dõi'}`

async function notifyOnce(channel, task, text, log) {
  try { await channel.notify({ taskId: task.cardId, kind: 'info', title: text, body: text }) }
  catch { log?.(`[ff-worker] gửi thông báo tạm dừng thẻ ${task.cardId} thất bại\n`) }
}

/** Mark a task parked (driver-side single writer). Returns the updated task. Idempotent: an already parked task is untouched. */
export async function parkTask({ root, cardId, reason, list = null, now = Date.now, channel, log, notify = true, extra = '' }) {
  const current = readTask(root, cardId)
  if (!current) throw new Error(`không có task ${cardId}`)
  if (current.parked) return { task: current, changed: false }
  const at = new Date(typeof now === 'function' ? now() : now).toISOString()
  const task = await updateHarnessTask(root, cardId, current.stateVersion, (cur) => ({ ...cur, parked: { reason, at, list, ...(reason === 'chat' ? { sawOut: false } : {}) } }))
  if (reason === 'max_reopen') await safeOutcome(root, {cardId, revision: task.revision ?? '', outcome: 'qa_fail', source: 'max_reopen', detail: String(list ?? '')})
  if (notify && channel) await notifyOnce(channel, task, `${parkNotice(reason, list)}${extra}`, log)
  return { task, changed: true }
}

async function patchParked(root, task, next) {
  return updateHarnessTask(root, task.cardId, task.stateVersion, (cur) => ({ ...cur, parked: next }))
}

/**
 * One reconcile pass over stored tasks against the poll result.
 * polled: Map(cardId -> discovery). Returns Set of parked cardIds after the pass.
 */
export async function reconcileParking({ root, config, source, channel, tasks, polled, now = Date.now, log }) {
  const lists = pollListsOf(config)
  const filterAssigned = taskSourceBlock(config).filter_assigned_only !== false
  const parked = new Set()
  for (const stored of tasks) {
    if (!stored?.stateVersion || stored.stage === 'done') continue
    const id = stored.cardId
    const inPoll = polled.has(id)
    let task = stored
    if (task.parked) {
      const p = task.parked
      if (inPoll) {
        if (p.reason === 'trello' || (p.reason === 'chat' && p.sawOut)) {
          await updateHarnessTask(root, id, task.stateVersion, (cur) => { const { parked: _drop, ...rest } = cur; return rest })
          continue // QUEUED again: resumes exactly where it stopped
        }
      } else if (p.reason === 'chat' && !p.sawOut) {
        await patchParked(root, task, { ...p, sawOut: true })
      }
      parked.add(id)
      continue
    }
    if (inPoll || isPostShip(task) || typeof source?.observeCard !== 'function') continue
    let obs
    try { obs = await source.observeCard(task.trelloCardId ?? id) } catch { continue } // unknown: never park
    if (!obs) continue
    const inLists = obs.list != null && lists.includes(norm(obs.list))
    if (obs.closed || (filterAssigned && !obs.assignedToMe) || !inLists) {
      const { task: next } = await parkTask({ root, cardId: id, reason: 'trello', list: obs.list ?? null, now, channel, log })
      if (next.parked) parked.add(id)
    }
  }
  return parked
}

/** Kill the tmux session of tasks parked longer than park_close_after_minutes when nobody is attached and the pane is idle. */
export async function closeIdleParkedSessions({ root, config, tasks, tmux, now = Date.now, log }) {
  const minutes = config.worker?.park_close_after_minutes ?? 60
  const t = typeof now === 'function' ? now() : now
  const closed = []
  for (const task of tasks) {
    const p = task.parked
    if (!p || p.tmuxClosedAt || !task.tmuxSession || !tmux) continue
    if (t - Date.parse(p.at) < minutes * 60000) continue
    let pane
    try { pane = tmux.inspectPane(task.tmuxSession, root) } catch { continue }
    if (!pane || pane.exists !== true || pane.status !== 'idle' || pane.attached !== 0) continue
    if (!tmux.killSession(task.tmuxSession, root)) continue
    await updateHarnessTask(root, task.cardId, readTask(root, task.cardId).stateVersion, (cur) => ({ ...cur, parked: { ...cur.parked, tmuxClosedAt: new Date(t).toISOString() } }))
    log?.(`[ff-worker] thẻ ${task.cardId}: đóng tmux ${task.tmuxSession} sau ${minutes} phút tạm dừng\n`)
    closed.push(task.cardId)
  }
  return closed
}

/** Handler for POST /park: chat-driven park. Errors from Trello are reported, but the task stays parked. */
export async function chatPark({ root, config, source, channel, cardId, comment, now = Date.now, log }) {
  if (!/^[A-Za-z0-9]+$/.test(String(cardId ?? ''))) throw Object.assign(new Error('invalid card'), { status: 400 })
  const task = readTask(root, cardId)
  if (!task?.stateVersion) throw Object.assign(new Error('unknown task'), { status: 400 })
  const { changed } = await parkTask({ root, cardId, reason: 'chat', now, notify: false })
  const errors = []
  const remote = task.trelloCardId ?? cardId
  const parkList = taskSourceBlock(config).park_list
  if (changed && typeof parkList === 'string' && parkList.trim()) {
    try { await source.moveCard(remote, parkList.trim()) } catch (e) { errors.push(`không chuyển được thẻ sang ${parkList}: ${e.message}`) }
  }
  if (changed && typeof comment === 'string' && comment.trim()) {
    try { await source.addComment(remote, comment) } catch (e) { errors.push(`không đăng được bình luận: ${e.message}`) }
  }
  if (changed) await notifyOnce(channel, task, `${parkNotice('chat')}${errors.length ? ` (lỗi: ${errors.join('; ')})` : ''}`, log)
  return { parked: true, alreadyParked: !changed, errors }
}

const LEDGER_HEADING = '## Nhật ký worker'

/** Append `- <ISO> park hệ thống: <lý do>` under "## Nhật ký worker" of 01b-ledger.md (creates section/file). Never throws. */
export function appendWorkerLedger({ root, config, task, text, at }) {
  try {
    const dir = path.resolve(root, config.workspace.cards_dir, `${task.cardId}-${task.slug}`)
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    const file = path.join(dir, '01b-ledger.md')
    const line = `- ${at} ${text}`
    const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    const lines = old.split('\n')
    const i = lines.findIndex((l) => l.trim() === LEDGER_HEADING)
    if (i < 0) fs.writeFileSync(file, `${old}${old && !old.endsWith('\n') ? '\n' : ''}${old ? '\n' : ''}${LEDGER_HEADING}\n\n${line}\n`, { mode: 0o600 })
    else {
      let end = lines.findIndex((l, k) => k > i && /^#{1,2} /.test(l))
      if (end < 0) end = lines.length
      while (end - 1 > i && lines[end - 1].trim() === '') end--
      lines.splice(end, 0, line)
      fs.writeFileSync(file, lines.join('\n'), { mode: 0o600 })
    }
    return true
  } catch { return false }
}

/**
 * System park (replaces the dead `failed` phase): local effects only and synchronous, so sync callers can use it.
 * The Trello move + channel notice happen later in flushSystemParks. Idempotent.
 */
export function systemParkTask({ root, config, task, reason, now = Date.now, log = () => {} }) {
  if (task.parked) return task
  const at = new Date(typeof now === 'function' ? now() : now).toISOString()
  const why = String(reason ?? task.lastError ?? 'lỗi không rõ').slice(0, 240)
  const parkList = taskSourceBlock(config).park_list
  task.parked = { reason: 'failed', at, list: typeof parkList === 'string' && parkList.trim() ? parkList.trim() : null }
  task.phase = 'parked'
  task.lastError = why
  task.updatedAt = at
  writeTask(root, task)
  appendWorkerLedger({ root, config, task, text: `park hệ thống: ${why}`, at })
  log(`[ff-worker] thẻ ${task.cardId}: park hệ thống (${why})\n`)
  return task
}

/** Legacy task stored with the old dead phase `failed` and not parked: park it once. */
export function migrateFailedTasks({ root, config, tasks, now = Date.now, log }) {
  for (const task of tasks) {
    if (task && !task.stateVersion && task.phase === 'failed' && !task.parked) systemParkTask({ root, config, task, reason: task.lastError, now, log })
  }
}

/** Move system-parked cards to park_list (NO Trello comment) and send the one-way notice; each step done once. */
export async function flushSystemParks({ root, config, source, channel, tasks, log = () => {} }) {
  const parkList = taskSourceBlock(config).park_list
  const hasList = typeof parkList === 'string' && parkList.trim()
  for (const task of tasks) {
    const p = task?.parked
    if (!p || p.reason !== 'failed' || task.stateVersion) continue
    const patch = {}
    if (hasList && !p.moved && typeof source?.moveCard === 'function') {
      try { await source.moveCard(task.trelloCardId ?? task.cardId, parkList.trim()); patch.moved = true; patch.movedAt = new Date().toISOString() }
      catch (e) { log(`[ff-worker] thẻ ${task.cardId}: không chuyển được sang ${parkList} (${e.message}); thử lại vòng sau\n`) }
    }
    if (!p.notified && channel) {
      await notifyOnce(channel, task, `${parkNotice('failed', task.lastError)}`, log)
      patch.notified = true
    }
    if (Object.keys(patch).length) { const cur = readTask(root, task.cardId) ?? task; cur.parked = { ...cur.parked, ...patch }; writeTask(root, cur); task.parked = cur.parked }
  }
}
