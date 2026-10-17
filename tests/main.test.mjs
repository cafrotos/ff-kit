import { test } from 'node:test'
import assert from 'node:assert/strict'
import { main } from '../scripts/cli/main.mjs'
import { capture } from './helpers/io.mjs'

test('ff help liệt kê lệnh và exit 0', async () => {
  const { ctx, buf } = capture()
  assert.equal(await main(['help'], ctx), 0)
  assert.match(buf.out, /ff <lệnh>/)
  for (const command of ['state', 'sync', 'copy', 'squash-check', 'verify-up', 'verify-down', 'verify-lock', 'ship-request', 'mcp-auth', 'e2e-auth-check', 'e2e-scaffold', 'ship-approve', 'ac-matrix', 'e2e-lint', 'design-check', 'lock-tests', 'relock', 'allow', 'db-query', 'probe-slice']) {
    assert.match(buf.out, new RegExp(`\\b${command.replaceAll('-', '\\-')}\\b`), `ff help should list ${command}`)
  }
  assert.match(buf.out, /worker <start\\|stop\\|status\\|logs\\|resolve\\|park>/)
})

test('ff --version in phiên bản', async () => {
  const { ctx, buf } = capture()
  assert.equal(await main(['--version'], ctx), 0)
  assert.equal(buf.out.trim(), '0.2.0')
})

test('lệnh lạ → exit 2 + thông báo tiếng Việt', async () => {
  const { ctx, buf } = capture()
  assert.equal(await main(['khong-co'], ctx), 2)
  assert.match(buf.err, /không có lệnh 'khong-co'/)
})
