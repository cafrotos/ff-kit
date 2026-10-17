// Suy ra thẻ của phiên hiện tại: FF_CARD_ID (runner export) trước, sau đó cwd trong worktrees_dir/cards_dir `<id>-<slug>/...`.
import path from 'node:path'
import { readTask } from '../../ff-worker/src/core/task-store.mjs'

export function inferCardId(root, config, { env = process.env, cwd = process.cwd() } = {}) {
  if (/^[A-Za-z0-9]+$/.test(env.FF_CARD_ID ?? '')) return env.FF_CARD_ID
  const abs = path.resolve(cwd)
  for (const base of [config?.workspace?.worktrees_dir, config?.workspace?.cards_dir].filter(Boolean)) {
    const rel = path.relative(path.resolve(root, base), abs)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue
    const m = /^([A-Za-z0-9]+)-/.exec(rel.split(path.sep)[0])
    if (m && readTask(root, m[1])) return m[1]
  }
  return ''
}
