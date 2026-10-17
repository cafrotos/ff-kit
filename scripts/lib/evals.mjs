// Mức 5 (EVO-02/03): fixture từ thẻ thật, runner `claude -p`, grader mù A/B, bảng so cặp.
// Dữ liệu dự án chỉ nằm ở workspace (.ff/evals/), không bao giờ vào plugin. Mọi chỗ gọi LLM đều tiêm được (test dùng giả).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import YAML from 'yaml'
import { findCardDir } from './cards.mjs'
import { DEFAULTS } from './config.mjs'
import { redactHumanText } from './human-output.mjs'
import { readKnowledgeEvents } from './knowledge-log.mjs'
import { ledgerFor } from './gates.mjs'
import { readShipTest } from './ship-test-record.mjs'
import { readShipState } from './ship-store.mjs'
import { readRevisionMeta } from '../cli/repo-common.mjs'
import { leafKeys } from './lock.mjs'

export const LABELS = ['sửa được', 'không đổi', 'tệ đi', 'nhiễu']
export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SHA_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const GRADE_SCORE = { 'đạt': 1, 'một phần': 0.5, 'trượt': 0 }
const CARDS_DIR = 'cards'

export const evolveCfg = config => ({ ...DEFAULTS.evolve, ...(config?.evolve ?? {}) })
export const skillKey = skill => String(skill ?? '').replace(/^ff-kit:/, '').toLowerCase()
export const evalDirs = root => ({ fixtures: path.join(root, '.ff/evals/fixtures'), runs: path.join(root, '.ff/evals/runs'), grades: path.join(root, '.ff/evals/grades') })
const stamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
const rid = () => Math.random().toString(16).slice(2, 6)
const mkdir = p => fs.mkdirSync(p, { recursive: true, mode: 0o700 })
const write = (p, text) => { mkdir(path.dirname(p)); fs.writeFileSync(p, text) }
const readOr = (p, d = '') => { try { return fs.readFileSync(p, 'utf8') } catch { return d } }

/** Thư mục gốc plugin (chứa .claude-plugin/plugin.json), chạy được cả từ source lẫn dist/ đã bundle. */
export function pluginRoot(from = path.dirname(fileURLToPath(import.meta.url))) {
  for (let d = from; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.claude-plugin', 'plugin.json'))) return d
    if (path.dirname(d) === d) throw new Error('không tìm thấy thư mục plugin ff-kit')
  }
}

// ---- Lọc secret (không bao giờ đọc file secret; chỉ lọc chuỗi đã đọc từ dossier/ledger/transcript) ----
export function redactText(value) {
  return redactHumanText(value)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[REDACTED]')
    .replace(/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g, '[REDACTED]')
    .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED]')
    .replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g, m => /^[0-9a-f]+$/i.test(m) ? m : '[REDACTED]')
}

