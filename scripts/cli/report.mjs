import { findRoot, loadConfig } from '../lib/config.mjs'
import { buildReport, renderReport } from '../lib/report.mjs'

export const summary = 'report [--today] [--json] — báo cáo tiếng Việt: thẻ đang ở đâu, ff đã tự quyết gì (kèm căn cứ), đã học gì'

export async function run(args, ctx) {
  try {
    const bad = args.filter((a) => !['--today', '--json'].includes(a))
    if (bad.length) throw new Error('dùng: ff report [--today] [--json]')
    const root = findRoot(ctx.cwd); if (!root) throw new Error('không thấy ff.config.yaml')
    const { config } = loadConfig(root)
    const r = buildReport(root, config, { today: args.includes('--today') })
    ctx.stdout.write(args.includes('--json') ? JSON.stringify(r) + '\n' : renderReport(r) + '\n')
    return 0
  } catch (e) { ctx.stderr.write(`ff report: ${e.message}\n`); return 1 }
}
