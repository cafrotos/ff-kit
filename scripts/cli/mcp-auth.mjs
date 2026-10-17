import fs from 'node:fs'
import path from 'node:path'
import { authContext, parseEmail, resolveAuthStorage } from './auth-common.mjs'
import { storageState } from '../lib/jwt.mjs'

export const summary = 'mcp-auth --email <email> — tạo Playwright storage-state cho user được chỉ định'

export async function run(args, ctx) {
  const email = parseEmail(args, 'mcp-auth', ctx)
  if (!email) return 2
  try {
    const { root, config, user, token } = await authContext(ctx, email)
    const file = resolveAuthStorage(root, config)
    const state = storageState(config.e2e.apps ?? [], config.e2e.auth.jwt.deliver, token)
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    fs.writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 })
    fs.chmodSync(file, 0o600)
    ctx.stdout.write(`storage-state cho ${email} đã ghi vào ${path.relative(root, file)}; không in JWT\n`)
    return 0
  } catch (e) {
    ctx.stderr.write(`ff mcp-auth: ${e.message}\n`)
    return 1
  }
}