// ---- Gọi claude -p (tiêm được) ----
const scrubEnv = env => Object.fromEntries(Object.entries(env ?? process.env).filter(([k]) => /^(ANTHROPIC|CLAUDE)_/.test(k) || !/(TOKEN|SECRET|PASSWORD|API_?KEY|CREDENTIAL)/i.test(k)))
export function runClaude(args, { cwd, input, timeoutMs = 900000, env, bin = 'claude' } = {}) {
  return new Promise(resolve => {
    const started = Date.now(), cap = 20 * 1024 * 1024
    let out = '', err = '', timedOut = false, done = false
    const p = spawn(bin, args, { cwd, env: scrubEnv(env), stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
    const finish = r => { if (done) return; done = true; clearTimeout(timer); resolve({ transcript: out, stderr: err, durationMs: Date.now() - started, timedOut, ...r }) }
    const timer = setTimeout(() => { timedOut = true; p.kill('SIGKILL') }, timeoutMs)
    p.stdout.on('data', b => { if (out.length < cap) out += b })
    p.stderr.on('data', b => { if (err.length < cap) err += b })
    p.on('error', e => finish({ exitCode: -1, stderr: err + e.message }))
    p.on('close', code => finish({ exitCode: code ?? -1 }))
    if (input !== undefined) p.stdin.end(input)
  })
}
/** stream-json → văn bản kết quả cuối (event `result`), rơi về toàn bộ transcript nếu không parse được. */
export function finalText(transcript) {
  let last = ''
  for (const line of String(transcript).split('\n')) {
    try { const ev = JSON.parse(line); if (ev?.type === 'result' && typeof ev.result === 'string') last = ev.result } catch { /* dòng không phải JSON */ }
  }
  return last || String(transcript)
}
export function extractJson(text) {
  if (text && typeof text === 'object') return text
  const s = String(text ?? '')
  const tries = [s.trim(), ...[...s.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(m => m[1]).reverse(), s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)]
  for (const t of tries) { try { const v = JSON.parse(t); if (v && typeof v === 'object') return v } catch { /* thử cách khác */ } }
  throw new Error('không đọc được JSON từ đầu ra LLM')
}

// ---- Fixture từ thẻ thật (EVO-02) ----
export const FIXTURE_README = `# Fixture eval (workspace-local)

Sinh bởi \`ff eval fixture <thẻ> [--revision rev-N]\` từ phiếu "vì sao lọt" đã được người xác nhận (\`escape_recorded\`). Chứa dữ liệu dự án (đã lọc secret): chỉ nằm ở \`.ff/evals/\`, không chép vào plugin; chỉ đưa bản đã lọc vào \`docs/skill-evals/fixtures/\` khi người duyệt.

Cùng định dạng với \`docs/skill-evals/fixtures/\` của plugin:

\`\`\`
<suite>/                 suite = tên skill (ví dụ ff-understand)
  expected.md            bảng đáp án: | Ca | Đúng | Sai nếu |   (mỗi ca một dòng)
  results.md             bảng so cặp: | Ca | A (hiện tại) | B (vá) | Nhãn |   — nhãn: sửa được | không đổi | tệ đi | nhiễu
  <case>/                case = <thẻ>-<revision>
    case.json            meta: cardId, revision, skill, route, phase, prompt, repos[{name,path,baseSha,featureSha}]
    dossier.md           đầu vào: dossier đã lọc secret (cái agent thấy lúc bắt đầu thẻ)
    git-facts.md         sha các repo lúc đó (baseSha = trạng thái code lúc làm; featureSha = commit đã ship)
    prompt.md            lời nhắc cố định giao cho \`claude -p\`
    expected.md          kết quả đúng người đã chốt: phiếu lọt + U-xx trong ledger + lý do "Cần sửa" ở Gate
\`\`\`

Nhãn (một nghĩa duy nhất): \`sửa được\` (B đúng, A sai) · \`không đổi\` (hai bản cùng kết quả) · \`tệ đi\` (A đúng, B sai) · \`nhiễu\` (kết quả lệch giữa các lần lặp cùng bản, không kết luận được).
Dossier trong ca là đầu vào lúc bắt đầu thẻ; ledger/đáp án KHÔNG đưa cho agent khi chạy, chỉ cho grader.
`

function repoFacts(root, config, cardDir, cardId, revision, escapedRevision) {
  const safe = fn => { try { return fn() } catch { return null } }
  const rec = safe(() => readShipTest(root, cardId, escapedRevision || '')) ?? safe(() => readShipTest(root, cardId, ''))
  const state = safe(() => readShipState(root, cardId))
  const meta = revision ? safe(() => readRevisionMeta(cardDir, revision)) : null
  return config.repos.map(r => {
    const e = rec?.repos?.[r.name]
    let baseSha = e && !e.noChange ? e.baseSha : '', featureSha = e && !e.noChange ? e.featureSha : ''
    if (!featureSha) featureSha = state?.runs?.at(-1)?.heads?.[r.name] ?? ''
    if (!baseSha) baseSha = meta?.bases?.[r.name] ?? ''
    return { name: r.name, path: r.path, baseBranch: r.base_branch, shipBranch: r.ship_branch, commands: r.commands ?? {}, baseSha: SHA_RE.test(baseSha) ? baseSha : '', featureSha: SHA_RE.test(featureSha) ? featureSha : '' }
  })
}

function gateFixes(root, cardId) {
  const dir = path.join(root, '.ff/gates'), out = []
  let names = []
  try { names = fs.readdirSync(dir).filter(n => n.startsWith(`${cardId}-`) && n.endsWith('.json')) } catch { return out }
  for (const n of names) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))
      if (String(r.cardId) === String(cardId) && r.approved === false && String(r.answer ?? '').trim()) out.push({ cardId: String(cardId), gate: r.gate, scope: r.scope ?? '', at: r.at, answer: redactText(r.answer) })
    } catch { /* receipt hỏng: bỏ qua */ }
  }
  return out
}
const qaFails = (root, cardId) => readKnowledgeEvents(root, { type: 'outcome_recorded' }).filter(e => e.cardId === String(cardId) && e.outcome === 'qa_fail').map(e => ({ cardId: String(cardId), revision: e.revision, detail: redactText(e.detail ?? '') }))
export const gateContext = (root, cardId) => ({ gateFixes: gateFixes(root, cardId), qaFails: qaFails(root, cardId) })

