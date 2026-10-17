import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

export class BusyError extends Error {
  constructor(file) {
    super(`File mutex busy: ${file}`)
    this.name = 'BusyError'
    this.file = file
  }
}

function readRecord(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (error) {
    if (error.code === 'ENOENT') return undefined
    if (error instanceof SyntaxError) return {}
    throw error
  }
}

function create(file, record) {
  const fd = fs.openSync(file, 'wx', 0o600)
  try {
    fs.writeFileSync(fd, `${JSON.stringify(record)}\n`)
    fs.fsyncSync(fd)
  } finally { fs.closeSync(fd) }
}

function ownerAlive(owner) {
  if (!owner || owner.hostname !== os.hostname() || !Number.isSafeInteger(owner.pid) || owner.pid < 1) return undefined
  try { process.kill(owner.pid, 0); return true } catch (error) {
    // EPERM, foreign hosts and invalid records are not evidence of death.
    return error.code === 'ESRCH' ? false : undefined
  }
}

// Every cooperating create/reclaim/release passes through this short guard. An
// interrupted/unknown guard is deliberately blocked, never guessed stale.
async function guarded(file, action, wait = false) {
  const guard = `${file}.guard`
  const token = randomUUID()
  const deadline = Date.now() + 2000
  for (;;) {
    try { create(guard, { token }); break } catch (error) {
      if (error.code !== 'EEXIST') throw error
      if (!wait || Date.now() >= deadline) throw new BusyError(file)
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  try { return await action() } finally {
    if (readRecord(guard)?.token === token) fs.unlinkSync(guard)
  }
}

/**
 * Exclusive, non-reentrant mutex. A slug is metadata, never ownership identity.
 * The current process PID and hostname are authoritative over caller metadata.
 * isOwnerAlive(owner) must return exactly false to prove a previous owner dead;
 * true, unknown values and errors all fail closed.
 */
export async function withFileMutex(file, owner, action, { isOwnerAlive = ownerAlive } = {}) {
  if (!owner || typeof owner !== 'object' || Array.isArray(owner)) throw new TypeError('Mutex owner must be an object')
  const record = { owner: { ...owner, pid: process.pid, hostname: os.hostname() }, token: randomUUID() }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  await guarded(file, async () => {
    const previous = readRecord(file)
    if (previous !== undefined) {
      let alive
      if (typeof previous?.token === 'string' && previous.token && previous.owner && typeof previous.owner === 'object') {
        try { alive = await isOwnerAlive(previous.owner) } catch { /* unknown ownership stays blocked */ }
      }
      if (alive !== false) throw new BusyError(file)
      fs.unlinkSync(file)
    }
    create(file, record)
  })
  try { return await action() } finally {
    await guarded(file, () => {
      if (readRecord(file)?.token === record.token) fs.unlinkSync(file)
    }, true)
  }
}

/** Bounded acquisition retries for short local storage transactions only. */
export async function withFileMutexRetry(file, owner, action) {
  const deadline = Date.now() + 2000
  for (;;) {
    let entered = false
    try {
      return await withFileMutex(file, owner, () => { entered = true; return action() })
    } catch (error) {
      if (!(error instanceof BusyError) || entered || Date.now() >= deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
}
