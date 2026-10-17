// Bản ghi Gate là nguồn sự thật (D21). Hook PostToolUse(AskUserQuestion) ghi; guard và `ff state` đọc.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ffDir } from './state.mjs'
import { findCardDir } from './cards.mjs'
import YAML from 'yaml'

export const GATES = ['GATE_A', 'GATE_B', 'GATE_C']
export const APPROVE_LABEL = 'Duyệt'
export const ARTIFACT_GATE = { 'brief.md': 'GATE_A', 'delta.md': 'GATE_A', '03-design.md': 'GATE_B', '05-verify-report.md': 'GATE_C' }
const GATE_ARTIFACT = { GATE_A: 'brief.md', GATE_B: '03-design.md', GATE_C: '05-verify-report.md' }
export const MARKER_RE = /Trạng thái:\s*ĐÃ DUYỆT/
// Chỉ bỏ dòng trạng thái đúng khuôn khi băm, để không dùng dòng "Trạng thái: …" làm kênh sửa nội dung đã duyệt.
const STATUS_LINE_RE = /^\s*>?\s*Trạng thái:\s*(?:CHỜ DUYỆT|ĐÃ DUYỆT|GATE B TỰ QUA)\b[\s\d-]*$/
const CARD_PREFIX_RE = /^\s*\[#([A-Za-z0-9]+)\]/

/** Gate bị từ chối ghi: lý do + cách sửa, để báo cho người (không im lặng ở trạng thái pending). */
export class GateRefusal extends Error { name = 'GateRefusal' }

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

export function activeRevision(cardDir) {
  const revs = fs.readdirSync(cardDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^rev-[1-9]\d*$/.test(e.name))
    .map((e) => e.name).sort((a, b) => Number(b.slice(4)) - Number(a.slice(4)))
  return revs[0] ?? null
}

export function validateScope(cardDir, scope = '') {
  if (scope && !/^(?:rev-[1-9]\d*(?:\/task-\d+(?:-[A-Za-z0-9-]+)?)?|task-\d+(?:-[A-Za-z0-9-]+)?)$/.test(scope)) throw new Error('scope Gate không hợp lệ')
  const dir = path.resolve(cardDir, scope)
  const real = fs.realpathSync(dir), base = fs.realpathSync(cardDir)
  if (real !== base && !real.startsWith(base + path.sep)) throw new Error('scope Gate vượt khỏi thẻ')
  return dir
}

export function gateScope(question) {
  const rev = question.match(/\[(rev-[1-9]\d*)\]/)?.[1]
  const task = question.match(/\[(task-\d+(?:-[A-Za-z0-9-]+)?)\]/)?.[1]
  return [rev, task].filter(Boolean).join('/')
}

export function validateGateQuestion(cardDir, question) {
  const scope = gateScope(question), revision = activeRevision(cardDir)
  if ((revision && scope.split('/')[0] !== revision) || (!revision && scope.startsWith('rev-'))) throw new Error(`Gate phải chỉ đúng revision hiện tại ${revision ?? 'gốc'}`)
  validateScope(cardDir, scope)
  return scope
}

export function gateFile(root, cardId, gate, scope = '') {
  if (!/^[A-Za-z0-9]+$/.test(String(cardId)) || !GATES.includes(gate) || (scope && !/^(?:rev-[1-9]\d*(?:\/task-\d+(?:-[A-Za-z0-9-]+)?)?|task-\d+(?:-[A-Za-z0-9-]+)?)$/.test(scope))) throw new Error('Gate không hợp lệ')
  return path.join(ffDir(root), 'gates', `${cardId}${scope ? '-' + scope.replaceAll('/', '-') : ''}-${gate}.json`)
}

function scopeOf(relPath) {
  const parts = relPath.split('/')
  return parts.length > 1 ? parts.slice(0, -1).join('/') : ''
}

function scopedFiles(cardDir, scope, filename) {
  const dir = validateScope(cardDir, scope), out = {}
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || (!scope && /^rev-\d+$/.test(entry.name))) continue
      const file = path.join(current, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (entry.isFile() && entry.name === filename) out[path.relative(cardDir, file).split(path.sep).join('/')] = bodyHash(fs.readFileSync(file, 'utf8'))
    }
  }
  walk(dir)
  return out
}

export function designArtifacts(cardDir, scope = '') {
  const hashes = scopedFiles(cardDir, scope, '03-design.md')
  const parent = [scope, '03-design.md'].filter(Boolean).join('/')
  if (Object.keys(hashes).some((rel) => rel !== parent && /(?:^|\/)task-\d+(?:-[A-Za-z0-9-]+)?\/03-design\.md$/.test(rel))) delete hashes[parent]
  return hashes
}

