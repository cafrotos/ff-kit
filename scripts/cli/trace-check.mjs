import { findRoot, loadConfig, ConfigError } from '../lib/config.mjs'
import { findCardDir } from '../lib/cards.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { traceCheck } from '../lib/trace.mjs'
import { activeRevision } from '../lib/gates.mjs'
import { checkFileRefs, refSearchRoot } from '../lib/file-refs.mjs'

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
  // Brief citations ("Tự quyết", MƠ HỒ, bất biến) must point at real files and lines.
  const active = path.join(card.dir, activeRevision(card.dir) ?? '')
  const searchRoot = refSearchRoot(root, config, card.dir)
  for (const name of ['brief.md', 'brief-chi-tiet.md', 'delta.md']) {
    const file = path.join(active, name)
    if (!fs.existsSync(file)) continue
    for (const { ref, reason } of checkFileRefs(fs.readFileSync(file, 'utf8'), { searchRoot, repos: config.repos, extraRoots: [card.dir] })) r.errors.push(`${name}: ${ref} — ${reason}`)
  }
  r.ok = r.errors.length === 0
  if (flags.includes('--json')) ctx.stdout.write(JSON.stringify(r) + '\n')
  else if (r.ok) ctx.stdout.write(`trace-check: xanh (${r.counts.D} mã D, ${r.counts.U} mã U)\n`)
  else ctx.stdout.write(`trace-check: ĐỎ (${r.errors.length} lỗi)\n${r.errors.map((e) => `- ${e}`).join('\n')}\n`)
  return r.ok ? 0 : 1
}
