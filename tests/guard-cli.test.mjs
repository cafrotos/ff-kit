import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeWorkspace, baseConfig } from './helpers/fixture.mjs'

const GUARD = fileURLToPath(new URL('../scripts/guard.mjs', import.meta.url))
const run = (args, input = '') => spawnSync('node', [GUARD, ...args], { input, encoding: 'utf8' })

function ws(t) {
  const config = baseConfig()
  config.repos = [{ name: 'api', path: 'api', base_branch: 'dev', ship_branch: 'dev', commands: {} }]
  const w = makeWorkspace({ config, gitRepos: false })
  t.after(w.cleanup)
  return w.root
}

test('stdin kiểu Claude: git stash → exit 2', (t) => {
  const root = ws(t)
  const r = run([], JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git stash' }, cwd: path.join(root, 'api') }))
  assert.equal(r.status, 2)
  assert.match(r.stderr, /^\[ff-guard\]/)
})

test('stdin kiểu Claude: Edit repo gốc ở feature-flow → exit 2', (t) => {
  const root = ws(t)
  const r = run(['--mode', 'feature-flow'], JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(root, 'api/src/a.ts') }, cwd: root }))
  assert.equal(r.status, 2)
})

test('kiểu agy: deny, cho qua, force_ask', (t) => {
  const root = ws(t)
  const cwd = path.join(root, 'api')
  const deny = run(['--format', 'agy'], JSON.stringify({ toolCall: { name: 'run_command', args: { CommandLine: 'git add -A', Cwd: cwd } } }))
  assert.match(deny.stdout, /"decision":"deny"/)
  const allow = run(['--format', 'agy'], JSON.stringify({ toolCall: { name: 'run_command', args: { CommandLine: 'git status', Cwd: cwd } } }))
  assert.equal(allow.stdout, '')
  const ask = run(['--format', 'agy'], JSON.stringify({ toolCall: { name: 'run_command', args: { CommandLine: 'ff ship-approve 999', Cwd: root } } }))
  assert.match(ask.stdout, /"decision":"force_ask"/)
})

test('kiểu agy: đủ 9 ca tool sửa file (TargetFile) của test-guard.sh', (t) => {
  const root = ws(t)
  fs.appendFileSync(path.join(root, 'ff.config.yaml'), 'e2e:\n  dir: e2e\n  tests_dir: e2e/tests\n')
  const slug = '991-agy'
  const rel = `e2e/tests/${slug}/a.spec.ts`
  fs.mkdirSync(path.join(root, `e2e/tests/${slug}`), { recursive: true })
  fs.mkdirSync(path.join(root, `worktrees/${slug}/web/src`), { recursive: true })
  fs.writeFileSync(path.join(root, `worktrees/${slug}/.ff-test-lock`), `${'0'.repeat(64)}  ${rel}\n`)
  const agy = (tool, file) => run(['--format', 'agy'], JSON.stringify({ toolCall: { name: tool, args: { TargetFile: path.join(root, file) } }, cwd: root })).stdout
  assert.match(agy('write_to_file', rel), /"decision":"deny"/)
  assert.match(agy('replace_file_content', rel), /"decision":"deny"/)
  assert.match(agy('multi_replace_file_content', rel), /"decision":"deny"/)
  assert.equal(agy('write_to_file', `e2e/tests/${slug}/b.spec.ts`), '')
  assert.equal(agy('view_file', rel), '')
  fs.writeFileSync(path.join(root, `worktrees/${slug}/.ff-allow`), `ts=${Math.floor(Date.now() / 1000)}\nweb/src/a.ts\n`)
  assert.equal(agy('replace_file_content', `worktrees/${slug}/web/src/a.ts`), '')
  assert.match(agy('replace_file_content', `worktrees/${slug}/web/src/c.ts`), /"decision":"deny"/)
  assert.match(agy('multi_replace_file_content', `worktrees/${slug}/web/src/c.ts`), /"decision":"deny"/)
  assert.equal(agy('write_to_file', `trellocards/${slug}/04-plan.md`), '')
})

test('kiểu agy: write_to_file vào file test đã khóa → deny', (t) => {
  const root = ws(t)
  const rel = 'e2e/tests/991-agy/a.spec.ts'
  fs.mkdirSync(path.join(root, 'e2e/tests/991-agy'), { recursive: true })
  fs.mkdirSync(path.join(root, 'worktrees/991-agy'), { recursive: true })
  fs.writeFileSync(path.join(root, 'worktrees/991-agy/.ff-test-lock'), `${'0'.repeat(64)}  ${rel}\n`)
  const cfgPath = path.join(root, 'ff.config.yaml')
  fs.appendFileSync(cfgPath, 'e2e:\n  dir: e2e\n  tests_dir: e2e/tests\n')
  const r = run(['--format', 'agy'], JSON.stringify({ toolCall: { name: 'write_to_file', args: { TargetFile: path.join(root, rel) } }, cwd: root }))
  assert.match(r.stdout, /"decision":"deny"/)
})

test('kiểu OpenCode: shell git stash → exit 2', (t) => {
  const root = ws(t)
  const r = run([], JSON.stringify({ tool_name: 'shell', tool_input: { command: 'git stash', workdir: path.join(root, 'api') }, cwd: path.join(root, 'api') }))
  assert.equal(r.status, 2)
})

test('tham số --cmd/--cwd', (t) => {
  const root = ws(t)
  assert.equal(run(['--cwd', path.join(root, 'api'), '--cmd', 'git push origin dev']).status, 2)
  assert.equal(run(['--cwd', path.join(root, 'api'), '--cmd', 'git status']).status, 0)
})