export function ledgerFor(cardDir, scope = '') {
  const scoped = readOr(path.join(validateScope(cardDir, scope), '01b-ledger.md'))
  return scoped ?? readOr(path.join(cardDir, '01b-ledger.md'))
}

function readReceipt(root, id, gate, scope = '') {
  try { return JSON.parse(fs.readFileSync(gateFile(root, id, gate, scope), 'utf8')) } catch { return null }
}

function receiptDigest(root, id, gate, scope = '') {
  const text = readOr(gateFile(root, id, gate, scope))
  return text === null ? null : sha(text)
}

function context(cardDir, scope, gate) {
  const hashes = {}
  if (gate !== 'GATE_A') {
    Object.assign(hashes, scopedFiles(cardDir, scope, '02-spec.md'))
    const aScope = parentScope(scope), aFile = /^rev-/.test(aScope) ? 'delta.md' : 'brief.md'
    const rel = [aScope, aFile].filter(Boolean).join('/'), body = readOr(path.join(cardDir, rel))
    if (body !== null) hashes[rel] = bodyHash(body)
    if (scope.includes('/') || /^task-/.test(scope)) {
      const parentDesign = [parentScope(scope), '03-design.md'].filter(Boolean).join('/'), shared = readOr(path.join(cardDir, parentDesign))
      if (shared !== null) hashes[parentDesign] = bodyHash(shared)
    }
  }
  if (gate === 'GATE_C') Object.assign(hashes, scopedFiles(cardDir, scope, '03-design.md'))
  return { dossierHash: readOr(path.join(cardDir, '01-dossier.md')) === null ? null : sha(readOr(path.join(cardDir, '01-dossier.md'))),
    rootLedgerHash: readOr(path.join(cardDir, '01b-ledger.md')) === null ? null : sha(readOr(path.join(cardDir, '01b-ledger.md'))), contextHashes: hashes }
}

