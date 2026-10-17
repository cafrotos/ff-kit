import { createRequire } from 'node:module'
import path from 'node:path'
import { db as config, readEnvFile, root } from './env'

export type Db = { query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }> }

const require = createRequire(import.meta.url)
export const quoteIdentifier = (name: string): string => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Tên bảng/cột không hợp lệ: ${name}`)
  return config?.driver === 'mysql' ? `\`${name}\`` : `"${name}"`
}

export async function connect(): Promise<Db & { end(): Promise<void> }> {
  if (!config) throw new Error('Thiếu khối db trong ff.config.yaml.')
  const env = readEnvFile(path.resolve(root, config.env_file))
  if (config.driver === 'postgres') {
    const pg = require('pg')
    const client = new pg.Client({ host: env.DATABASE_HOST ?? env.PGHOST, port: Number(env.DATABASE_PORT ?? env.PGPORT ?? 5432), user: env.DATABASE_USERNAME ?? env.PGUSER, password: env.DATABASE_PASSWORD ?? env.PGPASSWORD, database: env.DATABASE_NAME ?? env.PGDATABASE })
    await client.connect()
    return client
  }
  const mysql = require('mysql2/promise')
  const connection = await mysql.createConnection({ host: env.DATABASE_HOST ?? env.MYSQL_HOST, port: Number(env.DATABASE_PORT ?? env.MYSQL_PORT ?? 3306), user: env.DATABASE_USERNAME ?? env.MYSQL_USER, password: env.DATABASE_PASSWORD ?? env.MYSQL_PASSWORD, database: env.DATABASE_NAME ?? env.MYSQL_DATABASE })
  return { query: async (sql, params = []) => { const [rows] = await connection.execute(sql.replace(/\$\d+/g, '?'), params); return { rows, rowCount: rows.length } }, end: () => connection.end() }
}

export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await connect()
  try { return await fn(db) } finally { await db.end() }
}
