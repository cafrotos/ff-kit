// Gate A tự qua: rút lại khi sai (SRS 6.4 mục 7). Dùng lại bộ đếm chế độ bóng mức 3, lớp `gate_a_auto` theo repo.
// Lớp chưa từng bị reset = tin cậy ngay (người đã chọn bật `on`); sau reset phải khớp lại ≥ shadow_min_match/shadow_window.
import fs from 'node:fs'
import path from 'node:path'
import { findCardDir } from './cards.mjs'
import { gateFile, bodyHash } from './gates.mjs'
import { readKnowledgeEvents, shadowStats, shadowPolicy, appendKnowledgeEvent, contradictShadow, recordShadowPrediction } from './knowledge-log.mjs'
import { notify, makeEvent } from './notify.mjs'

export const GATE_A_CLASS = 'gate_a_auto'
export const gateARepos = (config) => { const n = (config.repos ?? []).map((r) => r.name).filter(Boolean); return n.length ? n : [''] }
const repoLabel = (r) => r || '(gốc)'

/** Trạng thái theo repo: trusted (chưa từng reset, hoặc đã khớp lại) | learning (đã rút lại, chưa khớp lại đủ). */
export function gateAAutoState(root, config, repos = gateARepos(config)) {
  const events = readKnowledgeEvents(root), stats = shadowStats(events, config.knowledge)
  const { window, minMatch } = shadowPolicy(config.knowledge)
  return repos.map((repo) => {
    const s = stats.get(GATE_A_CLASS, repo)
    const last = events.filter((e) => e.type === 'shadow_reset' && e.class === GATE_A_CLASS && e.repo === repo).at(-1) ?? null
    const learning = s.resets > 0 && !s.trusted
    return { repo, status: learning ? 'learning' : 'trusted', relearned: s.resets > 0 && s.trusted, matches: s.windowMatches ?? 0, size: s.windowSize ?? 0, window, minMatch, resets: s.resets, lastReset: last ? { at: last.at, reason: last.reason ?? '', cardId: last.cardId ?? '' } : null }
  })
}

export function describeGateAState(s) {
  if (s.status === 'learning') return `đang học lại ${s.matches}/${s.minMatch} (đã rút lại lúc ${s.lastReset?.at ?? '?'} vì ${s.lastReset?.reason || 'không rõ'})`
  return s.relearned ? `tin cậy (đã khớp lại sau lần rút lại lúc ${s.lastReset?.at ?? '?'})` : 'tin cậy'
}

function readGateAReceipt(root, cardId, scope) {
  try { return JSON.parse(fs.readFileSync(gateFile(root, cardId, 'GATE_A', scope), 'utf8')) } catch { return null }
}

async function resetRepos(root, config, { cardId, repos, reason, key, revision = '', notifyIfTrusted = true }) {
  const out = []
  for (const repo of repos) {
    const [before] = gateAAutoState(root, config, [repo])
    const r = await contradictShadow(root, { class: GATE_A_CLASS, repo, cardId: String(cardId), reason, revision, eventId: `reset:gate_a:${key}:${repo}` })
    if (!r.stored) continue
    out.push(repo)
    if (notifyIfTrusted && before.status === 'trusted') {
      const { window, minMatch } = shadowPolicy(config.knowledge)
      const title = `Gate A tự duyệt bị rút lại cho repo ${repoLabel(repo)} do ${reason} — từ giờ hỏi người cho tới khi khớp lại ${minMatch}/${window}`
      try { await notify(root, makeEvent({ kind: 'attention', taskId: cardId, title })) } catch { /* thông báo là best-effort */ }
    }
  }
  return out
}

/** Nếu Gate A của một trong các scope (revision) là `auto_passed` thì rút lại lớp gate_a_auto cho repo của receipt. Bảo thủ: mọi trigger đều tính. */
export async function revertAutoGateA(root, config, cardId, { scopes, reason }) {
  const done = []
  for (const scope of [...new Set(scopes)]) {
    const rec = readGateAReceipt(root, cardId, scope)
    if (rec?.status !== 'auto_passed') continue
    const repos = Array.isArray(rec.autoRepos) && rec.autoRepos.length ? rec.autoRepos : gateARepos(config)
    const reset = await resetRepos(root, config, { cardId, repos, reason, key: rec.receiptId ?? `${cardId}:${scope}`, revision: scope })
    if (reset.length) done.push({ scope, repos: reset })
  }
  return done
}

export async function recordGateAPrediction(root, config, { cardId, revision, briefContent }) {
  const briefHash = bodyHash(briefContent ?? '')
  for (const repo of gateARepos(config)) await recordShadowPrediction(root, { cardId: String(cardId), revision, class: GATE_A_CLASS, decisionKey: 'gate_a', repo, questionHash: 'gate_a', predicted: 'duyệt', briefHash, auto: false })
}

/** Người trả lời Gate A: ghép với dự đoán "tự duyệt" chưa có kết quả của đúng revision. Dự đoán "từ chối" không bao giờ được ghi nên không tính. */
export async function resolveGateAAnswer(root, config, { cardId, revision = '', decisionId, answer }) {
  const norm = String(answer ?? '').normalize('NFC').trim().toLocaleLowerCase('vi')
  if (!['duyệt', 'cần sửa'].includes(norm)) return []
  const events = readKnowledgeEvents(root)
  const done = new Set(events.filter((e) => e.type === 'shadow_result').map((e) => e.predictionId))
  const preds = new Map()
  for (const e of events) if (e.type === 'shadow_prediction' && e.class === GATE_A_CLASS && e.cardId === String(cardId) && (e.revision ?? '') === revision && e.predicted === 'duyệt' && !done.has(e.eventId)) preds.set(e.repo, e)
  if (!preds.size) return []
  let current = null
  try {
    const card = findCardDir(root, config, cardId)
    current = bodyHash(fs.readFileSync(path.join(card.dir, revision, revision ? 'delta.md' : 'brief.md'), 'utf8'))
  } catch { /* không đọc được Brief: coi như không đổi */ }
  const out = []
  for (const [repo, p] of preds) {
    const unchanged = !p.briefHash || current === null || p.briefHash === current
    const match = norm === 'duyệt' && unchanged
    const r = await appendKnowledgeEvent(root, { type: 'shadow_result', eventId: `result:${decisionId}:${repo}`, predictionId: p.eventId, decisionId, cardId: String(cardId), revision, class: GATE_A_CLASS, decisionKey: 'gate_a', repo, predicted: 'duyệt', actual: norm, match, auto: false })
    if (!r.stored) continue
    out.push({ repo, match })
    if (norm === 'cần sửa') await resetRepos(root, config, { cardId, repos: [repo], reason: 'người trả lời "Cần sửa" ở Gate A dù ff dự đoán tự duyệt', key: `answer:${decisionId}`, revision })
  }
  return out
}
