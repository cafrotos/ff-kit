import fs from 'node:fs'
import path from 'node:path'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { findCardDir } from '../lib/cards.mjs'
import { isApproved } from '../lib/gates.mjs'

export const summary = 'state [<id>] — trạng thái dossier, Gate và bản copy của thẻ'
const artifacts = [['brief.md', 'GATE_A'], ['03-design.md', 'GATE_B'], ['05-verify-report.md', 'GATE_C']]

function cardFiles(dir, name) {
  const found = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const file = path.join(current, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (entry.name === name) found.push(file)
    }
  }
  walk(dir)
  return found
}

function renderCard(root, config, dir) {
  const name = path.basename(dir)
  const id = name.match(/^[A-Za-z0-9]+/)?.[0] ?? name
  const lines = [`## Thẻ ${name}`, `- Dossier: ${fs.existsSync(path.join(dir, '01-dossier.md')) ? 'có' : 'thiếu'}`]
  for (const [file, gate] of artifacts) {
    const matches = cardFiles(dir, file)
    if (!matches.length) {
      lines.push(`- ${file}: chưa`)
      continue
    }
    const statuses = matches.map((full) => {
      const rel = path.relative(dir, full).split(path.sep).join('/')
      const content = fs.readFileSync(full, 'utf8')
      const ledgerPath = path.join(path.dirname(full), '01b-ledger.md')
      const ledger = fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, 'utf8') : null
      return `${rel}: ${isApproved(root, id, gate, rel, content, ledger) ? 'ĐÃ DUYỆT' : 'chưa duyệt'}`
    })
    lines.push(`- ${file}: ${statuses.join('; ')}`)
  }
  const worktree = path.resolve(root, config.workspace.worktrees_dir, name)
  lines.push(`- Bản copy: ${fs.existsSync(worktree) ? path.relative(root, worktree) : 'chưa có'}`)
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
  const id = args[0]
  if (id) {
    const card = findCardDir(root, config, id)
    if (card.error) {
      ctx.stderr.write(`ff state: ${card.error}\n`)
      return 2
    }
    ctx.stdout.write(`${renderCard(root, config, card.dir)}\n`)
    return 0
  }
  const base = path.resolve(root, config.workspace.cards_dir)
  const cards = fs.existsSync(base) ? fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(base, d.name, '01-dossier.md'))).map((d) => d.name) : []
  ctx.stdout.write(['## Thẻ đang làm', ...(cards.length ? cards.map((name) => `- ${name}`) : ['- (không có)']), '', '➡️ Chạy: ff state <id>'].join('\n') + '\n')
  return 0
}
