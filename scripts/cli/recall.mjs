import { findRoot, loadConfig } from '../lib/config.mjs'
import { recall, renderRecall, cardRecallFiles } from '../lib/wiki.mjs'
export const summary = 'recall [--files a,b] [--symbols X,Y] [--query text] [--card <id>] [--limit N] [--json] — tra tri thức dự án (wiki) theo file/symbol/từ khóa'
const csv = v => String(v).split(',').map(s => s.trim()).filter(Boolean)
export async function run(args, ctx) {
  try {
    const o = { files: [], symbols: [], query: '', limit: 10 }
    let json = false, card
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      if (a === '--json') { json = true; continue }
      const v = args[i + 1]
      if (!['--files', '--symbols', '--query', '--card', '--limit'].includes(a) || v === undefined || v.startsWith('--')) throw new Error('dùng: ff recall [--files a,b] [--symbols X,Y] [--query text] [--card <id>] [--limit N] [--json]')
      i++
      if (a === '--files') o.files.push(...csv(v))
      else if (a === '--symbols') o.symbols.push(...csv(v))
      else if (a === '--query') o.query = v
      else if (a === '--card') card = v
      else { o.limit = Number(v); if (!Number.isInteger(o.limit) || o.limit < 1) throw new Error('--limit phải là số nguyên ≥ 1') }
    }
    const root = findRoot(ctx.cwd); if (!root) throw new Error('không thấy ff.config.yaml')
    const { config } = loadConfig(root)
    if (card) o.files.push(...cardRecallFiles(root, config, card))
    if (!o.files.length && !o.symbols.length && !o.query.trim()) throw new Error('cần ít nhất một trong --files, --symbols, --query, --card (thẻ có design/plan)')
    const rows = recall(root, config, o)
    ctx.stdout.write(json ? JSON.stringify(rows) + '\n' : renderRecall(rows))
    return 0
  } catch (e) { ctx.stderr.write(`ff recall: ${e.message}\n`); return 1 }
}
