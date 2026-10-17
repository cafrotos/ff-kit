import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { workflowPackage } from './helpers/workflow.mjs'
import { makeHarnessFixture } from './helpers/harness.mjs'
import { readRunnerBinding } from '../scripts/lib/question-history.mjs'
import { launchAgentTask } from '../ff-worker/src/core/worker.mjs'

const storedUuid = '550e8400-e29b-41d4-a716-446655440000'
const modulePath = path.resolve('scripts/lib/workflow-snapshot.mjs')
const api = async () => { assert.ok(fs.existsSync(modulePath), 'workflow snapshot implementation required'); return import(modulePath) }
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ff workflow ' space-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const root = path.join(dir, 'workspace'), packageRoot = path.join(dir, 'plugin')
  fs.mkdirSync(root)
  const pkg = workflowPackage(packageRoot)
  const lib = await api()
  return { dir, root, packageRoot, ...pkg, ...lib, workflow: lib.prepareWorkflowSnapshot({ root, packageRoot, cliVersion: '0.1.0' }) }
}
test('snapshot freezes runnable layout and approved assets without credentials or workspace', async t => {
  const f = await fixture(t)
  for (const name of ['.ff.env', 'workspace/card.md', 'skills/example/.env', 'skills/example/credentials.json', 'dist/private.key']) f.write(name, 'DO_NOT_COPY')
  const pinned = f.prepareWorkflowSnapshot({ root: f.root, packageRoot: f.packageRoot, cliVersion: '0.1.0' })
  assert.equal(pinned.digest, f.workflow.digest)
  assert.deepEqual(f.verifyWorkflowSnapshot(pinned), { valid: true, reasons: [] })
  f.write('skills/example/SKILL.md', 'new workflow')
  const fresh = f.prepareWorkflowSnapshot({ root: f.root, packageRoot: f.packageRoot, cliVersion: '0.1.0' })
  assert.notEqual(fresh.digest, pinned.digest)
  assert.equal(fs.readFileSync(path.join(pinned.path, 'skills/example/SKILL.md'), 'utf8'), 'original workflow\n')
  assert.ok(fs.statSync(pinned.cliPath).mode & 0o111)
  const r = spawnSync(pinned.cliPath, ['--version'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout.trim(), pinned.cliVersion)
  assert.ok(fs.existsSync(path.join(pinned.path, 'ff-worker/dist/index.mjs')))
  const manifest = JSON.parse(fs.readFileSync(path.join(pinned.path, 'manifest.json')))
  assert.ok(Object.keys(manifest.files).every(name => !/\.env|credentials|workspace|private\.key/.test(name)))
})
test('missing, tampered, unlisted and symlink snapshots fail closed', async t => {
  for (const mutation of [f => fs.rmSync(f.workflow.cliPath), f => fs.appendFileSync(path.join(f.workflow.path, 'dist/cli.mjs'), 'tamper'), f => fs.writeFileSync(path.join(f.workflow.path, 'extra'), 'extra'), f => { fs.rmSync(f.workflow.cliPath); fs.symlinkSync('/bin/true', f.workflow.cliPath) }, f => fs.chmodSync(f.workflow.cliPath, 0o600)]) {
    const f = await fixture(t); mutation(f)
    assert.equal(f.verifyWorkflowSnapshot(f.workflow).valid, false)
    assert.throws(() => f.buildClaudeLaunch({ engineCommand: 'claude', workflow: f.workflow, claudeSessionId: storedUuid }), /workflow|snapshot|ENOENT|executable/i)
  }
})
test('source symlinks cannot copy external content', async t => {
  const f = await fixture(t)
  fs.symlinkSync('/etc/passwd', path.join(f.packageRoot, 'references/escape'))
  assert.throws(() => f.prepareWorkflowSnapshot({ root: f.root, packageRoot: f.packageRoot, cliVersion: '0.1.0' }), /symlink/i)
})
test('launch uses persisted UUID, one auto mode, quoted executable and pinned plugin for new and resume', async t => {
  const f = await fixture(t)
  for (const resume of [false, true]) {
    const launch = f.buildClaudeLaunch({ engineCommand: '"/tools/Claude Code" --model "model name" --permission-mode bypassPermissions --permission-mode=dontAsk', workflow: f.workflow, claudeSessionId: storedUuid, resume })
    assert.equal(launch.command, '/tools/Claude Code')
    assert.deepEqual(launch.args.slice(0, 2), ['--model', 'model name'])
    assert.equal(launch.args.filter(x => x === '--permission-mode').length, 1)
    assert.equal(launch.args[launch.args.indexOf('--permission-mode') + 1], 'auto')
    assert.equal(launch.args[launch.args.indexOf(resume ? '--resume' : '--session-id') + 1], storedUuid)
    assert.equal(launch.args.includes(resume ? '--session-id' : '--resume'), false)
    assert.equal(launch.args.includes('--fork-session'), false)
    assert.equal(launch.args[launch.args.indexOf('--plugin-dir') + 1], f.workflow.pluginPath)
    assert.equal(launch.env.PATH.split(path.delimiter)[0], f.workflow.binDir)
  }
})
test('launch rejects invalid UUIDs, caller session selectors and bypass flags', async t => {
  const f = await fixture(t), common = { workflow: f.workflow, claudeSessionId: storedUuid }
  for (const id of [undefined, '', 'not-uuid']) assert.throws(() => f.buildClaudeLaunch({ ...common, claudeSessionId: id, engineCommand: 'claude' }), /UUID/)
  for (const flag of ['--session-id x', '--session-id=x', '--resume x', '--resume=x', '-r x', '--continue', '-c', '--fork-session', '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', '--plugin-dir /other', '--plugin-dir=/other']) assert.throws(() => f.buildClaudeLaunch({ ...common, engineCommand: `claude ${flag}` }), /selector|permission|plugin/i)
})
test('SessionStart and resume append env file and verify Bash resolves pinned ff instead of global', async t => {
  const f = await fixture(t), w = makeHarnessFixture(t)
  const workflow = f.prepareWorkflowSnapshot({ root: w.root, packageRoot: f.packageRoot, cliVersion: '0.1.0' })
  w.seedTask(w.task({ claudeSessionId: storedUuid, workflow }))
  const globalDir = path.join(f.dir, 'global'); fs.mkdirSync(globalDir)
  fs.writeFileSync(path.join(globalDir, 'ff'), '#!/bin/sh\necho WRONG_GLOBAL\n', { mode: 0o755 })
  const envFile = path.join(f.dir, 'claude env'); fs.writeFileSync(envFile, 'export OTHER_HOOK=preserved\n')
  const env = { ...process.env, PATH: `${globalDir}:${process.env.PATH}`, FF_CARD_ID: '123', FF_RUN_ID: 'run-1', CLAUDE_PLUGIN_ROOT: workflow.path, CLAUDE_ENV_FILE: envFile }
  for (const source of ['startup', 'resume']) {
    const r = spawnSync(process.execPath, ['scripts/hooks/session-start.mjs'], { input: JSON.stringify({ cwd: w.root, session_id: storedUuid, source }), env, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(readRunnerBinding(w.root, 'run-1')?.status, 'confirmed', r.stderr)
    const bash = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', 'source "$1"; command -v ff; ff --version; echo "$OTHER_HOOK"', 'fixture', envFile], { env, encoding: 'utf8' })
    assert.equal(bash.status, 0, bash.stderr)
    assert.deepEqual(bash.stdout.trim().split('\n'), [workflow.cliPath, workflow.cliVersion, 'preserved'])
  }
  assert.match(fs.readFileSync(envFile, 'utf8'), /^export OTHER_HOOK=preserved\n/)
})
test('SessionStart blocks plugin mismatch, missing env file or broken snapshot before confirmation', async t => {
  for (const failure of ['plugin', 'env', 'snapshot', 'version']) {
    const f = await fixture(t), w = makeHarnessFixture(t)
    const workflow = f.prepareWorkflowSnapshot({ root: w.root, packageRoot: f.packageRoot, cliVersion: failure === 'version' ? 'wrong-version' : '0.1.0' })
    w.seedTask(w.task({ claudeSessionId: storedUuid, workflow }))
    const env = { ...process.env, FF_CARD_ID: '123', FF_RUN_ID: 'run-1', CLAUDE_PLUGIN_ROOT: failure === 'plugin' ? f.packageRoot : workflow.path, CLAUDE_ENV_FILE: path.join(f.dir, 'env') }
    if (failure === 'env') delete env.CLAUDE_ENV_FILE
    if (failure === 'snapshot') fs.rmSync(workflow.cliPath)
    const r = spawnSync(process.execPath, ['scripts/hooks/session-start.mjs'], { input: JSON.stringify({ cwd: w.root, session_id: storedUuid }), env, encoding: 'utf8' })
    assert.equal(r.status, 2, r.stderr)
    assert.equal(readRunnerBinding(w.root, 'run-1')?.status, 'blocked')
    assert.match(r.stderr, /workflow|snapshot|CLI|Bash|env|plugin/i)
  }
})
test('worker launches only persisted pin/UUID, scopes env and blocks unsupported Claude flags', async t => {
  const f = await fixture(t), w = makeHarnessFixture(t)
  const workflow = f.prepareWorkflowSnapshot({ root: w.root, packageRoot: f.packageRoot, cliVersion: '0.1.0' })
  const task = w.task({ claudeSessionId: storedUuid, workflow, slug: 'harness' }); w.seedTask(task)
  const engine = path.join(f.dir, 'Claude Code')
  fs.writeFileSync(engine, '#!/bin/sh\necho "--plugin-dir --session-id --resume --permission-mode auto --remote-control"\n', { mode: 0o755 })
  w.config.engine = { default: 'claude', commands: { claude: `'${engine.replaceAll("'", "'\\''")}'` } }
  const calls = [], tmux = { start: async (...args) => { calls.push(args); return { existing: false } } }
  for (const resume of [false, true]) {
    await launchAgentTask({ root: w.root, config: w.config, tmux, task, card: {}, resume })
    const r = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', calls.at(-1)[2]], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    assert.match(calls.at(-1)[2], /FF_CARD_ID=/)
    assert.match(calls.at(-1)[2], /FF_RUN_ID=/)
    assert.match(calls.at(-1)[2], new RegExp(resume ? '--resume' : '--session-id'))
    assert.match(calls.at(-1)[2], /'--remote-control' 'ff-123 harness'/)
  }
  w.config.worker.driver.remote_control = false
  await launchAgentTask({ root: w.root, config: w.config, tmux, task, card: {} })
  assert.doesNotMatch(calls.at(-1)[2], /--remote-control/)
  delete w.config.worker.driver.remote_control
  calls.pop()
  await assert.rejects(launchAgentTask({ root: w.root, config: w.config, tmux, task: { ...task, claudeSessionId: 'different' }, card: {} }), /persisted|UUID/)
  fs.writeFileSync(engine, '#!/bin/sh\necho "old Claude"\n', { mode: 0o755 })
  await assert.rejects(launchAgentTask({ root: w.root, config: w.config, tmux, task, card: {} }), /setup:runner/)
  assert.equal(calls.length, 2)
})
test('doctor reports missing runner capability and a damaged pinned workflow', async t => {
  const { runDoctor } = await import('../scripts/lib/doctor.mjs')
  const { loadConfig } = await import('../scripts/lib/config.mjs')
  const f = await fixture(t), w = makeHarnessFixture(t)
  const workflow = f.prepareWorkflowSnapshot({ root: w.root, packageRoot: f.packageRoot, cliVersion: '0.1.0' })
  w.seedTask(w.task({ workflow }))
  fs.rmSync(workflow.cliPath)
  const engine = path.join(f.dir, 'old-claude')
  fs.writeFileSync(engine, '#!/bin/sh\necho "old Claude"\n', { mode: 0o755 })
  const loaded = loadConfig(w.root); loaded.config.engine = { default: 'claude', commands: { claude: `'${engine.replaceAll("'", "'\\''")}'` } }
  const result = runDoctor(w.root, loaded, { which: () => true })
  assert.ok(result.checks.some(c => !c.ok && c.group === 'worker' && /workflow/.test(c.msg)))
  assert.ok(result.checks.some(c => !c.ok && c.group === 'worker' && /setup:runner/.test(c.msg)))
})
test('launcher and SessionStart reject a valid pin belonging to another workspace', async t => {
  const f = await fixture(t), w = makeHarnessFixture(t), task = w.task({ claudeSessionId: storedUuid, workflow: f.workflow, slug: 'harness' })
  w.seedTask(task)
  await assert.rejects(launchAgentTask({ root: w.root, config: w.config, tmux: { start: async () => assert.fail('must not start') }, task, card: {} }), /workflow|snapshot/i)
  const r = spawnSync(process.execPath, ['scripts/hooks/session-start.mjs'], { input: JSON.stringify({ cwd: w.root, session_id: storedUuid }), env: { ...process.env, FF_CARD_ID: '123', FF_RUN_ID: 'run-1', CLAUDE_PLUGIN_ROOT: f.workflow.path, CLAUDE_ENV_FILE: path.join(f.dir, 'env') }, encoding: 'utf8' })
  assert.equal(r.status, 2, r.stderr)
  assert.equal(readRunnerBinding(w.root, 'run-1')?.status, 'blocked')
})
test('snapshot preparation never replaces a corrupt existing digest directory', async t => {
  const f = await fixture(t)
  fs.rmSync(f.workflow.path, { recursive: true }); fs.mkdirSync(f.workflow.path)
  assert.throws(() => f.prepareWorkflowSnapshot({ root: f.root, packageRoot: f.packageRoot, cliVersion: '0.1.0' }), /workflow|ENOENT/i)
})
test('launcher rejects an end-of-options delimiter that disables worker flags', async t => {
  const f = await fixture(t)
  assert.throws(() => f.buildClaudeLaunch({ engineCommand: 'claude --', workflow: f.workflow, claudeSessionId: storedUuid }), /options|selector/i)
})
test('source ancestor symlinks cannot copy a runnable asset outside the package', async t => {
  const f = await fixture(t), outside = path.join(f.dir, 'external-bin')
  fs.renameSync(path.join(f.packageRoot, 'bin'), outside)
  fs.symlinkSync(outside, path.join(f.packageRoot, 'bin'))
  assert.throws(() => f.prepareWorkflowSnapshot({ root: f.root, packageRoot: f.packageRoot, cliVersion: '0.1.0' }), /symlink|escape/i)
})
test('standalone SessionStart keeps diagnostic behavior when YAML cannot be loaded', async t => {
  const w = makeHarnessFixture(t)
  fs.writeFileSync(path.join(w.root, 'ff.config.yaml'), 'repos: [broken')
  const r = spawnSync(process.execPath, ['scripts/hooks/session-start.mjs'], { input: JSON.stringify({ cwd: w.root }), encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /doctor.*ĐỎ/)
})

test('remote control name is sanitized, appended once and cannot be set by the engine command', async t => {
  const f = await fixture(t), common = { workflow: f.workflow, claudeSessionId: storedUuid }
  const launch = f.buildClaudeLaunch({ ...common, engineCommand: 'claude --model x', remoteControl: 'ff-12 fix "login"; rm -rf /\n' })
  assert.equal(launch.args.filter(x => x === '--remote-control').length, 1)
  const name = launch.args[launch.args.indexOf('--remote-control') + 1]
  assert.match(name, /^ff-12 fix [A-Za-z0-9 ._-]+$/)
  assert.equal(launch.args.includes('--plugin-dir') && launch.args.includes('--session-id'), true)
  assert.equal(f.buildClaudeLaunch({ ...common, engineCommand: 'claude' }).args.includes('--remote-control'), false)
  for (const flag of ['--remote-control', '--remote-control=x', '--remote-control x']) assert.throws(() => f.buildClaudeLaunch({ ...common, engineCommand: `claude ${flag}`, remoteControl: 'ff-1 a' }), /remote/i)
  assert.equal(f.remoteControlName({ worker: { driver: { enabled: true } } }, '7', 'my-slug'), 'ff-7 my-slug')
  assert.equal(f.remoteControlName({ worker: { driver: { enabled: true, remote_control: false } } }, '7', 's'), null)
})
test('capability probe requires --remote-control only when launched with it', async t => {
  const f = await fixture(t), dir = fs.mkdtempSync(path.join(f.dir, 'eng-')), engine = path.join(dir, 'claude')
  fs.writeFileSync(engine, '#!/bin/sh\necho "--plugin-dir --session-id --resume --permission-mode auto"\n', { mode: 0o755 })
  f.assertClaudeLaunchCapabilities({ command: engine, args: [], env: {} })
  assert.throws(() => f.assertClaudeLaunchCapabilities({ command: engine, args: ['--remote-control', 'ff-1 a'], env: {} }), /remote/i)
  fs.writeFileSync(engine, '#!/bin/sh\necho "--plugin-dir --session-id --resume --permission-mode auto --remote-control"\n', { mode: 0o755 })
  f.assertClaudeLaunchCapabilities({ command: engine, args: ['--remote-control', 'ff-1 a'], env: {} })
})
