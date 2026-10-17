import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeGuard } from '../scripts/lib/guard-rules.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { makeWorkspace, baseConfig, git } from './helpers/fixture.mjs'

const WT = 'worktrees/123-hardening'
const TEST = 'e2e/tests/123-hardening/a.spec.ts'
const GUARD = fileURLToPath(new URL('../scripts/guard.mjs', import.meta.url))

function setup(t, { locked = false, allow = false } = {}) {
  const config = baseConfig()
  config.e2e = { dir: 'e2e', tests_dir: 'e2e/tests', test_cmd: 'node runner.mjs' }
  config.repos[0].commands = { build: 'node build.mjs', test: 'node --test tests/*.test.mjs' }
  const ws = makeWorkspace({ config, gitRepos: false, files: {
    [`${WT}/web/src/a.ts`]: 'a', [`${WT}/web/src/b.ts`]: 'b', [TEST]: 'test',
    '.ff.env': 'TOKEN=secret', 'trellocards/123-hardening/brief.md': '# Brief',
  } })
  t.after(ws.cleanup)
  const at = (f) => path.join(ws.root, f)
  if (locked) fs.writeFileSync(at(`${WT}/.ff-test-lock`), `${'0'.repeat(64)}  ${TEST}\n`)
  if (allow) fs.writeFileSync(at(`${WT}/.ff-allow`), `ts=${Math.floor(Date.now() / 1000)}\nweb/src/a.ts\n`)
  const G = makeGuard(ws.root, loadConfig(ws.root).config)
  const ev = (o) => G.evaluate({ cwd: ws.root, mode: 'feature-flow', ...o })
  return { ...ws, at, ev }
}

test('feature-flow composes base policy, absolute executables and wrapper options', (t) => {
  const { ev } = setup(t)
  for (const cmd of ['git push', '/usr/bin/git push', '/usr/bin/git -c color.ui=false stash',
    'sudo -n -u root -- /usr/bin/git push', '/usr/bin/env -u TOKEN -- /usr/bin/git stash',
    'command -p -- git add -A', 'timeout --signal=TERM 5s git push', '/bin/kill 12',
    '/bin/bash -lc "/usr/bin/git push"']) assert.notEqual(ev({ cmd }), null, cmd)
  assert.equal(ev({ cmd: '/usr/bin/git status' }), null)
})

