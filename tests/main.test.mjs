import { test } from 'node:test'
import assert from 'node:assert/strict'
import { main } from '../scripts/cli/main.mjs'
import { capture } from './helpers/io.mjs'

test('ff help liệt kê lệnh và exit 0', async () => {
  const { ctx, buf } = capture()
  assert.equal(await main(['help'], ctx), 0)
  assert.match(buf.out, /ff <lệnh>/)
})

test('ff --version in phiên bản', async () => {
  const { ctx, buf } = capture()
  assert.equal(await main(['--version'], ctx), 0)
  assert.equal(buf.out.trim(), '0.1.0')
})

test('lệnh lạ → exit 2 + thông báo tiếng Việt', async () => {
  const { ctx, buf } = capture()
  assert.equal(await main(['khong-co'], ctx), 2)
  assert.match(buf.err, /không có lệnh 'khong-co'/)
})
