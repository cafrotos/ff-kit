// Bảng theo dõi thẻ: hàm thuần biến task (.ff/tasks/*.json) thành các dòng "thẻ đang chờ ai".
import { harnessTaskStatus } from '../../ff-worker/src/core/task-store.mjs'

const KIND_LABEL = { question: 'câu hỏi', permission: 'quyền', trust: 'tin thư mục', idle: 'rảnh' }
const WAIT_KIND = { permission: 'permission', needs_human: 'question', stuck: 'idle', paused: 'idle' }
const ORDER = { human: 0, agent: 1, parked: 2, done: 3, unknown: 4 }
const ms = (iso, now) => { const t = Date.parse(iso); return Number.isFinite(t) ? Math.max(0, now - t) : null }

export function formatDuration(v) {
  if (!Number.isFinite(v)) return '—'
  const min = Math.floor(v / 60000)
  if (min < 60) return `${Math.max(min, 1)}p`
  const h = Math.floor(min / 60)
  if (h < 24) return min % 60 ? `${h}h${String(min % 60).padStart(2, '0')}` : `${h}h`
  return `${Math.floor(h / 24)} ngày`
}

function rowOf(raw, now) {
  const base = { cardId: String(raw.cardId), slug: String(raw.slug ?? ''), label: '', waiting: 'unknown', kind: null, sinceMs: null, list: null, hint: null }
  const a = raw.attention
  const hint = `tmux attach -t ff-${base.cardId}`
  if (raw.parked) {
    const why = raw.parked.reason === 'failed' ? `failed${raw.lastError ? `: ${String(raw.lastError).split(/[:;]/)[0].replace(/^Session /, '').slice(0, 30)}` : ''}` : raw.parked.reason ?? 'park'
    return { ...base, waiting: 'parked', label: `park (${why})`, sinceMs: ms(raw.parked.at, now), list: raw.parked.list ?? null }
  }
  if (raw.stateVersion) {
    const t = harnessTaskStatus(raw)
    const stage = t.stage ?? '—'
    if (t.stage === 'done') return { ...base, waiting: 'done', label: 'xong', sinceMs: null }
    if (t.waitingOn) return { ...base, waiting: 'human', kind: WAIT_KIND[t.waitingOn] ?? 'question', label: `chờ BẠN · ${stage} · ${t.waitingOn}`, sinceMs: ms(t.since, now), hint }
    return { ...base, waiting: 'agent', label: `agent đang làm · ${stage}`, sinceMs: ms(t.since, now) }
  }
  if (raw.phase === 'done' || raw.doneList) return { ...base, waiting: 'done', label: `xong${raw.doneList ? ` → ${raw.doneList}` : ''}`, list: raw.doneList ?? null }
  if (a?.who === 'human') return { ...base, waiting: 'human', kind: a.kind ?? null, label: `chờ bạn${KIND_LABEL[a.kind] ? `: ${KIND_LABEL[a.kind]}` : ''}`, sinceMs: ms(a.since, now), hint }
  if (a?.who === 'agent') return { ...base, waiting: 'agent', label: 'agent đang làm', sinceMs: ms(a.since, now) }
  if (raw.phase === 'completed') return { ...base, waiting: 'done', label: 'xong' }
  return { ...base, label: raw.phase ? `chưa rõ (${raw.phase})` : 'chưa rõ', sinceMs: ms(raw.startedAt ?? raw.updatedAt, now) }
}

/** Hàm thuần. Thứ tự: chờ người (lâu nhất trước) → agent → park → xong → chưa rõ. */
export function cardRows(tasks, { now = Date.now() } = {}) {
  const rows = (tasks ?? []).filter((t) => t && /^[A-Za-z0-9]+$/.test(String(t.cardId))).map((t) => rowOf(t, now))
  return rows.sort((x, y) => ORDER[x.waiting] - ORDER[y.waiting] || (y.sinceMs ?? -1) - (x.sinceMs ?? -1) || x.cardId.localeCompare(y.cardId))
}

const ICON = { human: '⏳', agent: '⚙ ', parked: '⏸', done: '✓ ', unknown: '? ' }
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n))

export function formatRows(rows) {
  const idW = Math.max(3, ...rows.map((r) => r.cardId.length))
  return rows.map((r) => {
    const time = r.sinceMs == null || r.waiting === 'done' ? '' : ` · ${formatDuration(r.sinceMs)}`
    const kind = r.waiting === 'human' && r.kind && !r.label.includes(KIND_LABEL[r.kind] ?? '\0') && r.label === 'chờ bạn' ? ` · ${KIND_LABEL[r.kind] ?? r.kind}` : ''
    const tail = r.hint ? `  ${r.hint}` : ''
    return `${ICON[r.waiting]} ${r.cardId.padEnd(idW)} ${cut(r.slug, 20)}  ${r.label}${kind}${time}${tail}`.trimEnd()
  }).join('\n')
}
