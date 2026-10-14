import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeWorkspace } from './helpers/fixture.mjs'
import { startWorkerHttp } from '../ff-worker/src/core/http.mjs'
import { notify } from '../scripts/lib/notify.mjs'

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

test('worker HTTP preserves the complete notification packet verbatim', async (t) => {
  const w = makeWorkspace()
  t.after(w.cleanup)
  const events = []
  const api = await startWorkerHttp({ root: w.root, token: 'test-token', channel: { notify: async (event) => events.push(event) } })
  t.after(() => api.close())
  const event = { kind: 'gate', taskId: '123', title: 'Duyệt', fields: { revision: 'rev-3', scope: 'task-2' }, body: 'Đã xác minh', presentation: { version: 1, decisions: [{ question: 'Có duyệt?', options: [{ label: 'Duyệt', description: 'Nội dung dài'.repeat(100) }] }] }, extra: { preserved: true } }
  const response = await fetch(`http://127.0.0.1:${api.address.port}/notify`, { method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' }, body: JSON.stringify(event) })
  assert.equal(response.status, 200)
  assert.deepEqual(events, [event])
})

test('worker HTTP logs channel failure, returns generic rejection and never leaks details', async (t) => {
  const w = makeWorkspace()
  t.after(w.cleanup)
  const logs = []
  const api = await startWorkerHttp({ root: w.root, token: 'test-token', channel: { notify: async () => { throw Object.assign(new Error('private server detail test-token'), { status: 500 }) } }, log: (line) => logs.push(line) })
  t.after(() => api.close())
  const response = await fetch(`http://127.0.0.1:${api.address.port}/notify`, { method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'info', title: 'hello' }) })
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: 'request failed' })
  assert.match(logs.join(''), /notify.*failed/i)
  assert.doesNotMatch(logs.join(''), /private|test-token|server detail/)
})

test('worker HTTP default 64KiB limit returns explicit 413 without forwarding', async (t) => {
  const w = makeWorkspace()
  t.after(w.cleanup)
  const api = await startWorkerHttp({ root: w.root, token: 'test-token', channel: { notify: async () => assert.fail('oversized payload forwarded') } })
  t.after(() => api.close())
  const response = await fetch(`http://127.0.0.1:${api.address.port}/notify`, { method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'info', title: 'hello', body: 'x'.repeat(64 * 1024) }) })
  assert.equal(response.status, 413)
  assert.deepEqual(await response.json(), { error: 'request too large' })
})

test('channel errors cannot impersonate client-validation errors or suppress failure logs', async (t) => {
  const w = makeWorkspace()
  t.after(w.cleanup)
  const logs = []
  const api = await startWorkerHttp({ root: w.root, token: 'test-token', channel: { notify: async () => { throw Object.assign(new Error('private channel details'), { status: 400 }) } }, log: (line) => logs.push(line) })
  t.after(() => api.close())
  const response = await fetch(`http://127.0.0.1:${api.address.port}/notify`, { method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'info', title: 'hello' }) })
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: 'request failed' })
  assert.match(logs.join(''), /notify.*failed/i)
  assert.doesNotMatch(logs.join(''), /private/)
})

test('downstream timeout or network loss remains unknown through worker and notify client', async (t) => {
  for (const name of ['TimeoutError', 'AbortError', 'TypeError']) {
    await t.test(name, async (t) => {
      const w = makeWorkspace()
      t.after(w.cleanup)
      const logs = []
      let attempts = 0
      const api = await startWorkerHttp({ root: w.root, token: 'test-token', channel: { notify: async () => { attempts++; throw Object.assign(new Error('private channel details test-token'), { name }) } }, log: (line) => logs.push(line) })
      t.after(() => api.close())
      const result = await notify(w.root, { kind: 'info', title: 'hello' }, { log: (line) => logs.push(line) })
      assert.deepEqual(result, { delivered: false, status: 'unknown', reason: name === 'TypeError' ? 'network_error' : 'timeout' })
      assert.equal(attempts, 1)
      assert.match(logs.join(''), /unknown/i)
      assert.doesNotMatch(logs.join(''), /private|test-token/)
    })
  }
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
