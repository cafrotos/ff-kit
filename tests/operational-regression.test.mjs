import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { main } from '../scripts/cli/main.mjs'
import { processTasks, launchAgentTask, attemptTaskLaunch } from '../ff-worker/src/core/worker.mjs'
import { readTask, writeTask } from '../ff-worker/src/core/task-store.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { makeWorkspace, git } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'

const dossier = '# Card\n\n## Branch\n\n```text\nfeature/card\n```\n'

test('copy preserves upstream fetch and all push URLs with explicit local base history', async (t) => {
  const w = makeWorkspace({ files: { 'trellocards/123-card/01-dossier.md': dossier } })
  t.after(w.cleanup)
  const original = path.join(w.root, 'web')
  git(original, 'remote', 'add', 'origin', 'https://example.test/upstream.git')
  git(original, 'config', '--add', 'remote.origin.pushurl', 'ssh://example.test/push.git')
  git(original, 'config', '--add', 'remote.origin.pushurl', 'ssh://example.test/backup.git')
  const { ctx, buf } = capture(w.root)
  assert.equal(await main(['copy', '123'], ctx), 0, buf.err)
  const copy = path.join(w.root, 'worktrees/123-card/web')
  assert.equal(git(copy, 'remote', 'get-url', 'origin'), 'https://example.test/upstream.git')
  assert.equal(git(copy, 'remote', 'get-url', '--push', '--all', 'origin'), 'ssh://example.test/push.git\nssh://example.test/backup.git')
  assert.equal(git(copy, 'remote', 'get-url', 'ff-local'), original)
  const reachable = path.join(w.root, 'reachable.git')
  git(w.root, 'clone', '--bare', original, reachable)
  git(copy, 'remote', 'set-url', 'origin', reachable)
  assert.equal(await main(['squash-check', '123'], ctx), 0, buf.err)
})

test('copy resolves relative local fetch and push URLs from the original repo', async (t) => {
  const w = makeWorkspace({ files: { 'trellocards/123-card/01-dossier.md': dossier } })
  t.after(w.cleanup)
  const original = path.join(w.root, 'web'), upstream = path.join(w.root, 'upstream.git')
  git(w.root, 'init', '--bare', upstream)
  git(original, 'remote', 'add', 'origin', '../upstream.git')
  git(original, 'config', '--add', 'remote.origin.pushurl', '../upstream.git')
  git(original, 'config', '--add', 'remote.origin.pushurl', 'git@example.test:team/upstream.git')
  const { ctx, buf } = capture(w.root)
  assert.equal(await main(['copy', '123'], ctx), 0, buf.err)
  const copy = path.join(w.root, 'worktrees/123-card/web')
  assert.equal(git(copy, 'remote', 'get-url', 'origin'), upstream)
  assert.equal(git(copy, 'remote', 'get-url', '--push', '--all', 'origin'), `${upstream}\ngit@example.test:team/upstream.git`)
  assert.equal(git(copy, 'fetch', 'origin'), '')
})

test('copy registers a missing revision baseline once and never advances it', async (t) => {
  const w = makeWorkspace({ files: { 'trellocards/123-card/01-dossier.md': dossier, 'trellocards/123-card/rev-1/revision.json': '{"version":1,"revision":"rev-1"}\n' } })
  t.after(w.cleanup)
  const { ctx, buf } = capture(w.root)
  assert.equal(await main(['copy', '123'], ctx), 0, buf.err)
  const copy = path.join(w.root, 'worktrees/123-card/web'), metadata = path.join(w.root, 'trellocards/123-card/rev-1/revision.json')
  const base = git(copy, 'rev-parse', 'HEAD')
  assert.equal(JSON.parse(fs.readFileSync(metadata)).bases?.web, base)
  git(copy, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'revision\n\nTrello: #123')
  fs.writeFileSync(path.join(copy, 'dirty.txt'), 'keep')
  assert.equal(await main(['copy', '123'], ctx), 0, buf.err)
  assert.equal(JSON.parse(fs.readFileSync(metadata)).bases?.web, base)
  assert.equal(fs.readFileSync(path.join(copy, 'dirty.txt'), 'utf8'), 'keep')
})

