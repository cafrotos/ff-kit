import { authContext } from './auth-common.mjs'
import { parseEmail } from './auth-common.mjs'

export const summary = 'e2e-auth-check --email <email> — kiểm tra JWT và endpoint xác thực e2e'

export async function run(args, ctx) {
  const email = parseEmail(args, 'e2e-auth-check', ctx)
  if (!email) return 2
  try {
    const { config, token } = await authContext(ctx, email)
    const verify = config.e2e.auth.jwt.verify
    if (!verify?.url) throw new Error('thiếu e2e.auth.jwt.verify.url')
    const fetcher = ctx.fetch ?? globalThis.fetch
    let response
    try {
      response = await fetcher(verify.url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) })
    } catch {
      throw new Error('server chưa bật hoặc không kết nối được tới verify.url')
    }
    const expected = verify.expect_status ?? 200
    if (response.status === 401) throw new Error('verify.url trả 401 — kiểm tra JWT secret, payload và user')
    if (response.status !== expected) throw new Error(`verify.url trả HTTP ${response.status}, cần ${expected}`)
    ctx.stdout.write('xác thực e2e thành công; JWT không được in\n')
    return 0
  } catch (e) {
    ctx.stderr.write(`ff e2e-auth-check: ${e.message}\n`)
    return 1
  }
}
