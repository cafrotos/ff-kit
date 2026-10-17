import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { Tmux } from '../ff-worker/src/core/tmux.mjs'

test('tmux uses exact session targets and waits until ready before typing prompt', async () => {
  const calls = []
  let time = 0
  const tmux = new Tmux({ now: () => time, sleep: async (ms) => { time += ms }, run: (args) => {
    calls.push(args)
    if (args[0] === 'has-session') return { status: 1 }
    if (args[0] === 'capture-pane') return { status: 0, stdout: calls.some((c) => c[0] === 'new-session') ? 'Claude Code v2\n❯ ' : '' }
    return { status: 0, stdout: '' }
  } })
  assert.deepEqual(await tmux.start('ff-123', '/workspace', 'claude', 'process card'), { existing: false })
  assert.deepEqual(calls[0], ['has-session', '-t', '=ff-123'])
  assert.deepEqual(calls[1], ['new-session', '-d', '-s', 'ff-123', '-c', '/workspace', 'claude'])
  assert.deepEqual(calls[3], ['send-keys', '-t', '=ff-123:', '-l', 'process card'])
  assert.deepEqual(calls[4], ['send-keys', '-t', '=ff-123:', 'C-m'])
})

test('tmux does not type into an existing card session', async () => {
  const calls = []
  const tmux = new Tmux({ run: (args) => { calls.push(args); return { status: args[0] === 'has-session' ? 0 : 1 } } })
  assert.deepEqual(await tmux.start('ff-123', '/workspace', 'claude', 'resume'), { existing: true })
  assert.equal(calls.length, 1)
})

test('tmux kills a session it created if the CLI never becomes ready', async () => {
  const calls = []
  let time = 0
  const tmux = new Tmux({ now: () => time, sleep: async (ms) => { time += ms }, run: (args) => { calls.push(args); return { status: args[0] === 'has-session' ? 1 : 0, stdout: '' } } })
  await assert.rejects(tmux.start('ff-123', '/workspace', 'claude', 'work', { timeoutMs: 1000 }), /không sẵn sàng/)
  assert.deepEqual(calls.at(-1), ['kill-session', '-t', '=ff-123'])
})

test('literal input is one argv value with exact target and Enter only after successful write', async () => {
  const calls = [], payload = `-t evil ' " ; $(touch /tmp/nope)\nnext`
  const tmux = new Tmux({ sleep: async () => {}, run: args => { calls.push(args); return { status: 0 } } })
  assert.equal(typeof tmux.sendLiteral, 'function')
  await tmux.sendLiteral('ff-123', '/workspace', payload)
  assert.deepEqual(calls, [['send-keys', '-t', '=ff-123:', '-l', '--', payload], ['send-keys', '-t', '=ff-123:', 'C-m']])
  calls.length = 0; tmux.run = args => { calls.push(args); return { status: 1 } }
  await assert.rejects(tmux.sendLiteral('ff-123', '/workspace', payload), /send|literal/i)
  assert.equal(calls.length, 1)
})
test('pane state comes from tmux metadata, never from screen text', async () => {
  const calls = [], now = 1_800_000_000_000
  let meta = '0\tclaude\t0\t1\t0\t1799999980\n'
  const tmux = new Tmux({ now: () => now, run: args => { calls.push(args); return { status: 0, stdout: args[0] === 'display-message' ? meta : 'Claude Code v2\n❯ ' } } })
  assert.deepEqual(tmux.inspectPane('ff-123', '/workspace'), { exists: true, status: 'idle', attached: 0, quietMs: 20000, inputEmpty: true })
  assert.ok(calls.every(c => c[0] !== 'capture-pane'), 'screen text is never read')
  meta = '0\tclaude\t0\t1\t1\t1799999980\n'
  assert.equal(tmux.inspectPane('ff-123', '/workspace').status, 'occupied', 'attached human holds the pane')
  meta = '0\tclaude\t1\t1\t0\t1799999980\n'
  assert.equal(tmux.inspectPane('ff-123', '/workspace').status, 'occupied', 'copy mode holds the pane')
  meta = '0\tclaude\t0\t1\t0\t1799999995\n'
  assert.equal(tmux.inspectPane('ff-123', '/workspace').status, 'occupied', 'recent keystrokes hold the pane')
  meta = '0\tclaude\t0\t1\n'
  assert.equal(tmux.inspectPane('ff-123', '/workspace').status, 'blocked', 'missing metadata fails closed')
})
test('persistent start and dead-pane resume preserve tmux session without timeout cleanup', async () => {
  const calls = [], tmux = new Tmux({ run: args => { calls.push(args); return { status: args[0] === 'has-session' ? 1 : 0, stdout: '' } } })
  assert.equal(typeof tmux.respawn, 'function')
  await tmux.start('ff-123', '/workspace', 'claude', null, { persistent: true })
  await tmux.respawn('ff-123', '/workspace', 'claude --resume uuid')
  assert.equal(calls.filter(c => c[0] === 'kill-session' || c[0] === 'send-keys').length, 0)
  assert.deepEqual(calls.at(-1), ['respawn-pane', '-t', '=ff-123:', '-c', '/workspace', 'claude --resume uuid'])
})
test('real tmux accepts every pane/window target the runner sends', { skip: spawnSync('tmux', ['-V']).status !== 0 && 'tmux not installed' }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-tmux-'))
  const saved = { TMUX_TMPDIR: process.env.TMUX_TMPDIR, TMUX: process.env.TMUX }
  process.env.TMUX_TMPDIR = dir; delete process.env.TMUX
  t.after(() => { spawnSync('tmux', ['kill-server']); Object.assign(process.env, saved); if (saved.TMUX === undefined) delete process.env.TMUX; if (saved.TMUX_TMPDIR === undefined) delete process.env.TMUX_TMPDIR; fs.rmSync(dir, { recursive: true, force: true }) })
  const tmux = new Tmux({ sleep: async () => {}, quietMs: 0 })
  await tmux.start('ff-real', dir, 'cat', null, { persistent: true })
  assert.equal(tmux.inspectPane('ff-real', dir).status, 'idle')
  await tmux.sendLiteral('ff-real', dir, 'hello-pane')
  assert.match(tmux.capture('ff-real', dir), /hello-pane/)
  tmux.run(['send-keys', '-t', '=ff-real:', 'C-d'], dir)
  for (let i = 0; i < 50 && tmux.inspectPane('ff-real', dir).status !== 'exited'; i++) await new Promise(r => setTimeout(r, 50))
  assert.equal(tmux.inspectPane('ff-real', dir).status, 'exited')
  await tmux.respawn('ff-real', dir, 'cat')
  assert.equal(tmux.killSession('ff-real', dir), true)
})
