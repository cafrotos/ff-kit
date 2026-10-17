import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { resolveTrelloLists } from '../../../../scripts/lib/config.mjs'

export const LOCAL_DIR = 'ff-cards'
const norm = (v) => String(v ?? '').trim().toLowerCase()
const ID_RE = /^[0-9]+$/

/** Thư mục thẻ phải nằm trong workspace, không vào `.ff/` (agent không đọc/ghi được) và không thoát root. */
export function resolveLocalDir(root, dir = LOCAL_DIR) {
  const rel = String(dir ?? LOCAL_DIR).trim() || LOCAL_DIR
  if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new Error(`task_source.local.dir '${rel}' phải là đường dẫn tương đối trong workspace, không có '..'`)
  if (rel.split(/[\\/]/).filter(Boolean)[0] === '.ff') throw new Error('task_source.local.dir không được nằm trong .ff/ (agent không đọc/ghi được)')
  return path.resolve(root, rel)
}

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }

function atomicWrite(file, text) {
  const tmp = path.join(path.dirname(file), `.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`)
  fs.writeFileSync(tmp, text, { mode: 0o600 })
  fs.renameSync(tmp, file)
}

function parseCard(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) return { meta: {}, body: text }
  let meta = {}
  try { meta = YAML.parse(m[1]) ?? {} } catch { meta = {} }
  return { meta: meta && typeof meta === 'object' ? meta : {}, body: m[2] }
}

