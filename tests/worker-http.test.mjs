import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeWorkspace } from './helpers/fixture.mjs'
import { startWorkerHttp } from '../ff-worker/src/core/http.mjs'

test('worker HTTP binds loopback, requires bearer token, and routes supported requests', async (t) => {
  const w = makeWorkspace()
  t.after(w.cleanup)
  const events = []
  const api = await startWorkerHttp({ root: w.root, port: 0, token: 'a-secret-token', channel: { notify: async (event) => events.push(event) }, handlers: { verifyLock: async (body) => ({ acquired: body.action === 'acquire' }), shipRequest: async () => ({ accepted: true }) } })
  t.after(() => api.close())
  assert.equal(api.address.address, '127.0.0.1')
  const base = `http://127.0.0.1:${api.address.port}`
  const denied = await fetch(`${base}/notify`, { method: 'POST', body: '{}' })
  assert.equal(denied.status, 401)
  const headers = { authorization: 'Bearer a-secret-token', 'content-type': 'application/json' }
  const notify = await fetch(`${base}/notify`, { method: 'POST', headers, body: JSON.stringify({ kind: 'info', title: 'hello' }) })
  assert.equal(notify.status, 200)
  assert.equal(events[0].title, 'hello')
  const lock = await fetch(`${base}/verify-lock`, { method: 'POST', headers, body: JSON.stringify({ action: 'acquire', taskId: '123' }) })
  assert.deepEqual(await lock.json(), { acquired: true })
  const ship = await fetch(`${base}/ship-request`, { method: 'POST', headers, body: '{}' })
  assert.deepEqual(await ship.json(), { accepted: true })
  const statusPath = path.join(w.root, '.ff/worker.json')
  assert.equal(fs.statSync(statusPath).mode & 0o777, 0o600)
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).token, 'a-secret-token')
})

test('worker HTTP rejects malformed, oversized, and unknown requests', async (t) => {
  const w = makeWorkspace()
  t.after(w.cleanup)
  const api = await startWorkerHttp({ root: w.root, port: 0, token: 'token123456789', channel: { notify: async () => {} }, maxBodyBytes: 32 })
  t.after(() => api.close())
  const base = `http://127.0.0.1:${api.address.port}`
  const headers = { authorization: 'Bearer token123456789', 'content-type': 'application/json' }
  assert.equal((await fetch(`${base}/missing`, { method: 'POST', headers, body: '{}' })).status, 404)
  assert.equal((await fetch(`${base}/notify`, { method: 'POST', headers, body: '{bad' })).status, 400)
  assert.equal((await fetch(`${base}/notify`, { method: 'POST', headers, body: JSON.stringify({ title: 'x'.repeat(100) }) })).status, 413)
})
