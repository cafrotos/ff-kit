import { readEnvFile } from '../../core/env.mjs'
import { formatEvent } from './console.mjs'

export class RocketChatChannel {
  name = 'rocketchat'
  #credentials
  #fetch

  constructor({ envFile, fetchImpl = fetch }) {
    this.#credentials = readEnvFile(envFile)
    this.#fetch = fetchImpl
    for (const key of ['RC_URL', 'RC_USER_ID', 'RC_AUTH_TOKEN', 'RC_ROOM_ID']) {
      if (!this.#credentials[key]) throw new Error(`thiếu key ${key} trong secrets.env_file`)
    }
  }

  async notify(event) {
    const base = this.#credentials.RC_URL.replace(/\/+$/, '')
    const response = await this.#fetch(`${base}/api/v1/chat.postMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-User-Id': this.#credentials.RC_USER_ID, 'X-Auth-Token': this.#credentials.RC_AUTH_TOKEN },
      body: JSON.stringify({ roomId: this.#credentials.RC_ROOM_ID, text: formatMessage(event) }),
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error(`Rocket.Chat trả HTTP ${response.status}`)
    const result = await response.json()
    if (result.success === false) throw new Error('Rocket.Chat không nhận thông báo')
  }
}

export function formatMessage(event) {
  return formatEvent(event)
}
