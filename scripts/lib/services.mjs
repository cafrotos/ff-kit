// Khởi động / dừng service cho verify (e2e.services). ff tự làm việc này; không phụ thuộc script dev của dự án.
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Parse a dotenv-style file: KEY=VALUE, `export` prefix, quotes and comments tolerated. */
export function parseEnvFile(text) {
  const out = {}
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!m) continue
    let value = m[2]
    const quote = value[0]
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) value = value.slice(1, -1)
    else value = value.replace(/\s+#.*$/, '')
    out[m[1]] = value
  }
  return out
}

/** Env for a service: process env wins over env_load files (like `set -a; . file` in a shell that already has the var). */
export function loadServiceEnv(service, cwd, baseEnv = process.env) {
  const loaded = {}
  for (const rel of service.env_load ?? []) {
    try { Object.assign(loaded, parseEnvFile(fs.readFileSync(path.resolve(cwd, rel), 'utf8'))) } catch { /* optional file */ }
  }
  return { ...loaded, ...baseEnv }
}

/** Idempotent: copy the template when the file is missing, then set each KEY (replace the line, or append). Returns changed files. */
export function applyEnvOverrides(repoDir, overrides = []) {
  const changed = []
  for (const o of overrides) {
    const file = path.resolve(repoDir, o.file)
    if (!fs.existsSync(file)) {
      if (o.from && fs.existsSync(path.resolve(repoDir, o.from))) {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.copyFileSync(path.resolve(repoDir, o.from), file)
      } else {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, '')
      }
    }
    const original = fs.readFileSync(file, 'utf8')
    let lines = original.split('\n')
    for (const [key, value] of Object.entries(o.set)) {
      const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`)
      const line = `${key}=${value}`
      const idx = lines.findIndex((l) => re.test(l))
      if (idx >= 0) lines[idx] = line
      else {
        if (lines.length && lines[lines.length - 1] === '') lines.splice(lines.length - 1, 0, line)
        else lines.push(line)
      }
    }
    const next = lines.join('\n')
    if (next !== original) { fs.writeFileSync(file, next.endsWith('\n') || next === '' ? next : next + '\n'); changed.push(file) }
  }
  return changed
}

const probe = (host, port) => new Promise((resolve) => {
  const socket = net.connect({ host, port })
  const done = (value) => { socket.destroy(); resolve(value) }
  socket.setTimeout(500, () => done(false))
  socket.once('connect', () => done(true))
  socket.once('error', () => done(false))
})
export async function portInUse(port) {
  return (await probe('127.0.0.1', port)) || (await probe('::1', port))
}
export async function waitPort(port, { up, timeoutMs, alive = () => true, sleepMs = 250 }) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if ((await portInUse(port)) === up) return true
    if (up && !alive()) return false
    if (Date.now() >= deadline) return false
    await sleep(sleepMs)
  }
}

/** Fingerprint of a process, so a stale pid reused by an unrelated process is never signalled. */
export function procStamp(pid) {
  const r = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : ''
}
const exists = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
const groupExists = (pid) => { try { process.kill(-pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
export function ownedAlive(entry) {
  if (!entry?.pid) return false
  if (exists(entry.pid)) return !entry.stamp || procStamp(entry.pid) === entry.stamp
  return groupExists(entry.pid) // leader gone but children still in the group
}

function descendants(pid) {
  const r = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
  const kids = r.status === 0 ? r.stdout.split('\n').map(Number).filter(Boolean) : []
  return kids.flatMap((k) => [k, ...descendants(k)])
}

/** TERM the whole process tree (group + descendants that left the group), KILL what survives the timeout. */
export async function killTree(entry, { timeoutMs = 5000 } = {}) {
  if (!ownedAlive(entry)) return false
  const pids = [entry.pid, ...descendants(entry.pid)]
  const signal = (sig) => {
    try { process.kill(-entry.pid, sig) } catch { /* group gone */ }
    for (const pid of pids) { try { process.kill(pid, sig) } catch { /* gone */ } }
  }
  signal('SIGTERM')
  const deadline = Date.now() + timeoutMs
  const anyAlive = () => groupExists(entry.pid) || pids.some(exists)
  while (anyAlive() && Date.now() < deadline) await sleep(100)
  if (anyAlive()) {
    signal('SIGKILL')
    const killDeadline = Date.now() + 2000
    while (anyAlive() && Date.now() < killDeadline) await sleep(50)
  }
  return true
}

/** Start one service detached in its own process group; output goes to logFile. Returns the lock-state entry. */
export function startService({ service, cwd, env, logFile }) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true })
  const fd = fs.openSync(logFile, 'w')
  const child = spawn('sh', ['-c', service.cmd], { cwd, env, detached: true, stdio: ['ignore', fd, fd] })
  fs.closeSync(fd)
  child.unref()
  child.on('error', () => {})
  return { name: service.name, pid: child.pid, port: service.port, cwd, log: logFile, stamp: procStamp(child.pid) }
}

/** Run a one-off preparation command (install/build) with output in logFile. */
export function runPrepare(command, cwd, logFile, timeoutMs = 900000) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true })
  const fd = fs.openSync(logFile, 'w')
  try { return spawnSync('sh', ['-c', command], { cwd, stdio: ['ignore', fd, fd], timeout: timeoutMs }) } finally { fs.closeSync(fd) }
}
