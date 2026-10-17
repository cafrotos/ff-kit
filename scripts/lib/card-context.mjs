// Suy ra thẻ của phiên hiện tại: FF_CARD_ID (runner export) trước, sau đó cwd trong worktrees_dir/cards_dir `<id>-<slug>/...`,
// rồi session id Claude / tên phiên tmux (phiên legacy chạy ở gốc workspace, không có FF_CARD_ID).
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { readTask } from '../../ff-worker/src/core/task-store.mjs'

export function inferCardId(root, config, { env = process.env, cwd = process.cwd(), sessionId = '', tmuxSession = '' } = {}) {
  if (/^[A-Za-z0-9]+$/.test(env.FF_CARD_ID ?? '')) return env.FF_CARD_ID
  const abs = path.resolve(cwd)
  for (const base of [config?.workspace?.worktrees_dir, config?.workspace?.cards_dir].filter(Boolean)) {
    const rel = path.relative(path.resolve(root, base), abs)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue
    const m = /^([A-Za-z0-9]+)-/.exec(rel.split(path.sep)[0])
    if (m && readTask(root, m[1])) return m[1]
  }
  return bySession(root, config, { sessionId, tmuxSession })
}

function bySession(root, config, { sessionId, tmuxSession }) {
  let names = []
  try { names = fs.readdirSync(path.join(root, '.ff', 'tasks')).filter((n) => /^[A-Za-z0-9]+\.json$/.test(n)) } catch { return '' }
  if (sessionId) {
    for (const n of names) {
      let t; try { t = readTask(root, n.slice(0, -5)) } catch { continue }
      if (t?.claudeSessionId === sessionId) return t.cardId
    }
  }
  if (tmuxSession) {
    for (const n of names) {
      let t; try { t = readTask(root, n.slice(0, -5)) } catch { continue }
      if (t && (t.tmuxSession === tmuxSession || t.session === tmuxSession)) return t.cardId
    }
    const prefix = config?.worker?.tmux?.session_prefix ?? 'ff-'
    const m = tmuxSession.startsWith(prefix) ? /^([A-Za-z0-9]+)$/.exec(tmuxSession.slice(prefix.length)) : null
    if (m && readTask(root, m[1])) return m[1]
  }
  return ''
}

/** Tên phiên tmux đang chứa hook (chỉ khi chạy trong tmux); rỗng nếu không xác định. */
export function currentTmuxSession(env = process.env) {
  if (!env.TMUX) return ''
  try {
    const r = spawnSync('tmux', ['display-message', '-p', '#S'], { encoding: 'utf8', timeout: 2000, env })
    return r.status === 0 ? r.stdout.trim() : ''
  } catch { return '' }
}

/** Ngữ cảnh phiên đính kèm sự kiện để worker/người đọc xác định nguồn khi chưa biết thẻ. */
export function sessionFields(input, tmuxSession = '') {
  return Object.fromEntries(Object.entries({ session_id: input?.session_id, tmux: tmuxSession, cwd: input?.cwd }).filter(([, v]) => v))
}
