import { findRoot, loadConfig } from '../lib/config.mjs'
import { findCardDir } from '../lib/cards.mjs'
import { activeRevision } from '../lib/gates.mjs'
import { proposeEscape, readKnowledgeEvents } from '../lib/knowledge-log.mjs'
export const summary = 'escape <id> --route A|B|C|D --skill <skill> --evidence <text> — đề xuất "vì sao lọt" cho revision reopen (người duyệt Gate A xác nhận)'
export async function run(args, ctx) {
  try {
    const [id, ...flags] = args, opt = {}
    if (!id || !/^[A-Za-z0-9]+$/.test(id)) throw new Error('dùng: ' + summary)
    if (flags.length === 1 && flags[0] === '--list') {
      const root = findRoot(ctx.cwd); if (!root) throw new Error('không thấy ff.config.yaml')
      ctx.stdout.write(JSON.stringify(readKnowledgeEvents(root).filter(e => e.cardId === id && e.type.startsWith('escape_'))) + '\n'); return 0
    }
    for (let i = 0; i < flags.length; i++) {
      const k = flags[i]
      if (!['--route', '--skill', '--evidence'].includes(k) || opt[k] !== undefined || !flags[i + 1]) throw new Error('dùng: ' + summary)
      opt[k] = flags[++i]
    }
    if (!opt['--route'] || !opt['--skill'] || !opt['--evidence']) throw new Error('dùng: ' + summary)
    const root = findRoot(ctx.cwd); if (!root) throw new Error('không thấy ff.config.yaml')
    const { config } = loadConfig(root), card = findCardDir(root, config, id)
    if (card.error) throw new Error(card.error)
    const revision = activeRevision(card.dir)
    if (!revision) throw new Error('thẻ chưa reopen: phiếu "vì sao lọt" thuộc revision reopen (chạy ff reopen trước)')
    const previous = revision === 'rev-1' ? '' : `rev-${Number(revision.slice(4)) - 1}`
    const r = await proposeEscape(root, { cardId: id, revision, escapedRevision: previous, route: opt['--route'], skill: opt['--skill'], evidence: opt['--evidence'] })
    ctx.stdout.write(`Đã ghi đề xuất vì sao lọt (ngả ${opt['--route']}, skill ${opt['--skill']}) cho ${id} ${revision}; chỉ thành escape_recorded khi người duyệt Gate A của revision này.${r.stored ? '' : ' (đã có)'}\n`)
    return 0
  } catch (e) { ctx.stderr.write(`ff escape: ${e.message}\n`); return 1 }
}
