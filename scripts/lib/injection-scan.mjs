// Chống chèn lệnh qua nội dung thẻ: mọi chữ trong thẻ (mô tả, checklist, comment) là dữ liệu không tin cậy.
// Module thuần (không I/O) để worker và CLI dùng chung; danh sách luật nằm ở một chỗ.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const DOSSIER_FILE = '01-dossier.md'
export const DOSSIER_RAW_FILE = '01-dossier.raw.md'
export const DOSSIER_SCAN_FILE = '01-dossier.scan.json'

// Ký tự ẩn/định dạng: soft hyphen, zero-width, bidi, word joiner/invisible ops, BOM, tag chars, variation selector bổ sung.
// ZWJ (U+200D) giữ khi nằm trong chuỗi emoji.
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ﻿ﾠ\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu
const PICTO = /\p{Extended_Pictographic}/u

/** Bỏ ký tự ẩn và comment HTML, giữ nguyên số dòng. Trả {text, invisibleLines:[số dòng], commentLines:[{line, excerpt}]}. */
export function sanitizeText(raw) {
  const src = String(raw ?? '')
  const invisibleLines = new Set(), commentLines = []
  let text = src.replace(/<!--[\s\S]*?(?:-->|$)/g, (m, off) => {
    commentLines.push({ line: src.slice(0, off).split('\n').length, excerpt: m.replace(/\s+/g, ' ').slice(0, 120) })
    return m.replace(/[^\n]/g, '')
  })
  const chars = [...text]
  let line = 1
  const out = []
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (c === '\n') line++
    INVISIBLE.lastIndex = 0
    if (INVISIBLE.test(c)) {
      if (c === '‍' && PICTO.test(chars[i - 1] ?? '') && PICTO.test(chars[i + 1] ?? '')) { out.push(c); continue }
      invisibleLines.add(line); continue
    }
    out.push(c)
  }
  return { text: out.join(''), invisibleLines: [...invisibleLines], commentLines }
}

const RULES = [
  ['ignore_instructions', /\b(?:ignore|disregard|forget|override)\b[^\n]{0,30}\b(?:previous|prior|above|earlier|preceding|all|any|your)\b[^\n]{0,20}\b(?:instructions?|prompts?|rules?|guidelines?)\b/i],
  ['ignore_instructions', /\b(?:bỏ qua|phớt lờ|quên)\b[^\n]{0,25}\b(?:hướng dẫn|chỉ dẫn|chỉ thị|quy tắc|luật|lệnh|prompt)\b/iu],
  ['role_hijack', /\byou are now\b|\bfrom now on,? you\b|\bnew instructions?\s*:/i],
  ['role_hijack', /\b(?:system|developer) (?:prompt|message|instructions?)\b/i],
  ['role_hijack', /<\/?(?:system|assistant|im_start|im_end)\b|<\|im_(?:start|end)\|>/i],
  ['role_hijack', /[Bb]ạn (?:bây giờ |giờ )?là (?:một )?(?:AI|[Aa]gent|[Cc]laude|chatbot|trợ lý AI|mô hình ngôn ngữ)\b|[Tt]ừ (?:giờ|bây giờ) bạn (?:là|sẽ)(?![\p{L}])/u],
  ['run_command', /\bgit\s+(?:push|reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--)\b/i],
  ['run_command', /(?:^|\s)--force(?:-with-lease)?\b/i],
  ['run_command', /\b(?:curl|wget)\b[^\n]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/i],
  ['run_command', /\bwget\s+\S+/i],
  ['run_command', /\brm\s+-[a-z]*[rf][a-z]*\b/i],
  ['run_command', /\bff\s+(?:ship-approve|worker\s+resolve|gate-auto|allow|relock|escape|decide)\b/i],
  ['run_command', /\bchmod\s+(?:-[a-zA-Z]+\s+)?[0-7+\-ugoa=][^\s]*/],
  ['run_command', /\bsudo\s+\S+|\bnpm\s+publish\b|\bbash\s+-c\b|\beval\s*\(/i],
  ['read_secret', /\b(?:cat|type|less|more|head|tail|source)\s+\S*\.env\b/i],
  ['read_secret', /\b(?:print|echo|dump|reveal|leak|exfiltrate|show me|cat|in ra|tiết lộ|lộ)\b[^\n]{0,40}(?:\.env\b|token|password|mật khẩu|api[ _-]?key|secret|private key|credentials?|\.ssh)/i],
  ['read_secret', /(?<![\p{L}])(?:đọc|read|open|mở)(?![\p{L}])[^\n]{0,20}\.env\b|\.ff\.env\b|~\/\.ssh|id_rsa/iu],
]
const BASE64 = /[A-Za-z0-9+/_-]{200,}={0,2}/

const excerpt = (s) => { const t = s.trim().replace(/\s+/g, ' '); return t.length > 120 ? t.slice(0, 117) + '...' : t }

/** Quét văn bản đã làm sạch. extra = {invisibleLines, commentLines} từ sanitizeText. Trả về {suspect, hits:[{line, rule, excerpt}]}. */
export function scanText(text, extra = {}) {
  const hits = []
  const lines = String(text ?? '').normalize('NFC').split('\n')
  lines.forEach((l, i) => {
    const seen = new Set()
    for (const [rule, re] of RULES) if (!seen.has(rule) && re.test(l)) { seen.add(rule); hits.push({ line: i + 1, rule, excerpt: excerpt(l) }) }
    const b = l.match(BASE64)
    if (b) hits.push({ line: i + 1, rule: 'base64_blob', excerpt: `${b[0].slice(0, 40)}... (${b[0].length} ký tự)` })
  })
  for (const n of extra.invisibleLines ?? []) hits.push({ line: n, rule: 'invisible_chars', excerpt: excerpt(lines[n - 1] ?? '') || '(ký tự ẩn đã bị loại)' })
  for (const c of extra.commentLines ?? []) hits.push({ line: c.line, rule: 'html_comment', excerpt: c.excerpt })
  hits.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule))
  return { suspect: hits.length > 0, hits }
}

