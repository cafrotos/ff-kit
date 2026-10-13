import { readEnvFile } from '../../core/env.mjs'

export class TrelloTaskSource {
  name = 'trello'
  #config
  #credentials
  #fetch
  #lists = new Map()
  #memberId

  constructor({ config, envFile, fetchImpl = fetch }) {
    this.#config = config
    this.#credentials = readEnvFile(envFile)
    this.#fetch = fetchImpl
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

  async poll() {
    const lists = await this.#api(`/boards/${encodeURIComponent(this.#config.board_id)}/lists?fields=name,id`)
    const result = []
    this.#lists = new Map(lists.map((list) => [list.name.trim().toLowerCase(), list.id]))
    for (const listName of this.#config.poll_lists) {
      const listId = this.#lists.get(listName.trim().toLowerCase())
      if (!listId) continue
      const cards = await this.#api(`/lists/${encodeURIComponent(listId)}/cards?fields=name,desc,url,idShort,idMembers,labels`)
      let memberId = this.#config.assignee
      if (this.#config.filter_assigned_only && !memberId) {
        this.#memberId ??= (await this.#api('/members/me?fields=id')).id
        memberId = this.#memberId
      }
      for (const card of cards) {
        if (this.#config.filter_assigned_only && !card.idMembers?.includes(memberId)) continue
        result.push({ id: String(card.idShort), trelloCardId: card.id, name: card.name, url: card.url, list: listName, labels: (card.labels ?? []).map((label) => label.name) })
      }
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
