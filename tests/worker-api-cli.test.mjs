import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { main } from '../scripts/cli/main.mjs'
import { makeWorkspace } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'

test('verify-lock calls authenticated worker endpoint and reports competing lock', async (t) => {
  const w = makeWorkspace()
  t.after(w.cleanup)
  fs.mkdirSync(path.join(w.root, '.ff'), { recursive: true })
  fs.writeFileSync(path.join(w.root, '.ff/worker.json'), JSON.stringify({ port: 3456, token: 'secret-token' }))
  const { ctx, buf } = capture(w.root)
  ctx.fetch = async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:3456/verify-lock')
    assert.equal(init.headers.authorization, 'Bearer secret-token')
    return Response.json({ acquired: false, current: { slug: '123-other' } })
  }
  assert.equal(await main(['verify-lock', 'acquire', '123-search'], ctx), 1)
  assert.match(buf.err, /123-other/)
  assert.doesNotMatch(buf.err, /secret-token/)
})

test('ship-request sends a one-way request without exposing worker token', async (t) => {
  const w = makeWorkspace()
  t.after(w.cleanup)
  fs.mkdirSync(path.join(w.root, '.ff'), { recursive: true })
  fs.writeFileSync(path.join(w.root, '.ff/worker.json'), JSON.stringify({ port: 3456, token: 'secret-token' }))
  const { ctx, buf } = capture(w.root)
  ctx.fetch = async (_url, init) => {
    assert.equal(init.headers.authorization, 'Bearer secret-token')
    assert.deepEqual(JSON.parse(init.body), { taskId: '123', title: 'Ship now', body: 'Check Gate C' })
    return Response.json({ accepted: true })
  }
  assert.equal(await main(['ship-request', '--task', '123', '--title', 'Ship now', '--body', 'Check Gate C'], ctx), 0)
  assert.match(buf.out, /đã gửi yêu cầu/)
  assert.doesNotMatch(buf.out, /secret-token/)
})
