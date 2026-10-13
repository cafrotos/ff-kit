import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { findCardDir } from '../lib/cards.mjs'

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
  const dirs = fs.readdirSync(card.dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^(?:task-\d+|rev-\d+)/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]))
  let selected
  if (task) {
    if (/^rev-\d+/.test(task)) selected = dirs.filter((name) => name === task)
    else {
      const key = task.match(/^task-\d+/)?.[0]
      if (!key) throw new Error(`task phải dạng task-N hoặc rev-N, nhận '${task}'`)
      selected = dirs.filter((name) => name === key || name.startsWith(`${key}-`))
    }
    if (!selected.length) throw new Error(`không thấy thư mục ${task}`)
  } else {
    const revs = dirs.filter((name) => /^rev-\d+/.test(name)).sort((a, b) => Number(b.match(/\d+/)?.[0]) - Number(a.match(/\d+/)?.[0]))
    selected = revs.length && fs.existsSync(path.join(card.dir, revs[0], fileName))
      ? [revs[0]]
      : dirs.filter((name) => fs.existsSync(path.join(card.dir, name, fileName)))
    if (!selected.length) selected = ['']
  }
  return {
    root, config, card: card.dir,
    docs: selected.map((name) => ({ task: name || null, file: path.join(card.dir, name, fileName) })),
  }
}

function parseSpecAcs(text) {
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

function scanTests(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  const found = []
  let active = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*\/\//.test(line)) continue
    const start = line.match(/^\s*test(?:\.(skip|fixme|only))?\(\s*(['"`])(.*)$/)
    const continuation = !start && line.match(/^\s*test(?:\.(skip|fixme|only))?\(\s*$/)
      ? lines[i + 1]?.match(/^\s*(['"`])(.*)$/)
      : null
    if (start || continuation) {
      const mod = start?.[1] ?? (continuation ? line.match(/^\s*test(?:\.(skip|fixme|only))?/)?.[1] : null)
      const title = start?.[3] ?? continuation?.[2] ?? ''
      active = { ids: titleAcs(title), skip: mod === 'skip' || mod === 'fixme', conditional: false, line: i + 1, file: path.basename(file) }
      found.push(active)
      continue
    }
    if (active && /\btest\.skip\(/.test(line)) active.conditional = true
  }
  return found
}

function readLock(root, config, cardSlug, task) {
  const file = path.join(root, config.workspace.worktrees_dir, cardSlug, '.ff-test-lock')
  if (!fs.existsSync(file)) return { found: false, bad: [] }
  const raw = fs.readFileSync(file)
  const bad = []
  for (const line of raw.toString().split(/\r?\n/)) {
    const m = line.match(/^([a-f0-9]{64})\s{2}(.+)$/)
    if (!line.trim()) continue
    if (!m) { bad.push('.ff-test-lock (manifest không hợp lệ)'); continue }
    if (task && !path.basename(m[2]).startsWith(`${task}-`)) continue
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
      const total = { COVERED: 0, SKIP: 0, MISSING: 0, ORPHAN: 0, DROPPED: 0 }
      let failed = false
      for (const doc of c.docs) {
        if (!fs.existsSync(doc.file)) throw new Error(`không thấy ${path.relative(c.root, doc.file)}`)
        const acs = parseSpecAcs(fs.readFileSync(doc.file, 'utf8'))
        const names = testFiles.filter((name) => !doc.task || doc.task.startsWith('rev-') || name.startsWith(`${doc.task}-`) || name.startsWith(`${doc.task}.`))
        const tests = names.flatMap((name) => scanTests(path.join(testRoot, name)))
        const local = { COVERED: 0, SKIP: 0, MISSING: 0, ORPHAN: 0, DROPPED: 0 }
        ctx.stdout.write(`\n== ${path.relative(c.root, doc.file)} — ${acs.length} AC, ${names.length} file test\n`)
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
      const lock = readLock(c.root, c.config, path.basename(c.card), args[1]?.startsWith('task-') ? args[1].match(/^task-\d+/)?.[0] : null)
      if (lock.found) {
        ctx.stdout.write(`\nTest lock: manifest ${lock.digest}\n`)
        for (const item of lock.bad) ctx.stdout.write(`❌ HASH ĐỔI ${item}\n`)
        if (!lock.bad.length) ctx.stdout.write('hash khớp\n')
        if (lock.bad.length) failed = true
      } else ctx.stdout.write('\nChưa khóa test (.ff-test-lock không có)\n')
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
      const base = path.resolve(c.root, c.config.workspace.worktrees_dir, path.basename(c.card))
      const searchRoot = fs.existsSync(base) ? base : c.root
      for (const repo of c.config.repos) walk(path.join(searchRoot, path.basename(repo.path)))
      for (const doc of c.docs) {
        if (!fs.existsSync(doc.file)) throw new Error(`không thấy ${path.relative(c.root, doc.file)}`)
        const text = fs.readFileSync(doc.file, 'utf8')
        const refs = new Set()
        for (const match of text.matchAll(/([\w@.\-/]+\.(?:tsx?|jsx?|mjs|cjs|json|less|css|scss|sql|ya?ml|md|sh|html)):(\d+)(?:-(\d+))?/g)) refs.add(match[0])
        for (const ref of refs) {
          const match = ref.match(/^(.+):(\d+)(?:-(\d+))?$/)
          const raw = match[1], from = Number(match[2]), to = Number(match[3] ?? match[2])
          const candidates = [path.resolve(searchRoot, raw), ...c.config.repos.map((repo) => path.resolve(searchRoot, path.basename(repo.path), raw))]
            .filter((file) => file.startsWith(searchRoot + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile())
          if (!candidates.length) { ctx.stdout.write(`❌ ${ref} — file không tồn tại\n`); bad++; continue }
          const counts = candidates.map((file) => { const source = fs.readFileSync(file, 'utf8'); return source.split('\n').length - (source.endsWith('\n') ? 1 : 0) })
          if (from < 1 || to < from || !counts.some((count) => to <= count)) { ctx.stdout.write(`❌ ${ref} — dòng ngoài file\n`); bad++ }
        }
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
