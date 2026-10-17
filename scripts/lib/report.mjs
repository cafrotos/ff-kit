// Báo cáo tiếng Việt cho chế độ tự lái (SRS 6.4 mục 6). Chỉ đọc: state thẻ, receipt Gate, decisions.jsonl, knowledge.jsonl, luật hạ tầng.
import fs from 'node:fs'
import path from 'node:path'
import { readDecisions } from './question-history.mjs'
import { readKnowledgeEvents } from './knowledge-log.mjs'
import { gateAAutoState, describeGateAState } from './gate-a-auto.mjs'
import { listInfraRules, ANSWER_LABEL } from './infra-rules.mjs'
import { readTask } from '../../ff-worker/src/core/task-store.mjs'
import { cardRows } from './card-status.mjs'

const sameDay = (iso, now) => { const t = new Date(iso), n = new Date(now); return Number.isFinite(+t) && t.getFullYear() === n.getFullYear() && t.getMonth() === n.getMonth() && t.getDate() === n.getDate() }
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const STAGE_LABEL = { understand: 'hiểu yêu cầu', build: 'viết code', verify: 'nghiệm thu', ship: 'đang ship' }

function gateReceipts(root) {
  const dir = path.join(root, '.ff', 'gates')
  let names = []
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')) } catch { return [] }
  return names.map((n) => readJson(path.join(dir, n))).filter((r) => r && r.gate && r.cardId)
}

function hasMigration(root, config, id) {
  try {
    const base = path.resolve(root, config.workspace.cards_dir)
    const card = fs.readdirSync(base).find((n) => n === String(id) || n.startsWith(`${id}-`))
    if (!card) return false
    const walk = (d, depth = 0) => fs.readdirSync(d, { withFileTypes: true }).some((e) => {
      const f = path.join(d, e.name)
      if (e.isDirectory()) return depth < 2 && !e.name.startsWith('.') && walk(f, depth + 1)
      return /^(?:03-design|04-plan|02-spec)\.md$/.test(e.name) && /\bmigration\b/i.test(fs.readFileSync(f, 'utf8'))
    })
    return walk(path.join(base, card))
  } catch { return false }
}

const manualOf = (gates, id) => gates.filter((g) => String(g.cardId) === String(id) && g.gate === 'GATE_C' && g.status === 'auto_passed').sort((a, b) => String(b.at).localeCompare(String(a.at)))[0]?.autoChecks?.manualAcs ?? []

function cardLine(root, config, raw, gates) {
  const id = String(raw.cardId)
  const manual = manualOf(gates, id)
  const migration = hasMigration(root, config, id)
  let state, detail = ''
  if (raw.stage === 'done') state = 'xong'
  else if (raw.parked) { state = 'tạm dừng'; detail = raw.parked.reason ? `: ${raw.parked.reason}` : '' }
  else if (raw.executionStatus === 'blocked' || raw.executionStatus === 'failed' || ['needs_human', 'stuck'].includes(raw.waitingOn) || /^setup:/.test(raw.waitingOn ?? '')) {
    state = 'kẹt'; detail = `: ${raw.blockReason ?? raw.failureReason ?? raw.waitingOn ?? 'cần người xem'}`
  } else if (raw.stage === 'acceptance') {
    state = manual.length ? 'đã lên dev, chờ người thử tay' : 'đã lên dev, chờ bạn xác nhận'
    detail = manual.length ? ` (${manual.length} mục)` : ''
  } else if (raw.waitingOn) { state = 'chờ bạn'; detail = `: ${raw.waitingOn}` }
  else { state = 'đang làm'; detail = `: ${STAGE_LABEL[raw.stage] ?? raw.stage ?? '?'}` }
  return { cardId: id, slug: raw.slug ?? '', state: state + detail, migration, manual }
}

