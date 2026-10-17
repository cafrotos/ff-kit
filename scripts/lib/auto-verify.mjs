// Điều kiện xác định để Gate C tự qua (N6). Không đọc ý kiến chủ quan: chỉ biên nhận, hash, bảng AC và ledger.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { parseTables, parseLedger, phaseSourceProblems } from './trace.mjs'
import { parseSpecAcs } from '../cli/spec-checks.mjs'
import { inspectCard } from '../cli/state.mjs'
import { readStageReceipt, validateStageReceipt } from './stage-receipts.mjs'
import { readShipTest, validateShipTest, shipTestRequired } from './ship-test-record.mjs'
import { readQuestionHistory } from './question-history.mjs'
import { captureShipTargets } from './ship-approval.mjs'
import { ledgerFor } from './gates.mjs'
import { decideForTask } from './knowledge.mjs'
import { getInfraRule } from './infra-rules.mjs'

const clean = (s) => String(s ?? '').normalize('NFC').replace(/[*`]/g, '').trim()
const AC_RE = /AC-(?:([A-Za-z0-9]+)-)?(\d+)([a-z]?)/i
const acId = (cell) => {
  const m = clean(cell).match(AC_RE)
  return m ? `AC-${m[1] ? `${m[1].toUpperCase()}-` : ''}${String(Number(m[2])).padStart(2, '0')}${m[3].toLowerCase()}` : null
}

/**
 * Cú pháp báo cáo được đọc:
 *  - Bảng có cột đầu `AC` và một cột `Verdict`; mỗi dòng có id `AC-xx` ở ô đầu. Verdict hợp lệ: `PASS`, `FAIL`, `PARTIAL`,
 *    `UNVERIFIED`, `UNVERIFIED[ext:<key>]` (key = [A-Za-z0-9_.-]+). In đậm/backtick được bỏ.
 *  - Bảng có cột `Trạng thái hồi quy…` (Neighborhood Sweep): dòng bắt đầu bằng `Gãy` hoặc `FAIL` là hồi quy hỏng.
 */
export function parseReport(text) {
  const rows = [], regressions = []
  for (const tb of parseTables(text)) {
    const head = tb.header.map((h) => clean(h).toLowerCase())
    const verdict = head.indexOf('verdict')
    if (head[0] === 'ac' && verdict >= 0) {
      for (const r of tb.rows) {
        const id = acId(r.cells[0])
        if (!id) continue
        const v = clean(r.cells[verdict])
        const ext = v.match(/^UNVERIFIED\[ext:([A-Za-z0-9_.-]+)\]/i)
        rows.push({ id, verdict: ext ? 'UNVERIFIED_EXT' : /^PASS$/i.test(v) ? 'PASS' : /^FAIL\b/i.test(v) ? 'FAIL' : /^PARTIAL\b/i.test(v) ? 'PARTIAL' : /^UNVERIFIED\b/i.test(v) ? 'UNVERIFIED' : 'OTHER', key: ext?.[1] ?? null, raw: v })
      }
    }
    const reg = head.findIndex((h) => /^trạng thái hồi quy/.test(h))
    if (reg >= 0) for (const r of tb.rows) if (/^(?:gãy|fail)/i.test(clean(r.cells[reg]))) regressions.push(clean(r.cells[0]))
  }
  return { rows, regressions }
}

function specAcIds(dir, revision) {
  const ids = new Set()
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || (!revision && /^rev-\d+$/.test(e.name))) continue
      const f = path.join(d, e.name)
      if (e.isDirectory()) walk(f)
      else if (e.name === '02-spec.md') for (const ac of parseSpecAcs(fs.readFileSync(f, 'utf8'))) if (!ac.dropped) ids.add(ac.id)
    }
  }
  walk(dir)
  return ids
}

/** Câu hỏi chuẩn của ff decide cho miễn kiểm hạ tầng ngoài (khớp decisionContext trong presentation understand). */
export const exemptionQuestion = (infra) => `Có miễn kiểm AC UNVERIFIED do hạ tầng ngoài "${infra}" không tái hiện được cục bộ không?`
export const exemptionKey = (infra) => `verify-exemption:${infra}`

/** Miễn chỉ khi tri thức cho phép: ff decide lớp test-scope, khóa verify-exemption:<hạ tầng> trả `proceed` (VER-08). */
async function exemptByDecide(root, config, id, infra, decide) {
  for (const repo of (config.repos ?? []).map((r) => r.name)) {
    const r = await decide(root, config, { cardId: id, class: 'test-scope', decisionKey: exemptionKey(infra), repo, question: exemptionQuestion(infra), options: ['Miễn', 'Không miễn'] }).catch(() => null)
    if (r?.verdict === 'proceed') return true
  }
  return false
}

/** AC đánh dấu manual trong JSON ma trận AC của pha verify (acMatrixRef của biên nhận verify, hoặc <activeDir>/evidence/verify-ac.json): {id → {steps, infra}}. */
export function readManualAcs(root, active, id, revision) {
  const out = new Map(), refs = []
  for (const stage of ['verify']) { try { const r = readStageReceipt(root, id, stage, revision); if (r?.acMatrixRef) refs.push(path.resolve(root, r.acMatrixRef)) } catch {} }
  refs.push(path.join(active, 'evidence', 'verify-ac.json'))
  for (const f of refs) {
    try {
      for (const e of JSON.parse(fs.readFileSync(f, 'utf8')).criteria ?? []) {
        if (e?.manual === true && typeof e.id === 'string') out.set(acId(e.id) ?? e.id, { steps: String(e.manual_steps ?? '').trim(), infra: typeof e.infra === 'string' ? e.infra : '' })
        else if (e?.manual !== undefined && e.manual !== false) out.set('__invalid__' + e.id, { invalid: true })
      }
    } catch {}
  }
  return out
}

export async function checkAutoGateC(root, config, cardDir, { decide = decideForTask } = {}) {
  const failures = [], exemptAcs = [], manualAcs = [], infraRules = []
  const state = inspectCard(root, config, cardDir)
  const id = state.id, revision = state.activeRevision, active = revision ? path.join(cardDir, revision) : cardDir
  const guard = (fn) => { try { fn() } catch (e) { failures.push(e.message) } }
  // (a)
  if (!['approved', 'auto_passed'].includes(state.gates.GATE_A.status)) failures.push(`(a) Gate A chưa được duyệt hoặc hash lệch (${state.gates.GATE_A.status})`)
  if (!['approved', 'auto_passed'].includes(state.gates.GATE_B.status)) failures.push(`(a) Gate B chưa hợp lệ (${state.gates.GATE_B.status})`)
  // (b) biên nhận build + ship-test sạch
  guard(() => {
    const r = readStageReceipt(root, id, 'build', revision)
    const v = r && ['pass', 'no_change'].includes(r.outcome) ? validateStageReceipt(root, config, r) : null
    if (!v?.valid) failures.push(`(b) thiếu biên nhận build hợp lệ cho HEAD hiện tại${v ? ': ' + v.reasons.join('; ') : ''}`)
  })
  if (shipTestRequired(config)) guard(() => {
    const heads = Object.fromEntries(captureShipTargets(root, config, id).map((t) => [t.repo, t.sourceHead]))
    const v = validateShipTest(readShipTest(root, id, revision ?? ''), heads)
    if (!v.valid) failures.push(`(b) ship-test chưa sạch: ${v.reason}`)
  })
  // (c) + (d) báo cáo
  const reportFile = path.join(active, '05-verify-report.md')
  if (!fs.existsSync(reportFile)) failures.push('(c) chưa có 05-verify-report.md')
  else {
    const report = parseReport(fs.readFileSync(reportFile, 'utf8'))
    const manual = readManualAcs(root, active, id, revision)
    const applyRule = (row, key) => {
      const rule = key ? getInfraRule(root, key) : null
      if (!rule) return false
      if (rule.answer === 'manual') {
        exemptAcs.push(`${row.id} [ext:${key}]`)
        manualAcs.push({ id: row.id, infra: key, steps: manual.get(row.id)?.steps || rule.note || '' })
        const hit = infraRules.find((r) => r.name === key); hit ? hit.acs.push(row.id) : infraRules.push({ name: key, answer: 'manual', note: rule.note, acs: [row.id] })
      } else failures.push(`(c) ${row.id}: luật hạ tầng "${key}" = ${rule.answer === 'block' ? 'chặn thẻ (người đã chọn)' : 'dùng giả lập, AC phải PASS bằng giả lập'}${rule.note ? ` · ${rule.note}` : ''}`)
      return true
    }
    for (const row of report.rows) {
      if (row.verdict === 'PASS') continue
      const mk = manual.get(row.id)
      if (row.verdict === 'UNVERIFIED_EXT') {
        if (applyRule(row, row.key)) continue
        if (await exemptByDecide(root, config, id, row.key, decide)) { exemptAcs.push(`${row.id} [ext:${row.key}]`); manualAcs.push({ id: row.id, infra: row.key, steps: mk?.steps ?? '' }) }
        else failures.push(`(c) ${row.id}: hạ tầng ngoài "${row.key}" chưa được ff decide cho miễn (test-scope, ${exemptionKey(row.key)}) và chưa có luật: hỏi người rồi ff infra-rule set ${row.key} <manual|mock|block> --from-question <Q-id>`)
      } else if (row.verdict === 'UNVERIFIED' && mk && !mk.invalid) {
        if (!mk.infra || !applyRule(row, mk.infra)) failures.push(`(c) ${row.id}: đánh dấu manual nhưng chưa có luật hạ tầng ${mk.infra ? `"${mk.infra}"` : '(thiếu tên hạ tầng)'} do người quyết (ff infra-rule set <tên> manual …)`)
      } else failures.push(`(c) ${row.id}: ${row.verdict === 'OTHER' ? `verdict không hiểu "${row.raw}"` : row.verdict}`)
    }
    for (const k of manual.keys()) if (k.startsWith('__invalid__')) failures.push(`(c) ${k.slice(11)}: "manual" phải là boolean true`)
    for (const want of specAcIds(active, revision)) if (!report.rows.some((r) => r.id === want)) failures.push(`(c) ${want}: có trong 02-spec.md nhưng thiếu trong báo cáo`)
    if (!report.rows.length) failures.push('(c) báo cáo không có bảng AC (cột AC + Verdict)')
    for (const g of report.regressions) failures.push(`(d) hồi quy gãy: ${g}`)
  }
  // (e) khóa test còn nguyên
  guard(() => {
    const lock = path.resolve(root, state.testLock)
    if (!fs.existsSync(lock)) { failures.push('(e) chưa khóa test (thiếu manifest .ff-test-lock)'); return }
    const lines = fs.readFileSync(lock, 'utf8').split(/\r?\n/).filter((l) => l.trim())
    if (!lines.length) failures.push('(e) manifest khóa test rỗng')
    for (const line of lines) {
      const m = line.match(/^([a-f0-9]{64})  (.+)$/)
      let ok = false
      try { ok = Boolean(m) && crypto.createHash('sha256').update(fs.readFileSync(path.resolve(root, m[2]))).digest('hex') === m[1] } catch {}
      if (!ok) failures.push(`(e) test đã khóa bị đổi hoặc mất: ${m?.[2] ?? line}`)
    }
  })
  // (f) không còn câu hỏi mở. Nguồn: biên nhận câu hỏi của hook (.ff/runner/*/questions, status 'open') và dòng U-xx chưa có trả lời trong ledger.
  guard(() => {
    for (const q of readQuestionHistory(root, id)) if (q.status === 'open') failures.push(`(f) còn câu hỏi chưa trả lời: ${q.header ?? ''} ${q.snapshot?.question ?? q.questionId}`.trim())
    const ledger = ledgerFor(cardDir, revision ?? '')
    if (ledger) for (const [code, u] of parseLedger(ledger).U) if (!String(u.answer).trim()) failures.push(`(f) ${code} chưa có trả lời trong ledger`)
  })
  // (g) provenance
  guard(() => {
    const ledger = ledgerFor(cardDir, revision ?? '')
    if (ledger) for (const p of phaseSourceProblems(ledger)) failures.push(`(g) ${p.code} tự suy ra chưa được người xác nhận`)
  })
  return { failures, exemptAcs, manualAcs, infraRules }
}
