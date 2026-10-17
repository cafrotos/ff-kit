// Chính sách thông báo chung cho mọi channel (console, rocketchat): chỉ đẩy việc cần người, gom phần còn lại vào log/báo cáo ngày.
//
// Ánh xạ kind -> action (đẩy ngay) | info (chỉ log + .ff/notify-info.jsonl):
//   gate            action  Gate chờ người duyệt (kể cả Gate A tự duyệt bị thu hồi)
//   ask             action  câu hỏi / yêu cầu xác nhận ship
//   error           action  lỗi chặn thẻ / worker
//   done            action  Gate C qua, kèm checklist test tay / chờ ship
//   attention       action  quyền, "waiting for your input", hộp thoại trust/setup, needs_human, stuck, PR conflict, harness blocked
//                   info    "Phiên agent đã dừng..." (Stop hook) khi thẻ KHÔNG chờ người; fields.reason='adopted'
//   info            info    launch/resume/dispatch/checkpoint/slot/nhận thẻ/wiki/QA fail kéo về Doing/đóng phiên
//                   action  riêng "⏸ Tạm dừng" (park/failed) và "Báo cáo ff" (báo cáo ngày)
//   event.policy='action'|'info' ghi đè mọi suy luận ở trên.
// Dedup: cùng thẻ + cùng kind/tiêu đề đã chuẩn hoá trong 30 phút chỉ gửi 1 lần (tin chờ người: 24h).
// Rate limit: >10 tin đẩy trong 1 giờ trượt -> giữ phần dư, cuối cửa sổ gửi 1 tin tóm tắt.
// Nhắc: thẻ chờ người >24h -> 1 nhắc/ngày/thẻ. notify_level=all: đẩy hết (vẫn dedup).
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { readTask } from './task-store.mjs'

export const DEDUP_MS = 30 * 60000
export const WAIT_DEDUP_MS = 24 * 3600000
export const RATE_LIMIT = 10
export const RATE_WINDOW_MS = 3600000
export const REMIND_AFTER_MS = 24 * 3600000
const STOP_TITLE = /^Phiên agent đã dừng/
const ACTION_INFO_TITLE = /^(?:⏸ Tạm dừng|Báo cáo ff )/
const HUMAN_WAIT = /^(?:GATE_[ABC]|Q[0-9]*|acceptance|needs_human|permission|stuck|setup:.*)$/
const HUMAN_ATTENTION = new Set(['permission', 'question', 'trust', 'setup'])

