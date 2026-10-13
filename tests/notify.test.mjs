import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { notify, makeEvent } from '../scripts/lib/notify.mjs'
import { main } from '../scripts/cli/main.mjs'
import { makeWorkspace } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'

async function server(t, handler) {
  const s = http.createServer(handler)
  await new Promise((r) => s.listen(0, '127.0.0.1', r))
  t.after(() => { s.closeAllConnections(); s.close() })
  return s.address().port
}
const writeWorker = (root, port) => {
  fs.mkdirSync(path.join(root, '.ff'), { recursive: true })
  fs.writeFileSync(path.join(root, '.ff/worker.json'), JSON.stringify({ port, token: 'tok123' }), { mode: 0o600 })
}
const ws = (t) => { const w = makeWorkspace(); t.after(w.cleanup); return w.root }
const ev = makeEvent({ kind: 'gate', taskId: '123', title: 'GATE_A thẻ #123 chờ duyệt' })

test('makeEvent chặn kind sai và thiếu title', () => {
  assert.throws(() => makeEvent({ kind: 'x', title: 'a' }))
  assert.throws(() => makeEvent({ kind: 'info' }))
  assert.deepEqual(makeEvent({ kind: 'info', title: 'a' }), { kind: 'info', taskId: '', title: 'a', fields: {}, body: '' })
})

test('worker không chạy → delivered false, có log', async (t) => {
  const logs = []
  const r = await notify(ws(t), ev, { log: (s) => logs.push(s) })
  assert.equal(r.delivered, false)
  assert.match(logs.join(), /worker không chạy/)
})

test('worker nhận đúng body và token', async (t) => {
  const root = ws(t)
  let got
  const port = await server(t, (req, res) => {
    let b = ''
    req.on('data', (c) => { b += c })
    req.on('end', () => { got = { url: req.url, method: req.method, auth: req.headers.authorization, body: JSON.parse(b) }; res.writeHead(204).end() })
  })
  writeWorker(root, port)
  assert.equal((await notify(root, ev, { log: () => {} })).delivered, true)
  assert.deepEqual(got, { url: '/notify', method: 'POST', auth: 'Bearer tok123', body: ev })
})

test('worker trả 500 → delivered false', async (t) => {
  const root = ws(t)
  writeWorker(root, await server(t, (req, res) => res.writeHead(500).end()))
  assert.equal((await notify(root, ev, { log: () => {} })).delivered, false)
})

test('notify timeout: worker treo → trả trong thời hạn', async (t) => {
  const root = ws(t)
  writeWorker(root, await server(t, () => {}))
  const t0 = Date.now()
  const r = await notify(root, ev, { timeoutMs: 200, log: () => {} })
  assert.equal(r.delivered, false)
  assert.ok(Date.now() - t0 < 1500)
})

test('CLI: exit 0 khi worker không chạy, exit 2 khi sai tham số', async (t) => {
  const root = ws(t)
  assert.equal(await main(['notify', '--kind', 'info', '--title', 'xin chào'], capture(root).ctx), 0)
  assert.equal(await main(['notify', '--kind', 'sai', '--title', 'x'], capture(root).ctx), 2)
  assert.equal(await main(['notify', '--kind', 'info'], capture(root).ctx), 2)
})
