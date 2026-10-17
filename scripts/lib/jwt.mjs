import fs from 'node:fs'
import path from 'node:path'
import crypto, { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'

export function readEnvValues(text) {
  const values = Object.create(null)
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1)
    else value = value.replace(/\s+#.*$/, '').replace(/^#.*$/, '')
    values[match[1]] = value
  }
  return values
}

export function readEnvFile(file) {
  return readEnvValues(fs.readFileSync(file, 'utf8'))
}

export function renderPayload(payload, user, uuid = randomUUID()) {
  const render = (value, key) => {
    if (typeof value !== 'string') return value
    return value.replace(/\{([^{}]+)\}/g, (whole, token) => {
      if (token === 'uuid') return uuid
      const match = /^user\.([A-Za-z_][A-Za-z0-9_.]*)$/.exec(token)
      if (!match) throw new Error(`payload có placeholder không hỗ trợ ở ${key}: {${token}}`)
      const found = match[1].split('.').reduce((obj, part) => obj?.[part], user)
      if (found === undefined || found === null) throw new Error(`thiếu user.${match[1]} cho JWT payload`)
      return String(found)
    })
  }
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, render(value, key)]))
}

function durationSeconds(value) {
  const match = /^(\d+)([smhd])$/.exec(value ?? '')
  if (!match) throw new Error('JWT expires_in không hợp lệ')
  return Number(match[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 })[match[2]]
}

export function signJwt(config, user, secret, { now = Math.floor(Date.now() / 1000), uuid = randomUUID(), expiresIn } = {}) {
  if (!secret) throw new Error('JWT secret rỗng')
  const alg = config.algorithm
  const hash = { HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' }[alg]
  if (!hash) throw new Error(`JWT algorithm không hỗ trợ: ${alg}`)
  const payload = renderPayload(config.payload, user, uuid)
  const seconds = durationSeconds(expiresIn ?? config.expires_in?.default ?? '2h')
  payload.iat ??= now
  payload.exp ??= now + seconds
  const header = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const input = `${header}.${body}`
  return `${input}.${crypto.createHmac(hash, secret).update(input).digest('base64url')}`
}

export function storageState(apps, deliver, token) {
  const locations = deliver.filter((d) => d.via === 'local_storage' || d.via === 'cookie')
  if (!locations.length) throw new Error('mcp-auth cần deliver kiểu local_storage hoặc cookie')
  const state = { cookies: [], origins: [] }
  for (const app of apps) {
    const origin = new URL(app.base_url).origin
    const localStorage = []
    for (const item of locations) {
      if (item.via === 'local_storage') localStorage.push({ name: item.name, value: token })
      else state.cookies.push({ name: item.name, value: token, domain: new URL(origin).hostname, path: '/', expires: -1, httpOnly: false, secure: origin.startsWith('https:'), sameSite: 'Lax' })
    }
    if (localStorage.length) state.origins.push({ origin, localStorage })
  }
  return state
}

function dbValues(root, config) {
  if (!config.db?.env_file) throw new Error('mcp-auth cần cấu hình db.env_file')
  return readEnvFile(path.resolve(root, config.db.env_file))
}

function first(values, keys, fallback) {
  for (const key of keys) if (values[key]) return values[key]
  return fallback
}

export async function lookupUserByEmail(root, config, email) {
  const jwt = config.e2e?.auth?.jwt
  const lookup = jwt?.user_lookup
  if (!lookup) throw new Error('thiếu e2e.auth.jwt.user_lookup')
  const env = dbValues(root, config)
  const require = createRequire(path.join(path.resolve(root, config.e2e.dir), 'package.json'))
  const shared = {
    host: first(env, ['DATABASE_HOST', 'PGHOST', 'MYSQL_HOST'], 'localhost'),
    port: Number(first(env, ['DATABASE_PORT', 'PGPORT', 'MYSQL_PORT'], config.db.driver === 'postgres' ? '5432' : '3306')),
    user: first(env, ['DATABASE_USERNAME', 'DATABASE_USER', 'PGUSER', 'MYSQL_USER'], ''),
    password: first(env, ['DATABASE_PASSWORD', 'PGPASSWORD', 'MYSQL_PASSWORD'], ''),
    database: first(env, ['DATABASE_NAME', 'PGDATABASE', 'MYSQL_DATABASE'], ''),
  }
  if (config.db.driver === 'postgres') {
    const pg = require('pg')
    const client = new pg.Client(shared)
    try {
      await client.connect()
      const result = await client.query(lookup, [email])
      return result.rows[0] ?? null
    } finally {
      await client.end().catch(() => {})
    }
  }
  if (config.db.driver === 'mysql') {
    const mysql = require('mysql2/promise')
    const connection = await mysql.createConnection(shared)
    try {
      const sql = lookup.replace(/\$1/g, '?')
      const [rows] = await connection.execute(sql, [email])
      return rows[0] ?? null
    } finally {
      await connection.end()
    }
  }
  throw new Error(`db.driver không hỗ trợ: ${config.db.driver}`)
}

export function mintForConfig(root, config, user, { uuid, now } = {}) {
  const jwt = config.e2e?.auth?.jwt
  if (!jwt) throw new Error('thiếu e2e.auth.jwt')
  const secretPath = path.resolve(root, jwt.secret.file)
  const env = readEnvFile(secretPath)
  const secret = env[jwt.secret.key]
  if (!secret) throw new Error(`thiếu key ${jwt.secret.key} trong ${jwt.secret.file}`)
  const expiresIn = (jwt.expires_in?.key && env[jwt.expires_in.key]) || jwt.expires_in?.default || '2h'
  return signJwt(jwt, user, secret, { uuid, now, expiresIn })
}
