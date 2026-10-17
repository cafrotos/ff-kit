import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('../ff-worker/src/index.mjs', import.meta.url))

test('ff-worker has a standalone help entrypoint', () => {
  const r = spawnSync(process.execPath, [entry, '--help'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /ff-worker --config <ff\.config\.yaml>/)
})

test('ff-worker rejects missing and unknown arguments without starting', () => {
  const missing = spawnSync(process.execPath, [entry], { encoding: 'utf8' })
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /--config/)
  const unknown = spawnSync(process.execPath, [entry, '--wat'], { encoding: 'utf8' })
  assert.equal(unknown.status, 2)
})
