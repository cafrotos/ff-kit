import fs from 'node:fs'
import path from 'node:path'
import { writeWorkerStatus } from './status.mjs'

export function watchConfig({ root, configFile, envFile, lockFile, debounceMs = 2000, loadCandidate, onValid, channel, initialStatus, log = (s) => process.stderr.write(s) }) {
  const targets = [configFile, envFile, lockFile].filter(Boolean).map((file) => path.resolve(file))
  const byDir = new Map()
  for (const file of targets) {
    const dir = path.dirname(file)
    if (!byDir.has(dir)) byDir.set(dir, new Set())
    byDir.get(dir).add(path.basename(file))
  }
  let timer
  let closed = false
  let running = false
  const watchers = [...byDir].map(([dir, names]) => fs.watch(dir, (_event, name) => {
    if (name && !names.has(String(name))) return
    clearTimeout(timer)
    timer = setTimeout(check, debounceMs)
  }))

  async function check() {
    if (closed || running) return
    running = true
    try {
      const candidate = await loadCandidate()
      const errors = candidate.errors ?? []
      if (errors.length) {
        const status = { ...initialStatus(), config_state: 'rejected', config_errors: errors.map((e) => String(e).slice(0, 240)), updatedAt: new Date().toISOString() }
        writeWorkerStatus(root, status)
        await channel.notify({ kind: 'error', title: 'Config mới không hợp lệ; worker tiếp tục dùng config cũ', body: errors.join('\n') })
        return
      }
      writeWorkerStatus(root, { ...initialStatus(), state: 'restarting', config_state: 'accepted', updatedAt: new Date().toISOString() })
      await onValid(candidate)
    } catch (e) {
      log(`[ff-worker] kiểm tra config mới lỗi (${e.message}); tiếp tục dùng config cũ\n`)
      try { await channel.notify({ kind: 'error', title: 'Không thể kiểm tra config mới; worker tiếp tục dùng config cũ' }) } catch {}
    } finally { running = false }
  }

  return {
    close() { closed = true; clearTimeout(timer); for (const watcher of watchers) watcher.close() },
    check,
  }
}
