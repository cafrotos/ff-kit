import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { findRoot, loadConfig } from '../lib/config.mjs'

export const summary = 'db-query --sql <SELECT> | --file <query.sql> [--json] — truy vấn DB chỉ đọc'

// This lexer is a conservative preflight filter, not a SQL grammar or a sandbox.
// The server transaction enforces read-only database access. Arbitrary functions
// can still have external effects: use least-privilege credentials and function grants.
function tokenizeStatements(sql) {
  const statements = []
  let text = '', tokens = [], depth = 0, i = 0
  const add = (kind, value, raw = value) => { tokens.push({ kind, value }); text += raw }
  const finish = () => {
    if (depth) throw new Error('SQL có ngoặc chưa đóng')
    if (tokens.length) statements.push({ sql: text.trim(), tokens })
    text = ''; tokens = []
  }
  while (i < sql.length) {
    const c = sql[i], n = sql[i + 1]
    if (/\s/.test(c)) { text += c; i++; continue }
    if (c === '-' && n === '-') {
      // MySQL requires whitespace after --, whereas PostgreSQL does not.
      // Reject ambiguous forms rather than silently changing arithmetic.
      if (sql[i + 2] && !/\s/.test(sql[i + 2])) throw new Error('SQL có -- không hỗ trợ vì phụ thuộc dialect')
      const end = sql.indexOf('\n', i + 2)
      i = end < 0 ? sql.length : end
      text += ' '
      continue
    }
    if (c === '/' && n === '*') {
      if (['!', '+'].includes(sql[i + 2])) throw new Error('SQL không hỗ trợ executable comment hoặc optimizer hint')
      let nested = 1
      i += 2
      while (i < sql.length && nested) {
        if (sql[i] === '/' && sql[i + 1] === '*') { nested++; i += 2 }
        else if (sql[i] === '*' && sql[i + 1] === '/') { nested--; i += 2 }
        else i++
      }
      if (nested) throw new Error('SQL có chú thích chưa đóng')
      text += ' '
      continue
    }
    if (["'", '"', '`'].includes(c)) {
      const start = i++, quote = c
      let value = '', closed = false
      while (i < sql.length) {
        if (sql[i] === '\\') throw new Error('SQL không hỗ trợ backslash escape phụ thuộc chế độ DB')
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { value += quote; i += 2; continue }
          i++; closed = true; break
        }
        value += sql[i++]
      }
      if (!closed) throw new Error('SQL có literal hoặc identifier chưa đóng')
      add(quote === "'" ? 'literal' : 'identifier', value, sql.slice(start, i))
      continue
    }
    if (c === '$') {
      const tag = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0]
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length)
        if (end < 0) throw new Error('SQL có dollar literal chưa đóng')
        const raw = sql.slice(i, end + tag.length)
        add('literal', '', raw); i = end + tag.length; continue
      }
      const parameter = sql.slice(i).match(/^\$[0-9]+/)?.[0]
      if (!parameter) throw new Error('SQL có token $ không hỗ trợ')
      add('parameter', parameter); i += parameter.length; continue
    }
    if (/[A-Za-z_]/.test(c)) {
      const word = sql.slice(i).match(/^[A-Za-z_][A-Za-z_0-9$]*/)[0]
      add('word', word.toUpperCase(), word); i += word.length; continue
    }
    if (/[0-9]/.test(c)) {
      const number = sql.slice(i).match(/^[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/)[0]
      add('number', number); i += number.length; continue
    }
    if (c === ';') { finish(); i++; continue }
    if (c === '(') depth++
    else if (c === ')' && --depth < 0) throw new Error('SQL có ngoặc đóng không khớp')
    if (c === ':' && n === '=') throw new Error('SQL không cho phép gán biến :=')
    if (!'(),.*+-/%=<>!~^|&?:@'.includes(c)) throw new Error(`SQL có token không hỗ trợ: ${c}`)
    add('symbol', c); i++
  }
  finish()
  return statements
}