export function phaseOf(skill) {
  const k = skillKey(skill)
  return { 'ff-understand': 'understand', 'ff-build': 'build', 'ff-verify': 'verify' }[k] ?? k
}
export const promptFor = ({ cardId, skill, phase }) => `Bạn chạy trong workspace thử nghiệm của ff-kit, không có người ngồi chờ. Làm thẻ #${cardId} (thư mục ${CARDS_DIR}/${cardId}-eval, dossier là 01-dossier.md) bằng skill ${skillKey(skill)}, chỉ pha ${phase}. Chỗ nào cần hỏi người hoặc tới Gate thì ghi câu hỏi, các lựa chọn và khuyến nghị vào questions.md trong thư mục thẻ rồi dừng; không tự trả lời thay người. Ghi mọi artifact vào thư mục thẻ.`

export function buildFixture(root, config, { cardId, revision = '', suite = '', caseName = '', now = new Date() }) {
  cardId = String(cardId)
  const escapes = readKnowledgeEvents(root, { type: 'escape_recorded' }).filter(e => e.cardId === cardId && (!revision || e.revision === revision))
  if (!escapes.length) throw new Error(`thẻ ${cardId}${revision ? ' ' + revision : ''} chưa có phiếu "vì sao lọt" được người xác nhận (escape_recorded)`)
  const last = escapes.at(-1), rev = revision || last.revision
  const same = escapes.filter(e => e.revision === rev)
  const skill = last.skill
  suite = suite || skillKey(skill)
  caseName = caseName || `${cardId}-${rev || 'root'}`
  if (!NAME_RE.test(suite) || !NAME_RE.test(caseName)) throw new Error('tên suite/ca không hợp lệ')
  const card = findCardDir(root, config, cardId)
  if (card.error) throw new Error(card.error)
  const dossier = redactText(readOr(path.join(card.dir, '01-dossier.md')))
  if (!dossier.trim()) throw new Error('thẻ không có 01-dossier.md')
  const ledgerText = (() => { try { return ledgerFor(card.dir, rev || '') ?? '' } catch { return ledgerFor(card.dir, '') ?? '' } })()
  const uRows = redactText(ledgerText).split('\n').filter(l => /^\|\s*U-\d+\s*\|/.test(l))
  const ctx = gateContext(root, cardId)
  const repos = repoFacts(root, config, card.dir, cardId, rev, last.escapedRevision)
  const phase = phaseOf(skill), prompt = promptFor({ cardId, skill, phase })
  const dir = path.join(evalDirs(root).fixtures, suite, caseName)
  const expected = [
    `# Đáp án (người đã chốt) — thẻ #${cardId} ${rev || 'gốc'}`, '',
    `Skill: ${skillKey(skill)} · ngả lọt: ${same.map(e => e.route).join('/')} (A lỗi triển khai · B spec/Brief thiếu hoặc sai · C yêu cầu mới · D không tái hiện/hiểu khác)`, '',
    '## Vì sao lọt (người xác nhận ở Gate A)', ...same.map(e => `- [${e.route}] ${redactText(e.evidence)}`), '',
    '## Quyết định người đã trả lời (ledger U-xx)', ...(uRows.length ? uRows : ['- (không có)']), '',
    '## Lý do "Cần sửa" ở Gate / QA fail', ...(ctx.gateFixes.length || ctx.qaFails.length ? [...ctx.gateFixes.map(g => `- ${g.gate}${g.scope ? ' ' + g.scope : ''}: ${g.answer}`), ...ctx.qaFails.map(q => `- QA fail ${q.revision || 'gốc'}: ${q.detail || '(không ghi lý do)'}`)] : ['- (không có)']), '',
    'Chấm: kết quả đúng khi agent tránh được đúng lỗi lọt ở trên (không lặp lại), vẫn giữ các quyết định đã chốt, không thêm lỗi mới.', ''].join('\n')
  const facts = ['# Git facts (lúc làm thẻ)', '', '| Repo | Đường dẫn | baseSha (trạng thái code lúc làm) | featureSha (commit đã ship) |', '|---|---|---|---|', ...repos.map(r => `| ${r.name} | ${r.path} | ${r.baseSha || '—'} | ${r.featureSha || '—'} |`), ''].join('\n')
  write(path.join(evalDirs(root).fixtures, 'README.md'), FIXTURE_README)
  write(path.join(dir, 'case.json'), JSON.stringify({ version: 1, cardId, revision: rev, escapedRevision: last.escapedRevision ?? '', skill: skillKey(skill), route: last.route, routes: [...new Set(same.map(e => e.route))], phase, prompt, repos, suite, case: caseName, createdAt: now.toISOString() }, null, 2) + '\n')
  write(path.join(dir, 'dossier.md'), dossier)
  write(path.join(dir, 'git-facts.md'), facts)
  write(path.join(dir, 'prompt.md'), prompt + '\n')
  write(path.join(dir, 'expected.md'), expected)
  upsertRow(path.join(evalDirs(root).fixtures, suite, 'expected.md'), `# Đáp án chấm trước (${suite})`, '| Ca | Đúng | Sai nếu |\n|---|---|---|', caseName, `| ${caseName} | Tránh đúng lỗi lọt (ngả ${last.route}): ${redactText(last.evidence).replace(/\s+/g, ' ').slice(0, 300).replaceAll('|', '/')} | Lặp lại lỗi trên, hoặc đổi quyết định đã chốt (xem ${caseName}/expected.md) |`)
  return { dir, suite, case: caseName, skill: skillKey(skill), route: last.route, repos }
}
function upsertRow(file, title, header, key, row) {
  const old = readOr(file, `${title}\n${header}\n`)
  const lines = old.split('\n').filter(l => !l.startsWith(`| ${key} |`))
  while (lines.length && lines.at(-1) === '') lines.pop()
  write(file, [...lines, row, ''].join('\n'))
}

