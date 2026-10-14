import fs from 'node:fs'
import path from 'node:path'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { findCardDir } from '../lib/cards.mjs'
import { gateStatus, activeRevision, ledgerFor, designArtifacts } from '../lib/gates.mjs'

export const summary = 'state [<id>] [--json] — trạng thái Gate/hash và revision hiện tại'
const artifacts = [['brief.md', 'GATE_A'], ['03-design.md', 'GATE_B'], ['05-verify-report.md', 'GATE_C']]

function cardFiles(dir, name, excludeRevisions = false) {
  const found = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      if (excludeRevisions && /^rev-\d+$/.test(entry.name)) continue
      const file = path.join(current, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (entry.name === name) found.push(file)
    }
  }
  walk(dir)
  return found
}

export function inspectCard(root, config, dir) {
  const name = path.basename(dir)
  const id = name.match(/^[A-Za-z0-9]+/)?.[0] ?? name
  const revision = activeRevision(dir), current = revision ? path.join(dir, revision) : dir
  const gates = {}
  for (const [file, gate] of artifacts) {
    const filename = gate === 'GATE_A' && revision ? 'delta.md' : file
    const matches = gate === 'GATE_A' ? (fs.existsSync(path.join(current, filename)) ? [path.join(current, filename)] : [])
      : gate === 'GATE_B' ? Object.keys(designArtifacts(dir, revision ?? '')).map((rel) => path.join(dir, rel)) : cardFiles(current, filename, !revision)
    const records = matches.map((full) => {
      const rel = path.relative(dir, full).split(path.sep).join('/')
      const content = fs.readFileSync(full, 'utf8')
      const scope = path.relative(dir, path.dirname(full)).split(path.sep).join('/')
      return { path: rel, status: gateStatus(root, id, gate, rel, content, ledgerFor(dir, scope)) }
    })
    const statuses = records.map((r) => r.status)
    const status = !statuses.length || statuses.includes('pending') ? 'pending' : statuses.includes('stale') ? 'stale' : statuses.includes('auto_passed') ? 'auto_passed' : 'approved'
    gates[gate] = { status, artifacts: records }
  }
  const worktree = path.resolve(root, config.workspace.worktrees_dir, name)
  return { id, slug: name, activeRevision: revision, activeDir: path.relative(root, current).split(path.sep).join('/'),
    dossier: fs.existsSync(path.join(dir, '01-dossier.md')), worktree: fs.existsSync(worktree) ? path.relative(root, worktree) : null,
    testLock: path.relative(root, path.join(worktree, '.ff-test-lock' + (revision ? `.${revision}` : ''))).split(path.sep).join('/'),
    gates, readyForBuild: gates.GATE_A.status === 'approved' && ['approved', 'auto_passed'].includes(gates.GATE_B.status) }
}

function renderCard(root, config, dir) {
  const state = inspectCard(root, config, dir)
  const labels = { approved: 'ĐÃ DUYỆT', auto_passed: 'TỰ QUA (không phải user duyệt)', pending: 'chưa duyệt', stale: 'chưa duyệt (hash lệch)' }
  const lines = [`## Thẻ ${state.slug}`, `- Dossier: ${state.dossier ? 'có' : 'thiếu'}`, `- Revision: ${state.activeRevision ?? 'gốc'}`]
  for (const [file, gate] of artifacts) {
    const a = state.gates[gate].artifacts
    lines.push(`- ${file}: ${a.length ? a.map((r) => `${r.path}: ${labels[r.status]}`).join('; ') : 'chưa'}`)
  }
  lines.push(`- Bản copy: ${state.worktree ?? 'chưa có'}`)
  return lines.join('\n')
}

export async function run(args, ctx) {
  const root = findRoot(ctx.cwd)
  if (!root) {
    ctx.stderr.write('ff state: không thấy ff.config.yaml\n')
    return 4
  }
  let config
  try { config = loadConfig(root).config } catch (e) {
    ctx.stderr.write(`ff state: ${e.message}\n`)
    return 4
  }
  if (args.some((a, i) => i > 0 && a !== '--json') || args.length > 2) { ctx.stderr.write('dùng: ' + summary + '\n'); return 2 }
  const id = args[0] === '--json' ? null : args[0]
  if (id) {
    const card = findCardDir(root, config, id)
    if (card.error) {
      ctx.stderr.write(`ff state: ${card.error}\n`)
      return 2
    }
    ctx.stdout.write(args.includes('--json') ? JSON.stringify(inspectCard(root, config, card.dir), null, 2) + '\n' : `${renderCard(root, config, card.dir)}\n`)
    return 0
  }
  const base = path.resolve(root, config.workspace.cards_dir)
  const cards = fs.existsSync(base) ? fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(base, d.name, '01-dossier.md'))).map((d) => d.name) : []
  ctx.stdout.write(args.includes('--json') ? JSON.stringify(cards.map((name) => inspectCard(root, config, path.join(base, name))), null, 2) + '\n' : ['## Thẻ đang làm', ...(cards.length ? cards.map((name) => `- ${name}`) : ['- (không có)']), '', '➡️ Chạy: ff state <id>'].join('\n') + '\n')
  return 0
}