export function buildReport(root, config, { today = false, now = Date.now() } = {}) {
  const inScope = (iso) => !today || sameDay(iso, now)
  const dir = path.join(root, '.ff', 'tasks')
  let files = []
  try { files = fs.readdirSync(dir).filter((n) => /^[A-Za-z0-9]+\.json$/.test(n)).sort() } catch {}
  const tasks = files.map((f) => readTask(root, f.slice(0, -5))).filter(Boolean)
  const gates = gateReceipts(root)
  const cards = tasks.map((t) => t.stateVersion ? cardLine(root, config, t, gates) : { cardId: String(t.cardId), slug: t.slug ?? '', state: cardRows([t], { now })[0]?.label ?? 'chưa rõ', migration: hasMigration(root, config, t.cardId), manual: manualOf(gates, t.cardId) })
  const auto = []
  for (const g of gates.filter((r) => r.status === 'auto_passed' && inScope(r.at)))
    auto.push({ at: g.at, kind: 'gate', text: `Thẻ #${g.cardId}: ${g.gate.replace('GATE_', 'Gate ')} tự qua${g.scope ? ` (${g.scope})` : ''} — ${g.reason}` })
  for (const d of readDecisions(root).filter((r) => r.provenance?.source === 'agent' && r.verdict === 'proceed' && (!today || (r.at && inScope(r.at)))))
    auto.push({ at: d.at ?? '', kind: 'decide', text: `Thẻ #${d.cardId}: tự quyết câu mềm "${d.question ?? d.decisionKey}" → ${d.default} — ${d.reason}` })
  for (const g of gates.filter((r) => r.gate === 'GATE_C' && r.status === 'auto_passed' && inScope(r.at)))
    for (const r of g.autoChecks?.infraRules ?? []) auto.push({ at: g.at, kind: 'infra', text: `Thẻ #${g.cardId}: áp luật hạ tầng "${r.name}" (${ANSWER_LABEL[r.answer] ?? r.answer}) cho ${r.acs.join(', ')}${r.note ? ` — ${r.note}` : ''}` })
  auto.sort((a, b) => String(a.at).localeCompare(String(b.at)))
  const learned = []
  for (const e of readKnowledgeEvents(root, { type: 'outcome_recorded' }).filter((e) => inScope(e.at))) learned.push({ at: e.at, text: `Thẻ #${e.cardId}${e.revision ? ` ${e.revision}` : ''}: kết quả ${e.outcome}${e.source ? ` (${e.source})` : ''}` })
  for (const e of readKnowledgeEvents(root, { type: 'shadow_reset' }).filter((e) => inScope(e.at))) learned.push({ at: e.at, text: `Lớp ${e.class}/${e.repo} về chế độ bóng${e.reason ? ` — ${e.reason}` : ''}` })
  for (const r of listInfraRules(root).filter((r) => inScope(r.at))) learned.push({ at: r.at, text: `Luật hạ tầng mới "${r.name}": ${ANSWER_LABEL[r.answer]}${r.note ? ` — ${r.note}` : ''}` })
  learned.sort((a, b) => String(a.at).localeCompare(String(b.at)))
  return { generatedAt: new Date(now).toISOString(), today, cards, auto, learned, autopilot: config.autopilot ?? { enabled: false }, ...(config.autopilot?.enabled ? { gateA: gateAAutoState(root, config) } : {}) }
}

export function renderReport(r) {
  const out = [`Báo cáo ff${r.today ? ' hôm nay' : ''} (${r.generatedAt.slice(0, 16).replace('T', ' ')})${r.autopilot?.enabled ? '' : ' · autopilot đang tắt'}`, '', 'Thẻ']
  if (!r.cards.length) out.push('- (chưa có thẻ nào)')
  for (const c of r.cards) out.push(`- #${c.cardId}${c.slug ? ` ${c.slug}` : ''}: ${c.state}${c.migration ? ' · có migration' : ''}`)
  const manual = r.cards.filter((c) => c.manual.length)
  if (manual.length) {
    out.push('', 'Cần thử tay trên dev')
    for (const c of manual) for (const m of c.manual) out.push(`- #${c.cardId} ${m.id}${m.infra ? ` [${m.infra}]` : ''}${m.steps ? `: ${m.steps}` : ''}`)
  }
  if (r.gateA?.length) {
    out.push('', 'Gate A tự duyệt')
    for (const g of r.gateA) out.push(`- repo ${g.repo || '(gốc)'}: ${describeGateAState(g)}`)
  }
  out.push('', 'ff đã tự quyết')
  if (!r.auto.length) out.push('- (chưa có)')
  for (const a of r.auto) out.push(`- ${a.text}`)
  out.push('', 'Đã học')
  if (!r.learned.length) out.push('- (chưa có)')
  for (const l of r.learned) out.push(`- ${l.text}`)
  return out.join('\n')
}
