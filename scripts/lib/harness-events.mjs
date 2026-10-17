import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { assertHarnessEvent } from './harness-contracts.mjs'
import { withFileMutexRetry } from './file-mutex.mjs'

function inbox(root, cardId) {
  if (typeof cardId !== 'string' || !/^[A-Za-z0-9]+$/.test(cardId)) throw new TypeError('Invalid cardId')
  return path.join(root, '.ff', 'harness', 'inbox', cardId)
}

export async function appendHarnessEvent(root, event) {
  // Snapshot before the first await so callers cannot change the persisted scope.
  const normalized = assertHarnessEvent(structuredClone(event))
  const dir = inbox(root, normalized.cardId)
  const digest = createHash('sha256').update(normalized.eventId).digest('hex')
  const target = path.join(dir, `${digest}.json`)
  return withFileMutexRetry(`${dir}.lock`, { operation: 'event-append' }, () => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    if (fs.existsSync(target)) {
      // A corrupt occupied identity is not successful delivery, and is never
      // overwritten with new evidence under the same eventId.
      const previous = assertHarnessEvent(JSON.parse(fs.readFileSync(target, 'utf8')))
      if (previous.eventId !== normalized.eventId || previous.cardId !== normalized.cardId) throw new Error('Event identity mismatch')
      return { stored: false, eventId: normalized.eventId }
    }
    const temp = `${target}.${randomUUID()}.tmp`
    try {
      const fd = fs.openSync(temp, 'wx', 0o600)
      try { fs.writeFileSync(fd, `${JSON.stringify(normalized)}\n`); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      fs.renameSync(temp, target)
    } finally { fs.rmSync(temp, { force: true }) }
    return { stored: true, eventId: normalized.eventId }
  })
}

/** Incomplete temp files and malformed/foreign final records are ignored. */
export function listHarnessEvents(root, cardId) {
  const dir = inbox(root, cardId)
  let names
  try { names = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort() } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const events = []
  const seen = new Set()
  for (const name of names) {
    let event
    try { event = assertHarnessEvent(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))) } catch (error) {
      if (error instanceof SyntaxError || error instanceof TypeError || error.code === 'ENOENT') continue
      throw error
    }
    if (event.cardId !== cardId || seen.has(event.eventId)) continue
    seen.add(event.eventId)
    events.push(event)
  }
  return events.sort((a, b) => a.at.localeCompare(b.at) || a.eventId.localeCompare(b.eventId))
}
