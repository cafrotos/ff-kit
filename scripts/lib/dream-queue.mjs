// Hàng chờ việc dreaming (SRS 6.1): .ff/knowledge/queue.jsonl, chỉ nối thêm (hook gọi song song vẫn an toàn).
// Sự kiện: {t:'job'} tạo việc · {t:'patch'} đổi trạng thái · {t:'evidence'} bằng chứng phiên (PreCompact/SessionEnd, không chạy LLM).
// Chỉ phụ thuộc fs/path để hook import nhanh.
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { withFileMutexRetry } from './file-mutex.mjs'

export const queueFile = root => path.join(root, '.ff', 'knowledge', 'queue.jsonl')
export const JOB_KINDS = ['D0', 'D0p', 'D1', 'D2', 'evolve']
const PRIORITY = { D0: 0, D1: 1, D0p: 2, D2: 3, evolve: 4 }
const FAILED_BLOCK_MS = 24 * 3600 * 1000
const COMPACT_LINES = 1500

export function appendEvent(root, ev) {
  const file = queueFile(root)
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  fs.appendFileSync(file, JSON.stringify(ev) + '\n', { mode: 0o600 })
}

export function readQueue(root) {
  let text = ''
  try { text = fs.readFileSync(queueFile(root), 'utf8') } catch { /* chưa có */ }
  const jobs = new Map(), evidence = []
  let lines = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    lines++
    let ev
    try { ev = JSON.parse(line) } catch { continue } // dòng ghi dở: bỏ qua
    if (ev.t === 'job' && ev.job?.id) jobs.set(ev.job.id, { ...ev.job })
    else if (ev.t === 'patch' && jobs.has(ev.id)) Object.assign(jobs.get(ev.id), ev.patch, { updatedAt: ev.at })
    else if (ev.t === 'evidence') evidence.push(ev)
  }
  return { jobs: [...jobs.values()], evidence, lines }
}

/** Idempotent theo `key`: trùng việc chưa hỏng (hoặc hỏng chưa quá 24 giờ) thì không tạo lại. */
export function enqueueJob(root, { kind, key, payload = {}, notBefore = 0 }, now = Date.now()) {
  if (!JOB_KINDS.includes(kind)) throw new TypeError(`loại việc không hợp lệ: ${kind}`)
  if (!key) throw new TypeError('thiếu key')
  const same = readQueue(root).jobs.filter(j => j.key === key)
  const hit = same.find(j => j.status !== 'failed' || now - Date.parse(j.failedAt ?? j.updatedAt ?? 0) < FAILED_BLOCK_MS)
  if (hit) return { id: hit.id, existing: true }
  const id = `${new Date(now).toISOString().replace(/\D/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`
  const job = { id, kind, key, payload, status: 'queued', attempts: 0, notBefore: new Date(notBefore || now).toISOString(), createdAt: new Date(now).toISOString() }
  appendEvent(root, { t: 'job', job, at: job.createdAt })
  return { id, existing: false }
}

export function patchJob(root, id, patch, now = Date.now()) {
  appendEvent(root, { t: 'patch', id, patch, at: new Date(now).toISOString() })
}

/** Bằng chứng phiên: chỉ một dòng append, không đọc gì, không LLM. */
export function recordEvidence(root, { event, sessionId = '', cardId = '', transcriptPath = '', reason = '', now = Date.now() }) {
  appendEvent(root, { t: 'evidence', at: new Date(now).toISOString(), event, sessionId: String(sessionId), cardId: String(cardId), transcriptPath: String(transcriptPath), reason: String(reason) })
}

export function dueJobs(jobs, now = Date.now()) {
  return jobs.filter(j => j.status === 'queued' && Date.parse(j.notBefore) <= now)
    .sort((a, b) => (PRIORITY[a.kind] ?? 9) - (PRIORITY[b.kind] ?? 9) || String(a.createdAt).localeCompare(String(b.createdAt)))
}

/** Gọn file khi quá dài: giữ việc chưa xong + 200 việc xong gần nhất + 200 bằng chứng gần nhất. */
export async function compactQueue(root) {
  const q = readQueue(root)
  if (q.lines < COMPACT_LINES) return false
  const file = queueFile(root)
  return withFileMutexRetry(`${file}.lock`, { operation: 'queue-compact' }, () => {
    const fresh = readQueue(root)
    const open = fresh.jobs.filter(j => ['queued', 'running'].includes(j.status))
    const closed = fresh.jobs.filter(j => !['queued', 'running'].includes(j.status)).slice(-200)
    const out = [...closed, ...open].map(job => JSON.stringify({ t: 'job', job, at: job.createdAt }))
    for (const ev of fresh.evidence.slice(-200)) out.push(JSON.stringify(ev))
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, out.join('\n') + '\n', { mode: 0o600 })
    fs.renameSync(tmp, file)
    return true
  })
}
