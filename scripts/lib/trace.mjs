// Truy vết xác định: mọi dòng có cột Nguồn trỏ về D-xx/U-xx; mọi D-xx được phủ hoặc nằm Ngoài phạm vi.
import fs from 'node:fs'
import path from 'node:path'

const CODE_RE = /\b([DU]-\d+)\b/g
const ARTIFACTS = new Set(['brief.md', 'brief-chi-tiet.md', '02-spec.md', '03-design.md'])
const norm = (s) => s.replace(/^\uFEFF/, '').normalize('NFC')
const squash = (s) => norm(s).replace(/\\\|/g, '|').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()

function splitRow(line) {
  const parts = line.trim().split(/(?<!\\)\|/)
  if (parts[0].trim() === '') parts.shift()
  if (parts.length && parts[parts.length - 1].trim() === '') parts.pop()
  return parts.map((c) => c.trim())
}

export function parseTables(text) {
  const lines = norm(text).split(/\r?\n/)
  const tables = []
  let heads = []
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      heads = heads.slice(0, h[1].length - 1)
      heads[h[1].length - 1] = h[2]
      continue
    }
    if (i === lines.length - 1 || !lines[i].trim().startsWith('|') || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) continue
    const rows = []
    let j = i + 2
    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) rows.push({ cells: splitRow(lines[j]), line: j + 1 })
    tables.push({ header: splitRow(lines[i]), rows, line: i + 1, inAppendix: heads.some((x) => x && /phụ lục/i.test(x)) })
    i = j - 1
  }
  return tables
}

// Mục được miễn yêu cầu phủ (metadata, bình luận). Mọi mục khác đều phải có trong ledger.
const EXEMPT_SECTION_RE = /^(Tiêu đề|Branch|Loại|Thông tin tiếp nhận|Comments?)\b/i
const stripLinePrefix = (l) => l.replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s+)/, '').trim()