const forbiddenWords = new Set([
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'GRANT', 'REVOKE', 'CREATE',
  'CALL', 'COPY', 'INTO', 'MERGE', 'REPLACE', 'UPSERT', 'LOAD', 'OUTFILE', 'DUMPFILE',
  'SET', 'RESET', 'COMMIT', 'ROLLBACK', 'BEGIN', 'START', 'SAVEPOINT', 'RELEASE',
  'PREPARE', 'EXECUTE', 'DEALLOCATE', 'DISCARD', 'VACUUM', 'REFRESH', 'REINDEX',
  'LOCK', 'UNLOCK', 'LISTEN', 'UNLISTEN', 'NOTIFY', 'DO', 'HANDLER',
])
const unsafeFunctions = new Set([
  'NEXTVAL', 'SETVAL', 'PG_NOTIFY', 'SET_CONFIG', 'PG_CANCEL_BACKEND', 'PG_TERMINATE_BACKEND',
  'PG_RELOAD_CONF', 'PG_ROTATE_LOGFILE', 'PG_LOGICAL_EMIT_MESSAGE', 'PG_CREATE_RESTORE_POINT',
  'PG_SWITCH_WAL', 'LO_IMPORT', 'LO_EXPORT', 'LO_CREATE', 'LO_CREAT', 'LO_UNLINK', 'LO_PUT',
  'LO_FROM_BYTEA', 'LOWRITE', 'LO_WRITE', 'GET_LOCK', 'RELEASE_LOCK', 'RELEASE_ALL_LOCKS',
])
const isWord = (token, value) => token?.kind === 'word' && token.value === value
const isName = (token) => ['word', 'identifier'].includes(token?.kind)

function skipGroup(tokens, start) {
  if (tokens[start]?.value !== '(') throw new Error('SQL phải có nhóm ngoặc')
  let depth = 1, i = start + 1
  for (; i < tokens.length && depth; i++) {
    if (tokens[i].value === '(' && tokens[i].kind === 'symbol') depth++
    else if (tokens[i].value === ')' && tokens[i].kind === 'symbol') depth--
  }
  if (depth) throw new Error('SQL có ngoặc chưa đóng')
  return i
}

function requireSelect(tokens) {
  if (isWord(tokens[0], 'SELECT')) {
    if (tokens.length < 2) throw new Error('SELECT phải có biểu thức')
    return
  }
  if (!isWord(tokens[0], 'WITH')) throw new Error('WITH / EXPLAIN phải dẫn tới SELECT')
  let i = isWord(tokens[1], 'RECURSIVE') ? 2 : 1
  do {
    if (!isName(tokens[i])) throw new Error('WITH phải khai báo tên CTE')
    i++
    if (tokens[i]?.value === '(') i = skipGroup(tokens, i)
    if (!isWord(tokens[i++], 'AS')) throw new Error('WITH phải có AS')
    if (isWord(tokens[i], 'NOT')) {
      i++
      if (!isWord(tokens[i++], 'MATERIALIZED')) throw new Error('WITH không hợp lệ')
    } else if (isWord(tokens[i], 'MATERIALIZED')) i++
    const end = skipGroup(tokens, i)
    requireSelect(tokens.slice(i + 1, end - 1))
    i = end
    if (tokens[i]?.value !== ',') break
    i++
  } while (i < tokens.length)
  if (!isWord(tokens[i], 'SELECT')) throw new Error('WITH phải kết thúc bằng SELECT')
  requireSelect(tokens.slice(i))
}