test('revision squash-check counts only commits after its immutable baseline', async (t) => {
  const w = makeWorkspace({ files: { 'trellocards/123-card/01-dossier.md': dossier } })
  t.after(w.cleanup)
  const { ctx, buf } = capture(w.root)
  assert.equal(await main(['copy', '123'], ctx), 0, buf.err)
  const copy = path.join(w.root, 'worktrees/123-card/web')
  git(copy, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'shipped task\n\nTrello: #123')
  const base = git(copy, 'rev-parse', 'HEAD')
  git(copy, 'push', 'origin', 'HEAD:refs/heads/feature/card')
  assert.equal(await main(['reopen', '123', '--reason', 'QA change'], ctx), 0, buf.err)
  const metadata = path.join(w.root, 'trellocards/123-card/rev-1/revision.json')
  assert.equal(JSON.parse(fs.readFileSync(metadata)).bases?.web, base)
  git(copy, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'rev fix\n\nTrello: #123')
  const check = capture(w.root)
  assert.equal(await main(['squash-check', '123'], check.ctx), 0, check.buf.err)
  assert.match(check.buf.out, /1 commit/)
  assert.doesNotMatch(check.buf.out, /shipped task/)
})

test('revision squash-check fails missing and non-ancestor baselines', async (t) => {
  const w = makeWorkspace({ files: { 'trellocards/123-card/01-dossier.md': dossier } })
  t.after(w.cleanup)
  const { ctx, buf } = capture(w.root)
  assert.equal(await main(['copy', '123'], ctx), 0, buf.err)
  const copy = path.join(w.root, 'worktrees/123-card/web'), rev = path.join(w.root, 'trellocards/123-card/rev-1')
  fs.mkdirSync(rev)
  fs.writeFileSync(path.join(rev, 'revision.json'), '{"revision":"rev-1"}')
  assert.equal(await main(['squash-check', '123'], ctx), 1)
  git(copy, 'switch', '--orphan', 'other')
  git(copy, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'unrelated')
  const unrelated = git(copy, 'rev-parse', 'HEAD')
  git(copy, 'switch', 'feature/card')
  fs.writeFileSync(path.join(rev, 'revision.json'), JSON.stringify({ revision: 'rev-1', bases: { web: unrelated } }))
  assert.equal(await main(['squash-check', '123'], ctx), 1)
})

test('copy reuses an existing dirty card branch without erasing or pulling', async (t) => {
  const w = makeWorkspace({ files: { 'trellocards/123-card/01-dossier.md': dossier } })
  t.after(w.cleanup)
  const { ctx, buf } = capture(w.root)
  assert.equal(await main(['copy', '123'], ctx), 0, buf.err)
  const copy = path.join(w.root, 'worktrees/123-card/web')
  fs.writeFileSync(path.join(copy, 'local.txt'), 'keep')
  const head = git(copy, 'rev-parse', 'HEAD')
  assert.equal(await main(['copy', '123'], ctx), 0, buf.err)
  assert.equal(fs.readFileSync(path.join(copy, 'local.txt'), 'utf8'), 'keep')
  assert.equal(git(copy, 'rev-parse', 'HEAD'), head)
  assert.equal(git(copy, 'config', '--get', 'ff.localOnly'), 'true')
  assert.match(buf.err + buf.out, /ship.*(?:cấm|không)|không.*ship/i)
})

test('copy repairs a legacy local origin while preserving its dirty branch', async (t) => {
  const w = makeWorkspace({ files: { 'trellocards/123-card/01-dossier.md': dossier } })
  t.after(w.cleanup)
  const source = path.join(w.root, 'web')
  git(source, 'remote', 'add', 'origin', 'https://example.test/upstream.git')
  const copy = path.join(w.root, 'worktrees/123-card/web')
  git(w.root, 'clone', '--local', source, copy)
  git(copy, 'switch', '-c', 'feature/card')
  fs.writeFileSync(path.join(copy, 'dirty.txt'), 'keep')
  const { ctx, buf } = capture(w.root)
  assert.equal(await main(['copy', '123'], ctx), 0, buf.err)
  assert.equal(git(copy, 'remote', 'get-url', 'origin'), 'https://example.test/upstream.git')
  assert.equal(git(copy, 'remote', 'get-url', 'ff-local'), source)
  assert.equal(git(copy, 'branch', '--show-current'), 'feature/card')
  assert.equal(fs.readFileSync(path.join(copy, 'dirty.txt'), 'utf8'), 'keep')
})

test('unchanged squash-check leaves branch and working tree intact', async (t) => {
  const w = makeWorkspace({ files: { 'trellocards/123-card/01-dossier.md': dossier } })
  t.after(w.cleanup)
  const { ctx, buf } = capture(w.root)
  assert.equal(await main(['copy', '123'], ctx), 0, buf.err)
  const copy = path.join(w.root, 'worktrees/123-card/web')
  const before = [git(copy, 'rev-parse', 'HEAD'), git(copy, 'branch', '--show-current'), git(copy, 'status', '--porcelain')]
  assert.equal(await main(['squash-check', '123'], ctx), 0)
  assert.deepEqual([git(copy, 'rev-parse', 'HEAD'), git(copy, 'branch', '--show-current'), git(copy, 'status', '--porcelain')], before)
})