// Đơn vị dossier: mỗi dòng nội dung (bỏ tiền tố danh sách) và từng câu trong dòng; bỏ heading, khối code.
// "Mục" = heading cấp 2 gần nhất; heading cấp 3+ (Scope, Acceptance Criteria…) thuộc mục cha; trước heading cấp 2 đầu tiên = mục rỗng (bắt buộc).
export function dossierUnits(text) {
  const units = []
  let section = ''
  let fence = false
  norm(text).split(/\r?\n/).forEach((raw, i) => {
    if (/^\s*```/.test(raw)) { fence = !fence; return }
    if (fence) return
    const h = raw.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      if (h[1].length === 1) section = ''
      else if (h[1].length === 2) section = h[2].replace(/^[^\p{L}]+/u, '').trim()
      return
    }
    const body = stripLinePrefix(raw)
    if (!body) return
    units.push({ line: squash(body), sentences: body.split(/(?<=[.!?…])\s+/).map(squash).filter(Boolean), section, lineNo: i + 1 })
  })
  return units
}

export function outOfScopeCodes(text) {
  const codes = []
  let inside = false
  for (const line of norm(text).split(/\r?\n/)) {
    if (/^#{1,4}\s/.test(line)) inside = /^#{2,4}\s*Ngoài phạm vi/i.test(line)
    else if (inside) codes.push(...[...line.matchAll(CODE_RE)].map((m) => m[1]).filter((c) => c.startsWith('D-')))
  }
  return codes
}

export function parseLedger(text) {
  const D = new Map()
  const U = new Map()
  const errors = []
  for (const tb of parseTables(text)) {
    for (const r of tb.rows) {
      const code = r.cells[0] ?? ''
      if (!/^[DU]-\d+$/.test(code)) continue
      const map = code.startsWith('D') ? D : U
      if (map.has(code)) { errors.push(`01b-ledger.md:${r.line} ${code} bị trùng`); continue }
      if (code.startsWith('D')) map.set(code, { quote: r.cells[1] ?? '', where: r.cells[2] ?? '', note: r.cells[3] ?? '', line: r.line })
      else map.set(code, { question: r.cells[1] ?? '', answer: r.cells[2] ?? '', date: r.cells[3] ?? '', line: r.line })
    }
  }
  return { D, U, errors }
}

function listArtifacts(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'observe') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...listArtifacts(p))
    else if (ARTIFACTS.has(e.name)) out.push(p)
  }
  return out
}

export function traceCheck(cardDir) {
  const errors = []
  const read = (f) => {
    try {
      return norm(fs.readFileSync(path.join(cardDir, f), 'utf8'))
    } catch {
      return null
    }
  }
  const dossier = read('01-dossier.md')
  const ledgerText = read('01b-ledger.md')
  if (dossier === null) errors.push('thiếu 01-dossier.md')
  if (ledgerText === null) {
    errors.push('thiếu 01b-ledger.md — lập ledger trước khi viết Brief')
    return { ok: false, errors, counts: { D: 0, U: 0 } }
  }
  const ledger = parseLedger(ledgerText)
  errors.push(...ledger.errors)
  if (dossier !== null) {
    const units = dossierUnits(dossier)
    const index = new Map()
    for (const u of units) for (const k of [u.line, ...u.sentences]) if (!index.has(k)) index.set(k, u)
    const quotes = new Set()
    for (const [code, e] of ledger.D) {
      const q = squash(stripLinePrefix(e.quote))
      if (!q) { errors.push(`01b-ledger.md:${e.line} ${code}: trích rỗng`); continue }
      quotes.add(q)
      const u = index.get(q)
      if (!u) { errors.push(`01b-ledger.md:${e.line} ${code}: trích không khớp nguyên 1 dòng hoặc 1 câu trong 01-dossier.md`); continue }
      if (e.note.startsWith('bỏ:') && !EXEMPT_SECTION_RE.test(u.section)) errors.push(`01b-ledger.md:${e.line} ${code}: "bỏ:" chỉ dùng cho dòng trong mục Comments hoặc mục được miễn (Tiêu đề, Branch, Loại, Thông tin tiếp nhận)`)
    }
    for (const u of units) {
      if (EXEMPT_SECTION_RE.test(u.section)) continue
      const covered = quotes.has(u.line) || (u.sentences.length > 0 && u.sentences.every((x) => quotes.has(x)))
      if (!covered) errors.push(`01-dossier.md:${u.lineNo} chưa có trong ledger: "${u.line}"`)
    }
  }
  const known = new Set([...ledger.D.keys(), ...ledger.U.keys()])
  const referenced = new Set()
  const outOfScope = new Set(outOfScopeCodes(ledgerText))
  for (const file of listArtifacts(cardDir)) {
    const rel = path.relative(cardDir, file).split(path.sep).join('/')
    const text = norm(fs.readFileSync(file, 'utf8'))
    for (const c of outOfScopeCodes(text)) outOfScope.add(c)
    for (const tb of parseTables(text)) {
      const col = tb.header.findIndex((h) => squash(h).toLowerCase() === 'nguồn')
      if (col < 0) {
        if (!tb.inAppendix) errors.push(`${rel}:${tb.line} bảng không có cột Nguồn (bảng tra cứu thì đặt dưới heading "Phụ lục")`)
        continue
      }
      for (const r of tb.rows) {
        const codes = [...(r.cells[col] ?? '').matchAll(CODE_RE)].map((m) => m[1])
        if (!codes.length) errors.push(`${rel}:${r.line} dòng thiếu nguồn (cần D-xx hoặc U-xx)`)
        for (const c of codes) {
          if (known.has(c)) referenced.add(c)
          else errors.push(`${rel}:${r.line} ${c} không có trong ledger`)
        }
      }
    }
  }
  for (const [code, e] of ledger.D) {
    if (e.note.startsWith('bỏ:') || referenced.has(code) || outOfScope.has(code)) continue
    errors.push(`${code} chưa được dòng nào phủ và không nằm trong "Ngoài phạm vi": "${e.quote}"`)
  }
  return { ok: errors.length === 0, errors, counts: { D: ledger.D.size, U: ledger.U.size } }
}
