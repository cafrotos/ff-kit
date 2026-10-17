import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeGuard } from '../scripts/lib/guard-rules.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { makeWorkspace, baseConfig } from './helpers/fixture.mjs'

function guard(t, env) {
  const ws = makeWorkspace({ config: baseConfig(), gitRepos: false })
  t.after(ws.cleanup)
  const G = makeGuard(ws.root, loadConfig(ws.root).config, env)
  return { ev: (cmd) => G.evaluate({ cwd: ws.root, mode: 'base', cmd }), ask: (cmd) => G.needsAsk(cmd) }
}

test('ff worker park: worker session may park only its own card, no extra confirmation', (t) => {
  const g = guard(t, { FF_CARD_ID: '123', FF_RUN_ID: 'run-1' })
  assert.equal(g.ev('ff worker park'), null)
  assert.equal(g.ev('ff worker park 123'), null)
  assert.equal(g.ev('ff worker park 123 --comment-file /tmp/c.md'), null)
  assert.equal(g.ask('ff worker park 123'), false)
  assert.match(g.ev('ff worker park 999') ?? '', /thẻ của phiên này/)
  assert.match(g.ev('ff worker park --comment-file /tmp/c.md 999') ?? '', /thẻ của phiên này/)
})

test('ff worker park: outside a worker session any card is allowed', (t) => {
  const g = guard(t, {})
  assert.equal(g.ev('ff worker park 999'), null)
})
