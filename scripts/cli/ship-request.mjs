import { findRoot } from '../lib/config.mjs'
import { workerRequest } from '../lib/worker-client.mjs'

export const summary = 'ship-request --task <id> --title <text> [--body <text>] — gửi yêu cầu ship để người dùng xác nhận'

export async function run(args, ctx) {
  const options = {}
  for (let i = 0; i < args.length; i++) {
    const match = /^--(task|title|body)$/.exec(args[i])
    if (!match || !args[i + 1] || args[i + 1].startsWith('--')) { ctx.stderr.write(`dùng: ff ship-request --task <id> --title <text> [--body <text>]\n`); return 2 }
    options[match[1]] = args[++i]
  }
  if (!/^[A-Za-z0-9]+$/.test(options.task ?? '') || !options.title?.trim()) {
    ctx.stderr.write('ff ship-request: cần --task <id> và --title <text>\n')
    return 2
  }
  const root = findRoot(ctx.cwd)
  if (!root) { ctx.stderr.write('ff ship-request: không thấy ff.config.yaml\n'); return 4 }
  try {
    await workerRequest(root, '/ship-request', { taskId: options.task, title: options.title, body: options.body ?? '' }, ctx.fetch)
    ctx.stdout.write('đã gửi yêu cầu ship để người dùng xác nhận\n')
    return 0
  } catch (e) { ctx.stderr.write(`ff ship-request: ${e.message}\n`); return 1 }
}
