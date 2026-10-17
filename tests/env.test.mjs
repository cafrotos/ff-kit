import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parseEnvKeys, presentKeys, requiredKeys, requiredKeysByGroup, mergeEnvExample } from '../scripts/lib/env.mjs'
import { parseConfigText } from '../scripts/lib/config.mjs'
import { main } from '../scripts/cli/main.mjs'
import { makeWorkspace, baseConfig } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'
import YAML from 'yaml'

const cfg = (mut = (c) => c) => parseConfigText(YAML.stringify(mut(baseConfig()))).config

test('parseEnvKeys: export, nháy, comment, giá trị rỗng, CRLF, BOM', () => {
  const text = '\uFEFFexport A=1\r\nB="x y"\r\nC=\r\n# D=1\r\nE=  # chỉ comment\r\nF=\'\'\r\n'
  assert.deepEqual([...parseEnvKeys(text)].sort(), ['A', 'B'])
  assert.deepEqual([...parseEnvKeys(text, { withValueOnly: false })].sort(), ['A', 'B', 'C', 'E', 'F'])
})

test('requiredKeys theo adapter đã chọn', () => {
  assert.deepEqual(requiredKeys(cfg()), ['TRELLO_API_KEY', 'TRELLO_API_TOKEN'])
  const rc = requiredKeys(cfg((c) => { c.worker.channel.adapter = 'rocketchat'; return c }))
  assert.deepEqual(rc, ['TRELLO_API_KEY', 'TRELLO_API_TOKEN', 'RC_URL', 'RC_USER_ID', 'RC_AUTH_TOKEN', 'RC_ROOM_ID'])
  const fl = requiredKeys(cfg((c) => { c.e2e = { dir: 'ff-e2e', auth: { strategy: 'form-login', login_url: 'http://localhost:3000/login' } }; return c }))
  assert.deepEqual(fl, ['TRELLO_API_KEY', 'TRELLO_API_TOKEN', 'E2E_USER', 'E2E_PASSWORD'])
  const c = cfg((c) => { c.e2e = { dir: 'ff-e2e', auth: { strategy: 'form-login', login_url: 'http://localhost:3000/login' } }; return c })
  assert.deepEqual(requiredKeysByGroup(c), { worker: ['TRELLO_API_KEY', 'TRELLO_API_TOKEN'], e2e: ['E2E_USER', 'E2E_PASSWORD'] })
})

test('presentKeys: không có file → null', () => {
  assert.equal(presentKeys('/khong/co/file'), null)
})

test('mergeEnvExample tạo file mới đủ key, giá trị rỗng', (t) => {
  const ws = makeWorkspace()
  t.after(ws.cleanup)
  const f = path.join(ws.root, '.ff.env.example')
  assert.deepEqual(mergeEnvExample(f, cfg()), ['TRELLO_API_KEY', 'TRELLO_API_TOKEN'])
  const text = fs.readFileSync(f, 'utf8')
  assert.match(text, /^TRELLO_API_KEY=$/m)
  assert.equal(parseEnvKeys(text).size, 0)
})

test('mergeEnvExample chỉ thêm key thiếu, giữ nguyên dòng cũ, giữ CRLF', (t) => {
  const ws = makeWorkspace()
  t.after(ws.cleanup)
  const f = path.join(ws.root, '.ff.env.example')
  const old = '# của user\r\nTRELLO_API_KEY=\r\nKHAC=1\r\n'
  fs.writeFileSync(f, old)
  assert.deepEqual(mergeEnvExample(f, cfg()), ['TRELLO_API_TOKEN'])
  const text = fs.readFileSync(f, 'utf8')
  assert.ok(text.startsWith(old))
  assert.match(text, /TRELLO_API_TOKEN=\r\n$/)
  assert.deepEqual(mergeEnvExample(f, cfg()), [])
})

test('ff env-example không đọc .ff.env', async (t) => {
  const ws = makeWorkspace({ files: { '.ff.env': 'TRELLO_API_KEY=SECRET123\n' } })
  // Hook t.after chạy theo thứ tự đăng ký: trả quyền rồi mới xoá thư mục.
  t.after(() => { fs.chmodSync(path.join(ws.root, '.ff.env'), 0o600); ws.cleanup() })
  const secret = path.join(ws.root, '.ff.env')
  fs.chmodSync(secret, 0o000)
  const { ctx, buf } = capture(ws.root)
  assert.equal(await main(['env-example'], ctx), 0)
  assert.match(buf.out, /TRELLO_API_TOKEN/)
  assert.doesNotMatch(buf.out + buf.err, /SECRET123/)
})