const stateFile = (root) => path.join(root, '.ff', 'notify-policy.json')
const infoFile = (root) => path.join(root, '.ff', 'notify-info.jsonl')

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${randomUUID()}.tmp`
  try { fs.writeFileSync(tmp, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' }); fs.renameSync(tmp, file) }
  finally { fs.rmSync(tmp, { force: true }) }
}

/** Thẻ đang chờ người? (waitingOn của harness hoặc attention của hook) */
export function cardWaitsOnHuman(root, taskId) {
  if (!root || !/^[A-Za-z0-9]+$/.test(String(taskId ?? ''))) return false
  try {
    const t = readTask(root, String(taskId))
    if (!t) return false
    if (t.waitingOn && t.waitingOn !== 'ship_confirm') return true
    return t.attention?.who === 'human' && HUMAN_ATTENTION.has(t.attention.kind)
  } catch { return false }
}

/** 'action' | 'info' theo bảng ở đầu file. */
export function classify(event, { waits = () => false } = {}) {
  if (event?.policy === 'action' || event?.policy === 'info') return event.policy
  const title = String(event?.title ?? '')
  if (event?.kind === 'info') return ACTION_INFO_TITLE.test(title) ? 'action' : 'info'
  if (event?.kind === 'attention') {
    if (event.fields?.reason === 'adopted') return 'info'
    if (STOP_TITLE.test(title)) return event.taskId && waits(event.taskId) ? 'action' : 'info'
    return 'action'
  }
  return 'action'
}

/** Chuẩn hoá để so trùng: bỏ số/thời lượng/mã dài, gộp khoảng trắng. */
export function normalizeMessage(event) {
  const t = String(event?.title ?? '').toLowerCase().replace(/\(đã [^)]*\)/g, '').replace(/[0-9a-f]{8,}/g, '#').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 160)
  return `${event?.kind}|${t}`
}

export function readInfoEvents(root, sinceMs = 0) {
  try {
    return fs.readFileSync(infoFile(root), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } })
      .filter((e) => e && Date.parse(e.at) >= sinceMs)
  } catch { return [] }
}

/** Bọc channel: cùng giao diện { name, notify }, thêm tick() cho nhắc/tóm tắt. */
export function withNotifyPolicy(channel, { root, level = 'action', now = Date.now, log = () => {} } = {}) {
  const clock = () => (typeof now === 'function' ? now() : now)
  let st = null
  const load = () => {
    if (st) return st
    try { st = JSON.parse(fs.readFileSync(stateFile(root), 'utf8')) } catch { st = {} }
    st.sent ??= {}; st.pushes ??= []; st.held ??= []; st.reminded ??= {}
    return st
  }
  const save = () => { try { atomicWrite(stateFile(root), st) } catch (e) { log(`[ff-worker] ghi notify-policy lỗi (${e.message})\n`) } }
  const prune = (t) => {
    const s = load()
    s.pushes = s.pushes.filter((p) => t - p < RATE_WINDOW_MS)
    for (const [k, at] of Object.entries(s.sent)) if (t - at >= WAIT_DEDUP_MS) delete s.sent[k]
  }
  const record = (event, t, why) => {
    log(`[ff-worker] thông báo không đẩy (${why}): [${event.taskId || 'worker'}] ${event.kind} ${event.title}\n`)
    if (why !== 'info') return
    try { fs.mkdirSync(path.dirname(infoFile(root)), { recursive: true }); fs.appendFileSync(infoFile(root), `${JSON.stringify({ at: new Date(t).toISOString(), taskId: event.taskId ?? '', kind: event.kind, title: event.title })}\n`) } catch {}
  }
  // Gửi qua channel gốc, tính vào hạn mức giờ.
  const push = async (event, t) => { load().pushes.push(t); await channel.notify(event) }

  async function flushSummary(t) {
    const s = load()
    if (!s.held.length || t < s.summaryAt) return
    const held = s.held; s.held = []; delete s.summaryAt
    const sample = held.slice(0, 5).map((h) => h.title).join('; ')
    save()
    try { await channel.notify({ kind: 'info', title: `${held.length} thông báo khác trong giờ qua: ${sample}${held.length > 5 ? '; …' : ''}`, body: held.map((h) => `${h.taskId ? `[${h.taskId}] ` : ''}${h.title}`).join('\n') }) }
    catch (e) { log(`[ff-worker] gửi tóm tắt thông báo lỗi (${e.message})\n`) }
  }

  async function notify(event) {
    const t = clock()
    prune(t)
    const s = load()
    await flushSummary(t)
    const cls = classify(event, { waits: (id) => cardWaitsOnHuman(root, id) })
    if (level !== 'all' && cls === 'info') { record(event, t, 'info'); return }
    const key = `${event.taskId || '-'}|${normalizeMessage(event)}`
    const window = event.fields?.waiting ? WAIT_DEDUP_MS : DEDUP_MS
    if (s.sent[key] !== undefined && t - s.sent[key] < window) { record(event, t, 'trùng'); return }
    s.sent[key] = t
    if (s.pushes.length >= RATE_LIMIT) {
      s.held.push({ taskId: event.taskId ?? '', title: String(event.title ?? '') })
      s.summaryAt ??= Math.min(...s.pushes) + RATE_WINDOW_MS
      save(); record(event, t, 'quá hạn mức giờ'); return
    }
    save()
    try { await push(event, t) } finally { save() }
  }

  // Gọi định kỳ: tóm tắt cuối cửa sổ + nhắc thẻ chờ người >24h (1 nhắc/ngày/thẻ).
  async function tick() {
    const t = clock()
    prune(t)
    const s = load()
    await flushSummary(t)
    let names = []
    try { names = fs.readdirSync(path.join(root, '.ff', 'tasks')).filter((n) => /^[A-Za-z0-9]+\.json$/.test(n)) } catch {}
    for (const n of names) {
      const id = n.slice(0, -5)
      let task; try { task = readTask(root, id) } catch { continue }
      if (!task || task.stage === 'done' || !cardWaitsOnHuman(root, id)) { delete s.reminded[id]; continue }
      const since = Date.parse(task.attention?.who === 'human' ? task.attention.since : (task.waitingSince ?? task.updatedAt ?? task.lastProgressAt))
      if (!Number.isFinite(since) || t - since < REMIND_AFTER_MS) continue
      if (s.reminded[id] !== undefined && t - s.reminded[id] < REMIND_AFTER_MS) continue
      if (s.pushes.length >= RATE_LIMIT) continue
      s.reminded[id] = t
      save()
      const hours = Math.floor((t - since) / 3600000)
      try { await push({ taskId: id, kind: 'attention', title: `Nhắc: thẻ #${id} đã chờ bạn ${hours} giờ`, body: `Thẻ #${id} (${task.waitingOn ?? task.attention?.kind ?? 'chờ người'}) vẫn chờ bạn xử lý.`, policy: 'action' }, t) }
      catch (e) { log(`[ff-worker] gửi nhắc thẻ ${id} lỗi (${e.message})\n`) }
    }
    save()
  }

  return { name: channel.name, notify, tick, inner: channel }
}
