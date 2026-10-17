import { findRoot } from '../lib/config.mjs'
import { workerRequest } from '../lib/worker-client.mjs'

export const summary = 'verify-lock <acquire|release> <slug> — lấy/trả lock verify qua worker'

export async function run(args, ctx) {
  const [action, slug, ...extra] = args
  if (!['acquire', 'release'].includes(action) || !slug || extra.length || !/^[A-Za-z0-9]+(?:-[A-Za-z0-9-]+)?$/.test(slug)) {
    ctx.stderr.write('dùng: ff verify-lock <acquire|release> <slug>\n')
    return 2
  }
  const root = findRoot(ctx.cwd)
  if (!root) { ctx.stderr.write('ff verify-lock: không thấy ff.config.yaml\n'); return 4 }
  try {
    const result = await workerRequest(root, '/verify-lock', { action, slug }, ctx.fetch)
    if (action === 'acquire' && !result.acquired) {
      ctx.stderr.write(`ff verify-lock: đang được giữ bởi ${result.current?.slug ?? 'thẻ khác'}\n`)
      return 1
    }
    if (action === 'release' && !result.released) {
      ctx.stderr.write('ff verify-lock: lock chưa được trả\n')
      return 1
    }
    ctx.stdout.write(action === 'acquire' ? 'đã lấy verify lock\n' : 'đã trả verify lock\n')
    return 0
  } catch (e) { ctx.stderr.write(`ff verify-lock: ${e.message}\n`); return 1 }
}