const strList = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map((x) => String(x).replace(/^#/, '').trim()).filter(Boolean)

const slug = (text) => String(text).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'task'

/**
 * TaskSource lưu thẻ dạng file trong workspace: `<dir>/<id>.md` (front-matter YAML + mô tả),
 * comment ở `<dir>/<id>.comments.jsonl`. Ghi atomic (tmp + rename) dưới khóa thư mục `.lock`.
 */
export class LocalTaskSource {
  name = 'local'
  #config
  #dir
  #root
  #log
  #now

  constructor({ config = {}, root, log, now = Date.now }) {
    this.#config = config
    this.#root = root
    this.#dir = resolveLocalDir(root, config.dir)
    this.#log = log
    this.#now = now
  }

  get dir() { return this.#dir }
  #iso() { return new Date(typeof this.#now === 'function' ? this.#now() : this.#now).toISOString() }

  #lock(fn) {
    fs.mkdirSync(this.#dir, { recursive: true, mode: 0o700 })
    const lock = path.join(this.#dir, '.lock')
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); break } catch (e) {
        if (e.code !== 'EEXIST') throw e
        try { if (Date.now() - fs.statSync(lock).mtimeMs > 30000) { fs.rmSync(lock, { recursive: true, force: true }); continue } } catch {}
        if (i > 200) throw new Error('không khóa được thư mục thẻ local (đang bị giữ)')
        sleepSync(25)
      }
    }
    try { return fn() } finally { fs.rmSync(lock, { recursive: true, force: true }) }
  }

  #file(id) {
    if (!ID_RE.test(String(id))) throw new Error(`ID thẻ local không hợp lệ: ${String(id).slice(0, 40)}`)
    return path.join(this.#dir, `${id}.md`)
  }

  #read(id) {
    let text
    try { text = fs.readFileSync(this.#file(id), 'utf8') } catch (e) { if (e.code === 'ENOENT') return null; throw e }
    const { meta, body } = parseCard(text)
    return {
      id: String(id), title: String(meta.title ?? `Thẻ ${id}`), list: String(meta.list ?? '').trim(),
      labels: strList(meta.labels), dependsOn: strList(meta.depends_on), created: meta.created ? String(meta.created) : null,
      updated: meta.updated ? String(meta.updated) : null, description: body.replace(/^\r?\n/, '').replace(/\s+$/, ''),
    }
  }

  #write(card) {
    const front = YAML.stringify({ id: Number(card.id), title: card.title, list: card.list, labels: card.labels, depends_on: card.dependsOn.map(Number), created: card.created, updated: card.updated }).trimEnd()
    atomicWrite(this.#file(card.id), `---\n${front}\n---\n\n${card.description ? `${card.description}\n` : ''}`)
  }

  #ids() {
    let names = []
    try { names = fs.readdirSync(this.#dir) } catch (e) { if (e.code !== 'ENOENT') throw e }
    return names.map((n) => /^([0-9]+)\.md$/.exec(n)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b).map(String)
  }

  #all() { return this.#ids().map((id) => this.#read(id)).filter(Boolean) }

  /** Tên các list đã cấu hình (poll/done/accept/reopen/park/doing/qa_fail). */
  listNames() {
    const c = this.#config
    const names = [...(c.poll_lists ?? []), c.done_list, c.accept_list, c.reopen_list, c.park_list, c.doing_list, c.qa_fail_list]
    const seen = new Set(), out = []
    for (const n of names) if (typeof n === 'string' && n.trim() && !seen.has(norm(n))) { seen.add(norm(n)); out.push(n.trim()) }
    return out
  }

  #canon(list) {
    const found = this.listNames().find((n) => norm(n) === norm(list))
    if (!found) throw new Error(`Không tìm thấy list '${list}' (đã cấu hình: ${this.listNames().join(', ') || 'không có'})`)
    return found
  }

  /** Thẻ phụ thuộc xong khi nằm ở done_list hoặc accept_list. */
  #doneLists() { return [this.#config.done_list, this.#config.accept_list].filter((n) => typeof n === 'string' && n.trim()).map(norm) }

  unmetDependencies(card) {
    const done = this.#doneLists()
    return strList(card.dependsOn).filter((dep) => {
      const dc = ID_RE.test(dep) ? this.#read(dep) : null
      return !dc || !done.includes(norm(dc.list))
    })
  }

  #view(c, listName) {
    return { id: c.id, name: c.title, url: path.relative(this.#root, this.#file(c.id)), list: listName ?? c.list, pos: Number(c.id), labels: c.labels, dependsOn: c.dependsOn, waitingOn: this.unmetDependencies(c) }
  }

  async poll() {
    const all = this.#all()
    const out = []
    for (const listName of this.#config.poll_lists ?? []) {
      for (const c of all) if (norm(c.list) === norm(listName)) out.push(this.#view(c, listName))
    }
    return out
  }

  /** Cho `ff task list/show`: mọi thẻ (hoặc một list). */
  async list(listName) {
    return this.#all().filter((c) => !listName || norm(c.list) === norm(listName)).map((c) => this.#view(c))
  }

  async get(id) {
    const c = this.#read(id)
    if (!c) return null
    return { ...this.#view(c), description: c.description, created: c.created, updated: c.updated, comments: await this.readComments(id) }
  }

  async create({ title, list, description = '', labels = [], dependsOn = [] }) {
    if (!String(title ?? '').trim()) throw new Error('thiếu tiêu đề thẻ')
    const target = list ? this.#canon(list) : (resolveTrelloLists(this.#config).doing ?? this.#config.poll_lists?.[0])
    if (!target) throw new Error('chưa có list mặc định (poll_lists trống)')
    const deps = strList(dependsOn)
    return this.#lock(() => {
      for (const d of deps) if (!ID_RE.test(d) || !this.#read(d)) throw new Error(`depends_on: không có thẻ #${d}`)
      let counter = 0
      try { counter = Number(fs.readFileSync(path.join(this.#dir, '.next-id'), 'utf8')) || 0 } catch {}
      const id = String(Math.max(counter, ...this.#ids().map(Number).map((n) => n + 1), 1))
      const now = this.#iso()
      this.#write({ id, title: String(title).trim(), list: this.#canon(target), labels: strList(labels), dependsOn: deps, created: now, updated: now, description: String(description).replace(/\s+$/, '') })
      atomicWrite(path.join(this.#dir, '.next-id'), `${Number(id) + 1}\n`)
      return this.#view(this.#read(id))
    })
  }

  async moveCard(id, listName) {
    const list = this.#canon(listName)
    return this.#lock(() => {
      const c = this.#read(id)
      if (!c) throw new Error(`Không tìm thấy thẻ #${id}`)
      this.#write({ ...c, list, updated: this.#iso() })
      return null
    })
  }

  async moveTo(id, status) { return this.moveCard(id, status) }

  async addComment(id, text, { author = 'ff' } = {}) {
    return this.#lock(() => {
      if (!this.#read(id)) throw new Error(`Không tìm thấy thẻ #${id}`)
      const file = path.join(this.#dir, `${id}.comments.jsonl`)
      let prev = ''
      try { prev = fs.readFileSync(file, 'utf8') } catch {}
      const n = prev.split('\n').filter(Boolean).length + 1
      const comment = { id: `${id}-c${n}`, at: this.#iso(), author, text: String(text) }
      atomicWrite(file, `${prev}${JSON.stringify(comment)}\n`)
      const c = this.#read(id)
      this.#write({ ...c, updated: comment.at })
      return comment
    })
  }

  async comment(id, text, options) { return this.addComment(id, text, options) }

  async readComments(id, { after } = {}) {
    let text = ''
    try { text = fs.readFileSync(path.join(this.#dir, `${ID_RE.test(String(id)) ? id : 'x'}.comments.jsonl`), 'utf8') } catch (e) { if (e.code !== 'ENOENT') throw e }
    const out = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const c = JSON.parse(line)
        if (!after || Date.parse(c.at) > Date.parse(after)) out.push({ id: String(c.id), at: String(c.at), text: String(c.text ?? ''), author: String(c.author ?? '') })
      } catch { /* dòng hỏng do sửa tay: bỏ qua */ }
    }
    return out.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
  }

  async findComment(id, eventId) {
    return (await this.readComments(id)).find((c) => c.text.includes(`[ff] ${eventId}`)) ?? null
  }

  async observeCard(id) {
    const c = ID_RE.test(String(id)) ? this.#read(id) : null
    if (!c) return { list: null, assignedToMe: false, closed: true, description: '', comments: [] }
    return { list: c.list || null, assignedToMe: true, closed: false, description: c.description, comments: await this.readComments(id) }
  }

  async fetchDossier(card) { return (await this.pullDossier(card)).text }

  async pullDossier(card, { now = this.#now } = {}) {
    const id = String(card.id)
    const c = this.#read(id)
    if (!c) throw new Error(`Không tìm thấy thẻ local #${id}`)
    const comments = await this.readComments(id)
    const desc = c.description.trim()
    const lines = [
      `# Thẻ local ${c.id}`,
      '', '## Tiêu đề', c.title,
      '', '## Mô tả (Description)', '', desc || '(Không có mô tả)',
      '', '## 🌿 Branch', '```text', `feature/${c.id}-${slug(c.title)}`, '```',
      '', '## Mô tả', ...(desc ? desc.split(/\r?\n/) : ['(Không có mô tả)']),
      '', '## Loại', c.labels.join(', ') || '(Chưa phân loại)',
      '', '## IT Note', '',
      '## Thông tin tiếp nhận', `Nguồn: ${path.relative(this.#root, this.#file(c.id))}`,
      ...(c.dependsOn.length ? [`Phụ thuộc: ${c.dependsOn.map((d) => `#${d}`).join(', ')}`] : []),
      '', '## Checklist', '### Acceptance Criteria', '- [ ] Chưa có acceptance criteria trong thẻ',
      '', '## Comments',
      ...comments.filter((x) => x.text).map((x) => `- ${x.author || 'ff'} · ${x.at.slice(0, 10)}: ${x.text.replace(/\r?\n/g, ' ')}`),
    ]
    const marker = { at: new Date(typeof now === 'function' ? now() : now).toISOString() }
    return { text: `${lines.join('\n')}\n`, marker }
  }
}
