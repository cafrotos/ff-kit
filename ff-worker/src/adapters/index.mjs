import { assertChannel, assertTaskSource } from './types.mjs'
import { makeConsoleChannel } from './channel/console.mjs'
import { RocketChatChannel } from './channel/rocketchat.mjs'
import { TrelloTaskSource } from './task-source/trello.mjs'
import path from 'node:path'

export function makeChannel(config, output = process.stdout, { envFile, fetchImpl } = {}) {
  const adapter = config?.channel?.adapter ?? 'console'
  if (adapter === 'console') return assertChannel(makeConsoleChannel(output))
  if (adapter === 'rocketchat') {
    if (!envFile) throw new Error('rocketchat cần secrets.env_file')
    return assertChannel(new RocketChatChannel({ envFile, fetchImpl }))
  }
  throw new Error(`Không hỗ trợ channel adapter '${adapter}'. Adapter hiện có: console`)
}

export function makeTaskSource(config, adapters = {}) {
  const adapter = config?.task_source?.adapter
  if (!adapter) throw new Error('Thiếu worker.task_source.adapter; không thể tạo task source')
  const source = adapters[adapter]
  if (!source) throw new Error(`Không hỗ trợ task source adapter '${adapter}'.`)
  return assertTaskSource(source)
}

export function createAdapters({ root, config, output = process.stdout, fetchImpl } = {}) {
  const envFile = path.resolve(root, config.secrets.env_file)
  const worker = config.worker
  let sourceAdapters = {}
  if (worker.task_source?.adapter === 'trello') {
    sourceAdapters.trello = new TrelloTaskSource({ config: worker.task_source.trello, envFile, fetchImpl })
  }
  return {
    source: makeTaskSource(worker, sourceAdapters),
    channel: makeChannel(worker, output, { envFile, fetchImpl }),
  }
}