/** Làm sạch + quét văn bản thô của dossier. */
export function inspectDossierText(raw) {
  const s = sanitizeText(raw)
  return { text: s.text, injection: scanText(s.text, s) }
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')

/** Ghi dossier đã làm sạch + bản gốc + kết quả quét cạnh nhau. Trả {text, injection}. */
export function writeDossierFiles(dir, raw, { exclusive = false } = {}) {
  const { text, injection } = inspectDossierText(raw)
  fs.writeFileSync(path.join(dir, DOSSIER_FILE), text, { mode: 0o600, ...(exclusive ? { flag: 'wx' } : {}) })
  fs.writeFileSync(path.join(dir, DOSSIER_RAW_FILE), String(raw ?? ''), { mode: 0o600 })
  fs.writeFileSync(path.join(dir, DOSSIER_SCAN_FILE), JSON.stringify({ version: 1, at: new Date().toISOString(), rawSha: sha(String(raw ?? '')), sanitizedSha: sha(text), injection }, null, 2) + '\n', { mode: 0o600 })
  return { text, injection }
}

/**
 * Kết quả cho CLI: gộp sidecar (có thông tin ký tự ẩn đã bị loại từ bản gốc) với quét lại dossier hiện tại
 * (bắt trường hợp dossier bị sửa tay sau khi pull). Không có dossier → suspect=false, present=false.
 */
export function readInjection(cardDir) {
  let current = null
  try { current = fs.readFileSync(path.join(cardDir, DOSSIER_FILE), 'utf8') } catch { return { present: false, suspect: false, hits: [] } }
  const rescan = inspectDossierText(current).injection
  let side = null
  try { side = JSON.parse(fs.readFileSync(path.join(cardDir, DOSSIER_SCAN_FILE), 'utf8')).injection } catch {}
  const hits = [...rescan.hits]
  for (const h of side?.hits ?? []) if (!hits.some((x) => x.line === h.line && x.rule === h.rule)) hits.push(h)
  hits.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule))
  return { present: true, suspect: hits.length > 0, hits }
}

export const describeHits = (hits) => hits.map((h) => `dòng ${h.line} [${h.rule}]: ${h.excerpt}`)
