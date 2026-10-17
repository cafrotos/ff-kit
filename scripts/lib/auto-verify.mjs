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

export async function checkAutoGateC(root, config, cardDir, { decide = decideForTask } = {}) {
  const failures = [], exemptAcs = []
  const state = inspectCard(root, config, cardDir)
  const id = state.id, revision = state.activeRevision, active = revision ? path.join(cardDir, revision) : cardDir
  const guard = (fn) => { try { fn() } catch (e) { failures.push(e.message) } }
  // (a)
  if (state.gates.GATE_A.status !== 'approved') failures.push(`(a) Gate A chưa được duyệt hoặc hash lệch (${state.gates.GATE_A.status})`)
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
    for (const row of report.rows) {
      if (row.verdict === 'PASS') continue
      if (row.verdict === 'UNVERIFIED_EXT') {
        if (await exemptByDecide(root, config, id, row.key, decide)) exemptAcs.push(`${row.id} [ext:${row.key}]`)
        else failures.push(`(c) ${row.id}: hạ tầng ngoài "${row.key}" chưa được ff decide cho miễn (test-scope, ${exemptionKey(row.key)})`)
      } else failures.push(`(c) ${row.id}: ${row.verdict === 'OTHER' ? `verdict không hiểu "${row.raw}"` : row.verdict}`)
    }
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
  return { failures, exemptAcs }
}
