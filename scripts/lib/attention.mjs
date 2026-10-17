// Ghi "đang chờ ai" (human|agent) vào .ff/tasks/<id>.json cho bảng theo dõi thẻ. Hook không bao giờ được hỏng vì việc này.
import { withFileMutexRetry } from './file-mutex.mjs'
import { taskPath, readTask, writeTask } from '../../ff-worker/src/core/task-store.mjs'

const CARD_ID = /^[A-Za-z0-9]+$/
const ms = (v) => (Number.isFinite(v) && v > 0 ? v : 0)

export function cardIdFromEnv(env = process.env) {
  const id = env.FF_CARD_ID
  return typeof id === 'string' && CARD_ID.test(id) ? id : ''
}

/** Hàm thuần: agent→human cộng agentMs; human→agent giữ agentMs; cùng who giữ since, đổi kind. */
export function nextAttention(prev, { who, kind, via, notifiedAt }, now = new Date()) {
  const nowIso = new Date(now).toISOString()
  const prevSince = Date.parse(prev?.since)
  const agentMs = ms(prev?.agentMs)
  const withKind = (a) => (who === 'human' ? { ...a, ...(kind ? { kind } : {}), ...(via ? { via } : {}), ...(notifiedAt ? { notifiedAt } : {}) } : a)
  if (prev && prev.who === who && Number.isFinite(prevSince)) {
    return withKind({ who, since: prev.since, agentMs })
  }
  if (prev?.who === 'agent' && who === 'human' && Number.isFinite(prevSince)) {
    return withKind({ who, since: nowIso, agentMs: agentMs + Math.max(0, Date.parse(nowIso) - prevSince) })
  }
  return withKind({ who, since: nowIso, agentMs })
}

export async function recordAttention(root, cardId, change, now = new Date(), seed = undefined) {
  try {
    if (!root || !CARD_ID.test(String(cardId))) return
    if (!readTask(root, cardId)) return
    await withFileMutexRetry(`${taskPath(root, cardId)}.lock`, { operation: 'attention', cardId: String(cardId) }, () => {
      const task = readTask(root, cardId)
      if (!task) return
      writeTask(root, { ...task, attention: nextAttention(task.attention ?? seed, change, now) })
    })
  } catch { /* nuốt lỗi: hook không được làm hỏng phiên */ }
}

/** Dùng trong hook: chỉ ghi khi phiên thuộc một thẻ (FF_CARD_ID hợp lệ). */
export async function recordEnvAttention(root, change) {
  const id = cardIdFromEnv()
  if (id) await recordAttention(root, id, change)
}
