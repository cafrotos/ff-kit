import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { main } from '../scripts/cli/main.mjs'
import { makeWorkspace, baseConfig, git } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'

function cardFiles(branch = 'feature/123-sample') {
  return { 'trellocards/123-sample/01-dossier.md': `# Sample\n\n## 🌿 Branch\n\n\`\`\`text\n${branch}\n\`\`\`\n` }
}

test('ff sync --check reports configured base branch without changing branch', async (t) => {
  const ws = makeWorkspace()
  t.after(ws.cleanup)
  const { ctx, buf } = capture(ws.root)
  assert.equal(await main(['sync', '--check'], ctx), 0)
  assert.match(buf.out, /web.*dev/)
  assert.equal(git(path.join(ws.root, 'web'), 'branch', '--show-current'), 'dev')
})

test('ff copy clones configured repos, makes card branch and copies configured env files', async (t) => {
  const config = baseConfig()
  config.repos[0].env_files = ['.env.local']
  const ws = makeWorkspace({ config, files: { ...cardFiles(), 'web/.env.local': 'LOCAL_SECRET=keep\n' } })
  t.after(ws.cleanup)
  const { ctx, buf } = capture(ws.root)
  assert.equal(await main(['copy', '123'], ctx), 0, buf.err)
  const copy = path.join(ws.root, 'worktrees/123-sample/web')
  assert.equal(git(copy, 'branch', '--show-current'), 'feature/123-sample')
  assert.equal(fs.readFileSync(path.join(copy, '.env.local'), 'utf8'), 'LOCAL_SECRET=keep\n')
  assert.doesNotMatch(buf.out + buf.err, /LOCAL_SECRET/)
})

test('ff copy refuses a dossier without a branch and keeps existing worktree', async (t) => {
  const ws = makeWorkspace({ files: { 'trellocards/123-sample/01-dossier.md': '# No branch\n' } })
  t.after(ws.cleanup)
  const { ctx, buf } = capture(ws.root)
  assert.equal(await main(['copy', '123'], ctx), 1)
  assert.match(buf.err, /không đọc được tên branch/)
  assert.equal(fs.existsSync(path.join(ws.root, 'worktrees/123-sample')), false)
})

test('ff squash-check accepts an unchanged copy and rejects dirty files', async (t) => {
  const ws = makeWorkspace({ files: cardFiles() })
  t.after(ws.cleanup)
  const first = capture(ws.root)
  assert.equal(await main(['copy', '123'], first.ctx), 0, first.buf.err)
  const copied = path.join(ws.root, 'worktrees/123-sample/web')
  const ok = capture(ws.root)
  assert.equal(await main(['squash-check', '123'], ok.ctx), 0)
  assert.match(ok.buf.out, /squash-check đạt/)
  fs.writeFileSync(path.join(copied, 'dirty.txt'), 'dirty\n')
  const dirty = capture(ws.root)
  assert.equal(await main(['squash-check', '123'], dirty.ctx), 1)
  assert.match(dirty.buf.out, /chưa commit/)
})
