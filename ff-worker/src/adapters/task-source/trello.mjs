import { readEnvFile } from '../../core/env.mjs'

export class TrelloTaskSource {
  name = 'trello'
  #config
  #credentials
  #fetch
  #lists = new Map()
  #memberId
  #filterAssigned
  #log
  #warnedEmpty = false

  constructor({ config, envFile, fetchImpl = fetch, log }) {
    this.#config = config
    this.#credentials = readEnvFile(envFile)
    this.#fetch = fetchImpl
    this.#log = log
    // Mặc định an toàn: chỉ thẻ của người được giao, trừ khi config tắt tường minh.
    this.#filterAssigned = this.#config.filter_assigned_only ?? true
    for (const key of ['TRELLO_API_KEY', 'TRELLO_API_TOKEN']) {
      if (!this.#credentials[key]) throw new Error(`thiếu key ${key} trong secrets.env_file`)
    }
  }

  async #api(endpoint, { method = 'GET', body } = {}) {
    const url = new URL(`https://api.trello.com/1${endpoint}`)
    url.searchParams.set('key', this.#credentials.TRELLO_API_KEY)
    url.searchParams.set('token', this.#credentials.TRELLO_API_TOKEN)
    const response = await this.#fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error(`Trello API trả HTTP ${response.status}`)
    if (response.status === 204) return null
    return response.json()
  }

  // assignee: member id (24 hex) dùng trực tiếp; username được resolve một lần; trống → token owner.
  // Lỗi → throw (fail closed), không bao giờ quay về lấy mọi thẻ.
  async #assigneeId() {
    if (this.#memberId) return this.#memberId
    const who = String(this.#config.assignee ?? '').trim().replace(/^@/, '')
    let id
    if (who && /^[0-9a-f]{24}$/i.test(who)) id = who
    else if (who) id = (await this.#api(`/members/${encodeURIComponent(who)}?fields=id`))?.id
    else id = (await this.#api('/members/me?fields=id'))?.id
    if (!id) throw new Error('Trello không xác định được thành viên để lọc thẻ được giao')
    this.#memberId = id
    return id
  }

  async poll() {
    const lists = await this.#api(`/boards/${encodeURIComponent(this.#config.board_id)}/lists?fields=name,id`)
    const result = []
    this.#lists = new Map(lists.map((list) => [list.name.trim().toLowerCase(), list.id]))
    for (const listName of this.#config.poll_lists) {
      const listId = this.#lists.get(listName.trim().toLowerCase())
      if (!listId) continue
      const cards = await this.#api(`/lists/${encodeURIComponent(listId)}/cards?fields=name,desc,url,idShort,idMembers,labels,pos`)
      const memberId = this.#filterAssigned ? await this.#assigneeId() : null
      for (const card of cards) {
        if (this.#filterAssigned && !card.idMembers?.includes(memberId)) continue
        const dependsOn = parseDependsOn(card.desc)
        const waitingOn = dependsOn.length ? await this.#unmet(dependsOn) : []
        result.push({ id: String(card.idShort), trelloCardId: card.id, name: card.name, url: card.url, list: listName, pos: card.pos, labels: (card.labels ?? []).map((label) => label.name), ...(dependsOn.length ? { dependsOn, waitingOn } : {}) })
      }
    }
    if (this.#filterAssigned && result.length === 0 && !this.#warnedEmpty) {
      this.#warnedEmpty = true
      this.#log?.('[ff-worker] Trello: không có thẻ nào được giao cho bạn trong poll_lists (đang lọc theo thành viên)\n')
    }
    return result
  }

  /** Quy ước chung: dòng `Phụ thuộc: #12, #13` trong mô tả. Thẻ phụ thuộc xong khi ở done_list/accept_list. Lỗi tra cứu → coi là chưa xong (an toàn). */
  async #unmet(ids) {
    const done = [this.#config.done_list, this.#config.accept_list].filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim().toLowerCase())
    const out = []
    for (const dep of ids) {
      try {
        const [card, lists] = await Promise.all([
          this.#api(`/boards/${encodeURIComponent(this.#config.board_id)}/cards/${encodeURIComponent(dep)}?fields=idList`),
          this.#api(`/boards/${encodeURIComponent(this.#config.board_id)}/lists?fields=name,id`),
        ])
        const name = lists.find((l) => l.id === card.idList)?.name ?? ''
        if (!done.includes(name.trim().toLowerCase())) out.push(dep)
      } catch { out.push(dep) }
    }
    return out
  }

  /** `ff task list`: thẻ của một list (mặc định các poll_lists), không lọc theo thành viên. */
  async list(listName) {
    const names = listName ? [listName] : this.#config.poll_lists
    const lists = await this.#api(`/boards/${encodeURIComponent(this.#config.board_id)}/lists?fields=name,id`)
    this.#lists = new Map(lists.map((l) => [l.name.trim().toLowerCase(), l.id]))
    const out = []
    for (const name of names) {
      const id = this.#lists.get(String(name).trim().toLowerCase())
      if (!id) { if (listName) throw new Error(`Không tìm thấy list Trello '${name}'`); continue }
      const cards = await this.#api(`/lists/${encodeURIComponent(id)}/cards?fields=name,url,idShort,labels,pos`)
      for (const c of cards) out.push({ id: String(c.idShort), name: c.name, url: c.url, list: lists.find((l) => l.id === id).name, pos: c.pos, labels: (c.labels ?? []).map((l) => l.name) })
    }
    return out
  }

  /** `ff task show`: id là số ngắn (idShort) của thẻ trên board. */
  async get(id) {
    const card = await this.#api(`/boards/${encodeURIComponent(this.#config.board_id)}/cards/${encodeURIComponent(id)}?fields=name,desc,url,idShort,idList,labels`)
    const [lists, comments] = await Promise.all([
      this.#api(`/boards/${encodeURIComponent(this.#config.board_id)}/lists?fields=name,id`),
      this.readComments(card.id),
    ])
    const dependsOn = parseDependsOn(card.desc)
    return { id: String(card.idShort), name: card.name, url: card.url, list: lists.find((l) => l.id === card.idList)?.name ?? null, labels: (card.labels ?? []).map((l) => l.name), description: card.desc ?? '', dependsOn, waitingOn: dependsOn.length ? await this.#unmet(dependsOn) : [], comments }
  }

  /** `ff task create`: tạo thẻ vào list có sẵn (không tạo list). Phụ thuộc ghi thành dòng `Phụ thuộc: #x` cuối mô tả. */
  async create({ title, list, description = '', labels = [], dependsOn = [] }) {
    if (!String(title ?? '').trim()) throw new Error('thiếu tiêu đề thẻ')
    const target = list ?? this.#config.doing_list ?? this.#config.poll_lists?.[0]
    const idList = await this.#listId(target)
    const wanted = labels.map((l) => String(l).trim().toLowerCase()).filter(Boolean)
    let idLabels = []
    if (wanted.length) {
      const board = await this.#api(`/boards/${encodeURIComponent(this.#config.board_id)}/labels?fields=name,id`)
      idLabels = wanted.map((w) => board.find((l) => String(l.name).trim().toLowerCase() === w)?.id)
      const missing = wanted.filter((_, i) => !idLabels[i])
      if (missing.length) throw new Error(`Không tìm thấy label Trello: ${missing.join(', ')}`)
    }
    const deps = dependsOn.map((d) => String(d).replace(/^#/, '')).filter(Boolean)
    const desc = [String(description).trimEnd(), deps.length ? `Phụ thuộc: ${deps.map((d) => `#${d}`).join(', ')}` : ''].filter(Boolean).join('\n\n')
    const card = await this.#api('/cards', { method: 'POST', body: { idList, name: String(title).trim(), desc, ...(idLabels.length ? { idLabels } : {}) } })
    return { id: String(card.idShort), name: card.name, url: card.url, list: target, labels: labels }
  }

  /** Mọi comment của thẻ (phân trang), mới nhất trước. */
  async #commentActions(remoteId) {
    const all = [], seen = new Set()
    let before
    for (;;) {
      const page = await this.#api(`/cards/${encodeURIComponent(remoteId)}/actions?filter=commentCard&limit=100${before ? `&before=${encodeURIComponent(before)}` : ''}`)
      for (const action of page) if (!seen.has(action.id)) { seen.add(action.id); all.push(action) }
      if (page.length < 100) break
      const next = page.at(-1)?.id
      if (!next || next === before) throw new Error('Trello pagination stalled')
      before = next
    }
    return all
  }

  async fetchDossier(card) {
    return (await this.pullDossier(card)).text
  }

  /**
   * Kéo lại toàn bộ thẻ (tiêu đề, mô tả, checklist, MỌI comment). Trả về marker {at} của lần pull.
   */
  async pullDossier(card, { now = Date.now } = {}) {
    const remoteId = card.trelloCardId ?? card.id
    const [detail, checklists, actions] = await Promise.all([
      this.#api(`/cards/${encodeURIComponent(remoteId)}?fields=name,desc,url,idShort,labels`),
      this.#api(`/cards/${encodeURIComponent(remoteId)}/checklists`),
      this.#commentActions(remoteId),
    ])
    const chronological = actions.slice().sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')) || String(a.id).localeCompare(String(b.id)))
    const line = (action) => `- ${action.memberCreator?.fullName ?? 'Trello'} · ${String(action.date ?? '').slice(0, 10)}: ${String(action.data?.text ?? '').replace(/\r?\n/g, ' ')}`
    const lines = [
      `# Thẻ Trello ${detail.idShort}`,
    ]
    lines.push(
      '', '## Tiêu đề', detail.name ?? card.name ?? '',
      '', '## Mô tả (Description)', '', detail.desc?.trim() || '(Không có mô tả)',
      '', '## 🌿 Branch', '```text', `feature/${detail.idShort}-${slug(detail.name ?? card.name)}`, '```',
      '', '## Mô tả',
      ...(detail.desc?.trim() ? detail.desc.trim().split(/\r?\n/).map((l) => l || '') : ['(Không có mô tả)']),
      '', '## Loại', (detail.labels ?? []).map((label) => label.name).join(', ') || '(Chưa phân loại)',
      '', '## IT Note', '',
      '## Thông tin tiếp nhận', `Nguồn: ${detail.url ?? card.url ?? 'Trello'}`,
      '', '## Checklist', '### Acceptance Criteria',
    )
    for (const checklist of checklists) {
      lines.push(`#### ${checklist.name}`)
      for (const item of checklist.checkItems ?? []) lines.push(`- [${item.state === 'complete' ? 'x' : ' '}] ${item.name}`)
    }
    if (!checklists.length) lines.push('- [ ] Chưa có acceptance criteria trong Trello')
    lines.push('', '## Comments')
    for (const action of chronological) if (action.data?.text) lines.push(line(action))
    const marker = { at: new Date(typeof now === 'function' ? now() : now).toISOString() }
    return { text: `${lines.join('\n')}\n`, marker }
  }

  async readComments(id, { after } = {}) {
    const comments = [], seen = new Set()
    let before
    for (;;) {
      const actions = await this.#api(`/cards/${encodeURIComponent(id)}/actions?filter=commentCard&limit=100${before ? `&before=${encodeURIComponent(before)}` : ''}`)
      for (const action of actions) if (!seen.has(action.id)) {
        seen.add(action.id)
        if (!after || Date.parse(action.date) > Date.parse(after)) comments.push({ id: action.id, at: action.date, text: action.data?.text ?? '', author: action.memberCreator?.id ?? '' })
      }
      if (actions.length < 100 || (after && actions.every(a => Date.parse(a.date) <= Date.parse(after)))) break
      const next = actions.at(-1)?.id
      if (!next || next === before) throw new Error('Trello pagination stalled')
      before = next
    }
    return comments.sort((a,b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
  }

  async observeCard(id) {
    let card
    try {
      card = await this.#api(`/cards/${encodeURIComponent(id)}?fields=idList,desc,idMembers,closed`)
    } catch (error) {
      if (/HTTP 404/.test(error.message)) return { list: null, assignedToMe: false, closed: true, description: '', comments: [] }
      throw error
    }
    const [lists, comments, me] = await Promise.all([
      this.#api(`/boards/${encodeURIComponent(this.#config.board_id)}/lists?fields=name,id`),
      this.readComments(id),
      this.#filterAssigned ? this.#assigneeId() : null,
    ])
    this.#lists = new Map(lists.map(l => [l.name.trim().toLowerCase(), l.id]))
    return {
      list: lists.find(l => l.id === card.idList)?.name ?? null,
      // filter tắt → mọi thẻ trong poll đều coi là của worker
      assignedToMe: this.#filterAssigned ? Boolean(card.idMembers?.includes(me)) : true,
      closed: Boolean(card.closed),
      description: card.desc ?? '',
      comments,
    }
  }

  async #listId(name) {
    const key = String(name).trim().toLowerCase()
    if (!this.#lists.has(key)) {
      const lists = await this.#api(`/boards/${encodeURIComponent(this.#config.board_id)}/lists?fields=name,id`)
      this.#lists = new Map(lists.map(l => [l.name.trim().toLowerCase(), l.id]))
    }
    const id = this.#lists.get(key)
    if (!id) throw new Error(`Không tìm thấy list Trello '${name}'`)
    return id
  }

  /** Tên các list hiện có trên board (không bao giờ tạo list). */
  async listNames() {
    const lists = await this.#api(`/boards/${encodeURIComponent(this.#config.board_id)}/lists?fields=name,id`)
    this.#lists = new Map(lists.map(l => [l.name.trim().toLowerCase(), l.id]))
    return lists.map(l => l.name)
  }

  async moveCard(cardId, listName) {
    const idList = await this.#listId(listName)
    return this.#api(`/cards/${encodeURIComponent(cardId)}`, { method: 'PUT', body: { idList } })
  }

  async addComment(cardId, text) {
    return this.#api(`/cards/${encodeURIComponent(cardId)}/actions/comments`, { method: 'POST', body: { text: String(text) } })
  }

  async findComment(id, eventId) {
    return (await this.readComments(id)).find(c => c.text.includes(`[ff] ${eventId}`)) ?? null
  }

  async moveTo(id, status) {
    const listId = this.#lists.get(String(status).trim().toLowerCase())
    if (!listId) throw new Error(`Không tìm thấy list Trello '${status}'`)
    return this.#api(`/cards/${encodeURIComponent(id)}`, { method: 'PUT', body: { idList: listId } })
  }

  async comment(id, text) {
    return this.#api(`/cards/${encodeURIComponent(id)}/actions/comments`, { method: 'POST', body: { text: String(text) } })
  }
}

export function parseDependsOn(desc) {
  const m = /^\s*Phụ thuộc\s*:\s*(.+)$/im.exec(String(desc ?? ''))
  return m ? [...new Set([...m[1].matchAll(/#?(\d+)/g)].map((x) => x[1]))] : []
}

function slug(text) {
  return String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'task'
}
