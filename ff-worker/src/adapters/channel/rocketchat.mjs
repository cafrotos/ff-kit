import fs from 'node:fs'
import path from 'node:path'
import { readEnvFile } from '../../core/env.mjs'
import { readTask } from '../../core/task-store.mjs'
import { formatEvent } from './console.mjs'
import { BusyError, withFileMutexRetry } from '../../../../scripts/lib/file-mutex.mjs'

// Giới hạn Rocket.Chat UI blocks.
const SECTION_MAX = 2500
const BLOCKS_PER_MESSAGE = 7
const CHARS_PER_MESSAGE = 15000
const FALLBACK_MAX = 2000
const FENCE = '```'

class RcError extends Error {
  constructor(message, status) { super(message); this.status = status }
}

const safeName = (cardId) => String(cardId).replace(/[^A-Za-z0-9._-]/g, '_')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function splitRaw(text, max) {
  const chunks = []
  let current = ''
  const flush = () => { if (current) { chunks.push(current); current = '' } }
  const append = (piece, sep) => {
    if (!current) { current = piece; return }
    if (current.length + sep.length + piece.length <= max) current += sep + piece
    else { flush(); current = piece }
  }
  for (const line of text.split('\n')) {
    if (line.length <= max) { append(line, '\n'); continue }
    flush()
    for (const word of line.split(' ')) {
      if (word.length <= max) { append(word, ' '); continue }
      flush()
      for (let i = 0; i < word.length; i += max) chunks.push(word.slice(i, i + max))
    }
    flush()
  }
  flush()
  return chunks
}

/** Tách text thành các section ≤ max ký tự (theo dòng, rồi từ), giữ cặp ``` cân bằng. */
export function splitSections(text, max = SECTION_MAX) {
  if (text.length <= max) return [text]
  const raw = splitRaw(text, text.includes(FENCE) ? max - 2 * FENCE.length - 2 : max)
  let open = false
  return raw.map((chunk) => {
    let out = open ? `${FENCE}\n${chunk}` : chunk
    for (const line of chunk.split('\n')) if (line.trimStart().startsWith(FENCE)) open = !open
    if (open) out += `\n${FENCE}`
    return out
  })
}

function groupBlocks(sections) {
  const messages = []
  let group = []
  let size = 0
  for (const text of sections) {
    if (group.length && (group.length >= BLOCKS_PER_MESSAGE || size + text.length > CHARS_PER_MESSAGE)) { messages.push(group); group = []; size = 0 }
    group.push(text)
    size += text.length
  }
  if (group.length) messages.push(group)
  return messages
}

const fallback = (text) => (text.length > FALLBACK_MAX ? `${text.slice(0, FALLBACK_MAX - 1)}…` : text)

export class RocketChatChannel {
  name = 'rocketchat'
  #credentials
  #fetch
  #root
  #threadsDir
  #threadPerTask
  #delayMs
  #log
  #pending = new Map()

