// Bản ghi Gate là nguồn sự thật (D21). Hook PostToolUse(AskUserQuestion) ghi; guard và `ff state` đọc.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ffDir } from './state.mjs'
import { findCardDir } from './cards.mjs'

export const GATES = ['GATE_A', 'GATE_B', 'GATE_C']
export const APPROVE_LABEL = 'Duyệt'
export const ARTIFACT_GATE = { 'brief.md': 'GATE_A', '03-design.md': 'GATE_B', '05-verify-report.md': 'GATE_C' }
const GATE_ARTIFACT = Object.fromEntries(Object.entries(ARTIFACT_GATE).map(([f, g]) => [g, f]))
export const MARKER_RE = /Trạng thái:\s*ĐÃ DUYỆT/
// Chỉ bỏ dòng trạng thái đúng khuôn khi băm, để không dùng dòng "Trạng thái: …" làm kênh sửa nội dung đã duyệt.
const STATUS_LINE_RE = /^\s*>?\s*Trạng thái:\s*(?:CHỜ DUYỆT|ĐÃ DUYỆT|GATE B TỰ QUA)\b[\s\d-]*$/
const CARD_PREFIX_RE = /^\s*\[#([A-Za-z0-9]+)\]/

const lines = (text) => text.replace(/^\uFEFF/, '').normalize('NFC').split(/\r?\n/)

export const hasMarker = (text) => typeof text === 'string' && lines(text).slice(0, 10).some((l) => MARKER_RE.test(l))

export function bodyHash(text) {
  const body = lines(text).filter((l, i) => !(i < 10 && STATUS_LINE_RE.test(l))).join('\n').replace(/\s+$/, '')
  return crypto.createHash('sha256').update(body).digest('hex')
}

const sha = (text) => crypto.createHash('sha256').update(lines(text).join('\n')).digest('hex')
const readOr = (f) => {
  try {
    return fs.readFileSync(f, 'utf8')
  } catch {
    return null
  }
}

export function gateQuestions(toolInput) {
  const qs = Array.isArray(toolInput?.questions) ? toolInput.questions : []
  return qs
    .filter((q) => GATES.includes(q?.header))
    .map((q) => ({ gate: q.header, cardId: String(q.question ?? '').match(CARD_PREFIX_RE)?.[1] ?? null, question: q.question }))
}

export function answerFor(resp, question) {
  if (!resp) return null
  const a = resp.answers ?? resp
  if (Array.isArray(a)) {
    const hit = a.find((x) => x?.question === question)
    return hit ? String(hit.answer ?? hit.value ?? '') : null
  }
  if (a && typeof a === 'object' && Object.hasOwn(a, question)) {
    const v = a[question]
    return Array.isArray(v) ? v.join(', ') : String(v)
  }
  return null
}

function artifactHashes(cardDir, gate) {
  const name = GATE_ARTIFACT[gate]
  const out = {}
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name === name) out[path.relative(cardDir, p).split(path.sep).join('/')] = bodyHash(fs.readFileSync(p, 'utf8'))
    }
  }
  walk(cardDir)
  return out
}

const gateFile = (root, cardId, gate) => path.join(ffDir(root), 'gates', `${cardId}-${gate}.json`)

export function recordGates(root, config, toolInput, toolResponse, now = new Date()) {
  const out = []
  for (const g of gateQuestions(toolInput)) {
    if (!g.cardId) continue
    // Docs hooks chỉ nêu `answers` trong tool_input; đọc tool_response trước, không có thì tool_input.
    const answer = answerFor(toolResponse, g.question) ?? answerFor(toolInput, g.question)
    const card = findCardDir(root, config, g.cardId)
    const rec = {
      gate: g.gate,
      cardId: g.cardId,
      question: g.question,
      answer,
      approved: (answer ?? '').normalize('NFC').trim() === APPROVE_LABEL,
      at: now.toISOString(),
      hashes: card.dir ? artifactHashes(card.dir, g.gate) : {},
      ledgerHash: card.dir && readOr(path.join(card.dir, '01b-ledger.md')) !== null ? sha(readOr(path.join(card.dir, '01b-ledger.md'))) : null,
    }
    const f = gateFile(root, g.cardId, g.gate)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, JSON.stringify(rec, null, 2) + '\n')
    out.push(rec)
  }
  return out
}

export function isApproved(root, cardId, gate, relPath, content, ledgerText = null) {
  try {
    const r = JSON.parse(fs.readFileSync(gateFile(root, cardId, gate), 'utf8'))
    if (r.approved !== true || r.hashes?.[relPath] !== bodyHash(content)) return false
    return r.ledgerHash == null || (ledgerText !== null && sha(ledgerText) === r.ledgerHash)
  } catch {
    return false
  }
}