function storeReceipt(root, id, gate, scope, receipt) {
  const file = gateFile(root, id, gate, scope)
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const dir = fs.realpathSync(path.dirname(file))
  if (!dir.startsWith(fs.realpathSync(root) + path.sep) || (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())) throw new Error('đường dẫn Gate không an toàn')
  const temp = `${file}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(temp, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(temp, file)
}

function parentScope(scope) {
  return scope.includes('/') ? scope.split('/')[0] : /^task-/.test(scope) ? '' : scope
}

function dependenciesFor(root, id, cardDir, scope, gate) {
  if (gate === 'GATE_A') return []
  const dependencies = [], aScope = parentScope(scope)
  const add = (sourceGate, rel) => {
    const ownScope = scopeOf(rel)
    const rec = readReceipt(root, id, sourceGate, ownScope) ?? (!ownScope.startsWith('rev-') ? readReceipt(root, id, sourceGate) : null)
    const label = `${sourceGate}${ownScope ? ` [${ownScope}]` : ''}`
    if (!rec) {
      // Root receipts created by earlier versions did not require prerequisites.
      if (scope.startsWith('rev-')) throw new GateRefusal(`${label} chưa có bản ghi duyệt nên chưa ghi được ${gate}. Cách sửa: trình ${sourceGate} cho người duyệt trước (câu hỏi bắt đầu "[#${id}]${ownScope ? ` [${ownScope.split('/')[0]}]` : ''}"), rồi trình lại ${gate}.`)
      return
    }
    const status = gateStatus(root, id, sourceGate, rel, readOr(path.join(cardDir, rel)), ledgerFor(cardDir, ownScope))
    if (!['approved', 'auto_passed'].includes(status)) throw new GateRefusal(`${label} đang ${status === 'stale' ? 'lệch hash (tài liệu đã đổi sau khi duyệt)' : 'chưa duyệt'} nên chưa ghi được ${gate}. Cách sửa: trình lại ${sourceGate} cho người duyệt, rồi trình lại ${gate}.`)
    const receiptScope = rec.scope ?? ''
    if (!dependencies.some((d) => d.gate === sourceGate && d.scope === receiptScope)) dependencies.push({ gate: sourceGate, scope: receiptScope, digest: receiptDigest(root, id, sourceGate, receiptScope) })
  }
  add('GATE_A', [aScope, scope.startsWith('rev-') ? 'delta.md' : 'brief.md'].filter(Boolean).join('/'))
  if (gate === 'GATE_C') {
    const designs = designArtifacts(cardDir, scope)
    for (const rel of Object.keys(designs)) add('GATE_B', rel)
    if (!Object.keys(designs).length && scope.startsWith('rev-')) throw new GateRefusal(`${scope} thiếu 03-design.md/GATE_B nên chưa ghi được GATE_C. Cách sửa: viết design và trình GATE_B trước.`)
  }
  return dependencies
}

/** null nếu Gate này ghi được; ngược lại lý do + cách sửa (ask-pre dùng để không hỏi người một câu chắc chắn bị từ chối). */
export function gatePrerequisiteProblem(root, config, cardId, gate, question) {
  const card = findCardDir(root, config, cardId)
  if (card.error) return card.error
  try {
    const scope = validateGateQuestion(card.dir, question)
    if (gate !== 'GATE_A') dependenciesFor(root, cardId, card.dir, scope, gate)
    return null
  } catch (e) { return e.message }
}

export function gateStatus(root, cardId, gate, relPath, content, ledgerText = null) {
  const scope = scopeOf(relPath)
  const r = readReceipt(root, cardId, gate, scope) ?? (!scope.startsWith('rev-') ? readReceipt(root, cardId, gate) : null)
  if (!r || (r.approved !== true && r.status !== 'auto_passed')) return 'pending'
  try {
    const receiptScope = r.scope ?? ''
    // New receipts carry the physical card path; legacy receipts keep their existing contract.
    const cardDir = r.cardDir ? path.resolve(root, r.cardDir) : null
    if (r.hashes?.[relPath] !== bodyHash(content ?? '')) return 'stale'
    const effectiveLedger = cardDir && scope !== receiptScope ? ledgerFor(cardDir, receiptScope) : ledgerText
    if (r.ledgerHash != null && (effectiveLedger === null || sha(effectiveLedger) !== r.ledgerHash)) return 'stale'
    if (cardDir) {
      if (!fs.realpathSync(cardDir).startsWith(fs.realpathSync(root) + path.sep)) return 'stale'
      validateScope(cardDir, receiptScope)
      for (const [rel, expected] of Object.entries({ ...r.hashes, ...r.contextHashes })) {
        const actual = readOr(path.join(cardDir, rel))
        if (actual === null || bodyHash(actual) !== expected) return 'stale'
      }
      const now = context(cardDir, receiptScope, gate)
      if (now.dossierHash !== r.dossierHash || now.rootLedgerHash !== r.rootLedgerHash) return 'stale'
      if (JSON.stringify(now.contextHashes) !== JSON.stringify(r.contextHashes ?? {})) return 'stale'
      for (const dep of r.dependencies ?? []) {
        if (receiptDigest(root, cardId, dep.gate, dep.scope) !== dep.digest) return 'stale'
        const receipt = readReceipt(root, cardId, dep.gate, dep.scope)
        for (const rel of Object.keys(receipt?.hashes ?? {})) {
          const actual = readOr(path.join(cardDir, rel))
          if (!['approved', 'auto_passed'].includes(gateStatus(root, cardId, dep.gate, rel, actual, ledgerFor(cardDir, dep.scope)))) return 'stale'
        }
      }
    }
    return r.status === 'auto_passed' ? 'auto_passed' : 'approved'
  } catch { return 'stale' }
}

export function recordAutoGate(root, config, cardId, reason, task = '') {
  if (!reason?.trim()) throw new Error('cần --reason cho Gate B tự qua')
  const card = findCardDir(root, config, cardId)
  if (card.error) throw new Error(card.error)
  const revision = activeRevision(card.dir), scope = [revision, task].filter(Boolean).join('/')
  const dir = validateScope(card.dir, scope)
  const aScope = parentScope(scope)
  const aFile = /^rev-/.test(aScope) ? 'delta.md' : 'brief.md'
  const aRel = [aScope, aFile].filter(Boolean).join('/')
  if (!['approved', 'auto_passed'].includes(gateStatus(root, cardId, 'GATE_A', aRel, readOr(path.join(card.dir, aRel)), ledgerFor(card.dir, aScope)))) throw new Error('Gate A hiện tại chưa hợp lệ')
  const content = readOr(path.join(dir, '03-design.md'))
  const metadata = content?.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1]
  const policy = metadata ? YAML.parse(metadata)?.gate_b : null
  if (!policy || !['new_behavior', 'precedent_deviation', 'open_decisions'].every((key) => policy[key] === false)) throw new Error('design thiếu gate_b đủ ba điều kiện false')
  const rel = [scope, '03-design.md'].filter(Boolean).join('/')
  const rec = { version: 2, receiptId: crypto.randomUUID(), cardId: String(cardId), gate: 'GATE_B', scope, cardDir: path.relative(root, card.dir),
    status: 'auto_passed', approved: false, reason: reason.trim(), policy, at: new Date().toISOString(), hashes: { [rel]: bodyHash(content) },
    ledgerHash: ledgerFor(card.dir, scope) === null ? null : sha(ledgerFor(card.dir, scope)), ...context(card.dir, scope, 'GATE_B'),
    dependencies: [{ gate: 'GATE_A', scope: aScope, digest: receiptDigest(root, cardId, 'GATE_A', aScope) }] }
  storeReceipt(root, cardId, 'GATE_B', scope, rec)
  return rec
}

export const GATE_A_SIZES = ['nho', 'vua', 'lon']
export const GATE_A_FLAGS = ['open_choices', 'user_visible_assumptions', 'hard_risk', 'adversary_blocking', 'reader_blocking']
const FLAG_LABEL = { open_choices: 'còn điểm cần người chọn (open_choices)', user_visible_assumptions: 'có giả định đổi điều người dùng thấy (user_visible_assumptions)', hard_risk: 'chạm vùng rủi ro cứng (hard_risk)', adversary_blocking: 'người phản biện Brief có phát hiện chặn (adversary_blocking)', reader_blocking: 'người đọc thử chưa hiểu đúng (reader_blocking)' }

/** Đọc khối `gate_a:` ở frontmatter Brief/delta. Trả { policy, problems }: problems rỗng khi mọi cờ là boolean false và size hợp lệ không phải lớn. */
export function gateAPolicy(content) {
  const problems = []
  const meta = typeof content === 'string' ? content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] : null
  let policy = null
  try { policy = meta ? YAML.parse(meta)?.gate_a : null } catch { problems.push('frontmatter Brief không đọc được YAML') }
  if (!policy || typeof policy !== 'object') { if (!problems.length) problems.push('Brief thiếu khối frontmatter gate_a'); return { policy: null, problems } }
  if (!GATE_A_SIZES.includes(policy.size)) problems.push(`gate_a.size phải là ${GATE_A_SIZES.join('|')}`)
  else if (policy.size === 'lon') problems.push('thẻ cỡ Lớn luôn hỏi Gate A')
  for (const k of GATE_A_FLAGS) {
    if (typeof policy[k] !== 'boolean') problems.push(`gate_a.${k} phải là boolean thật (true/false), không phải chuỗi`)
    else if (policy[k]) problems.push(FLAG_LABEL[k])
  }
  return { policy, problems }
}

/** Gate A tự qua: ghi receipt hash-bound `auto_passed` (không bao giờ là người duyệt). Điều kiện cấu hình/Brief do gọi hàm kiểm trước bằng gateAProblems. */
export function recordAutoGateA(root, config, cardId, reason) {
  if (!reason?.trim()) throw new Error('cần --reason cho Gate A tự qua')
  const card = findCardDir(root, config, cardId)
  if (card.error) throw new Error(card.error)
  const scope = activeRevision(card.dir) ?? ''
  const file = scope ? 'delta.md' : 'brief.md', rel = [scope, file].filter(Boolean).join('/')
  const content = readOr(path.join(card.dir, rel))
  if (content === null) throw new Error(`chưa có ${rel}`)
  const { policy, problems } = gateAPolicy(content)
  if (problems.length) throw new Error(problems.join('; '))
  const ledger = ledgerFor(card.dir, scope)
  const rec = { version: 2, receiptId: crypto.randomUUID(), cardId: String(cardId), gate: 'GATE_A', scope, cardDir: path.relative(root, card.dir),
    status: 'auto_passed', approved: false, reason: reason.trim(), policy, at: new Date().toISOString(), hashes: { [rel]: bodyHash(content) },
    autoRepos: (config.repos ?? []).map((r) => r.name).filter(Boolean),
    ledgerHash: ledger === null ? null : sha(ledger), ...context(card.dir, scope, 'GATE_A'), dependencies: [] }
  storeReceipt(root, cardId, 'GATE_A', scope, rec)
  return rec
}

// Gate C tự qua (N6): chỉ gọi sau khi `ff gate-auto --gate GATE_C` đã kiểm điều kiện xác định. Băm y như receipt Gate C của người.
export function recordAutoGateC(root, config, cardId, reason, autoChecks = {}) {
  if (!reason?.trim()) throw new Error('cần --reason cho Gate C tự qua')
  const card = findCardDir(root, config, cardId)
  if (card.error) throw new Error(card.error)
  const scope = activeRevision(card.dir) ?? ''
  const hashes = scopedFiles(card.dir, scope, GATE_ARTIFACT.GATE_C)
  if (!Object.keys(hashes).length) throw new Error('chưa có 05-verify-report.md')
  const ledger = ledgerFor(card.dir, scope)
  const rec = { version: 2, receiptId: crypto.randomUUID(), cardId: String(cardId), gate: 'GATE_C', scope, cardDir: path.relative(root, card.dir),
    status: 'auto_passed', approved: false, reason: reason.trim(), at: new Date().toISOString(), hashes,
    ledgerHash: ledger === null ? null : sha(ledger), ...context(card.dir, scope, 'GATE_C'),
    dependencies: dependenciesFor(root, cardId, card.dir, scope, 'GATE_C'), autoChecks }
  storeReceipt(root, cardId, 'GATE_C', scope, rec)
  return rec
}

/** Gate C hiện tại của revision đang mở có phải auto_passed còn hash khớp không; hash gộp các receipt để ràng buộc ship. */
export function gateCAuto(root, cardId, cardDir) {
  const revision = activeRevision(cardDir) ?? ''
  try {
    const rels = Object.keys(scopedFiles(cardDir, revision, GATE_ARTIFACT.GATE_C))
    if (!rels.length) return { ok: false, reason: 'chưa có báo cáo verify', revision }
    const parts = [], exemptAcs = [], manualAcs = [], infraRules = []
    for (const rel of rels) {
      const scope = scopeOf(rel), status = gateStatus(root, cardId, 'GATE_C', rel, readOr(path.join(cardDir, rel)), ledgerFor(cardDir, scope))
      if (status !== 'auto_passed') return { ok: false, reason: `Gate C ${status} (${rel})`, revision }
      const rec = readReceipt(root, cardId, 'GATE_C', scope) ?? (!scope.startsWith('rev-') ? readReceipt(root, cardId, 'GATE_C') : null)
      parts.push([rec.scope ?? '', receiptDigest(root, cardId, 'GATE_C', rec.scope ?? '')])
      exemptAcs.push(...(rec.autoChecks?.exemptAcs ?? []))
      manualAcs.push(...(rec.autoChecks?.manualAcs ?? []))
      infraRules.push(...(rec.autoChecks?.infraRules ?? []))
    }
    return { ok: true, revision, hash: sha(JSON.stringify(parts)), exemptAcs: [...new Set(exemptAcs)], manualAcs, infraRules }
  } catch (e) { return { ok: false, reason: e.message, revision } }
}

export function recordGates(root, config, toolInput, toolResponse, now = new Date()) {
  const out = []
  for (const g of gateQuestions(toolInput)) {
    if (!g.cardId) continue
    // Docs hooks chỉ nêu `answers` trong tool_input; đọc tool_response trước, không có thì tool_input.
    const answer = answerFor(toolResponse, g.question) ?? answerFor(toolInput, g.question)
    const card = findCardDir(root, config, g.cardId)
    if (card.error) throw new Error(card.error)
    const scope = validateGateQuestion(card.dir, g.question)
    const filename = g.gate === 'GATE_A' && scope.startsWith('rev-') ? 'delta.md' : GATE_ARTIFACT[g.gate]
    const artifact = path.join(card.dir, scope, filename)
    const hashes = g.gate === 'GATE_A' ? (fs.existsSync(artifact) ? { [[scope, filename].filter(Boolean).join('/')]: bodyHash(fs.readFileSync(artifact, 'utf8')) } : {}) : scopedFiles(card.dir, scope, filename)
    const rec = {
      version: 2,
      receiptId: crypto.randomUUID(),
      scope,
      cardDir: path.relative(root, card.dir),
      gate: g.gate,
      cardId: g.cardId,
      question: g.question,
      answer,
      approved: (answer ?? '').normalize('NFC').trim() === APPROVE_LABEL,
      at: now.toISOString(),
      hashes,
      ledgerHash: ledgerFor(card.dir, scope) === null ? null : sha(ledgerFor(card.dir, scope)),
      ...context(card.dir, scope, g.gate),
      dependencies: (answer ?? '').normalize('NFC').trim() === APPROVE_LABEL ? dependenciesFor(root, g.cardId, card.dir, scope, g.gate) : [],
    }
    storeReceipt(root, g.cardId, g.gate, scope, rec)
    out.push(rec)
  }
  return out
}

export function isApproved(root, cardId, gate, relPath, content, ledgerText = null) {
  return gateStatus(root, cardId, gate, relPath, content, ledgerText) === 'approved'
}
