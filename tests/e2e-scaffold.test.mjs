import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { main } from '../scripts/cli/main.mjs'
import { makeWorkspace, baseConfig } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'

function workspace(t) {
  const config = baseConfig()
  config.e2e = { dir: 'ff-e2e' }
  const ws = makeWorkspace({ config })
  t.after(ws.cleanup)
  return ws
}

test('e2e-scaffold copies template, adds optional DB files and does not git init', async (t) => {
  const ws = workspace(t)
  let installCwd
  const { ctx, buf } = capture(ws.root)
  ctx.install = async (cwd) => { installCwd = cwd; return { status: 0 } }
  assert.equal(await main(['e2e-scaffold', '--db', 'postgres'], ctx), 0)
  const target = path.join(ws.root, 'ff-e2e')
  assert.equal(installCwd, target)
  assert.equal(fs.existsSync(path.join(target, 'helpers/db.ts')), true)
  assert.equal(fs.existsSync(path.join(target, 'helpers/restore.ts')), true)
  assert.equal(fs.existsSync(path.join(target, 'fixtures/test.ts')), true)
  assert.equal(fs.existsSync(path.join(target, '.git')), false)
  assert.match(buf.out, /npx playwright install chromium/)
})

test('e2e-scaffold without DB omits DB helper and fixture', async (t) => {
  const ws = workspace(t)
  const { ctx } = capture(ws.root)
  ctx.install = async () => ({ status: 0 })
  assert.equal(await main(['e2e-scaffold'], ctx), 0)
  const target = path.join(ws.root, 'ff-e2e')
  assert.equal(fs.existsSync(path.join(target, 'helpers/db.ts')), false)
  assert.equal(fs.existsSync(path.join(target, 'helpers/restore.ts')), false)
  assert.doesNotMatch(fs.readFileSync(path.join(target, 'fixtures/test.ts'), 'utf8'), /connect\('db'\)/)
})

test('e2e-scaffold refuses non-empty destination without overwriting', async (t) => {
  const ws = workspace(t)
  fs.mkdirSync(path.join(ws.root, 'ff-e2e'), { recursive: true })
  fs.writeFileSync(path.join(ws.root, 'ff-e2e/keep.txt'), 'keep')
  const { ctx, buf } = capture(ws.root)
  ctx.install = async () => { throw new Error('must not install') }
  assert.equal(await main(['e2e-scaffold'], ctx), 1)
  assert.equal(fs.readFileSync(path.join(ws.root, 'ff-e2e/keep.txt'), 'utf8'), 'keep')
  assert.match(buf.err, /không rỗng/)
})

test('e2e-scaffold validates db driver', async (t) => {
  const ws = workspace(t)
  const { ctx, buf } = capture(ws.root)
  assert.equal(await main(['e2e-scaffold', '--db', 'sqlite'], ctx), 2)
  assert.match(buf.err, /postgres\|mysql/)
})
