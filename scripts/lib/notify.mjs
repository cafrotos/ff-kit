// Client thông báo 1 chiều tới worker. Không bao giờ ném lỗi ra ngoài; worker vắng thì bỏ qua.
import fs from 'node:fs'
import path from 'node:path'

export const KINDS = ['info', 'gate', 'ask', 'attention', 'error', 'done']
// RocketChat có timeout 10s; để worker trả kết quả trước budget Ask hook 15s.
export const NOTIFY_TIMEOUT_MS = 12000

export function makeEvent({ kind, taskId = '', title, fields = {}, body = '' }) {
  if (!KINDS.includes(kind)) throw new Error(`kind phải là một trong: ${KINDS.join(', ')}`)
  if (!title) throw new Error('thiếu title')
  return { kind, taskId: String(taskId), title: String(title), fields, body: String(body) }
}

export async function notify(root, event, { timeoutMs = NOTIFY_TIMEOUT_MS, log = (s) => process.stderr.write(s) } = {}) {
  let w = {}
  try {
    w = JSON.parse(fs.readFileSync(path.join(root, '.ff', 'worker.json'), 'utf8'))
  } catch {}
  if (!w.port) {
    log(`[ff notify] worker không chạy — bỏ qua: ${event.kind} ${event.title}\n`)
    return { delivered: false, status: 'not_sent', reason: 'worker_unavailable' }
  }
  let body
  try { body = JSON.stringify(event) } catch {
    log('[ff notify] not_sent: invalid_event\n')
    return { delivered: false, status: 'not_sent', reason: 'invalid_event' }
  }
  try {
    const res = await fetch(`http://127.0.0.1:${w.port}/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${w.token ?? ''}` },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
      const reason = `http_${res.status}`
      log(`[ff notify] failed: ${reason}\n`)
      return { delivered: false, status: 'failed', reason }
    }
    if (res.headers.get('content-type')?.includes('application/json')) {
      const result = await res.json()
      if (result?.status === 'unknown') {
        const reason = ['timeout', 'network_error'].includes(result.reason) ? result.reason : 'delivery_unknown'
        log(`[ff notify] unknown: ${reason}; chưa xác định đã gửi, không tự gửi lại\n`)
        return { delivered: false, status: 'unknown', reason }
      }
      if (result?.delivered === false || result?.status === 'failed' || result?.error) {
        log('[ff notify] failed: delivery_rejected\n')
        return { delivered: false, status: 'failed', reason: 'delivery_rejected' }
      }
    }
    return { delivered: true, status: 'delivered' }
  } catch (e) {
    const reason = ['TimeoutError', 'AbortError'].includes(e?.name) ? 'timeout' : 'network_error'
    // Request có thể đã tới kênh; không retry hay in lỗi chứa token/server detail.
    log(`[ff notify] unknown: ${reason}; chưa xác định đã gửi, không tự gửi lại\n`)
    return { delivered: false, status: 'unknown', reason }
  }
}