export function listCases(root, suite) {
  if (!NAME_RE.test(suite)) throw new Error('tên suite không hợp lệ')
  const base = path.join(evalDirs(root).fixtures, suite)
  let names = []
  try { names = fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory() && fs.existsSync(path.join(base, d.name, 'case.json'))).map(d => d.name).sort() } catch { /* chưa có suite */ }
  return names.map(n => ({ ...JSON.parse(fs.readFileSync(path.join(base, n, 'case.json'), 'utf8')), dir: path.join(base, n), case: n }))
}

// ---- Workspace tạm dựng lại từ fixture ----
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' })
export function prepareCaseWorkspace(root, fx, { overlay = {} } = {}) {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ff-eval-')))
  const worktrees = []
  const cleanup = () => {
    for (const w of worktrees) { git(w.src, ['worktree', 'remove', '--force', w.dest]); git(w.src, ['worktree', 'prune']) }
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  try {
    for (const r of fx.repos) {
      const sha = r.baseSha || r.featureSha
      if (!sha) throw new Error(`fixture thiếu sha cho repo ${r.name}`)
      const src = path.join(root, r.path), dest = path.join(tmp, r.path)
      mkdir(path.dirname(dest))
      const res = git(src, ['worktree', 'add', '--detach', dest, sha])
      if (res.status !== 0) throw new Error(`git worktree ${r.name}@${sha.slice(0, 8)}: ${res.stderr.trim()}`)
      worktrees.push({ src, dest })
    }
    const cfg = {
      version: 1, workspace: { root: '.', cards_dir: CARDS_DIR, worktrees_dir: 'worktrees' },
      repos: fx.repos.map(r => ({ name: r.name, path: r.path, base_branch: r.baseBranch, ship_branch: r.shipBranch, commands: Object.keys(r.commands).length ? r.commands : { install: 'true', build: 'true' } })),
      worker: { max_concurrent_tasks: 1, task_source: { adapter: 'local', local: { poll_lists: ['Doing'], done_list: 'Done' } }, channel: { adapter: 'console' } },
      secrets: { env_file: '.ff.env' },
    }
    write(path.join(tmp, 'ff.config.yaml'), YAML.stringify(cfg))
    write(path.join(tmp, 'ff.config.lock.json'), JSON.stringify({ version: 1, sources: Object.fromEntries(leafKeys(cfg).map(({ key }) => [key, 'user'])) }, null, 2))
    mkdir(path.join(tmp, 'worktrees'))
    write(path.join(tmp, CARDS_DIR, `${fx.cardId}-eval`, '01-dossier.md'), readOr(path.join(fx.dir, 'dossier.md')))
    for (const [rel, text] of Object.entries(overlay)) {
      if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new Error('overlay không hợp lệ')
      write(path.join(tmp, rel), text)
    }
    return { dir: tmp, cleanup, cardDir: path.join(tmp, CARDS_DIR, `${fx.cardId}-eval`), repoDirs: fx.repos.map(r => path.join(tmp, r.path)) }
  } catch (e) { cleanup(); throw e }
}

const copyTree = (src, dest) => { try { fs.cpSync(src, dest, { recursive: true, filter: s => !s.includes(`${path.sep}.git${path.sep}`) && !s.endsWith(`${path.sep}.git`) }) } catch { /* không có thì thôi */ } }

/** Chạy một ca một lần cho một bản; thu transcript/state/artifact vào runDir/<ca>/rep-<n>. */
export async function runOnce(root, config, fx, { variantDir, overlay, runner, runDir, rep }) {
  const cfg = evolveCfg(config), out = path.join(runDir, fx.case, `rep-${rep}`)
  mkdir(out)
  let ws
  try { ws = prepareCaseWorkspace(root, fx, { overlay }) } catch (e) {
    write(path.join(out, 'meta.json'), JSON.stringify({ error: e.message, status: 'skipped' }) + '\n')
    return { case: fx.case, rep, status: 'skipped', error: e.message, dir: out }
  }
  try {
    const r = await runner({ variantDir, cwd: ws.dir, prompt: fx.prompt, timeoutMs: cfg.timeout_sec * 1000, permissionMode: cfg.permission_mode, caseId: fx.case, rep })
    const san = t => redactText(String(t ?? '')).split(ws.dir).join('<ws>').split(variantDir).join('<plugin>')
    write(path.join(out, 'transcript.jsonl'), san(r.transcript))
    write(path.join(out, 'stderr.txt'), san(r.stderr))
    write(path.join(out, 'result.md'), san(finalText(r.transcript)))
    ws.repoDirs.forEach((d, i) => {
      const diff = git(d, ['diff', 'HEAD']).stdout + git(d, ['status', '--porcelain']).stdout
      write(path.join(out, `diff-${fx.repos[i].name}.patch`), san(diff))
    })
    copyTree(path.join(ws.dir, '.ff'), path.join(out, 'state'))
    copyTree(ws.cardDir, path.join(out, 'artifacts'))
    write(path.join(out, 'meta.json'), JSON.stringify({ status: r.timedOut ? 'timeout' : 'ok', exitCode: r.exitCode, timedOut: !!r.timedOut, durationMs: r.durationMs ?? null }) + '\n')
    return { case: fx.case, rep, status: r.timedOut ? 'timeout' : 'ok', exitCode: r.exitCode, dir: out }
  } finally { ws.cleanup() }
}

export function defaultRunner({ variantDir, cwd, prompt, timeoutMs, permissionMode }) {
  return runClaude(['-p', prompt, '--plugin-dir', variantDir, '--permission-mode', permissionMode, '--output-format', 'stream-json', '--verbose'], { cwd, timeoutMs })
}

/** Chọn ca theo trần ngân sách: ca được chỉ định (hoặc ưu tiên) trước, cắt ở max_cases. */
export function selectCases(root, config, suite, { cases, prefer = [] } = {}) {
  const cfg = evolveCfg(config)
  let all = listCases(root, suite)
  if (cases?.length) {
    const miss = cases.filter(c => !all.some(a => a.case === c))
    if (miss.length) throw new Error(`không thấy ca: ${miss.join(', ')}`)
    all = cases.map(c => all.find(a => a.case === c))
  } else all = [...all.filter(a => prefer.includes(a.case)), ...all.filter(a => !prefer.includes(a.case))]
  return { selected: all.slice(0, cfg.max_cases), dropped: all.slice(cfg.max_cases).map(a => a.case) }
}
export const clampRepeat = (config, repeat) => Math.max(1, Math.min(repeat ?? evolveCfg(config).repeat, evolveCfg(config).repeat))

function newRunDir(root, suite, label, now, id) {
  const runId = `${suite}-${stamp(now)}-${String(label).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 24)}-${id ?? rid()}`
  const dir = path.join(evalDirs(root).runs, runId)
  mkdir(dir)
  return { runId, dir }
}

/** `ff eval run`: chạy một bản trên các ca (không chấm). */
export async function runVariant(root, config, { suite, variant, label = path.basename(variant), cases, prefer, repeat, runner = defaultRunner, overlay, now = new Date() }) {
  const { selected, dropped } = selectCases(root, config, suite, { cases, prefer })
  const n = clampRepeat(config, repeat)
  const run = newRunDir(root, suite, label, now)
  const results = []
  for (const fx of selected) for (let rep = 1; rep <= n; rep++) results.push(await runOnce(root, config, fx, { variantDir: variant, overlay, runner, runDir: run.dir, rep }))
  const meta = { version: 1, runId: run.runId, suite, label, variant, repeat: n, cases: selected.map(c => c.case), dropped, results: results.map(({ dir, ...r }) => r), createdAt: now.toISOString() }
  write(path.join(run.dir, 'run.json'), JSON.stringify(meta, null, 2) + '\n')
  return meta
}
export const readRun = (root, runId) => {
  if (!NAME_RE.test(runId)) throw new Error('run id không hợp lệ')
  try { return JSON.parse(fs.readFileSync(path.join(evalDirs(root).runs, runId, 'run.json'), 'utf8')) } catch { throw new Error(`không thấy run ${runId}`) }
}

// ---- Grader mù A/B ----
const clip = (t, n) => t.length > n ? t.slice(0, n) + '\n…(cắt)' : t
function walkFiles(dir, base = dir) {
  const out = []
  try { for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const f = path.join(dir, e.name); if (e.isDirectory()) out.push(...walkFiles(f, base)); else out.push(path.relative(base, f)) } } catch { /* thiếu thì thôi */ }
  return out
}
/** Đầu ra của một lần chạy để đưa cho grader: kết quả cuối + artifact + diff. Đã khử đường dẫn plugin. */
export function repMaterial(repDir, scrub = []) {
  const parts = []
  const add = (title, text) => { if (text.trim()) parts.push(`--- ${title}\n${clip(text, 12000)}`) }
  add('kết quả cuối', readOr(path.join(repDir, 'result.md')))
  for (const rel of walkFiles(path.join(repDir, 'artifacts'))) add(`artifact ${rel}`, readOr(path.join(repDir, 'artifacts', rel)))
  for (const f of walkFiles(repDir).filter(f => /^diff-.*\.patch$/.test(f))) add(f, readOr(path.join(repDir, f)))
  if (!parts.length) parts.push('(không có đầu ra)')
  let text = clip(parts.join('\n\n'), 40000)
  for (const s of scrub.filter(Boolean)) text = text.split(s).join('<plugin>')
  return text
}
export function graderPrompt({ expected, items }) {
  return `Bạn là grader mù. Có hai bản chạy ẩn danh X và Y của cùng một ca; mỗi bản có thể có nhiều lần lặp (X1, X2, Y1, …). Bạn không biết và không được đoán bản nào là bản mới hay cũ; không đánh giá theo thứ tự hay độ dài.

Chấm TỪNG lần lặp độc lập, chỉ so với ĐÁP ÁN dưới đây (kết quả đúng người đã chốt): "đạt" = tránh đúng lỗi lọt và giữ các quyết định đã chốt; "một phần" = tránh một phần hoặc đúng nhưng thêm lỗi nhỏ; "trượt" = lặp lại lỗi hoặc đổi quyết định đã chốt hoặc không có đầu ra dùng được. Chấm artifact và hành vi thật, không chấm từ khóa. Mỗi lần lặp nêu 1-3 dòng bằng chứng, trích nguyên văn đoạn trong đầu ra của lần lặp đó.

Trả đúng một khối JSON, không chữ nào khác:
{"verdicts":{"X1":{"grade":"đạt|một phần|trượt","evidence":["..."]},"Y1":{"grade":"...","evidence":["..."]}}}

=== ĐÁP ÁN ===
${expected}

${items.map(i => `=== ${i.id} ===\n${i.text}`).join('\n\n')}
`
}
export const defaultGrader = async ({ prompt, timeoutMs = 600000 }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-grade-'))
  try {
    const r = await runClaude(['-p', '--permission-mode', 'plan', '--disallowedTools', 'Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch', '--output-format', 'text'], { cwd: dir, input: prompt, timeoutMs })
    return r.transcript
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

const mean = a => a.reduce((s, v) => s + v, 0) / a.length
/** Nhãn B so với A từ điểm các lần lặp. Điểm null (grader thiếu kết luận) → nhiễu. */
export function labelFor(a, b) {
  if (!a.length || !b.length || [...a, ...b].some(v => v === null || v === undefined)) return 'nhiễu'
  const spread = s => Math.max(...s) - Math.min(...s)
  const overlap = Math.min(Math.max(...a), Math.max(...b)) >= Math.max(Math.min(...a), Math.min(...b))
  const d = mean(b) - mean(a)
  if (Math.max(spread(a), spread(b)) >= 0.5 && overlap) return 'nhiễu'
  if (Math.abs(d) < 0.25) return 'không đổi'
  return d > 0 ? 'sửa được' : 'tệ đi'
}

async function gradeCase({ root, fx, repsA, repsB, grader, random, scrub }) {
  const flip = random() < 0.5 // true: X = B (bản vá), false: X = A
  const blind = flip ? { X: 'B', Y: 'A' } : { X: 'A', Y: 'B' }
  const side = { A: repsA, B: repsB }
  const items = ['X', 'Y'].flatMap(l => side[blind[l]].map((r, i) => ({ id: `${l}${i + 1}`, side: blind[l], text: repMaterial(r.dir, scrub) })))
  const expected = readOr(path.join(fx.dir, 'expected.md'))
  const raw = await grader({ prompt: graderPrompt({ expected, items: items.map(({ id, text }) => ({ id, text })) }), caseName: fx.case })
  const verdicts = extractJson(raw).verdicts ?? {}
  const unblind = s => String(s).replace(/\b([XY])(\d+)\b/g, (_, l, n) => `${blind[l]}${n}`).replace(/\bbản ([XY])\b/gi, (_, l) => `bản ${blind[l.toUpperCase()]}`)
  const scores = { A: [], B: [] }, evidence = { A: [], B: [] }, grades = { A: [], B: [] }
  for (const it of items) {
    const v = verdicts[it.id], score = GRADE_SCORE[v?.grade]
    scores[it.side].push(score ?? null)
    grades[it.side].push(v?.grade ?? null)
    evidence[it.side].push(...(Array.isArray(v?.evidence) ? v.evidence : [score === undefined ? 'grader không trả kết luận hợp lệ' : '']).filter(Boolean).map(unblind))
  }
  return { case: fx.case, label: labelFor(scores.A, scores.B), scores, grades, evidence, blind }
}

/** Chạy cặp: một baseline, nhiều variant; chấm từng ca ngay sau khi chạy xong, dừng variant nào có `tệ đi`. */
export async function evalPair(root, config, { suite, baseline, variants, cases, prefer, repeat, runner = defaultRunner, grader = defaultGrader, random = Math.random, now = new Date() }) {
  const { selected, dropped } = selectCases(root, config, suite, { cases, prefer })
  const n = clampRepeat(config, repeat)
  const runA = newRunDir(root, suite, 'A-' + path.basename(baseline.dir), now)
  const state = variants.map(v => ({ v, run: newRunDir(root, suite, 'B-' + v.key, now), cases: [], stopped: false, skipped: [] }))
  const scrub = [baseline.dir, ...variants.map(v => v.dir)]
  for (const fx of selected) {
    if (state.every(s => s.stopped)) break
    const repsA = []
    for (let rep = 1; rep <= n; rep++) repsA.push(await runOnce(root, config, fx, { variantDir: baseline.dir, overlay: baseline.overlay, runner, runDir: runA.dir, rep }))
    for (const s of state) {
      if (s.stopped) { s.skipped.push(fx.case); continue }
      const repsB = []
      for (let rep = 1; rep <= n; rep++) repsB.push(await runOnce(root, config, fx, { variantDir: s.v.dir, overlay: s.v.overlay, runner, runDir: s.run.dir, rep }))
      const bad = [...repsA, ...repsB].find(r => r.status === 'skipped')
      if (bad) { s.cases.push({ case: fx.case, label: 'nhiễu', scores: { A: [], B: [] }, grades: { A: [], B: [] }, evidence: { A: [], B: [] }, blind: null, note: `không chạy được: ${bad.error}` }); continue }
      const g = await gradeCase({ root, fx, repsA, repsB, grader, random, scrub })
      s.cases.push(g)
      if (g.label === 'tệ đi') s.stopped = true
    }
  }
  const unrun = selected.map(c => c.case)
  const out = []
  for (const s of state) {
    const pairId = `${runA.runId}__${s.run.runId}`
    const grade = { version: 1, pairId, suite, key: s.v.key, runA: runA.runId, runB: s.run.runId, repeat: n, cases: s.cases, stoppedEarly: s.stopped, skipped: [...s.skipped, ...unrun.filter(c => !s.cases.some(x => x.case === c) && !s.skipped.includes(c))], dropped, createdAt: now.toISOString() }
    write(path.join(evalDirs(root).grades, `${pairId}.json`), JSON.stringify(grade, null, 2) + '\n')
    for (const [r, label] of [[runA, 'A'], [s.run, 'B']]) write(path.join(r.dir, 'run.json'), JSON.stringify({ version: 1, runId: r.runId, suite, side: label, repeat: n, createdAt: now.toISOString() }, null, 2) + '\n')
    out.push({ key: s.v.key, grade })
  }
  return out
}

/** `ff eval grade <run-a> <run-b>`: chấm hai run đã có (ca chung của hai run). */
export async function gradeRuns(root, config, { runA, runB, grader = defaultGrader, random = Math.random, now = new Date() }) {
  const a = readRun(root, runA), b = readRun(root, runB)
  if (a.suite !== b.suite) throw new Error('hai run khác suite')
  const fxs = listCases(root, a.suite)
  const common = a.cases.filter(c => b.cases.includes(c))
  if (!common.length) throw new Error('hai run không có ca chung')
  const cases = []
  for (const c of common) {
    const fx = fxs.find(x => x.case === c)
    if (!fx) continue
    const reps = (m, id) => m.results.filter(r => r.case === c && r.status !== 'skipped').map(r => ({ ...r, dir: path.join(evalDirs(root).runs, id, c, `rep-${r.rep}`) }))
    const g = await gradeCase({ root, fx, repsA: reps(a, runA), repsB: reps(b, runB), grader, random, scrub: [a.variant, b.variant] })
    cases.push(g)
    if (g.label === 'tệ đi') break
  }
  const pairId = `${runA}__${runB}`
  const grade = { version: 1, pairId, suite: a.suite, runA, runB, repeat: Math.max(a.repeat, b.repeat), cases, stoppedEarly: cases.some(c => c.label === 'tệ đi'), skipped: common.filter(c => !cases.some(x => x.case === c)), dropped: [], createdAt: now.toISOString() }
  write(path.join(evalDirs(root).grades, `${pairId}.json`), JSON.stringify(grade, null, 2) + '\n')
  return grade
}

export const readGrade = (root, pairId) => {
  if (!/^[A-Za-z0-9._-]+$/.test(pairId)) throw new Error('pair id không hợp lệ')
  try { return JSON.parse(fs.readFileSync(path.join(evalDirs(root).grades, `${pairId}.json`), 'utf8')) } catch { throw new Error(`không thấy kết quả chấm ${pairId}`) }
}
const cell = (grades, scores) => grades.length ? `${[...new Set(grades)].map(g => `${g ?? '?'} ×${grades.filter(x => x === g).length}`).join(', ')}` : '—'
export const countLabels = grade => Object.fromEntries(LABELS.map(l => [l, grade.cases.filter(c => c.label === l).length]))
export function renderReport(grade) {
  const c = countLabels(grade)
  const rows = grade.cases.map(x => `| ${x.case} | ${cell(x.grades.A)} | ${cell(x.grades.B)} | ${x.label} | ${[...(x.evidence.A ?? []).map(e => `A: ${e}`), ...(x.evidence.B ?? []).map(e => `B: ${e}`), ...(x.note ? [x.note] : [])].join('<br>').replaceAll('|', '/') || '—'} |`)
  return [`# So cặp ${grade.suite} — A = hiện tại (${grade.runA}), B = vá (${grade.runB}), lặp ${grade.repeat}`, '',
    '| Ca | A (hiện tại) | B (vá) | Nhãn | Bằng chứng |', '|---|---|---|---|---|', ...rows, '',
    `Tổng: ${LABELS.map(l => `${c[l]} ${l}`).join(' · ')}.`,
    ...(grade.stoppedEarly ? ['Dừng sớm: có `tệ đi`.'] : []),
    ...(grade.skipped?.length ? [`Chưa chạy: ${grade.skipped.join(', ')}.`] : []),
    ...(grade.dropped?.length ? [`Vượt trần ca, bỏ: ${grade.dropped.join(', ')}.`] : []), ''].join('\n')
}
/** Ghi bảng vào results.md của suite theo định dạng chung (mới nhất ở cuối). */
export function appendSuiteResults(root, suite, markdown) {
  const f = path.join(evalDirs(root).fixtures, suite, 'results.md')
  write(f, readOr(f, '') + (readOr(f, '') ? '\n' : '') + markdown)
}
