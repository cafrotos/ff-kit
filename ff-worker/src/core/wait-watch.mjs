// Legacy: phát hiện thẻ đang chờ người (hộp thoại quyền / AskUserQuestion) bằng cách đọc pane tmux (chỉ capture-pane),
// phòng khi hook thiếu hoặc cũ. Ghi attention human, notify một lần, nhắc lại sau REMIND_MS; hộp thoại biến mất → về agent.
import fs from 'node:fs'
import path from 'node:path'
import { readTask } from './task-store.mjs'
import { recordAttention } from '../../../scripts/lib/attention.mjs'
import { formatDuration } from '../../../scripts/lib/card-status.mjs'
import { accessHint } from '../../../scripts/lib/access-hint.mjs'

export const REMIND_MS = 2 * 3600000
export const CLEAR_GRACE_MS = 90000
const LABEL = { permission: 'quyền', question: 'câu hỏi', trust: 'tin thư mục', setup: 'đề xuất cấu hình auto mode (không phải việc của thẻ)' }

/** Hàm thuần: pane có đang hiện hộp thoại chọn số của Claude Code không → { kind } | null. */
export function detectDialog(text) {
  if (typeof text !== 'string' || !text) return null
  if (/Quick safety check/i.test(text) && /trust this folder/i.test(text) && /Enter to confirm/i.test(text)) return { kind: 'trust' }
  if (/auto[- ]mode/i.test(text) && /Looks good/i.test(text) && /Discard and exit/i.test(text)) return { kind: 'setup' }
  if (!/^\s*(?:[❯>]\s*)?1\.\s+\S/m.test(text) || !/^\s*(?:[❯>]\s*)?2\.\s+\S/m.test(text) || !/Esc to cancel/i.test(text)) return null
  return { kind: /^\s*(?:[❯>]\s*)?1\.\s+Yes\b/m.test(text) && /^\s*(?:[❯>]\s*)?\d\.\s+No\b/m.test(text) ? 'permission' : 'question' }
}

const iso = (ms) => new Date(ms).toISOString()

export async function watchHumanWaits({ root, config, tmux, channel, now = Date.now, log = () => {} }) {
  if (config.worker?.driver?.enabled) return
  const dir = path.join(root, '.ff', 'tasks')
  let files = []
  try { files = fs.readdirSync(dir).filter((n) => /^[A-Za-z0-9]+\.json$/.test(n)) } catch { return }
  const prefix = config.worker?.tmux?.session_prefix ?? 'ff-'
  for (const file of files) {
    try {
      const task = readTask(root, file.slice(0, -5))
      if (!task || task.stateVersion || task.parked || task.phase !== 'running') continue
      const session = `${prefix}${task.cardId}`
      if (!tmux.hasSession(session, root)) continue
      const text = tmux.capture(session, root, 40)
      if (typeof text !== 'string') continue
      const t = now()
      const dialog = detectDialog(text)
      const att = task.attention
      if (dialog) {
        const waitingSame = att?.who === 'human' && att.kind === dialog.kind
        const base = waitingSame ? Date.parse(att.notifiedAt ?? att.since) : NaN
        if (waitingSame && !(t - base >= REMIND_MS)) continue
        const prev = att ?? { who: 'agent', since: iso(Math.min(t, Date.parse(task.startedAt ?? task.updatedAt) || t)), agentMs: 0 }
        const sinceMs = waitingSame ? t - Date.parse(att.since) : 0
        const change = { who: 'human', kind: dialog.kind, notifiedAt: iso(t), ...(waitingSame ? { ...(att.via ? { via: att.via } : {}) } : { via: 'pane' }) }
        if (!att) await recordAttention(root, task.cardId, change, new Date(t), prev)
        else await recordAttention(root, task.cardId, change, new Date(t))
        const head = `Thẻ #${task.cardId} chờ bạn: ${LABEL[dialog.kind]}${waitingSame ? ` (đã ${formatDuration(sinceMs)})` : ''}`
        try { await channel.notify({ taskId: task.cardId, kind: 'attention', title: head, body: `${head}. ${accessHint({ config, cardId: task.cardId, slug: task.slug, session })}`, fields: { waiting: dialog.kind } }) }
        catch (e) { log(`[ff-worker] gửi thông báo chờ người thẻ ${task.cardId} thất bại (${e.message})\n`) }
        log(`[ff-worker] thẻ ${task.cardId}: chờ bạn (${LABEL[dialog.kind]})\n`)
      } else if (att?.who === 'human' && LABEL[att.kind] && t - Date.parse(att.since) >= CLEAR_GRACE_MS) {
        await recordAttention(root, task.cardId, { who: 'agent' }, new Date(t))
        log(`[ff-worker] thẻ ${task.cardId}: hộp thoại đã xong, agent làm tiếp\n`)
      }
    } catch (e) { log(`[ff-worker] theo dõi chờ người ${file} lỗi (${e.message})\n`) }
  }
}