test('squash-check rejects repository command failures instead of treating them as zero commits', async (t) => {
  const w = makeWorkspace({ files: { 'trellocards/123-card/01-dossier.md': dossier } })
  t.after(w.cleanup)
  const { ctx, buf } = capture(w.root)
  assert.equal(await main(['copy', '123'], ctx), 0, buf.err)
  fs.writeFileSync(path.join(w.root, 'worktrees/123-card/web/.git/index'), 'invalid index')
  assert.equal(await main(['squash-check', '123'], ctx), 1)
})

test('failed worker launches release slots and stop after bounded attempts', async (t) => {
  const w = makeWorkspace()
  t.after(w.cleanup)
  const config = loadConfig(w.root).config
  config.worker.max_concurrent_tasks = 1
  const calls = []
  const options = { root: w.root, config, source: { poll: async () => [{ id: '1', name: 'Bad' }, { id: '2', name: 'Good' }], fetchDossier: async () => dossier }, channel: { notify: async () => {} }, log: () => {}, launchTask: async (_card, task) => { calls.push(task.cardId); if (task.cardId === '1') throw new Error('start failed'); return { session: 'ff-2' } } }
  await processTasks(options)
  assert.deepEqual(calls, ['1', '2'])
  for (let n = 0; n < 5; n++) {
    writeTask(w.root, { ...readTask(w.root, '2'), phase: 'completed' })
    await processTasks(options)
  }
  assert.equal(calls.filter((id) => id === '1').length, 3)
  assert.equal(readTask(w.root, '1').parked.reason, 'failed')
  assert.equal(readTask(w.root, '1').phase, 'parked')
})

test('worker times out sessions from their start time without killing unowned sessions', async (t) => {
  const w = makeWorkspace()
  t.after(w.cleanup)
  const config = loadConfig(w.root).config
  writeTask(w.root, { cardId: '1', slug: 'old', phase: 'running', session: 'unknown', startedAt: new Date(Date.now() - 25 * 3600000).toISOString(), updatedAt: new Date().toISOString() })
  let launched = false
  await processTasks({ root: w.root, config, source: { poll: async () => [{ id: '1', name: 'Old' }], fetchDossier: async () => dossier }, channel: { notify: async () => {} }, launchTask: async () => { launched = true }, log: () => {} })
  assert.equal(launched, false)
  assert.equal(readTask(w.root, '1').parked.reason, 'failed')
  assert.match(readTask(w.root, '1').lastError, /lifetime|thời hạn/i)
})

test('failed legacy-session recovery preserves the original lifetime baseline', async (t) => {
  const w = makeWorkspace()
  t.after(w.cleanup)
  const config = loadConfig(w.root).config
  const updatedAt = new Date(Date.now() - 23 * 3600000).toISOString()
  const task = { cardId: '1', slug: 'old', phase: 'running', session: 'ff-1', updatedAt }
  await attemptTaskLaunch({ root: w.root, config, card: { id: '1' }, task, launchTask: async () => { throw new Error('offline') } })
  assert.equal(readTask(w.root, '1').startedAt, updatedAt)
})

test('worker reports malformed task files instead of silently undercounting capacity', async (t) => {
  const w = makeWorkspace()
  t.after(w.cleanup)
  fs.mkdirSync(path.join(w.root, '.ff/tasks'), { recursive: true })
  fs.writeFileSync(path.join(w.root, '.ff/tasks/broken.json'), '{')
  await assert.rejects(processTasks({ root: w.root, config: loadConfig(w.root).config, source: { poll: async () => [] }, channel: {} }), SyntaxError)
})

test('agent recovery prompt is one line and follows current on-disk workflow state', async (t) => {
  const w = makeWorkspace()
  t.after(w.cleanup)
  const config = loadConfig(w.root).config
  let prompt
  await launchAgentTask({ root: w.root, config, card: { id: '123' }, task: { cardId: '123', slug: 'card' }, resume: true, tmux: { start: async (_session, _root, _command, value) => { prompt = value } } })
  assert.doesNotMatch(prompt, /[\r\n]/)
  assert.match(prompt, /\/ff-kit:ff-understand/)
  assert.match(prompt, /resume\.md/)
  assert.match(prompt, /ff state 123/)
  assert.match(prompt, /dữ liệu|data/i)
})
