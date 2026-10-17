// Nhật ký tri thức bền (.ff/knowledge.jsonl, chỉ nối thêm): dự đoán/kết quả chế độ bóng (KNW-10),
// kết quả thẻ và phiếu "vì sao lọt" (KNW-05). Chỉ phụ thuộc fs/mutex để mọi lớp đều import được.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { withFileMutexRetry } from './file-mutex.mjs'

const hash = v => createHash('sha256').update(v).digest('hex')
export const ESCAPE_ROUTES = ['A', 'B', 'C', 'D']
export const OUTCOMES = ['qa_pass', 'qa_fail', 'merged', 'done', 'reopen']
export const SHADOW_WINDOW = 10
export const SHADOW_MIN_MATCH = 9
const EVENT_TYPES = ['shadow_prediction', 'shadow_result', 'shadow_reset', 'outcome_recorded', 'escape_proposed', 'escape_recorded']
const norm = v => String(v ?? '').normalize('NFC').trim().replace(/\s*\(recommended\)\s*$/i, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi')
export const knowledgeLogFile = root => path.join(root, '.ff', 'knowledge.jsonl')
export const questionHash = text => hash(String(text ?? '').normalize('NFC').replace(/^(?:\s*\[[^\]]*\])+/, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi')).slice(0, 24)

export function readKnowledgeEvents(root, {type} = {}) {
  let text
  try { text = fs.readFileSync(knowledgeLogFile(root), 'utf8') } catch (e) { if (e.code === 'ENOENT') return []; throw e }
  const out = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { const ev = JSON.parse(line); if (!type || ev.type === type) out.push(ev) } catch { /* dòng cuối ghi dở: bỏ qua, không phá lịch sử */ }
  }
  return out
}

/** Idempotent theo eventId. */
export async function appendKnowledgeEvent(root, ev) {
  if (!EVENT_TYPES.includes(ev?.type) || typeof ev.eventId !== 'string' || !ev.eventId) throw new TypeError('knowledge event cần type hợp lệ và eventId')
  const file = knowledgeLogFile(root)
  return withFileMutexRetry(`${file}.lock`, {operation: 'knowledge-append'}, () => {
    fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700})
    if (readKnowledgeEvents(root).some(e => e.eventId === ev.eventId)) return {stored: false, eventId: ev.eventId}
    const fd = fs.openSync(file, 'a', 0o600)
    try { fs.writeSync(fd, JSON.stringify({...ev, at: ev.at ?? new Date().toISOString()}) + '\n'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    return {stored: true, eventId: ev.eventId}
  })
}

// ---- Chế độ bóng ----
export const shadowPolicy = policy => ({window: policy?.shadow_window ?? SHADOW_WINDOW, minMatch: policy?.shadow_min_match ?? SHADOW_MIN_MATCH})
const keyOf = (cls, repo) => JSON.stringify([cls, repo])
/**
 * Độ khớp theo (lớp, repo). Cửa sổ chỉ chứa lần máy có dự đoán; "không biết" tính riêng (abstain).
 * Trusted = cửa sổ đầy và ≥ minMatch khớp. Lệch khi đang trusted (hoặc reset tường minh) → xóa cửa sổ, về bóng.
 */
export function shadowStats(events, policy) {
  const {window, minMatch} = shadowPolicy(policy)
  const map = new Map()
  const get = (cls, repo) => {
    const k = keyOf(cls, repo)
    if (!map.has(k)) map.set(k, {class: cls, repo, predictions: 0, matches: 0, mismatches: 0, abstains: 0, autoDecisions: 0, resets: 0, recent: [], trusted: false})
    return map.get(k)
  }
  const refresh = s => { s.windowSize = s.recent.length; s.windowMatches = s.recent.filter(Boolean).length; s.trusted = s.recent.length >= window && s.windowMatches >= minMatch; return s }
  for (const ev of events) {
    if (!ev.class || typeof ev.repo !== 'string') continue
    if (ev.type === 'shadow_prediction') { if (ev.auto) get(ev.class, ev.repo).autoDecisions++ }
    else if (ev.type === 'shadow_result') {
      const s = get(ev.class, ev.repo)
      if (ev.match === null || ev.match === undefined) { s.abstains++; continue }
      s.predictions++
      if (ev.match) { s.matches++; s.recent.push(true); s.recent = s.recent.slice(-window) }
      else {
        s.mismatches++
        if (refresh(s).trusted) { s.recent = []; s.resets++ }
        else { s.recent.push(false); s.recent = s.recent.slice(-window) }
      }
    } else if (ev.type === 'shadow_reset') { const s = get(ev.class, ev.repo); s.recent = []; s.resets++ }
  }
  for (const s of map.values()) { refresh(s); s.accuracy = s.predictions ? Number((s.matches / s.predictions).toFixed(3)) : null }
  return {window, minMatch, get: (cls, repo) => refresh(map.get(keyOf(cls, repo)) ?? {class: cls, repo, predictions: 0, matches: 0, mismatches: 0, abstains: 0, autoDecisions: 0, resets: 0, accuracy: null, recent: [], trusted: false}), all: [...map.values()]}
}

export async function recordShadowPrediction(root, p) {
  const eventId = `pred:${hash(JSON.stringify([p.cardId, p.revision ?? '', p.class, p.decisionKey, p.repo, p.questionHash, Date.now(), Math.random()]))}`
  await appendKnowledgeEvent(root, {type: 'shadow_prediction', eventId, ...p})
  return eventId
}

/** Người đã trả lời: ghép với dự đoán gần nhất chưa có kết quả của đúng câu đó, ghi khớp/lệch. Idempotent theo decisionId. */
export async function resolveShadowResults(root, decisions) {
  const out = []
  for (const d of decisions) {
    if (d.scopeStatus !== 'scoped' || !d.class || !d.decisionKey || typeof d.repo !== 'string' || !d.questionHash) continue
    const events = readKnowledgeEvents(root)
    const done = new Set(events.filter(e => e.type === 'shadow_result').map(e => e.predictionId))
    const pred = events.filter(e => e.type === 'shadow_prediction' && !done.has(e.eventId) && e.cardId === d.cardId && e.class === d.class && e.decisionKey === d.decisionKey && e.repo === d.repo && e.questionHash === d.questionHash).at(-1)
    if (!pred) continue
    const predicted = pred.predicted ?? null
    const actual = norm(d.normalizedValue)
    const match = predicted === null ? null : norm(predicted) === actual
    const r = await appendKnowledgeEvent(root, {type: 'shadow_result', eventId: `result:${d.decisionId}`, predictionId: pred.eventId, decisionId: d.decisionId, cardId: d.cardId, revision: d.revision ?? '', class: d.class, decisionKey: d.decisionKey, repo: d.repo, predicted, actual, match, auto: pred.auto === true})
    if (r.stored) out.push({class: d.class, repo: d.repo, predicted, actual, match})
  }
  return out
}

export const contradictShadow = (root, {class: cls, repo, decisionKey = '', cardId = '', reason = '', revision = '', eventId}) =>
  appendKnowledgeEvent(root, {type: 'shadow_reset', eventId: eventId ?? `reset:${hash(JSON.stringify([cls, repo, decisionKey, cardId, reason, Date.now(), Math.random()]))}`, class: cls, repo, decisionKey, cardId, reason, ...(revision ? {revision} : {})})

// ---- Kết quả thẻ (KNW-05) ----
/** Best-effort bởi người gọi: lỗi ghi nhật ký không được làm hỏng luồng chính. */
export function recordOutcome(root, {cardId, revision = '', outcome, source, detail = '', key = ''}) {
  if (!OUTCOMES.includes(outcome)) return Promise.reject(new TypeError(`outcome không hợp lệ: ${outcome}`))
  return appendKnowledgeEvent(root, {type: 'outcome_recorded', eventId: `outcome:${hash(JSON.stringify([cardId, revision, outcome, key || source]))}`, cardId: String(cardId), revision, outcome, source, ...(detail ? {detail} : {})})
}
export const safeOutcome = async (root, o) => { try { return await recordOutcome(root, o) } catch { return {stored: false} } }

/** Ngả: A lỗi triển khai · B spec/Brief thiếu hoặc sai · C yêu cầu mới/cải tiến · D không tái hiện/hiểu khác (skills/ff-understand/references/reopen.md). */
export function proposeEscape(root, {cardId, revision, escapedRevision = '', route, skill, evidence}) {
  if (!ESCAPE_ROUTES.includes(route)) return Promise.reject(new TypeError('route phải là A, B, C hoặc D'))
  if (!/^[a-z][a-z0-9:_-]*$/i.test(skill ?? '')) return Promise.reject(new TypeError('skill không hợp lệ'))
  if (!String(evidence ?? '').trim()) return Promise.reject(new TypeError('thiếu bằng chứng'))
  return appendKnowledgeEvent(root, {type: 'escape_proposed', eventId: `escape-proposed:${hash(JSON.stringify([cardId, revision, route, skill, evidence]))}`, cardId: String(cardId), revision, escapedRevision, route, skill, evidence: String(evidence).trim()})
}
/** Người duyệt Gate A của revision = xác nhận ngả lỗi. Chỉ đề xuất có TRƯỚC lúc duyệt mới được xác nhận. */
export async function confirmEscapes(root, {cardId, revision, gateDecisionId, at}) {
  const events = readKnowledgeEvents(root)
  const confirmed = new Set(events.filter(e => e.type === 'escape_recorded').map(e => e.proposalId))
  const out = []
  for (const p of events.filter(e => e.type === 'escape_proposed' && e.cardId === String(cardId) && e.revision === revision && !confirmed.has(e.eventId) && (!at || e.at <= at))) {
    const r = await appendKnowledgeEvent(root, {type: 'escape_recorded', eventId: `escape:${p.eventId}`, proposalId: p.eventId, cardId: p.cardId, revision, escapedRevision: p.escapedRevision, route: p.route, skill: p.skill, evidence: p.evidence, confirmedBy: 'human', confirmedAt: 'gate_a', gateDecisionId})
    if (r.stored) out.push(p)
  }
  return out
}
