import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { workerCommand } from '../scripts/worker-supervise.mjs'
import { inferPluginRoot } from '../scripts/cli/worker.mjs'
import { main } from '../scripts/cli/main.mjs'
import { baseConfig, makeWorkspace } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('supervisor runs the bundled worker with node, never npx', () => {
  const cmd = workerCommand({ config: '/w/ff.config.yaml', worker: '/p/ff-worker/dist/index.mjs' })
  assert.equal(cmd.command, process.execPath)
  assert.deepEqual(cmd.args, ['/p/ff-worker/dist/index.mjs', '--config', '/w/ff.config.yaml'])
  assert.doesNotMatch(fs.readFileSync(path.join(repo, 'scripts/worker-supervise.mjs'), 'utf8'), /npx/)
})

test('inferPluginRoot resolves symlinked bin to the real plugin root', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-link-'))
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const link = path.join(tmp, 'ff')
  fs.symlinkSync(path.join(repo, 'bin/ff'), link)
  assert.equal(inferPluginRoot(link), fs.realpathSync(repo))
  const nested = path.join(tmp, 'lib'); fs.symlinkSync(repo, nested)
  assert.equal(inferPluginRoot(path.join(nested, 'dist/cli.mjs')), fs.realpathSync(repo))
})

test('worker start via symlinked invocation builds tmux command on local dist', async (t) => {
  const config = baseConfig()
  config.worker.tmux = { session_name: 'ff-worker-test' }
  const w = makeWorkspace({ config, files: { '.ff.env': 'TRELLO_API_KEY=key\nTRELLO_API_TOKEN=token\n' } })
  t.after(w.cleanup)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-link-'))
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const link = path.join(tmp, 'ff'); fs.symlinkSync(path.join(repo, 'bin/ff'), link)
  const calls = []
  const { ctx } = capture(w.root)
  ctx.pluginRoot = inferPluginRoot(link)
  ctx.which = () => true
  ctx.runTmux = (args) => { calls.push(args); return { status: args[0] === 'has-session' ? 1 : 0, stdout: '', stderr: '' } }
  ctx.wait = async () => {
    fs.mkdirSync(path.join(w.root, '.ff'), { recursive: true })
    fs.writeFileSync(path.join(w.root, '.ff/worker.json'), JSON.stringify({ state: 'ready', port: 1, token: 's', adapter: 'x' }))
  }
  assert.equal(await main(['worker', 'start'], ctx), 0)
  const joined = calls[1].join(' ')
  assert.match(joined, new RegExp(path.join(fs.realpathSync(repo), 'dist/worker-supervise.mjs').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.ok(calls[1].includes(path.join(fs.realpathSync(repo), 'ff-worker/dist/index.mjs')))
  assert.doesNotMatch(joined, /npx|ff-worker@/)
})

test('real CLI through symlinked bin runs', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-link-'))
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const link = path.join(tmp, 'ff'); fs.symlinkSync(path.join(repo, 'bin/ff'), link)
  const r = spawnSync(process.execPath, [link, '--version'], { encoding: 'utf8' })
  assert.equal(r.status, 0)
})
