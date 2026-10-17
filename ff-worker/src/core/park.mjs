// Park/unpark: Trello is the single source of truth for which cards the worker may drive.
// Parked tasks keep worktree, branch, state and tmux session; they are simply never driven.
import { readTask, updateHarnessTask } from './task-store.mjs'

const norm = (value) => String(value ?? '').trim().toLowerCase()
export const isParked = (task) => !!task?.parked

/** Post-ship phase (shipped / acceptance watching) keeps its existing behaviour: never parked by list moves. */
export const isPostShip = (task) => ['acceptance', 'done'].includes(task.stage) || task.shipView?.s1Complete === true

export function pollListsOf(config) {
  return (config.worker?.task_source?.trello?.poll_lists ?? []).map(norm)
}

export const parkNotice = (reason, list) => reason === 'chat'
  ? '⏸ Tạm dừng: bạn đánh dấu trong chat'
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
  const filterAssigned = config.worker?.task_source?.trello?.filter_assigned_only !== false
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
  const parkList = config.worker?.task_source?.trello?.park_list
  if (changed && typeof parkList === 'string' && parkList.trim()) {
    try { await source.moveCard(remote, parkList.trim()) } catch (e) { errors.push(`không chuyển được thẻ sang ${parkList}: ${e.message}`) }
  }
  if (changed && typeof comment === 'string' && comment.trim()) {
    try { await source.addComment(remote, comment) } catch (e) { errors.push(`không đăng được bình luận: ${e.message}`) }
  }
  if (changed) await notifyOnce(channel, task, `${parkNotice('chat')}${errors.length ? ` (lỗi: ${errors.join('; ')})` : ''}`, log)
  return { parked: true, alreadyParked: !changed, errors }
}
