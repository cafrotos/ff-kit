import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { findRoot, loadConfig } from '../lib/config.mjs'

export const summary = 'db-query --sql <SELECT> | --file <query.sql> [--json] — truy vấn DB chỉ đọc'

function stripComments(sql) {
  let out = '', i = 0, single = false, double = false, backtick = false, dollar = null, line = false, block = false
  while (i < sql.length) {
    const c = sql[i], n = sql[i + 1]
    if (line) { if (c === '\n') { line = false; out += '\n' } else out += ' '; i++; continue }
    if (block) { if (c === '*' && n === '/') { out += '  '; i += 2; block = false } else { out += c === '\n' ? '\n' : ' '; i++ } continue }
    if (dollar) { if (sql.startsWith(dollar, i)) { out += dollar; i += dollar.length; dollar = null } else { out += c; i++ } continue }
    if (single) { out += c; if (c === "'" && n === "'") { out += n; i += 2; continue } if (c === "'") single = false; i++; continue }
    if (double) { out += c; if (c === '"' && n === '"') { out += n; i += 2; continue } if (c === '"') double = false; i++; continue }
    if (backtick) { out += c; if (c === '`' && n === '`') { out += n; i += 2; continue } if (c === '`') backtick = false; i++; continue }
    if (c === '-' && n === '-') { out += '  '; i += 2; line = true; continue }
    if (c === '/' && n === '*') { out += '  '; i += 2; block = true; continue }
    if (c === "'") single = true
    else if (c === '"') double = true
    else if (c === '`') backtick = true
    else if (c === '$') { const m = sql.slice(i).match(/^\$[A-Za-z_0-9]*\$/); if (m) dollar = m[0] }
    out += c; i++
  }
  return out
}

function splitStatements(sql) {
  const clean = stripComments(sql)
  const statements = []
  let start = 0, single = false, double = false, backtick = false, dollar = null
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i], n = clean[i + 1]
    if (dollar) { if (clean.startsWith(dollar, i)) { i += dollar.length - 1; dollar = null } continue }
    if (single) { if (c === "'" && n === "'") i++; else if (c === "'") single = false; continue }
    if (double) { if (c === '"' && n === '"') i++; else if (c === '"') double = false; continue }
    if (backtick) { if (c === '`' && n === '`') i++; else if (c === '`') backtick = false; continue }
    if (c === "'") single = true
    else if (c === '"') double = true
    else if (c === '`') backtick = true
    else if (c === '$') { const m = clean.slice(i).match(/^\$[A-Za-z_0-9]*\$/); if (m) dollar = m[0] }
    else if (c === ';') { if (clean.slice(start, i).trim()) statements.push(clean.slice(start, i).trim()); start = i + 1 }
  }
  if (clean.slice(start).trim()) statements.push(clean.slice(start).trim())
  return statements
}

function maskLiterals(sql) {
  return sql.replace(/'(?:''|[^'])*'/g, "''").replace(/\$[A-Za-z_0-9]*\$[\s\S]*?\$[A-Za-z_0-9]*\$/g, "''")
}

export function validateQuerySafety(sql) {
  if (typeof sql !== 'string' || !sql.trim()) throw new Error('SQL rỗng')
  const statements = splitStatements(sql)
  if (!statements.length) throw new Error('SQL chỉ chứa chú thích hoặc rỗng')
  for (const statement of statements) {
    const masked = maskLiterals(statement)
    const first = masked.match(/^\s*([A-Za-z]+)/)?.[1]?.toUpperCase()
    if (!['SELECT', 'WITH', 'EXPLAIN'].includes(first)) throw new Error(`chỉ cho phép SELECT / WITH ... SELECT / EXPLAIN; nhận ${first ?? 'SQL không hợp lệ'}`)
    if (first === 'WITH' && !/\bSELECT\b/i.test(masked)) throw new Error('WITH phải chứa SELECT')
    const forbidden = masked.match(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|CREATE|CALL|COPY)\b/i)
    if (forbidden) throw new Error(`thao tác ghi bị cấm: ${forbidden[1].toUpperCase()}`)
  }
  return statements
}

function parseEnv(file) {
  const env = {}
  for (const line of fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!match || match[1].startsWith('#')) continue
    let value = match[2]
    if (/^(?:".*"|'.*')$/.test(value)) value = value.slice(1, -1)
    else value = value.replace(/\s+#.*$/, '').replace(/^#.*$/, '')
    env[match[1]] = value
  }
  return env
}

