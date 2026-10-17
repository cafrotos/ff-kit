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
      const cards = await this.#api(`/lists/${encodeURIComponent(listId)}/cards?fields=name,desc,url,idShort,idMembers,labels`)
      const memberId = this.#filterAssigned ? await this.#assigneeId() : null
      for (const card of cards) {
        if (this.#filterAssigned && !card.idMembers?.includes(memberId)) continue
        result.push({ id: String(card.idShort), trelloCardId: card.id, name: card.name, url: card.url, list: listName, labels: (card.labels ?? []).map((label) => label.name) })
      }
    }
    if (this.#filterAssigned && result.length === 0 && !this.#warnedEmpty) {
      this.#warnedEmpty = true
      this.#log?.('[ff-worker] Trello: không có thẻ nào được giao cho bạn trong poll_lists (đang lọc theo thành viên)\n')
    }
    return result
  }

  async fetchDossier(card) {
    const remoteId = card.trelloCardId ?? card.id
    const [detail, checklists, actions] = await Promise.all([
      this.#api(`/cards/${encodeURIComponent(remoteId)}?fields=name,desc,url,idShort,labels`),
      this.#api(`/cards/${encodeURIComponent(remoteId)}/checklists`),
      this.#api(`/cards/${encodeURIComponent(remoteId)}/actions?filter=commentCard&limit=100`),
    ])
    const lines = [
      `# Thẻ Trello ${detail.idShort}`,
      '', '## Tiêu đề', detail.name ?? card.name ?? '',
      '', '## Mô tả (Description)', '', detail.desc?.trim() || '(Không có mô tả)',
      '', '## 🌿 Branch', '```text', `feature/${detail.idShort}-${slug(detail.name ?? card.name)}`, '```',
      '', '## Mô tả',
      ...(detail.desc?.trim() ? detail.desc.trim().split(/\r?\n/).map((line) => line || '') : ['(Không có mô tả)']),
      '', '## Loại', (detail.labels ?? []).map((label) => label.name).join(', ') || '(Chưa phân loại)',
      '', '## IT Note', '',
      '## Thông tin tiếp nhận', `Nguồn: ${detail.url ?? card.url ?? 'Trello'}`,
      '', '## Checklist', '### Acceptance Criteria',
    ]
    for (const checklist of checklists) {
      lines.push(`#### ${checklist.name}`)
      for (const item of checklist.checkItems ?? []) lines.push(`- [${item.state === 'complete' ? 'x' : ' '}] ${item.name}`)
    }
    if (!checklists.length) lines.push('- [ ] Chưa có acceptance criteria trong Trello')
    lines.push('', '## Comments')
    for (const action of actions.slice().reverse()) {
      const comment = action.data?.text
      if (comment) lines.push(`- ${action.memberCreator?.fullName ?? 'Trello'} · ${String(action.date ?? '').slice(0, 10)}: ${comment.replace(/\r?\n/g, ' ')}`)
    }
    return `${lines.join('\n')}\n`
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

function slug(text) {
  return String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'task'
}
