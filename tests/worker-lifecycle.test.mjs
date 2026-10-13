import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { main } from '../scripts/cli/main.mjs'
import { baseConfig, makeWorkspace } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'

test('worker start gates on doctor and exact tmux session before spawn', async (t) => {
  const w = makeWorkspace()
  t.after(w.cleanup)
  const calls = []
  const { ctx, buf } = capture(w.root)
  ctx.pluginRoot = process.cwd()
  ctx.which = () => true
  ctx.runTmux = (args) => { calls.push(args); return { status: 1, stdout: '', stderr: '' } }
  assert.equal(await main(['worker', 'start'], ctx), 4)
  assert.equal(calls.length, 0)
  assert.match(buf.err, /TRELLO_API_KEY/)
})

test('worker start creates only exact named session and reports readiness', async (t) => {
  const config = baseConfig()
  config.worker.tmux = { session_name: 'ff-worker-test' }
  const w = makeWorkspace({ config, files: { '.ff.env': 'TRELLO_API_KEY=key\nTRELLO_API_TOKEN=token\n' } })
  t.after(w.cleanup)
  const calls = []
  const { ctx, buf } = capture(w.root)
  ctx.pluginRoot = process.cwd()
  ctx.which = () => true
  ctx.runTmux = (args) => {
    calls.push(args)
    if (args[0] === 'has-session') return { status: 1, stdout: '', stderr: '' }
    return { status: 0, stdout: '', stderr: '' }
  }
  ctx.wait = async () => {
    fs.mkdirSync(path.join(w.root, '.ff'), { recursive: true })
    fs.writeFileSync(path.join(w.root, '.ff/worker.json'), JSON.stringify({ state: 'ready', pid: 10, port: 4567, token: 'secret', adapter: 'trello/console' }))
  }
  assert.equal(await main(['worker', 'start'], ctx), 0)
  assert.deepEqual(calls[0].slice(0, 3), ['has-session', '-t', '=ff-worker-test'])
  assert.equal(calls[1][0], 'new-session')
  assert.match(buf.out, /Đang chạy/)
  assert.match(buf.out, /TaskSource trello/)
  assert.match(buf.out, /Duyệt Gate/)
  assert.doesNotMatch(buf.out, /secret/)
})

test('worker status and stop use exact tmux target and never reveal token', async (t) => {
  const config = baseConfig()
  config.worker.tmux = { session_name: 'ff-worker-test' }
  const w = makeWorkspace({ config })
  t.after(w.cleanup)
  fs.mkdirSync(path.join(w.root, '.ff'), { recursive: true })
  fs.writeFileSync(path.join(w.root, '.ff/worker.json'), JSON.stringify({ state: 'ready', port: 9000, token: 'secret', adapter: 'trello/console' }))
  const { ctx, buf } = capture(w.root)
  const calls = []
  ctx.runTmux = (args) => { calls.push(args); return { status: 0, stdout: 'pane logs\n', stderr: '' } }
  assert.equal(await main(['worker', 'status'], ctx), 0)
  assert.match(buf.out, /ready/)
  assert.doesNotMatch(buf.out, /secret/)
  assert.deepEqual(calls[0], ['has-session', '-t', '=ff-worker-test'])
  assert.equal(await main(['worker', 'stop'], ctx), 0)
  assert.deepEqual(calls[2], ['send-keys', '-t', '=ff-worker-test', 'C-c'])
})
