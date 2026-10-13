import { findRoot, loadConfig, ConfigError } from '../lib/config.mjs'
import { findCardDir } from '../lib/cards.mjs'
import { traceCheck } from '../lib/trace.mjs'

export const summary = 'trace-check <id> [--json] — mọi dòng Brief/spec/design truy về câu dossier hoặc quyết định user'

export async function run(args, ctx) {
  const [id, ...flags] = args
  if (!id) {
    ctx.stderr.write('dùng: ff trace-check <id thẻ> [--json]\n')
    return 2
  }
  const root = findRoot(ctx.cwd)
  if (!root) {
    ctx.stderr.write('ff: không thấy ff.config.yaml. Chạy /ff-init.\n')
    return 4
  }
  let config
  try {
    config = loadConfig(root).config
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e
    ctx.stderr.write(`ff: ${e.message}\n`)
    return 4
  }
  const card = findCardDir(root, config, id)
  if (card.error) {
    ctx.stderr.write(`ff: ${card.error}\n`)
    return 2
  }
  const r = traceCheck(card.dir)
  if (flags.includes('--json')) ctx.stdout.write(JSON.stringify(r) + '\n')
  else if (r.ok) ctx.stdout.write(`trace-check: xanh (${r.counts.D} mã D, ${r.counts.U} mã U)\n`)
  else ctx.stdout.write(`trace-check: ĐỎ (${r.errors.length} lỗi)\n${r.errors.map((e) => `- ${e}`).join('\n')}\n`)
  return r.ok ? 0 : 1
}
