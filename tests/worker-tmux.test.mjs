import { test } from 'node:test'
import assert from 'node:assert/strict'
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
  assert.deepEqual(calls[3], ['send-keys', '-t', '=ff-123', '-l', 'process card'])
  assert.deepEqual(calls[4], ['send-keys', '-t', '=ff-123', 'C-m'])
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
