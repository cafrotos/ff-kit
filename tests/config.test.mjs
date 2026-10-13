import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { findRoot, parseConfigText, loadConfig, loadConfigOrDefaults, getKey, ConfigError } from '../scripts/lib/config.mjs'
import { validate } from '../scripts/lib/schema.mjs'
import { makeWorkspace, baseConfig } from './helpers/fixture.mjs'
import YAML from 'yaml'

test('config tối thiểu nhận mặc định', () => {
  const { config, raw } = parseConfigText(YAML.stringify(baseConfig()))
  assert.equal(config.workspace.cards_dir, 'trellocards')
  assert.equal(config.worker.max_concurrent_tasks, 2)
  assert.equal(config.worker.channel.adapter, 'console')
  assert.equal(config.guard.forbidden_script_re, ':prod$')
  assert.equal(raw.guard, undefined)
  assert.deepEqual(validate(config), [])
})

test('YAML hỏng → ConfigError có số dòng', () => {
  assert.throws(() => parseConfigText('version: 1\nrepos: [\n'), (e) => e instanceof ConfigError && /dòng \d+/.test(e.message))
})

test('BOM đầu file vẫn đọc được', () => {
  const { config } = parseConfigText('﻿' + YAML.stringify(baseConfig()))
  assert.equal(config.version, 1)
})

test('validate bắt thiếu repos, khóa lạ, repo trùng tên, trello thiếu cấu hình', () => {
  const c1 = parseConfigText(YAML.stringify({ ...baseConfig(), repos: undefined })).config
  assert.ok(validate(c1).some((e) => /repos/.test(e)))
  const c2 = parseConfigText(YAML.stringify({ ...baseConfig(), la: 1 })).config
  assert.ok(validate(c2).some((e) => /la/.test(e)))
  const b = baseConfig()
  b.repos.push({ ...b.repos[0] })
  assert.ok(validate(parseConfigText(YAML.stringify(b)).config).some((e) => /trùng/.test(e)))
  const t = baseConfig()
  delete t.worker.task_source.trello
  assert.ok(validate(parseConfigText(YAML.stringify(t)).config).length > 0)
})

test('validate khối e2e: form-login cần login_url, jwt-mint cần jwt, base_url phải là URL', () => {
  const c = baseConfig()
  c.e2e = { dir: 'ff-e2e', apps: [{ name: 'web', base_url: 'http://localhost:3001' }], health_urls: ['http://localhost:8080/health'], auth: { strategy: 'storage-state' } }
  assert.deepEqual(validate(parseConfigText(YAML.stringify(c)).config), [])
  c.e2e.auth = { strategy: 'form-login' }
  assert.ok(validate(parseConfigText(YAML.stringify(c)).config).some((e) => /login_url/.test(e)))
  c.e2e.auth = { strategy: 'jwt-mint' }
  assert.ok(validate(parseConfigText(YAML.stringify(c)).config).some((e) => /jwt/.test(e)))
  c.e2e.auth = {
    strategy: 'jwt-mint',
    jwt: {
      secret: { file: 'api/.env', key: 'JWT_SECRET' },
      algorithm: 'HS256',
      payload: { sub: '{user.id}', email: '{user.email}' },
      deliver: [{ via: 'query', name: 'token' }, { via: 'local_storage', name: 'authToken' }],
      verify: { url: 'http://localhost:8080/me', expect_status: 200 },
    },
  }
  assert.deepEqual(validate(parseConfigText(YAML.stringify(c)).config), [])
  c.e2e.auth.jwt.algorithm = 'RS256'
  assert.ok(validate(parseConfigText(YAML.stringify(c)).config).some((e) => /algorithm/.test(e)))
  c.e2e.auth = { strategy: 'none' }
  c.e2e.apps[0].base_url = 'localhost:3001'
  assert.ok(validate(parseConfigText(YAML.stringify(c)).config).some((e) => /base_url/.test(e)))
})

test('task_source là tùy chọn; ship_branch bắt buộc; regex hỏng bị báo', () => {
  const noWorker = baseConfig()
  delete noWorker.worker.task_source
  assert.deepEqual(validate(parseConfigText(YAML.stringify(noWorker)).config), [])
  const noShip = baseConfig()
  delete noShip.repos[0].ship_branch
  assert.ok(validate(parseConfigText(YAML.stringify(noShip)).config).some((e) => /ship_branch/.test(e)))
  const badRe = { ...baseConfig(), guard: { migration_script_re: '(' } }
  assert.ok(validate(parseConfigText(YAML.stringify(badRe)).config).some((e) => /regex không hợp lệ/.test(e)))
})

test('getKey tra theo chấm và theo name trong mảng', () => {
  const { config } = parseConfigText(YAML.stringify(baseConfig()))
  assert.deepEqual(getKey(config, 'repos.web.path'), { found: true, value: 'web' })
  assert.equal(getKey(config, 'repos.api.path').found, false)
  assert.equal(getKey(config, 'workspace.khong').found, false)
})

test('findRoot đi ngược lên, ngoài workspace trả null', (t) => {
  const ws = makeWorkspace()
  t.after(ws.cleanup)
  const nested = path.join(ws.root, 'web', 'src')
  fs.mkdirSync(nested, { recursive: true })
  assert.equal(findRoot(nested), ws.root)
  assert.equal(findRoot(path.dirname(ws.root)), null)
})

test('loadConfigOrDefaults: sai schema → broken, phần sai thay mặc định, phần đúng giữ nguyên', (t) => {
  const ws = makeWorkspace({ files: { 'ff.config.yaml': YAML.stringify({ ...baseConfig(), workspace: null, guard: { migration_script_re: '(' } }) } })
  t.after(ws.cleanup)
  const r = loadConfigOrDefaults(ws.root)
  assert.equal(r.broken, true)
  assert.equal(r.config.workspace.cards_dir, 'trellocards')
  assert.equal(r.config.guard.migration_script_re, '^migration:(run|revert)$')
  assert.deepEqual(r.config.repos.map((x) => x.path), ['web'])
  const noShip = baseConfig()
  delete noShip.repos[0].ship_branch
  fs.writeFileSync(path.join(ws.root, 'ff.config.yaml'), YAML.stringify(noShip))
  const r2 = loadConfigOrDefaults(ws.root)
  assert.equal(r2.broken, true)
  assert.deepEqual(r2.config.repos.map((x) => x.path), ['web'])
})

test('loadConfigOrDefaults: file hỏng → broken + mặc định', (t) => {
  const ws = makeWorkspace({ files: { 'ff.config.yaml': 'repos: [\n' } })
  t.after(ws.cleanup)
  assert.throws(() => loadConfig(ws.root), ConfigError)
  const r = loadConfigOrDefaults(ws.root)
  assert.equal(r.broken, true)
  assert.equal(r.config.workspace.worktrees_dir, 'worktrees')
  assert.deepEqual(r.config.repos, [])
})
