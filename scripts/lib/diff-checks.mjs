// Kiểm tất định diff thật của thẻ trước khi autopilot tự qua Gate C / tự ship (SRS 6.4 mục 14).
// (a) file đổi nằm trong danh sách file của plan; (b) không chạm deny_paths; (c) không thêm package mới.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { DEFAULT_DENY_PATHS } from './config.mjs'
import { activeRevision, gateAPolicy } from './gates.mjs'
import { revertAutoGateA } from './gate-a-auto.mjs'

export { DEFAULT_DENY_PATHS }
const DEP_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') { i++; if (glob[i + 1] === '/') { i++; re += '(?:.*/)?' } else re += '.*' }
      else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'i')
}
export const matchDeny = (file, globs) => globs.find((g) => globToRegExp(g).test(file)) ?? null

const normPath = (p) => String(p).trim().replace(/^`+|`+$/g, '').replace(/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?\//, '*/').replace(/^\.\//, '').replace(/:\d+(?:-\d+)?$/, '').replace(/\\/g, '/')
const looksLikePath = (t) => t && !/\s/.test(t) && /[./]/.test(t) && !/^https?:/.test(t) && !/^\*\/?$/.test(t)

/**
 * Danh sách file được ghi trong 04-plan.md. Đọc hai chỗ plan-slice.md quy định:
 *  - dòng `**Files (được ghi):** \`a\`, \`b\`` của từng micro-task (kể cả các dòng gạch đầu dòng nối tiếp tới dòng trống);
 *  - tiêu đề `## Đợt N — tên (file ghi: a, b, c)`.
 */
export function parsePlanFiles(md) {
  const files = new Set(), lines = String(md ?? '').split(/\r?\n/)
  const add = (chunk) => {
    const ticks = [...chunk.matchAll(/`([^`]+)`/g)].map((m) => m[1])
    const rest = chunk.replace(/`[^`]+`/g, ',').replace(/\([^)]*\)/g, ',').split(/[,;]/).map((x) => x.trim()).filter((x) => /^[\w@.\-/$*{}]+$/.test(x))
    for (const t of [...ticks, ...rest]) { const p = normPath(t.replace(/\s*\([^)]*\)\s*$/, '')); if (looksLikePath(p)) files.add(p) }
  }
  let col = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\|/.test(lines[i])) {
      const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|')
      const hi = cells.findIndex((c) => /file\s+ghi|file\s+\(duy nhất được ghi\)|files?\s*\(được ghi\)/i.test(c))
      if (hi >= 0) col = hi
      else if (col >= 0 && !/^\s*:?-{2,}/.test(cells[0] ?? '')) add(cells[col] ?? '')
      continue
    }
    col = -1
    const h = lines[i].match(/^#{1,6}\s.*\(\s*file ghi\s*:\s*(.*)\)\s*$/i)
    if (h) add(h[1])
    const m = lines[i].match(/^\s*(?:[-*]\s+)?\*{0,2}Files?\b[^:\n]*:\*{0,2}\s*(.*)$/i)
    if (!m) continue
    add(m[1])
    for (let j = i + 1; j < lines.length && lines[j].trim() && /^\s*(?:[-*]\s|\s)/.test(lines[j]) && !/^\s*\*\*/.test(lines[j]); j++) add(lines[j])
  }
  return files
}

/** Gộp file plan của mọi 04-plan.md trong thư mục thẻ (gốc, task-N, rev-N). */
export function readPlanFiles(cardDir) {
  const files = new Set(); let plans = 0
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'evidence') continue
      const f = path.join(d, e.name)
      if (e.isDirectory()) walk(f)
      else if (e.name === '04-plan.md') { plans++; for (const p of parsePlanFiles(fs.readFileSync(f, 'utf8'))) files.add(p) }
    }
  }
  walk(cardDir)
  return { files, plans }
}

