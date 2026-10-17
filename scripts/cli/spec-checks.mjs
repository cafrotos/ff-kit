import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { checkFileRefs, refSearchRoot } from '../lib/file-refs.mjs'
import { findCardDir } from '../lib/cards.mjs'
import { activeRevision } from '../lib/gates.mjs'

const hash = (v) => crypto.createHash('sha256').update(v).digest('hex')
const inside = (base, target) => { const rel = path.relative(base, target); return Boolean(rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)) }
const normalizeAc = (number, suffix = '', revision = '') =>
  `AC-${revision ? `${revision.toUpperCase()}-` : ''}${String(Number(number)).padStart(2, '0')}${suffix.toLowerCase()}`
const acMatches = (a, b) => {
  const x = a.match(/^AC-(?:([A-Z0-9]+)-)?(\d+)([a-z]?)$/i)
  const y = b.match(/^AC-(?:([A-Z0-9]+)-)?(\d+)([a-z]?)$/i)
  return Boolean(x && y && (x[1] ?? '') === (y[1] ?? '') && x[2] === y[2] && (!x[3] || !y[3] || x[3].toLowerCase() === y[3].toLowerCase()))
}

function getContext(ctx, id, task, fileName) {
  const root = findRoot(ctx.cwd)
  if (!root) throw new Error('không thấy ff.config.yaml')
  const config = loadConfig(root).config
  const card = findCardDir(root, config, id)
  if (card.error) throw new Error(card.error)
  const revision = activeRevision(card.dir)
  const current = revision ?? ''
  const clusters = (base) => fs.readdirSync(path.join(card.dir, base), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^task-\d+(?:-[A-Za-z0-9-]+)?$/.test(entry.name))
    .map((entry) => [base, entry.name].filter(Boolean).join('/'))
    .filter((name) => fs.existsSync(path.join(card.dir, name, fileName))).sort()
  let selected
  if (task) {
    if (/^rev-[1-9]\d*(?:\/task-\d+(?:-[A-Za-z0-9-]+)?)?$/.test(task)) {
      selected = task.includes('/') ? [task] : clusters(task)
      if (!selected.length) selected = [task]
    } else {
      const key = task.match(/^task-\d+(?:-[A-Za-z0-9-]+)?$/)?.[0]
      if (!key) throw new Error(`task phải dạng task-N, rev-N hoặc rev-N/task-N, nhận '${task}'`)
      selected = clusters(current).filter((name) => path.basename(name) === key || path.basename(name).startsWith(key + '-'))
    }
    if (!selected.length || selected.some((name) => !fs.existsSync(path.join(card.dir, name, fileName)))) throw new Error(`không thấy thư mục ${task}`)
  } else {
    selected = clusters(current)
    if (!selected.length) selected = [current]
  }
  return {
    root, config, card: card.dir, activeRevision: revision,
    docs: selected.map((name) => ({ task: name || null, file: path.join(card.dir, name, fileName) })),
  }
}

export function parseSpecAcs(text) {
  return [...text.matchAll(/^\s*[-*]\s+\*\*AC-(?:([A-Za-z0-9]+)-)?(\d+)([a-z]?)\*\*\s*[—–-]*\s*(.*)$/gm)]
    .map((m) => ({ id: normalizeAc(m[2], m[3], m[1]), dropped: /^_?\(bỏ/i.test(m[4].trim()) }))
}

function titleAcs(title) {
  const ids = []
  const first = title.match(/AC-(?:([A-Za-z0-9]+)-)?(\d+)([a-z]?)(?![\w])/i)
  if (!first) return ids
  ids.push(normalizeAc(first[2], first[3], first[1]))
  let rest = title.slice(first.index + first[0].length)
  for (;;) {
    const next = rest.match(/^\s*(?:\([^)]*\))?\s*(?:,|&|\/|và)\s*(?:AC-)?(?:([A-Za-z0-9]+)-)?(\d+)([a-z]?)(?![\w])/i)
    if (!next) break
    ids.push(normalizeAc(next[2], next[3], next[1]))
    rest = rest.slice(next[0].length)
  }
  return ids
}

