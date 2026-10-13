// Client thông báo 1 chiều tới worker. Không bao giờ ném lỗi ra ngoài; worker vắng thì bỏ qua.
import fs from 'node:fs'
import path from 'node:path'

export const KINDS = ['info', 'gate', 'ask', 'attention', 'error', 'done']

export function makeEvent({ kind, taskId = '', title, fields = {}, body = '' }) {
  if (!KINDS.includes(kind)) throw new Error(`kind phải là một trong: ${KINDS.join(', ')}`)
  if (!title) throw new Error('thiếu title')
  return { kind, taskId: String(taskId), title: String(title), fields, body: String(body) }
}

export async function notify(root, event, { timeoutMs = 1500, log = (s) => process.stderr.write(s) } = {}) {
  let w = {}
  try {
    w = JSON.parse(fs.readFileSync(path.join(root, '.ff', 'worker.json'), 'utf8'))
  } catch {}
  if (!w.port) {
    log(`[ff notify] worker không chạy — bỏ qua: ${event.kind} ${event.title}\n`)
    return { delivered: false }
  }
  try {
    const res = await fetch(`http://127.0.0.1:${w.port}/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${w.token ?? ''}` },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return { delivered: true }
  } catch (e) {
    log(`[ff notify] gửi lỗi (${e.message}) — bỏ qua\n`)
    return { delivered: false }
  }
}