test('default registered guard protects mirror and base policy', (t) => {
  const { root } = setup(t)
  const hook = JSON.parse(fs.readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf8'))
  const command = hook.hooks.PreToolUse.find((h) => h.matcher.includes('Bash')).hooks[0].command
  const mode = command.match(/--mode\s+(\S+)/)?.[1]
  for (const payload of [
    { tool_name: 'Write', tool_input: { file_path: 'web/src/a.ts', content: 'x' } },
    { tool_name: 'Bash', tool_input: { command: 'git push' } },
  ]) {
    const r = spawnSync('node', [GUARD, ...(mode ? ['--mode', mode] : [])], { input: JSON.stringify({ ...payload, cwd: root }), encoding: 'utf8' })
    assert.equal(r.status, 2, command)
  }
})

test('locked tests reject opaque interpreters and absolute mutation binaries', (t) => {
  const { ev, at } = setup(t, { locked: true })
  for (const cmd of [
    `node -e "require('fs').writeFileSync('${TEST}', 'changed')"`,
    `node -e "require('fs').writeFileSync(process.argv[1], 'changed')" ${TEST}`,
    'node mutate.mjs', 'python3 - <<EOF\nopen("dynamic", "w")\nEOF',
    `/bin/rm ${TEST}`, `cd e2e && /usr/bin/tee tests/123-hardening/a.spec.ts`,
    `cp /tmp/a e2e/tests/123-hardening/`,
  ]) assert.notEqual(ev({ cmd }), null, cmd)
  for (const cmd of [`cat ${TEST}`, `node --version`, 'ff lock-tests 123', 'ff relock 123 --reason x'])
    assert.equal(ev({ cmd }), null, cmd)
  assert.equal(ev({ cmd: 'node build.mjs', cwd: at(`${WT}/web`) }), null)
  assert.equal(ev({ cmd: 'node --test tests/*.test.mjs', cwd: at(`${WT}/web`) }), null)
  assert.equal(ev({ cmd: 'node runner.mjs', cwd: at('e2e') }), null)
})

test('shell writes obey active allowlists without applying them to reads or unrelated paths', (t) => {
  const { ev, at } = setup(t, { allow: true })
  for (const cmd of [`echo changed > ${at(`${WT}/web/src/b.ts`)}`, `echo changed > "${at(`${WT}/web/src/new file.ts`)}"`,
    `/usr/bin/tee src/b.ts`, `cp /tmp/a ${at(`${WT}/web/src/`)}/`,
    'node mutate.mjs', 'bash -c "echo changed > src/b.ts"'])
    assert.notEqual(ev({ cmd, cwd: at(`${WT}/web`) }), null, cmd)
  for (const cmd of ['cat src/b.ts', 'grep a src/b.ts', 'sed -n 1p src/b.ts', 'echo changed > src/a.ts',
    'echo log > /tmp/ff-log', 'node build.mjs', 'ff doctor'])
    assert.equal(ev({ cmd, cwd: at(`${WT}/web`) }), null, cmd)
  assert.equal(ev({ cmd: 'node unrelated.mjs', cwd: at('web') }), null)
})

test('ff invocations cannot hide shell redirections or follow-up mutations', (t) => {
  const { ev } = setup(t, { locked: true })
  for (const cmd of [`ff doctor > .ff/gates/x.json`, `ff lock-tests 123 > ${TEST}`,
    `ff relock 123 --reason x && node -e "require('fs').writeFileSync('${TEST}', 'x')"`,
    `ff lock-tests 123 > trellocards/123-hardening/brief.md`])
    assert.notEqual(ev({ cmd }), null, cmd)
})

test('worktree control metadata cannot be forged through tools or shell', (t) => {
  const { ev } = setup(t)
  for (const name of ['.ff-test-lock', '.ff-allow', '.ff-ship-approved']) {
    assert.notEqual(ev({ file: `${WT}/${name}`, tool: 'Write', input: { content: 'forged' } }), null, name)
    assert.notEqual(ev({ cmd: `echo forged > ${WT}/${name}` }), null, name)
    assert.notEqual(ev({ cmd: `/bin/rm ${WT}/${name}` }), null, name)
  }
  assert.equal(ev({ cmd: `cat ${WT}/.ff-test-lock` }), null)
})

test('secret aliases compare resolved paths for shell reads and file tools', (t) => {
  const { ev, at } = setup(t)
  fs.symlinkSync(at('.ff.env'), at('harmless.txt'))
  assert.notEqual(ev({ file: 'harmless.txt', tool: 'Read' }), null)
  assert.notEqual(ev({ cmd: 'cat harmless.txt' }), null)
  assert.notEqual(ev({ cmd: `node -e "require('fs').readFileSync('harmless.txt')"` }), null)
  assert.equal(ev({ cmd: 'cat harmless-other.txt' }), null)
})

test('directory builtins do not exempt redirects and wrappers inspect split-string commands', (t) => {
  const { ev } = setup(t, { locked: true })
  for (const cmd of [`cd . > ${TEST}`, `cd . > .ff/gates/x.json`,
    `/usr/bin/env -S 'git push'`, `/usr/bin/env -S 'node mutate.mjs'`])
    assert.notEqual(ev({ cmd }), null, cmd)
})

test('configured read checks can use shell sequencing without exempting appended code', (t) => {
  const config = baseConfig()
  config.repos[0].commands.build = 'export MODE=test && node build.mjs'
  const ws = makeWorkspace({ config, gitRepos: false, files: {
    [`${WT}/web/build.mjs`]: '', [`${WT}/.ff-allow`]: `ts=${Math.floor(Date.now() / 1000)}\nweb/src/a.ts\n`,
  } })
  t.after(ws.cleanup)
  const G = makeGuard(ws.root, loadConfig(ws.root).config)
  const cwd = path.join(ws.root, WT, 'web')
  assert.equal(G.evaluate({ cmd: config.repos[0].commands.build, cwd }), null)
  assert.notEqual(G.evaluate({ cmd: `${config.repos[0].commands.build} && node mutate.mjs`, cwd }), null)
})

test('revision manifests add locked files without replacing the original lock', (t) => {
  const { ev, at } = setup(t, { locked: true })
  const revisionTest = 'e2e/tests/123-hardening/revision.spec.ts'
  fs.writeFileSync(at(revisionTest), 'revision')
  fs.writeFileSync(at(`${WT}/.ff-test-lock.rev-1`), `${'0'.repeat(64)}  ${revisionTest}\n`)
  fs.writeFileSync(at(`${WT}/.ff-test-lock.log`), `${'0'.repeat(64)}  e2e/tests/123-hardening/unlocked.spec.ts\n`)
  for (const file of [TEST, revisionTest, `${WT}/.ff-test-lock.rev-1`])
    assert.notEqual(ev({ file, tool: 'Edit', input: { old_string: 'x', new_string: 'y' } }), null, file)
  assert.match(ev({ file: revisionTest, tool: 'Edit' }), /ff relock 123-hardening --revision rev-1/)
  assert.notEqual(ev({ cmd: `node -e "require('fs').writeFileSync('${revisionTest}', 'x')"` }), null)
  assert.equal(ev({ file: 'e2e/tests/123-hardening/unlocked.spec.ts', tool: 'Edit' }), null)
})

test('local-only observation copies cannot push even with ship approval', (t) => {
  const { ev, at } = setup(t)
  git(at(`${WT}/web`), 'init', '-q')
  fs.writeFileSync(at(`${WT}/.ff-ship-approved`), `${Math.floor(Date.now() / 1000)}\n`)
  assert.equal(ev({ cmd: 'git push', cwd: at(`${WT}/web`) }), null)
  git(at(`${WT}/web`), 'config', 'ff.localOnly', 'true')
  assert.notEqual(ev({ cmd: 'git push', cwd: at(`${WT}/web`) }), null)
  assert.notEqual(ev({ cmd: '/usr/bin/git -c ff.localOnly=false push', cwd: at(`${WT}/web`) }), null)
})

test('shell wrappers cannot hide protected mutations or git global flags', (t) => {
  const { ev } = setup(t)
  for (const cmd of [`bash -c "echo forged > .ff/gates/x.json"`,
    `bash -lc "/usr/bin/git -c color.ui=false push"`,
    `sh -c 'git -C web commit -m x'`]) assert.notEqual(ev({ cmd }), null, cmd)
  assert.equal(ev({ cmd: 'bash -c "echo harmless"' }), null)
})

test('patch hook payload checks every target, including moved files', (t) => {
  const { root } = setup(t, { locked: true })
  for (const patch of [`*** Begin Patch\n*** Update File: ${TEST}\n@@\n-test\n+x\n*** End Patch`,
    `*** Begin Patch\n*** Add File: notes.txt\n+ok\n*** Update File: .ff/gates/x.json\n@@\n+x\n*** End Patch`,
    `*** Begin Patch\n*** Update File: notes.txt\n*** Move to: ${WT}/.ff-test-lock\n@@\n+x\n*** End Patch`]) {
    const r = spawnSync('node', [GUARD, '--mode', 'feature-flow'], { encoding: 'utf8', input: JSON.stringify({
      cwd: root, tool_name: 'apply_patch', tool_input: { patch },
    }) })
    assert.equal(r.status, 2, patch)
  }
})

test('configured shell exceptions cannot override local-only push policy', (t) => {
  const config = baseConfig()
  config.guard = { allowed_bash: ['^git push origin docs$'] }
  const ws = makeWorkspace({ config, gitRepos: false, files: { [`${WT}/web/README.md`]: '' } })
  t.after(ws.cleanup)
  const cwd = path.join(ws.root, WT, 'web')
  git(cwd, 'init', '-q')
  git(cwd, 'config', 'ff.localOnly', 'true')
  const G = makeGuard(ws.root, loadConfig(ws.root).config)
  assert.notEqual(G.evaluate({ cmd: 'git push origin docs', cwd }), null)
})

test('directory wrapper flags and git directory options preserve mirror policy', (t) => {
  const { ev, at } = setup(t)
  for (const cmd of ['env -C web git commit -m x', 'env --chdir=web git commit -m x',
    'sudo -n -D web git commit -m x', 'git --git-dir web/.git commit -m x',
    'git --work-tree=web commit -m x', 'git -Cweb commit -m x',
    `git --git-dir=${at(`${WT}/web/.git`)} push`]) assert.notEqual(ev({ cmd }), null, cmd)
  assert.equal(ev({ cmd: 'env -C web git status' }), null)
})

test('configured checks use the copied repo basename for nested source paths', (t) => {
  const config = baseConfig()
  config.repos[0].path = 'services/web'
  config.repos[0].commands.build = 'node build.mjs'
  const ws = makeWorkspace({ config, gitRepos: false, files: {
    [`${WT}/web/build.mjs`]: '', [`${WT}/.ff-allow`]: `ts=${Math.floor(Date.now() / 1000)}\nweb/src/a.ts\n`,
  } })
  t.after(ws.cleanup)
  const G = makeGuard(ws.root, loadConfig(ws.root).config)
  assert.equal(G.evaluate({ cmd: 'node build.mjs', cwd: path.join(ws.root, WT, 'web') }), null)
})

test('guard repair commands identify the full slug and revision', (t) => {
  const { ev, at } = setup(t, { allow: true })
  assert.match(ev({ file: `${WT}/web/src/b.ts`, tool: 'Edit' }), /ff allow 123-hardening/)
  assert.match(ev({ cmd: 'git push', cwd: at(`${WT}/web`) }), /ff ship-approve 123-hardening/)
  assert.match(ev({ file: 'trellocards/123-hardening/rev-1/03-design.md', tool: 'Write', input: { content: '> Trạng thái: ĐÃ DUYỆT\n' } }), /\[#123\] \[rev-1\]/)
})