/** Lịch sử `ff allow` của thẻ (.ff/allow-history/<id>.jsonl, ghi bởi CLI, guard cấm agent sửa): file wt-relative `<repo>/<path>`. */
export const allowHistoryFile = (root, cardId) => path.join(root, '.ff', 'allow-history', `${cardId}.jsonl`)
export function recordAllowHistory(root, cardId, { revision = '', slug = '', files }) {
  const f = allowHistoryFile(root, cardId), at = new Date().toISOString()
  fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 })
  fs.appendFileSync(f, files.map((file) => JSON.stringify({ at, cardId: String(cardId), revision, slug, file })).join('\n') + '\n', { mode: 0o600 })
}
export function readAllowHistory(root, cardId, revision = '') {
  const out = new Set()
  try {
    for (const l of fs.readFileSync(allowHistoryFile(root, cardId), 'utf8').split('\n')) {
      if (!l.trim()) continue
      try { const e = JSON.parse(l); if ((e.revision ?? '') === revision && typeof e.file === 'string') out.add(normPath(e.file)) } catch {}
    }
  } catch {}
  return out
}
const planMatch = (set, cands) => cands.some((c) => set.has(c)) || [...set].some((p) => (p.startsWith('*/') && cands.some((c) => c === p.slice(2) || c.endsWith('/' + p.slice(2)))) || (p.endsWith('/') && cands.some((c) => c.startsWith(p))))

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

function baseRef(dir, repo) {
  for (const ref of [`ff-local/${repo.base_branch}`, `origin/${repo.base_branch}`, repo.base_branch]) if (git(dir, ['rev-parse', '--verify', ref]).status === 0) return ref
  return null
}

function depNames(text) {
  const names = new Set()
  try { const j = JSON.parse(text); for (const s of DEP_SECTIONS) for (const n of Object.keys(j?.[s] ?? {})) names.add(n) } catch {}
  return names
}

/** Diff thật của thẻ theo từng repo: {repo, dir, base, mergeBase, files:[repo-relative], addedDeps:[{file, pkg}]}. */
export function collectDiff(root, config, cardDir, { git: g = git } = {}) {
  const wt = path.resolve(root, config.workspace.worktrees_dir, path.basename(cardDir)), out = [], errors = []
  for (const repo of config.repos ?? []) {
    const dir = path.join(wt, path.basename(repo.path))
    if (!fs.existsSync(path.join(dir, '.git'))) continue
    const base = baseRef(dir, repo)
    if (!base) { errors.push(`${repo.name}: không xác định được ${repo.base_branch}`); continue }
    const mb = g(dir, ['merge-base', 'HEAD', base])
    if (mb.status !== 0 || !mb.stdout.trim()) { errors.push(`${repo.name}: merge-base lỗi`); continue }
    const mergeBase = mb.stdout.trim()
    const d = g(dir, ['diff', '--name-only', '--no-renames', '-z', `${mergeBase}..HEAD`])
    if (d.status !== 0) { errors.push(`${repo.name}: git diff lỗi`); continue }
    const files = d.stdout.split('\0').filter(Boolean)
    const addedDeps = []
    for (const f of files.filter((x) => path.posix.basename(x) === 'package.json')) {
      const after = g(dir, ['show', `HEAD:${f}`])
      if (after.status !== 0) continue
      const before = g(dir, ['show', `${mergeBase}:${f}`]), had = before.status === 0 ? depNames(before.stdout) : new Set()
      for (const n of depNames(after.stdout)) if (!had.has(n)) addedDeps.push({ file: f, pkg: n })
    }
    out.push({ repo, dir, files, addedDeps, mergeBase })
  }
  return { repos: out, errors }
}

const e2eDirs = (config) => [config.e2e?.tests_dir, config.e2e?.dir].filter(Boolean).map((d) => normPath(d).replace(/\/+$/, ''))

/**
 * Kiểm diff của thẻ. Trả {ok, violations:{plan:[], deny:[{file,pattern}], deps:[{file,pkg}], errors:[]}, changed:{repo:[files]}, messages:[vi]}.
 * Không tự áp điều kiện autopilot: người gọi quyết định khi nào chạy.
 */
