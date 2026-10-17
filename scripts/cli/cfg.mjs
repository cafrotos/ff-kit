import path from 'node:path'
import { findRoot, loadConfig, getKey, ConfigError } from '../lib/config.mjs'
import { doctorStatus } from '../lib/state.mjs'

export const summary = 'cfg get <key> [--abs] — đọc giá trị trong ff.config.yaml'

const STATUS_MSG = {
  missing: 'chưa chạy ff doctor trong workspace này. Chạy: ff doctor',
  stale: 'ff.config.yaml đã đổi sau lần ff doctor gần nhất. Chạy: ff doctor',
  red: 'ff doctor đang đỏ ở nhóm core. Chạy: ff doctor để xem lỗi, sửa bằng /ff-init',
}

export async function run(args, ctx) {
  const [sub, key, ...flags] = args
  if (sub !== 'get' || !key) {
    ctx.stderr.write('dùng: ff cfg get <key> [--abs]\n')
    return 2
  }
  const root = findRoot(ctx.cwd)
  if (!root) {
    ctx.stderr.write('ff: không thấy ff.config.yaml ở thư mục này hoặc thư mục cha. Chạy /ff-init.\n')
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
  const status = doctorStatus(root)
  if (status !== 'green') {
    ctx.stderr.write(`ff: ${STATUS_MSG[status]}\n`)
    return 4
  }
  const r = getKey(config, key)
  if (!r.found) {
    ctx.stderr.write(`ff: không có key '${key}' trong ff.config.yaml. Không tự đoán giá trị — hỏi user hoặc chạy lại /ff-init.\n`)
    return 3
  }
  let v = r.value
  if (flags.includes('--abs') && typeof v === 'string') v = path.resolve(root, v)
  ctx.stdout.write((typeof v === 'object' ? JSON.stringify(v) : String(v)) + '\n')
  return 0
}
