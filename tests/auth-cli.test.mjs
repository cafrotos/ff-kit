import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { main } from '../scripts/cli/main.mjs'
import { makeWorkspace, baseConfig } from './helpers/fixture.mjs'

function authWorkspace(t, extra = {}) {
  const config = baseConfig()
  config.e2e = {
    dir: 'ff-e2e', auth_storage: 'ff-e2e/.auth/state.json',
    apps: [{ name: 'web', base_url: 'http://localhost:3001' }],
    auth: { strategy: 'jwt-mint', jwt: {
      secret: { file: 'api/.env', key: 'JWT_SECRET' }, algorithm: 'HS256',
      expires_in: { default: '1h' }, payload: { sub: '{user.id}', email: '{user.email}' },
      deliver: [{ via: 'local_storage', name: 'authToken' }],
      verify: { url: 'http://localhost:8080/me', expect_status: 200 }, user_lookup: 'select id, email where email = $1',
    } },
  }
  const ws = makeWorkspace({ config, files: { 'api/.env': 'JWT_SECRET=test-secret\n', ...extra.files } })
  t.after(ws.cleanup)
  return ws
}

function cli(root, overrides = {}) {
  const out = { out: '', err: '' }
  return {
    out,
    ctx: {
      cwd: root,
      stdout: { write: (s) => { out.out += s } },
      stderr: { write: (s) => { out.err += s } },
      ...overrides,
    },
  }
}

test('ff mcp-auth --email ghi storage-state mode 0600 và không in JWT', async (t) => {
  const ws = authWorkspace(t)
  const { ctx, out } = cli(ws.root, { lookupUser: async () => ({ id: 'u1', email: 'user@example.test' }) })
  assert.equal(await main(['mcp-auth', '--email', 'user@example.test'], ctx), 0)
  const file = path.join(ws.root, 'ff-e2e/.auth/state.json')
  const state = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal((fs.statSync(file).mode & 0o777), 0o600)
  assert.equal(state.origins[0].origin, 'http://localhost:3001')
  assert.equal(typeof state.origins[0].localStorage[0].value, 'string')
  assert.doesNotMatch(out.out + out.err, /test-secret|eyJ/)
})

test('ff mcp-auth user không tồn tại thì không ghi auth storage', async (t) => {
  const ws = authWorkspace(t)
  const { ctx, out } = cli(ws.root, { lookupUser: async () => null })
  assert.equal(await main(['mcp-auth', '--email', 'missing@example.test'], ctx), 1)
  assert.match(out.err, /không thấy user/)
  assert.equal(fs.existsSync(path.join(ws.root, 'ff-e2e/.auth/state.json')), false)
})

test('mcp-auth tra user qua driver được cài trong e2e.dir, không mượn dependency tiniweb', async (t) => {
  const ws = authWorkspace(t, { files: {
    'db.env': 'DATABASE_HOST=127.0.0.1\nDATABASE_PORT=5432\nDATABASE_USERNAME=local\nDATABASE_PASSWORD=DB_PASSWORD_SECRET\nDATABASE_NAME=app\n',
    'ff-e2e/package.json': '{"name":"ff-e2e"}',
    'ff-e2e/node_modules/pg/index.js': `exports.Client = class { async connect() {} async query(sql, params) { if (!sql.includes('$1') || params[0] !== 'user@example.test') throw new Error('query params mismatch'); return { rows: [{ id: 'db-user', email: params[0] }] } } async end() {} }`,
  } })
  const configPath = path.join(ws.root, 'ff.config.yaml')
  const YAML = await import('yaml')
  const config = YAML.parse(fs.readFileSync(configPath, 'utf8'))
  config.db = { driver: 'postgres', env_file: 'db.env' }
  fs.writeFileSync(configPath, YAML.stringify(config))
  const { ctx, out } = cli(ws.root)
  assert.equal(await main(['mcp-auth', '--email', 'user@example.test'], ctx), 0)
  assert.ok(fs.existsSync(path.join(ws.root, 'ff-e2e/.auth/state.json')))
  assert.doesNotMatch(out.out + out.err, /DB_PASSWORD_SECRET/)
})

test('ff e2e-auth-check gửi Bearer token và chỉ báo kết quả', async (t) => {
  const ws = authWorkspace(t)
  const { ctx, out } = cli(ws.root, {
    lookupUser: async () => ({ id: 'u1', email: 'user@example.test' }),
    fetch: async (url, options) => {
      assert.equal(url, 'http://localhost:8080/me')
      assert.match(options.headers.authorization, /^Bearer eyJ/)
      return { status: 200 }
    },
  })
  assert.equal(await main(['e2e-auth-check', '--email', 'user@example.test'], ctx), 0)
  assert.match(out.out, /xác thực e2e thành công/)
  assert.doesNotMatch(out.out + out.err, /test-secret|eyJ/)
})

test('ff e2e-auth-check phân biệt 401 và mất kết nối', async (t) => {
  const ws = authWorkspace(t)
  const denied = cli(ws.root, { lookupUser: async () => ({ id: 'u1', email: 'user@example.test' }), fetch: async () => ({ status: 401 }) })
  assert.equal(await main(['e2e-auth-check', '--email', 'user@example.test'], denied.ctx), 1)
  assert.match(denied.out.err, /401/)
  const offline = cli(ws.root, { lookupUser: async () => ({ id: 'u1', email: 'user@example.test' }), fetch: async () => { throw new Error('refused') } })
  assert.equal(await main(['e2e-auth-check', '--email', 'user@example.test'], offline.ctx), 1)
  assert.match(offline.out.err, /server chưa bật/)
  assert.doesNotMatch(offline.out.err, /refused/)
})