  // root: thư mục workspace; thread được lưu ở <root>/.ff/channel/threads/<cardId>.json
  constructor({ envFile, fetchImpl = fetch, root, threadsDir, threadPerTask = true, delayMs = 350, log }) {
    this.#credentials = readEnvFile(envFile)
    this.#fetch = fetchImpl
    this.#root = root
    this.#threadsDir = threadsDir ?? (root ? path.join(root, '.ff', 'channel', 'threads') : undefined)
    this.#threadPerTask = threadPerTask !== false && Boolean(this.#threadsDir)
    this.#delayMs = delayMs
    this.#log = log
    for (const key of ['RC_URL', 'RC_USER_ID', 'RC_AUTH_TOKEN', 'RC_ROOM_ID']) {
      if (!this.#credentials[key]) throw new Error(`thiếu key ${key} trong secrets.env_file`)
    }
  }

  async #post(payload) {
    const base = this.#credentials.RC_URL.replace(/\/+$/, '')
    const response = await this.#fetch(`${base}/api/v1/chat.postMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-User-Id': this.#credentials.RC_USER_ID, 'X-Auth-Token': this.#credentials.RC_AUTH_TOKEN },
      body: JSON.stringify({ roomId: this.#credentials.RC_ROOM_ID, ...payload }),
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new RcError(`Rocket.Chat trả HTTP ${response.status}`, response.status)
    const result = await response.json()
    if (result.success === false) throw new RcError('Rocket.Chat không nhận thông báo', 400)
    return result
  }

  // Gửi text đã render dưới dạng UI blocks; tin dài chia nhiều tin liên tiếp (cùng tmid nếu có).
  // Chỉ tin đầu được phép kích hoạt recovery tmid (onFirstReject trả tmid mới).
  async #sendText(text, tmid, onFirstReject) {
    const messages = groupBlocks(splitSections(text))
    for (let i = 0; i < messages.length; i++) {
      if (i > 0 && this.#delayMs > 0) await sleep(this.#delayMs)
      const group = messages[i]
      const payload = {
        text: fallback(group.join('\n')),
        attachments: [{ blocks: group.map((section) => ({ type: 'section', text: { type: 'mrkdwn', text: section } })) }],
      }
      if (tmid) payload.tmid = tmid
      try {
        await this.#post(payload)
      } catch (error) {
        if (i !== 0 || !tmid || !onFirstReject || !(error instanceof RcError) || error.status !== 400) throw error
        tmid = await onFirstReject()
        await this.#post({ ...payload, tmid })
      }
    }
  }

  #file(cardId) { return path.join(this.#threadsDir, `${safeName(cardId)}.json`) }

  #load(cardId) {
    try {
      const record = JSON.parse(fs.readFileSync(this.#file(cardId), 'utf8'))
      if (record?.roomId === this.#credentials.RC_ROOM_ID && typeof record.tmid === 'string' && record.tmid) return record.tmid
    } catch {}
    return undefined
  }

  #save(cardId, tmid) {
    fs.mkdirSync(this.#threadsDir, { recursive: true, mode: 0o700 })
    const file = this.#file(cardId)
    const tmp = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify({ cardId: String(cardId), roomId: this.#credentials.RC_ROOM_ID, tmid })}\n`, { mode: 0o600 })
    fs.renameSync(tmp, file)
  }

  #cardName(event) {
    const direct = event.cardTitle ?? event.fields?.cardTitle
    if (direct) return String(direct)
    try {
      const task = this.#root ? readTask(this.#root, event.taskId) : null
      return task?.name ?? task?.cardTitle ?? task?.slug ?? ''
    } catch { return '' }
  }

  async #createRoot(event) {
    const cardId = String(event.taskId)
    const name = this.#cardName(event)
    const result = await this.#post({ text: `[#${cardId}]${name ? ` ${name}` : ''}` })
    const tmid = result?.message?._id
    if (!tmid) throw new Error('Rocket.Chat không trả id tin gốc của thread')
    this.#save(cardId, tmid)
    return tmid
  }

  // Trả tmid hiện có hoặc tạo root (một lần dù nhiều tiến trình/instance gọi đồng thời).
  async #ensureThread(event, { stale } = {}) {
    const cardId = String(event.taskId)
    const known = this.#load(cardId)
    if (known && known !== stale) return known
    const deadline = Date.now() + 12000
    for (;;) {
      try {
        return await withFileMutexRetry(path.join(this.#threadsDir, `${safeName(cardId)}.lock`), { name: 'rocketchat-thread', cardId }, async () => {
          const again = this.#load(cardId)
          if (again && again !== stale) return again
          return this.#createRoot(event)
        })
      } catch (error) {
        if (!(error instanceof BusyError) || Date.now() >= deadline) throw error
      }
    }
  }

  async #notifyInThread(event, text) {
    const tmid = await this.#ensureThread(event)
    // tmid bị từ chối → tạo lại root đúng một lần; lỗi khác giữ ngữ nghĩa cũ (throw, không gửi lại).
    await this.#sendText(text, tmid, () => this.#ensureThread(event, { stale: tmid }))
  }

  async notify(event) {
    const text = formatMessage(event)
    // Không rõ thẻ: không bao giờ bỏ (đặc biệt cảnh báo quyền/chờ nhập); gửi ra kênh chính, formatMessage đã kèm session/cwd.
    if (!event?.taskId || !this.#threadPerTask) {
      await this.#sendText(text)
      return
    }
    const key = String(event.taskId)
    const previous = this.#pending.get(key) ?? Promise.resolve()
    const run = previous.catch(() => {}).then(() => this.#notifyInThread(event, text))
    const tail = run.catch(() => {})
    this.#pending.set(key, tail)
    try { await run } finally { if (this.#pending.get(key) === tail) this.#pending.delete(key) }
  }
}

export function formatMessage(event) {
  return formatEvent(event)
}
