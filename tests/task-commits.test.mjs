import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { git } from './helpers/fixture.mjs'
import { makeShipWorkspace } from './helpers/ship.mjs'
import { getTaskCommitRange, captureReopenBases } from '../scripts/lib/task-commits.mjs'
const commit = (p, message) => git(p, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', message)
test('original fork survives prod advance; reopened range keeps pushed source history', t => {
  const w = makeShipWorkspace(t, { repoNames: ['web', 'api'] }), repoPath = w.copies.web
  const input = { ...w, repo: w.config.repos[0], repoPath }
  commit(path.join(w.root, 'web'), 'prod advance')
  commit(repoPath, 'first'); commit(repoPath, 'second')
  assert.equal(getTaskCommitRange(input).commits.length, 2)
  git(repoPath, 'reset', '--soft', w.forkShas.web)
  commit(repoPath, 'A'); const a = git(repoPath, 'rev-parse', 'HEAD')
  assert.equal(getTaskCommitRange(input).baseSha, w.forkShas.web)
  git(repoPath, 'push', 'origin', `HEAD:refs/heads/${w.branches.web}`)
  const bases = captureReopenBases({ ...w, taskBranch: w.branches.web })
  assert.equal(bases.web, a); assert.equal(bases.api, w.forkShas.api)
  fs.mkdirSync(path.join(w.cardDir, 'rev-1'))
  fs.writeFileSync(path.join(w.cardDir, 'rev-1', 'revision.json'), JSON.stringify({ revision: 'rev-1', bases }))
  assert.equal(getTaskCommitRange(input).commits.length, 0)
  commit(w.copies.api, 'late repo')
  const late = getTaskCommitRange({ ...w, repo: w.config.repos[1], repoPath: w.copies.api })
  assert.equal(late.baseSha, w.forkShas.api); assert.equal(late.firstShip, true)
  commit(repoPath, 'B'); commit(repoPath, 'C')
  git(repoPath, 'reset', '--soft', a); commit(repoPath, 'D')
  const delta = git(repoPath, 'rev-parse', 'HEAD')
  assert.deepEqual(getTaskCommitRange(input).commits, [delta])
  assert.throws(() => captureReopenBases({ ...w, taskBranch: w.branches.web }), /remote|khớp|mốc/)
  git(repoPath, 'push', 'origin', `HEAD:refs/heads/${w.branches.web}`)
  assert.equal(captureReopenBases({ ...w, taskBranch: w.branches.web }).web, delta)
  git(repoPath, 'push', 'origin', '--delete', w.branches.web)
  assert.throws(() => captureReopenBases({ ...w, taskBranch: w.branches.web }), /remote|mốc/)
})
test('branch validation rejects spaces and refs syntax; unshipped late repo uses original fork', t => {
  const w = makeShipWorkspace(t), input = { ...w, repo: w.config.repos[0], repoPath: w.copies.web }
  assert.equal(getTaskCommitRange(input).commits.length, 0)
  for (const taskBranch of ['task bad', 'refs/heads/bad', '-bad']) assert.throws(() => captureReopenBases({ ...w, taskBranch }), /branch/)
})

test('copy refuses missing shipped bases without changing revision bytes', async t => {
  const { main } = await import('../scripts/cli/main.mjs')
  const { capture } = await import('./helpers/io.mjs')
  for (const evidence of ['metadata', 'local', 'remote']) {
    const w = makeShipWorkspace(t, { repoNames: ['late', 'web'] })
    const file = path.join(w.cardDir, 'rev-1', 'revision.json')
    fs.mkdirSync(path.dirname(file))
    const metadata = { revision: 'rev-1', bases: {}, ...(evidence === 'metadata' ? { shippedRepos: ['web'] } : {}) }
    const bytes = JSON.stringify(metadata, null, 3) + '\n'
    fs.writeFileSync(file, bytes)
    if (evidence === 'local') git(w.copies.web, 'config', 'ff.shippedTaskHead', w.forkShas.web)
    if (evidence === 'remote') git(w.copies.web, 'push', 'origin', `HEAD:refs/heads/${w.branches.web}`)
    const { ctx, buf } = capture(w.root)
    assert.equal(await main(['copy', '123'], ctx), 1, `${evidence}: ${buf.err}`)
    assert.match(buf.err, /baseline|mốc|ship/)
    assert.equal(fs.readFileSync(file, 'utf8'), bytes, evidence)
    assert.throws(() => git(w.copies.late, 'config', '--get', 'ff.originalFork'), /git config/, 'preflight must not register earlier repo metadata')
  }
})
test('copy registers missing late never-shipped revision base at original fork', async t => {
  const { main } = await import('../scripts/cli/main.mjs')
  const { capture } = await import('./helpers/io.mjs')
  const w = makeShipWorkspace(t)
  const file = path.join(w.cardDir, 'rev-2', 'revision.json')
  fs.mkdirSync(path.dirname(file))
  fs.writeFileSync(file, JSON.stringify({ revision: 'rev-2', bases: {} }))
  commit(w.copies.web, 'unshipped late change')
  const { ctx, buf } = capture(w.root)
  assert.equal(await main(['copy', '123'], ctx), 0, buf.err)
  assert.equal(JSON.parse(fs.readFileSync(file)).bases.web, w.forkShas.web)
})

test('copy derives revision.json for a legacy rev dir that has only delta.md', async t => {
  const { main } = await import('../scripts/cli/main.mjs')
  const { capture } = await import('./helpers/io.mjs')
  const w = makeShipWorkspace(t)
  const dir = path.join(w.cardDir, 'rev-1')
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, 'delta.md'), '# Delta\n')
  const { ctx, buf } = capture(w.root)
  assert.equal(await main(['copy', '123'], ctx), 0, buf.err)
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'revision.json'), 'utf8'))
  assert.equal(meta.revision, 'rev-1'); assert.equal(meta.derived, true)
  assert.equal(meta.bases.web, w.forkShas.web)
  assert.ok(fs.existsSync(path.join(w.copies.web, '.git')))
})

test('copy: legacy rev with remote-shipped repo fails clearly and keeps the copy', async t => {
  const { main } = await import('../scripts/cli/main.mjs')
  const { capture } = await import('./helpers/io.mjs')
  const w = makeShipWorkspace(t)
  fs.mkdirSync(path.join(w.cardDir, 'rev-1'))
  git(w.copies.web, 'push', 'origin', `HEAD:refs/heads/${w.branches.web}`)
  const { ctx, buf } = capture(w.root)
  assert.equal(await main(['copy', '123'], ctx), 1)
  assert.match(buf.err, /baseline|mốc|ship/)
  assert.ok(fs.existsSync(path.join(w.copies.web, '.git')), 'worktree kept')
  assert.equal(fs.existsSync(path.join(w.cardDir, 'rev-1', 'revision.json')), false, 'nothing invented')
})

test('copy: fresh clone is not deleted when revision bases cannot be registered', async t => {
  const { main } = await import('../scripts/cli/main.mjs')
  const { capture } = await import('./helpers/io.mjs')
  const w = makeShipWorkspace(t)
  fs.rmSync(path.dirname(path.dirname(w.copies.web)), { recursive: true, force: true })
  fs.mkdirSync(path.join(w.cardDir, 'rev-1'))
  fs.writeFileSync(path.join(w.cardDir, 'rev-1', 'revision.json'), '{ not json')
  const { ctx, buf } = capture(w.root)
  assert.equal(await main(['copy', '123'], ctx), 1)
  assert.match(buf.err, /giữ nguyên bản copy/)
  assert.ok(fs.existsSync(path.join(w.copies.web, '.git')))
})
