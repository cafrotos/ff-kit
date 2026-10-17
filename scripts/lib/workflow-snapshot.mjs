// A task's CLI and plugin share one immutable, manifest-bound package.
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { tokenize } from './shell.mjs'
import { validateWorkflowPin } from './stage-receipts.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const required = ['bin/ff', 'dist', 'ff-worker/dist', '.claude-plugin', 'hooks', 'skills', 'agents', 'commands', 'references', 'package.json', 'ff-worker/package.json']
const optional = ['templates']
const excluded = name => /^(?:\.env(?:\..*)?|\.ff(?:\..*)?|\.git|node_modules|workspace|workspaces|worktrees|trellocards|credentials?(?:\..*)?|secrets?(?:\..*)?)$/i.test(name) || /\.(?:pem|key|p12|pfx)$/i.test(name)
export const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`
const pinAt = (root, digest, cliVersion) => {
  const base = path.resolve(root, '.ff/workflows', digest)
  return { digest, path: base, binDir: path.join(base, 'bin'), cliPath: path.join(base, 'bin/ff'), pluginPath: base, cliVersion }
}

/** Synchronous publication via private temporary directory + atomic rename. */
export function prepareWorkflowSnapshot({ root, packageRoot, cliVersion }) {
  if (typeof cliVersion !== 'string' || !cliVersion.trim()) throw new Error('Missing workflow CLI version')
  root = fs.realpathSync(root)
  packageRoot = fs.realpathSync(packageRoot)
  const parent = path.join(root, '.ff/workflows')
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 })
  if (fs.realpathSync(parent) !== parent) throw new Error('Workflow storage must not use symlinks')
  const temp = path.join(parent, `.prepare-${randomUUID()}`), files = {}
  fs.mkdirSync(temp, { mode: 0o700 })
  const copy = name => {
    if (name.split('/').some(excluded)) return
    const source = path.join(packageRoot, name), target = path.join(temp, name), stat = fs.lstatSync(source)
    if (stat.isSymbolicLink() || fs.realpathSync(source) !== source) throw new Error('Workflow source symlink or escape forbidden')
    if (stat.isDirectory()) {
      fs.mkdirSync(target, { recursive: true, mode: 0o700 })
      for (const child of fs.readdirSync(source).sort()) copy(`${name}/${child}`)
    } else {
      if (!stat.isFile()) throw new Error('Workflow source must be a regular file')
      const bytes = fs.readFileSync(source)
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
      fs.writeFileSync(target, bytes, { mode: stat.mode & 0o111 ? 0o700 : 0o600, flag: 'wx' })
      files[name] = hash(bytes)
    }
  }
  try {
    for (const name of required) copy(name)
    for (const name of optional) if (fs.existsSync(path.join(packageRoot, name))) copy(name)
    const manifest = JSON.stringify({ version: 1, cliVersion, files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) }) + '\n'
    fs.writeFileSync(path.join(temp, 'manifest.json'), manifest, { mode: 0o600, flag: 'wx' })
    const workflow = pinAt(root, hash(manifest), cliVersion)
    // Never repair an existing corrupt pin in place or silently replace it.
    if (fs.existsSync(workflow.path)) validateWorkflowPin(root, workflow)
    else try { fs.renameSync(temp, workflow.path) } catch (e) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(e.code)) throw e
    }
    validateWorkflowPin(root, workflow)
    return workflow
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
}

export function verifyWorkflowSnapshot(workflow) {
  try {
    if (!workflow || typeof workflow.path !== 'string' || !path.isAbsolute(workflow.path)) throw new Error('Workflow path must be absolute')
    const root = path.resolve(workflow.path, '../../..')
    validateWorkflowPin(root, workflow)
    return { valid: true, reasons: [] }
  } catch (e) { return { valid: false, reasons: [e.message] } }
}
const requirePin = workflow => {
  const result = verifyWorkflowSnapshot(workflow)
  if (!result.valid) throw new Error(`Invalid workflow snapshot: ${result.reasons.join('; ')}`)
}

/** Parse argv, never eval or execute configured command text as shell. */
/** Remote Control session name for a card; null only when worker.driver.remote_control is false. */
export function remoteControlName(config, cardId, slug) {
  const driver = config?.worker?.driver
  if (driver?.remote_control === false) return null // only called on harness launch paths
  return `ff-${cardId} ${slug ?? ''}`.trim()
}
const sanitizeRemoteName = name => String(name).replace(/[^A-Za-z0-9 ._-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)

export function buildClaudeLaunch({ engineCommand, workflow, claudeSessionId, resume = false, remoteControl = null }) {
  requirePin(workflow)
  if (typeof claudeSessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claudeSessionId)) throw new Error('Persisted Claude session UUID required')
  if (typeof engineCommand !== 'string' || !engineCommand.trim()) throw new Error('Missing Claude engine command')
  const [command, ...configured] = tokenize(engineCommand), args = []
  if (!command || command.startsWith('-')) throw new Error('Missing Claude executable')
  for (let i = 0; i < configured.length; i++) {
    const arg = configured[i], flag = arg.split('=')[0]
    if (arg === '--') throw new Error('Claude end-of-options selector forbidden')
    if (['--session-id', '--resume', '--continue', '--fork-session', '-r', '-c'].includes(flag)) throw new Error('Claude session selector belongs to worker')
    if (['--dangerously-skip-permissions', '--allow-dangerously-skip-permissions'].includes(flag)) throw new Error('Claude bypass permission flag forbidden')
    if (flag === '--remote-control') throw new Error('Claude remote-control belongs to worker config (worker.driver.remote_control)')
    if (flag === '--plugin-dir') throw new Error('Claude plugin path belongs to pinned workflow')
    if (flag === '--permission-mode') {
      if (arg === flag && (!configured[i + 1] || configured[++i].startsWith('-'))) throw new Error('Missing permission mode value')
      continue
    }
    args.push(arg)
  }
  args.push('--permission-mode', 'auto', resume ? '--resume' : '--session-id', claudeSessionId, '--plugin-dir', workflow.pluginPath)
  const rcName = remoteControl ? sanitizeRemoteName(remoteControl) : ''
  if (rcName) args.push('--remote-control', rcName)
  return { command, args, env: { PATH: `${workflow.binDir}${path.delimiter}${process.env.PATH ?? ''}` } }
}

/** Probe only the configured binary, with argv and no shell/config mutation. */
export function assertClaudeLaunchCapabilities(launch) {
  const result = spawnSync(launch.command, ['--help'], { env: { ...process.env, ...launch.env }, encoding: 'utf8', timeout: 10000 })
  const help = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (result.status !== 0 || !['--plugin-dir', '--session-id', '--resume', '--permission-mode'].every(flag => help.includes(flag)) || !/\bauto\b/.test(help)) throw new Error('setup:runner: Claude must support pinned plugin, UUID sessions and permission-mode auto')
  if (launch.args?.includes('--remote-control') && !help.includes('--remote-control')) throw new Error('setup:runner: Claude lacks --remote-control; upgrade Claude Code or set worker.driver.remote_control: false')
}

/** Execute the same explicit resolution/version check in Bash, fail closed. */
export function verifyWorkflowBash(workflow, { env = process.env, envFile } = {}) {
  requirePin(workflow)
  const script = [
    envFile ? 'source "$1" || exit 1' : '',
    `test "$(command -v ff)" = ${shellQuote(workflow.cliPath)} || exit 1`,
    `test "$(ff --version)" = ${shellQuote(workflow.cliVersion)} || exit 1`,
  ].filter(Boolean).join('\n')
  const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', script, 'ff-workflow-check', ...(envFile ? [envFile] : [])], { env, encoding: 'utf8', timeout: 10000 })
  if (result.status !== 0) throw new Error('Pinned workflow Bash CLI resolution/version check failed')
}

/** SessionStart appends, preserving exports written by other hooks. */
export function bindWorkflowEnvironment(workflow, env = process.env) {
  requirePin(workflow)
  if (!env.CLAUDE_PLUGIN_ROOT || path.resolve(env.CLAUDE_PLUGIN_ROOT) !== workflow.pluginPath) throw new Error('Pinned workflow plugin path mismatch')
  if (!env.CLAUDE_ENV_FILE) throw new Error('Pinned workflow requires CLAUDE_ENV_FILE for Bash')
  // Do not emit or persist the inherited environment or source file contents.
  fs.appendFileSync(env.CLAUDE_ENV_FILE, `\nexport PATH=${shellQuote(workflow.binDir)}:"$PATH"\n`, { mode: 0o600 })
  verifyWorkflowBash(workflow, { env, envFile: env.CLAUDE_ENV_FILE })
}