function makeClient(root, config, env, database, ctx) {
  if (typeof ctx.connectDb === 'function') return ctx.connectDb({ root, config, env, database })
  const e2eRoot = config.e2e?.dir ? path.resolve(root, config.e2e.dir) : root
  const require = createRequire(path.join(e2eRoot, 'package.json'))
  if (config.db.driver === 'postgres') {
    const { Client } = require('pg')
    const client = new Client({
      host: env.DATABASE_HOST ?? env.PGHOST ?? 'localhost', port: Number(env.DATABASE_PORT ?? env.PGPORT ?? 5432),
      user: env.DATABASE_USERNAME ?? env.PGUSER, password: env.DATABASE_PASSWORD ?? env.PGPASSWORD,
      database: database ?? env.DATABASE_NAME ?? env.PGDATABASE,
    })
    return { connect: () => client.connect(), query: (sql) => client.query(sql), end: () => client.end() }
  }
  if (config.db.driver === 'mysql') {
    const mysql = require('mysql2/promise')
    let connection
    return {
      connect: async () => { connection = await mysql.createConnection({
        host: env.DATABASE_HOST ?? env.MYSQL_HOST ?? 'localhost', port: Number(env.DATABASE_PORT ?? env.MYSQL_PORT ?? 3306),
        user: env.DATABASE_USERNAME ?? env.MYSQL_USER, password: env.DATABASE_PASSWORD ?? env.MYSQL_PASSWORD,
        database: database ?? env.DATABASE_NAME ?? env.MYSQL_DATABASE,
      }) },
      query: async (sql) => { const [rows] = await connection.execute(sql); return { rows } },
      end: () => connection?.end(),
    }
  }
  throw new Error(`driver DB không hỗ trợ: ${config.db.driver}`)
}

function formatRows(rows, json) {
  if (json) return `${JSON.stringify(rows, null, 2)}\n`
  if (!rows.length) return '(0 dòng)\n'
  const columns = Object.keys(rows[0])
  return `${columns.join(' | ')}\n${rows.map((row) => columns.map((column) => {
    const value = row[column]
    return String(value === null || value === undefined ? 'null' : typeof value === 'object' ? JSON.stringify(value) : value).replace(/\|/g, '\\|').replace(/\n/g, ' ')
  }).join(' | ')).join('\n')}\n`
}

export async function run(args, ctx) {
  let client, env = {}
  try {
    const root = findRoot(ctx.cwd)
    if (!root) throw new Error('không thấy ff.config.yaml')
    const { config } = loadConfig(root)
    if (!config.db?.env_file || !config.db.driver) throw new Error('chưa cấu hình db.driver và db.env_file')
    let sql = null, database = null, file = null
    const json = args.includes('--json') || args.includes('--format') && args[args.indexOf('--format') + 1] === 'json'
    for (let i = 0; i < args.length; i++) {
      if (['--sql', '-s'].includes(args[i])) sql = args[++i]
      else if (['--file', '-f'].includes(args[i])) file = args[++i]
      else if (['--db', '-d'].includes(args[i])) database = args[++i]
    }
    if (sql && file) throw new Error('chỉ truyền một trong --sql hoặc --file')
    if (file) {
      const allowedDir = config.project_docs?.verification_queries_dir
      if (!allowedDir) throw new Error('chưa cấu hình project_docs.verification_queries_dir cho --file')
      const base = path.resolve(root, allowedDir), target = path.resolve(ctx.cwd, file)
      if (!target.startsWith(base + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile() || !fs.realpathSync(target).startsWith(fs.realpathSync(base) + path.sep)) throw new Error('file SQL phải nằm trong project_docs.verification_queries_dir')
      sql = fs.readFileSync(target, 'utf8')
    }
    const statements = validateQuerySafety(sql)
    const envFile = path.resolve(root, config.db.env_file)
    if (!envFile.startsWith(root + path.sep) || !fs.existsSync(envFile)) throw new Error('không thấy file cấu hình DB')
    env = parseEnv(envFile)
    client = await makeClient(root, config, env, database, ctx)
    await client.connect()
    const rows = []
    for (const statement of statements) {
      const result = await client.query(statement)
      rows.push(...(result.rows ?? []))
    }
    ctx.stdout.write(formatRows(rows, json))
    return 0
  } catch (error) {
    let message = String(error?.message ?? error)
    for (const value of Object.values(env)) if (value && value.length >= 3) message = message.split(value).join('[redacted]')
    ctx.stderr.write(`ff db-query: ${message}\n`)
    return 1
  } finally { try { await client?.end() } catch {} }
}
