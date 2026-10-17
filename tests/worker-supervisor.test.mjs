import { test } from 'node:test'
import assert from 'node:assert/strict'
import { supervise } from '../ff-worker/src/core/supervisor.mjs'

test('supervisor restarts immediately after exit 75 and exits cleanly after zero', async () => {
  const codes = [75, 0]
  const sleeps = []
  const result = await supervise({ launch: async () => ({ code: codes.shift() }), sleep: async (ms) => sleeps.push(ms), now: () => 1000 })
  assert.equal(result.code, 0)
  assert.deepEqual(sleeps, [])
})

test('supervisor waits five seconds for crashes and stops after six within ten minutes', async () => {
  let launches = 0
  let now = 1000
  const sleeps = []
  let crashed
  const result = await supervise({ launch: async () => { launches++; return { code: 1 } }, sleep: async (ms) => { sleeps.push(ms); now += ms }, now: () => now, onCrash: (reason) => { crashed = reason } })
  assert.equal(result.code, 1)
  assert.equal(launches, 6)
  assert.equal(sleeps.length, 5)
  assert.ok(sleeps.every((ms) => ms === 5000))
  assert.match(crashed, /6 lần/)
})

test('supervisor forgets crashes older than ten minutes', async () => {
  let now = 0
  let count = 0
  const result = await supervise({ launch: async () => { count++; return { code: count === 7 ? 0 : 2 } }, sleep: async (ms) => { now += ms + 120000 }, now: () => now })
  assert.equal(result.code, 0)
  assert.equal(count, 7)
})