function scanTests(file, label = path.basename(file)) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  const found = []
  let active = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*\/\//.test(line)) continue
    const start = line.match(/^\s*(?:test|it)(?:\.(skip|fixme|only))?\(\s*(['"`])(.*)$/)
    const continuation = !start && line.match(/^\s*(?:test|it)(?:\.(skip|fixme|only))?\(\s*$/)
      ? lines[i + 1]?.match(/^\s*(['"`])(.*)$/)
      : null
    if (start || continuation) {
      const mod = start?.[1] ?? (continuation ? line.match(/^\s*(?:test|it)(?:\.(skip|fixme|only))?/)?.[1] : null)
      const title = start?.[3] ?? continuation?.[2] ?? ''
      active = { ids: titleAcs(title), skip: mod === 'skip' || mod === 'fixme', conditional: false, line: i + 1, file: label }
      found.push(active)
      continue
    }
    if (active && /\btest\.skip\(/.test(line)) active.conditional = true
  }
  return found
}

// Unit tests live in the card worktree, not under e2e.tests_dir; the lock manifests (.ff-test-lock[.rev-N]) list them.
function lockedTestFiles(root, config, cardSlug, skipUnder) {
  const dir = path.join(root, config.workspace.worktrees_dir, cardSlug)
  let names = []
  try { names = fs.readdirSync(dir).filter((n) => /^\.ff-test-lock(?:\.rev-\d+)?$/.test(n)).sort() } catch { return [] }
  const files = new Set()
  for (const name of names) {
    let raw = ''
    try { raw = fs.readFileSync(path.join(dir, name), 'utf8') } catch { continue }
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^[a-f0-9]{64}\s{2}(.+)$/)
      if (!m) continue
      const target = path.resolve(root, m[1])
      if (!inside(root, target) || (skipUnder && inside(skipUnder, target)) || !fs.existsSync(target) || !fs.statSync(target).isFile()) continue
      files.add(target)
    }
  }
  return [...files].sort()
}

function readLock(root, config, cardSlug, task) {
  const file = path.join(root, config.workspace.worktrees_dir, cardSlug, '.ff-test-lock' + (task?.startsWith('rev-') ? `.${task}` : ''))
  if (!fs.existsSync(file)) return { found: false, bad: [] }
  const raw = fs.readFileSync(file)
  const bad = []
  for (const line of raw.toString().split(/\r?\n/)) {
    const m = line.match(/^([a-f0-9]{64})\s{2}(.+)$/)
    if (!line.trim()) continue
    if (!m) { bad.push('.ff-test-lock (manifest không hợp lệ)'); continue }
    if (task?.startsWith('task-') && !path.basename(m[2]).startsWith(`${task}-`)) continue
    const target = path.resolve(root, m[2])
    if (!inside(root, target)) { bad.push(m[2]); continue }
    const actual = fs.existsSync(target) ? hash(fs.readFileSync(target)) : null
    if (actual !== m[1]) bad.push(m[2])
  }
  return { found: true, digest: hash(raw).slice(0, 8), bad }
}

export const acMatrix = {
  summary: 'ac-matrix <id> [task-N] — đối chiếu acceptance criteria với test',
  async run(args, ctx) {
    try {
      const id = args[0]
      if (!id) throw new Error('dùng: ff ac-matrix <id> [task-N]')
      const c = getContext(ctx, id, args[1], '02-spec.md')
      const testRoot = c.config.e2e?.tests_dir
        ? path.resolve(c.root, c.config.e2e.tests_dir, path.basename(c.card))
        : null
      const testFiles = testRoot && fs.existsSync(testRoot)
        ? fs.readdirSync(testRoot).filter((name) => name.endsWith('.spec.ts')).sort()
        : []
      const lockedFiles = lockedTestFiles(c.root, c.config, path.basename(c.card), testRoot)
      const total = { COVERED: 0, SKIP: 0, MISSING: 0, ORPHAN: 0, DROPPED: 0 }
      let failed = false
      for (const doc of c.docs) {
        if (!fs.existsSync(doc.file)) throw new Error(`không thấy ${path.relative(c.root, doc.file)}`)
        const acs = parseSpecAcs(fs.readFileSync(doc.file, 'utf8'))
        if (!acs.length) throw new Error(`spec không có AC: ${path.relative(c.root, doc.file)}`)
        const revisionName = doc.task?.match(/^rev-[1-9]\d*/)?.[0]
        const clusterName = doc.task ? path.basename(doc.task) : null
        const prefix = revisionName && clusterName !== revisionName ? `${revisionName}-${clusterName}` : clusterName
        const names = testFiles.filter((name) => !prefix || name.startsWith(`${prefix}-`) || name.startsWith(`${prefix}.`))
        const tests = [...names.flatMap((name) => scanTests(path.join(testRoot, name))), ...lockedFiles.flatMap((file) => scanTests(file, path.relative(c.root, file)))]
        const local = { COVERED: 0, SKIP: 0, MISSING: 0, ORPHAN: 0, DROPPED: 0 }
        ctx.stdout.write(`\n== ${path.relative(c.root, doc.file)} — ${acs.length} AC, ${names.length + lockedFiles.length} file test\n`)
        for (const ac of acs) {
          const matches = tests.filter((t) => t.ids.some((id) => acMatches(id, ac.id)))
          const state = ac.dropped ? 'DROPPED' : !matches.length ? 'MISSING' : matches.some((t) => !t.skip && !t.conditional) ? 'COVERED' : 'SKIP'
          local[state]++
          const locations = matches.map((t) => `${t.file}:${t.line}${t.skip ? ' (skip)' : t.conditional ? ' (skip có điều kiện)' : ''}`).join(', ')
          ctx.stdout.write(`${ac.id}: ${state}${locations ? ` — ${locations}` : ''}\n`)
        }
        for (const t of tests) for (const testId of t.ids) {
          if (acs.some((ac) => acMatches(testId, ac.id))) continue
          local.ORPHAN++
          ctx.stdout.write(`${testId}: ORPHAN — ${t.file}:${t.line}\n`)
        }
        for (const key of Object.keys(total)) total[key] += local[key]
        if (local.SKIP || local.MISSING) failed = true
        ctx.stdout.write(`Tổng: COVERED ${local.COVERED}, SKIP ${local.SKIP}, MISSING ${local.MISSING}, ORPHAN ${local.ORPHAN}, DROPPED ${local.DROPPED}\n`)
      }
      const selectedLock = args[1]?.startsWith('rev-') ? args[1].split('/')[0] : c.activeRevision ?? (args[1]?.startsWith('task-') ? args[1].match(/^task-\d+/)?.[0] : null)
      const lock = readLock(c.root, c.config, path.basename(c.card), selectedLock)
      if (lock.found) {
        ctx.stdout.write(`\nTest lock: manifest ${lock.digest}\n`)
        for (const item of lock.bad) ctx.stdout.write(`❌ HASH ĐỔI ${item}\n`)
        if (!lock.bad.length) ctx.stdout.write('hash khớp\n')
        if (lock.bad.length) failed = true
      } else { ctx.stdout.write('\nChưa khóa test (.ff-test-lock không có)\n'); if (selectedLock?.startsWith('rev-')) failed = true }
      ctx.stdout.write(`\n${failed ? '→ KHÔNG SẠCH' : '→ SẠCH'}\n`)
      return failed ? 1 : 0
    } catch (error) { ctx.stderr.write(`ff ac-matrix: ${error.message}\n`); return 1 }
  },
}

export const designCheck = {
  summary: 'design-check <id> [task-N] — kiểm tham chiếu file:line trong design',
  async run(args, ctx) {
    try {
      if (!args[0]) throw new Error('dùng: ff design-check <id> [task-N]')
      const c = getContext(ctx, args[0], args[1], '03-design.md')
      let bad = 0
      const extensions = /\.(?:tsx?|jsx?|mjs|cjs|json|less|css|scss|sql|ya?ml|md|sh|html)$/
      const excluded = new Set(['node_modules', 'dist', 'build', '.turbo', '.git', 'coverage'])
      const files = []
      const walk = (dir) => {
        let entries
        try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
        for (const entry of entries) {
          if (excluded.has(entry.name)) continue
          const file = path.join(dir, entry.name)
          if (entry.isDirectory()) walk(file)
          else if (extensions.test(entry.name)) files.push(file)
        }
      }
      const searchRoot = refSearchRoot(c.root, c.config, c.card)
      for (const repo of c.config.repos) walk(path.join(searchRoot, path.basename(repo.path)))
      for (const doc of c.docs) {
        if (!fs.existsSync(doc.file)) throw new Error(`không thấy ${path.relative(c.root, doc.file)}`)
        const text = fs.readFileSync(doc.file, 'utf8')
        for (const { ref, reason } of checkFileRefs(text, { searchRoot, repos: c.config.repos })) { ctx.stdout.write(`❌ ${ref} — ${reason}\n`); bad++ }
        const identifiers = new Set([...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim()).filter((s) => s.length >= 4 && /^[A-Za-z_$][\w$]*(?:\.[\w$]+)*(?:\(\))?$/.test(s)))
        const tokens = new Set()
        for (const file of files) {
          try { if (fs.statSync(file).size <= 2_000_000) for (const token of fs.readFileSync(file, 'utf8').matchAll(/[A-Za-z_$][\w$]*/g)) tokens.add(token[0]) } catch {}
        }
        for (const identifier of identifiers) {
          const last = identifier.replace(/\(\)$/, '').split('.').at(-1)
          if (!tokens.has(last)) ctx.stdout.write(`⚠️ \`${identifier}\` — không tìm thấy trong repo\n`)
        }
      }
      ctx.stdout.write(`\nTổng: ❌ ${bad}\n`)
      return bad ? 1 : 0
    } catch (error) { ctx.stderr.write(`ff design-check: ${error.message}\n`); return 1 }
  },
}