export function validateQuerySafety(sql) {
  if (typeof sql !== 'string' || !sql.trim()) throw new Error('SQL rỗng')
  const statements = tokenizeStatements(sql)
  if (!statements.length) throw new Error('SQL chỉ chứa chú thích hoặc rỗng')
  for (const { tokens } of statements) {
    const first = tokens[0]?.kind === 'word' ? tokens[0].value : undefined
    if (!['SELECT', 'WITH', 'EXPLAIN'].includes(first)) throw new Error(`chỉ cho phép SELECT / WITH ... SELECT / EXPLAIN; nhận ${first ?? 'SQL không hợp lệ'}`)
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      if (token.kind === 'word' && forbiddenWords.has(token.value)) throw new Error(`thao tác ghi / điều khiển bị cấm: ${token.value}`)
      if (isWord(token, 'FOR') && (isWord(tokens[i + 1], 'SHARE') || isWord(tokens[i + 1], 'KEY') && isWord(tokens[i + 2], 'SHARE'))) throw new Error('SQL không cho phép FOR SHARE')
      if (isWord(token, 'NEXT') && isWord(tokens[i + 1], 'VALUE')) throw new Error('SQL không cho phép NEXT VALUE')
      if (isName(token) && tokens[i + 1]?.value === '(') {
        const name = token.value.toUpperCase()
        if (unsafeFunctions.has(name) || /^PG_(?:TRY_)?ADVISORY_/.test(name) || /^DBLINK_(?:EXEC|CONNECT|DISCONNECT)/.test(name)) throw new Error(`hàm có side effect bị cấm: ${name}`)
      }
    }
    let query = tokens
    if (first === 'EXPLAIN') {
      let i = 1
      if (tokens[i]?.value === '(') i = skipGroup(tokens, i)
      else while (isWord(tokens[i], 'ANALYZE') || isWord(tokens[i], 'VERBOSE')) i++
      query = tokens.slice(i)
    }
    requireSelect(query)
  }
  return statements.map(statement => statement.sql)
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
      host: env.DATABASE_HOST ?? env.PGHOST ?? 'localhost', port: Number(env.DATABASE_PORT ?? env.PGPORT ?? 5432), connectionTimeoutMillis: 15000,
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
        host: env.DATABASE_HOST ?? env.MYSQL_HOST ?? 'localhost', port: Number(env.DATABASE_PORT ?? env.MYSQL_PORT ?? 3306), connectTimeout: 15000,
        user: env.DATABASE_USERNAME ?? env.MYSQL_USER, password: env.DATABASE_PASSWORD ?? env.MYSQL_PASSWORD,
        database: database ?? env.DATABASE_NAME ?? env.MYSQL_DATABASE,
      }) },
      query: async (sql) => { const [rows] = await connection.query({ sql, timeout: 15000 }); return { rows } },
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
    let queryError
    try {
      if (config.db.driver === 'postgres') {
        await client.query('BEGIN READ ONLY')
        await client.query("SET LOCAL statement_timeout = '15000ms'")
        await client.query("SET LOCAL lock_timeout = '5000ms'")
      } else if (config.db.driver === 'mysql') {
        await client.query('SET SESSION max_execution_time = 15000')
        await client.query('SET SESSION innodb_lock_wait_timeout = 5')
        await client.query('START TRANSACTION READ ONLY')
      } else throw new Error(`driver DB không hỗ trợ: ${config.db.driver}`)
      for (const statement of statements) {
        const result = await client.query(statement)
        rows.push(...(result.rows ?? []))
      }
    } catch (error) {
      queryError = error
      throw error
    } finally {
      try { await client.query('ROLLBACK') }
      catch (error) { if (!queryError) throw error }
    }
    ctx.stdout.write(formatRows(rows, json))
    return 0
  } catch (error) {
    let message = String(error?.message ?? error)
    const secrets = Object.entries(env)
      .filter(([key, value]) => value && (value.length >= 3 || /PASSWORD|PASS|SECRET|TOKEN|KEY|CREDENTIAL/i.test(key)))
      .map(([, value]) => value).sort((a, b) => b.length - a.length)
    for (const value of secrets) message = message.split(value).join('[redacted]')
    ctx.stderr.write(`ff db-query: ${message}\nDB chỉ đọc không cô lập side effect ngoài DB; dùng credentials least-privilege và giới hạn quyền gọi hàm.\n`)
    return 1
  } finally { try { await client?.end() } catch {} }
}
