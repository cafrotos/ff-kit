import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { makeWorkspace } from './helpers/fixture.mjs'
import { writeTask } from '../ff-worker/src/core/task-store.mjs'
import { inferCardId } from '../scripts/lib/card-context.mjs'
import { startWorkerHttp } from '../ff-worker/src/core/http.mjs'
import { RocketChatChannel } from '../ff-worker/src/adapters/channel/rocketchat.mjs'

async function setup(t) {
  const w = makeWorkspace(); t.after(w.cleanup)
  writeTask(w.root, { cardId: '123', stateVersion: 1, stage: 'understand' })
  w.writeArtifact = (rel, text) => { const f = path.join(w.root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text) }
  const got = []
  const s = http.createServer((req, res) => { let raw = ''; req.on('data', (b) => raw += b); req.on('end', () => { got.push(JSON.parse(raw)); res.writeHead(204).end() }) })
  await new Promise((r) => s.listen(0, '127.0.0.1', r))
  t.after(() => { s.closeAllConnections(); s.close() })
  w.writeArtifact('.ff/worker.json', JSON.stringify({ port: s.address().port }))
  return { w, got }
}
function hook(name, w, cwd, env = {}) {
  return new Promise((resolve) => {
    const base = { ...process.env }; delete base.FF_CARD_ID
    const p = spawn(process.execPath, [`scripts/hooks/${name}.mjs`], { env: { ...base, ...env } })
    p.on('close', resolve); p.stdin.end(JSON.stringify({ cwd, session_id: 's', notification_type: 'permission_prompt', message: 'Claude needs your permission' }))
  })
}

test('hook with FF_CARD_ID sends taskId', async (t) => {
  const { w, got } = await setup(t)
  await hook('notification', w, w.root, { FF_CARD_ID: '123' })
  await hook('stop', w, w.root, { FF_CARD_ID: '123' })
  assert.deepEqual(got.map((e) => e.taskId), ['123', '123'])
})

test('hook in card worktree without env infers taskId; non-card cwd stays empty', async (t) => {
  const { w, got } = await setup(t)
  const wt = path.join(w.root, 'worktrees', '123-slug', 'web'); fs.mkdirSync(wt, { recursive: true })
  await hook('notification', w, wt)
  await hook('stop', w, wt)
  await hook('notification', w, w.root)
  await hook('stop', w, w.root)
  assert.deepEqual(got.map((e) => e.taskId), ['123', '123', '', ''])
  assert.equal(inferCardId(w.root, { workspace: { worktrees_dir: 'worktrees', cards_dir: 'trellocards' } }, { env: {}, cwd: path.join(w.root, 'worktrees', '999-x') }), '')
})

test('http /notify maps cardId to taskId', async (t) => {
  const { w } = await setup(t)
  const events = []
  const api = await startWorkerHttp({ root: w.root, token: 'tk', channel: { notify: async (e) => events.push(e) } })
  t.after(() => api.close())
  const r = await fetch(`http://127.0.0.1:${api.address.port}/notify`, { method: 'POST', headers: { authorization: 'Bearer tk', 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'attention', cardId: '123', title: 'x' }) })
  assert.equal(r.status, 200)
  assert.equal(events[0].taskId, '123')
})

test('rc adapter posts card event in the card thread', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-rc-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const envFile = path.join(root, 'e.env'); fs.writeFileSync(envFile, 'RC_URL=https://c.example\nRC_USER_ID=u\nRC_AUTH_TOKEN=s\nRC_ROOM_ID=room\n')
  const posts = []; let n = 0
  const fetchImpl = async (u, o) => { posts.push(JSON.parse(o.body)); return Response.json({ success: true, message: { _id: `m${++n}` } }) }
  await new RocketChatChannel({ envFile, fetchImpl, root, threadPerTask: true, delayMs: 0, log: () => {} }).notify({ kind: 'attention', taskId: '123', title: 'Claude needs your permission' })
  assert.equal(posts.length, 2)
  assert.equal(posts[1].tmid, 'm1')
})
