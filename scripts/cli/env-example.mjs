import path from 'node:path'
import { findRoot, loadConfig, ConfigError } from '../lib/config.mjs'
import { mergeEnvExample } from '../lib/env.mjs'

export const summary = 'env-example — tạo/bổ sung key còn thiếu vào <secrets.env_file>.example'

export async function run(args, ctx) {
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
  const file = path.resolve(root, config.secrets.env_file + '.example')
  const added = mergeEnvExample(file, config)
  ctx.stdout.write(added.length ? `đã thêm vào ${path.relative(root, file)}: ${added.join(', ')}\n` : `${path.relative(root, file)} đã đủ key, không đổi\n`)
  return 0
}
