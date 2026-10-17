import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { baseConfig, makeWorkspace } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'
import { run } from '../scripts/cli/worker.mjs'

const hasTmux = spawnSync('tmux', ['-V']).status === 0
const sleeper = 'setInterval(() => {}, 1000)'
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
const until = async (fn, ms = 5000) => { for (let i = 0; i < ms / 50 && !fn(); i++) await new Promise((r) => setTimeout(r, 50)) }

function workspace(t, session) {
  const raw = baseConfig()
  raw.worker.tmux = { session_name: session }
  const ws = makeWorkspace({ config: raw, gitRepos: false })
  t.after(ws.cleanup)
  return ws.root
}
const writeStatus = (root, pid) => {
  fs.mkdirSync(path.join(root, '.ff'), { recursive: true })
  fs.writeFileSync(path.join(root, '.ff/worker.json'), JSON.stringify({ state: 'ready', pid }))
}

test('ff worker stop sends C-c to the pane target and the worker exits', { skip: !hasTmux && 'tmux không có' }, async (t) => {
  const session = `ff-stop-test-${process.pid}`
  const root = workspace(t, session)
  t.after(() => spawnSync('tmux', ['kill-session', '-t', `=${session}`]))
  assert.equal(spawnSync('tmux', ['new-session', '-d', '-s', session, process.execPath, '-e', sleeper]).status, 0)
  const pid = Number(spawnSync('tmux', ['display-message', '-p', '-t', `=${session}:`, '#{pane_pid}'], { encoding: 'utf8' }).stdout)
  assert.ok(pid > 0 && alive(pid))
  writeStatus(root, pid)
  const { ctx, buf } = capture(root)
  assert.equal(await run(['stop'], ctx), 0, buf.err)
  await until(() => !alive(pid))
  assert.equal(alive(pid), false)
  assert.match(buf.out, /dừng êm \(C-c\)/)
})

test('ff worker stop falls back to SIGTERM when tmux is unusable or C-c does not stop the worker', async (t) => {
  const child = spawn(process.execPath, ['-e', `process.on('SIGINT', () => {}); ${sleeper}`], { stdio: 'ignore' })
  t.after(() => child.kill('SIGKILL'))
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve(signal)))
  const root = workspace(t, 'ff-stop-unit')
  writeStatus(root, child.pid)

  // tmux session missing: SIGTERM straight away
  let { ctx, buf } = capture(root)
  ctx.runTmux = () => ({ status: 1 })
  assert.equal(await run(['stop'], ctx), 0, buf.err)
  assert.equal(await exited, 'SIGTERM')
  assert.match(buf.out, /không dùng được tmux; đã gửi SIGTERM/)
})

test('ff worker stop escalates to SIGTERM after C-c leaves the worker alive', async (t) => {
  const child = spawn(process.execPath, ['-e', sleeper], { stdio: 'ignore' })
  t.after(() => child.kill('SIGKILL'))
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve(signal)))
  const root = workspace(t, 'ff-stop-unit')
  writeStatus(root, child.pid)
  const calls = []
  const { ctx, buf } = capture(root)
  ctx.runTmux = (args) => { calls.push(args); return { status: 0 } }
  ctx.wait = async () => {}
  assert.equal(await run(['stop'], ctx), 0, buf.err)
  assert.equal(await exited, 'SIGTERM')
  assert.deepEqual(calls.find((a) => a[0] === 'send-keys'), ['send-keys', '-t', '=ff-stop-unit:', 'C-c'])
  assert.match(buf.out, /C-c không dừng được sau 10 giây; đã gửi SIGTERM/)
})