export function checkDiff(root, config, cardDir, opts = {}) {
  const ap = config.autopilot ?? {}
  const globs = [...(Array.isArray(ap.deny_paths) ? ap.deny_paths : DEFAULT_DENY_PATHS)]
  const { files: planFiles, plans } = readPlanFiles(cardDir)
  const cardId = path.basename(cardDir).match(/^[A-Za-z0-9]+/)?.[0] ?? '', allowed = readAllowHistory(root, cardId, activeRevision(cardDir) ?? '')
  const { repos, errors } = collectDiff(root, config, cardDir, opts)
  const v = { plan: [], deny: [], deps: [], errors: [...errors] }, changed = {}
  if (!allowed.size && !planFiles.size) v.errors.push(plans ? 'không có lịch sử `ff allow` và không đọc được danh sách file trong 04-plan.md' : 'không có lịch sử `ff allow` và không có 04-plan.md để đối chiếu file đã đổi')
  if (!repos.length && !errors.length) v.errors.push('không có bản copy repo của thẻ để kiểm diff')
  const tests = e2eDirs(config)
  for (const r of repos) {
    const name = r.repo.name, base = path.basename(r.repo.path), repoGlobs = [...globs, ...(r.repo.autopilot_deny_paths ?? [])]
    changed[name] = r.files
    for (const f of r.files) {
      const rel = path.relative(root, path.join(r.dir, f)).split(path.sep).join('/')
      const cands = [f, `${base}/${f}`, `${name}/${f}`], inPlan = planMatch(allowed, cands) || planMatch(planFiles, cands)
      const isTest = tests.some((t) => f === t || f.startsWith(t + '/') || rel.includes('/' + t + '/'))
      if (!inPlan && !isTest) v.plan.push(`${name}/${f}`)
      const hit = matchDeny(f, repoGlobs)
      if (hit) v.deny.push({ file: `${name}/${f}`, pattern: hit })
    }
    for (const d of r.addedDeps) v.deps.push({ file: `${name}/${d.file}`, pkg: d.pkg })
  }
  const messages = [
    ...v.errors.map((e) => `diff: ${e}`),
    ...(v.plan.length ? [`file đã đổi nhưng không có trong lịch sử \`ff allow\` hay plan (04-plan.md): ${v.plan.join(', ')}`] : []),
    ...(v.deny.length ? [`file chạm vùng cấm của autopilot (deny_paths): ${v.deny.map((d) => `${d.file} [${d.pattern}]`).join(', ')}`] : []),
    ...(v.deps.length ? [`thêm package mới: ${v.deps.map((d) => `${d.pkg} (${d.file})`).join(', ')}`] : []),
  ]
  return { ok: !messages.length, violations: v, changed, messages }
}

/**
 * Cổng tự lái: chỉ chạy khi autopilot.enabled. Trả {skipped, ok, messages, autoChecks:{diff}, reverted}.
 * Chạm deny_paths trong khi Gate A tự qua với hard_risk=false → rút lại Gate A (khai sai).
 */
export async function enforceDiffChecks(root, config, cardDir, cardId, opts = {}) {
  if (config.autopilot?.enabled !== true) return { skipped: true, ok: true, messages: [], autoChecks: {}, reverted: [] }
  const r = checkDiff(root, config, cardDir, opts)
  let reverted = []
  if (r.violations.deny.length) {
    const rev = activeRevision(cardDir) ?? ''
    let policy = null
    try { policy = gateAPolicy(fs.readFileSync(path.join(cardDir, rev, rev ? 'delta.md' : 'brief.md'), 'utf8')).policy } catch {}
    if (policy?.hard_risk === false) {
      try { reverted = await revertAutoGateA(root, config, cardId, { scopes: [rev], reason: `khai không rủi ro nhưng diff chạm ${r.violations.deny[0].file}` }) } catch {}
      if (reverted.length) r.messages.push('Gate A tự qua đã bị rút lại: Brief khai hard_risk=false nhưng diff chạm vùng cấm')
    }
  }
  const diff = { ok: r.ok, at: new Date().toISOString(), changed: r.changed, planViolations: r.violations.plan, denyHits: r.violations.deny, newDependencies: r.violations.deps, errors: r.violations.errors }
  return { skipped: false, ok: r.ok, messages: r.messages, autoChecks: { diff }, reverted }
}
