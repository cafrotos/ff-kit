import path from 'node:path'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { findCardDir } from '../lib/cards.mjs'
import { runConfigured } from './repo-common.mjs'
import { readVerifyLock, releaseVerifyLock, verifyLockPath } from '../lib/verify-lock.mjs'

export const summary = 'verify-down <id> [--force-unlock] — dừng server và trả verify lock'

export async function run(args, ctx) {
  const [id, ...flags] = args
  if (!id || flags.some((flag) => flag !== '--force-unlock')) { ctx.stderr.write('dùng: ff verify-down <id> [--force-unlock]\n'); return 2 }
  const root = findRoot(ctx.cwd)
  if (!root) { ctx.stderr.write('ff verify-down: không thấy ff.config.yaml\n'); return 4 }
  const config = loadConfig(root).config
  const card = findCardDir(root, config, id)
  if (card.error) { ctx.stderr.write(`ff verify-down: ${card.error}\n`); return 2 }
  const slug = path.basename(card.dir)
  const lock = verifyLockPath(root, config)
  const current = readVerifyLock(lock)
  const force = flags.includes('--force-unlock')
  if (current && current.slug !== slug && !force) {
    ctx.stderr.write(`ff verify-down: verify lock thuộc ${current.slug}; không dừng server hoặc đổi lock\n`)
    return 1
  }
  if (current && !config.e2e?.down_cmd && !force) {
    ctx.stderr.write('ff verify-down: thiếu e2e.down_cmd; chưa xác nhận dọn server, giữ lock. Dọn thủ công rồi dùng --force-unlock.\n')
    return 1
  }
  if (config.e2e?.down_cmd) {
    const result = runConfigured(config.e2e.down_cmd, path.resolve(root, config.e2e.dir), ctx)
    if (result.status !== 0) { ctx.stderr.write('ff verify-down: e2e.down_cmd lỗi; giữ nguyên lock để điều tra\n'); return 1 }
  }
  const released = releaseVerifyLock(lock, slug, force)
  if (released.released) ctx.stdout.write(`verify-down: đã trả lock của ${current.slug}\n`)
  else if (!current) ctx.stdout.write('verify-down: lock trống\n')
  else ctx.stdout.write(`verify-down: lock thuộc ${current.slug}; không thay đổi\n`)
  return 0
}
