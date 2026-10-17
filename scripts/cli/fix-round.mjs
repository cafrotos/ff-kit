import { findRoot, loadConfig } from '../lib/config.mjs'
import { findCardDir } from '../lib/cards.mjs'
import { activeRevision } from '../lib/gates.mjs'
import { readRepairCycles, nextRepairCycle, maxRepairCycles } from '../lib/repair-cycles.mjs'

export const summary = 'fix-round <id> [next --reason <text>] [--json] — đếm vòng sửa của revision hiện tại (cùng bộ đếm repairCycles của driver, giới hạn worker.driver.max_repair_cycles); hết lượt thì thoát 3'

export async function run(args, ctx) {
  try {
    const json = args.includes('--json'), rest = args.filter((a) => a !== '--json')
    const [id, sub, ...more] = rest
    if (!id || (sub && sub !== 'next')) throw new Error('dùng: ' + summary)
    let reason = ''
    if (sub === 'next') {
      if (more[0] !== '--reason' || !more[1]?.trim() || more.length !== 2) throw new Error('dùng: ff fix-round <id> next --reason <text>')
      reason = more[1].trim()
    } else if (more.length) throw new Error('dùng: ' + summary)
    const root = findRoot(ctx.cwd)
    if (!root) throw new Error('không thấy ff.config.yaml')
    const { config } = loadConfig(root), card = findCardDir(root, config, id)
    if (card.error) throw new Error(card.error)
    const cardId = String(id).split('-')[0], revision = activeRevision(card.dir) ?? '', max = maxRepairCycles(config)
    let count
    if (sub === 'next') {
      try { count = (await nextRepairCycle(root, config, cardId, revision, reason)).count } catch (e) {
        if (e.code === 'EXHAUSTED') { ctx.stderr.write(`ff fix-round: ${e.message}\n`); return 3 }
        throw e
      }
    } else count = readRepairCycles(root, cardId, revision)
    ctx.stdout.write(json ? JSON.stringify({ cardId, revision: revision || null, count, max }) + '\n' : `Vòng sửa ${revision || 'gốc'}: ${count}/${max}\n`)
    return 0
  } catch (e) { ctx.stderr.write(`ff fix-round: ${e.message}\n`); return 1 }
}
