import { createHmac, randomUUID } from 'node:crypto'
import path from 'node:path'
import { e2e, readEnvFile, root } from './env'

function render(value: unknown, user: Record<string, unknown>, uuid: string): unknown {
  if (typeof value !== 'string') return value
  return value.replace(/\{([^{}]+)\}/g, (_whole, key: string) => {
    if (key === 'uuid') return uuid
    const match = /^user\.([A-Za-z_][A-Za-z0-9_.]*)$/.exec(key)
    if (!match) throw new Error(`JWT payload có placeholder không hỗ trợ: {${key}}`)
    const found = match[1].split('.').reduce<any>((current, part) => current?.[part], user)
    if (found === undefined || found === null) throw new Error(`Thiếu user.${match[1]} trong test.`)
    return String(found)
  })
}

export function mintToken(user: Record<string, unknown>): string {
  const config = e2e.auth?.jwt
  if (!config) throw new Error('Thiếu e2e.auth.jwt.')
  const secretFile = path.resolve(root, config.secret.file)
  const env = readEnvFile(secretFile)
  const secret = env[config.secret.key]
  if (!secret) throw new Error(`Thiếu key ${config.secret.key} trong ${config.secret.file}.`)
  const hash = ({ HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' } as Record<string, string>)[config.algorithm]
  if (!hash) throw new Error(`JWT algorithm không hỗ trợ: ${config.algorithm}`)
  const now = Math.floor(Date.now() / 1000)
  const secretEnv = config.secret.file ? readEnvFile(secretFile) : {}
  const duration = (config.expires_in?.key && secretEnv[config.expires_in.key]) || config.expires_in?.default || '2h'
  const seconds = Number(duration.slice(0, -1)) * ({ s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[duration.slice(-1)]
  const uuid = randomUUID()
  const payload = Object.fromEntries(Object.entries(config.payload).map(([k, v]) => [k, render(v, user, uuid)]))
  const body = { ...payload, iat: now, exp: now + seconds }
  const header = Buffer.from(JSON.stringify({ alg: config.algorithm, typ: 'JWT' })).toString('base64url')
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url')
  const input = `${header}.${encoded}`
  return `${input}.${createHmac(hash, secret).update(input).digest('base64url')}`
}
