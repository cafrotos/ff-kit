import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeWorkspace } from './helpers/fixture.mjs'
import { watchConfig } from '../ff-worker/src/core/reload.mjs'

test('invalid reload is rejected and keeps the old worker status', async (t) => {
  const w = makeWorkspace()
  t.after(w.cleanup)
  const errors = []
  const notices = []
  const watcher = watchConfig({ root: w.root, configFile: path.join(w.root, 'ff.config.yaml'), envFile: path.join(w.root, '.ff.env'), debounceMs: 0, loadCandidate: async () => ({ errors: ['schema lỗi'] }), onValid: async () => assert.fail('must not restart'), channel: { notify: async (event) => notices.push(event) }, initialStatus: () => ({ state: 'ready', token: 'opaque' }), log: (s) => errors.push(s) })
  t.after(() => watcher.close())
  await watcher.check()
  const status = JSON.parse(fs.readFileSync(path.join(w.root, '.ff/worker.json'), 'utf8'))
  assert.equal(status.state, 'ready')
  assert.equal(status.config_state, 'rejected')
  assert.equal(status.token, 'opaque')
  assert.match(notices[0].title, /config cũ/)
  assert.deepEqual(errors, [])
})

test('valid reload requests a supervisor restart', async (t) => {
  const w = makeWorkspace()
  t.after(w.cleanup)
  let candidate
  const watcher = watchConfig({ root: w.root, configFile: path.join(w.root, 'ff.config.yaml'), debounceMs: 0, loadCandidate: async () => candidate, onValid: async (value) => { candidate = { ...value, restarted: true } }, channel: { notify: async () => {} }, initialStatus: () => ({ state: 'ready' }) })
  t.after(() => watcher.close())
  candidate = { errors: [] }
  await watcher.check()
  assert.equal(candidate.restarted, true)
  assert.equal(JSON.parse(fs.readFileSync(path.join(w.root, '.ff/worker.json'), 'utf8')).state, 'restarting')
})
