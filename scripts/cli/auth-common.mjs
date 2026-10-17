import path from 'node:path'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { lookupUserByEmail, mintForConfig } from '../lib/jwt.mjs'

export function parseEmail(args, command, ctx) {
  const i = args.indexOf('--email')
  if (i < 0 || !args[i + 1] || args[i + 1].startsWith('--')) {
    ctx.stderr.write(`dùng: ff ${command} --email <email>\n`)
    return null
  }
  return args[i + 1]
}

export async function authContext(ctx, email) {
  const root = findRoot(ctx.cwd)
  if (!root) throw new Error('không thấy ff.config.yaml')
  const config = loadConfig(root).config
  if (config.e2e?.auth?.strategy !== 'jwt-mint') throw new Error('e2e.auth.strategy phải là jwt-mint')
  const lookup = ctx.lookupUser ?? ((address) => lookupUserByEmail(root, config, address))
  const user = await lookup(email)
  if (!user) throw new Error(`không thấy user ${email} trong DB`)
  return { root, config, user, token: mintForConfig(root, config, user) }
}

export function resolveAuthStorage(root, config) {
  if (!config.e2e?.auth_storage) throw new Error('thiếu e2e.auth_storage trong ff.config.yaml')
  return path.resolve(root, config.e2e.auth_storage)
}
