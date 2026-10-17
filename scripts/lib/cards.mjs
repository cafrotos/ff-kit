import fs from 'node:fs'
import path from 'node:path'

export const CARD_ID_RE = /^[A-Za-z0-9]+$/

export function findCardDir(root, config, id) {
  if (!CARD_ID_RE.test(String(id))) return { error: `id thẻ không hợp lệ: ${id}` }
  const base = path.resolve(root, config.workspace.cards_dir)
  let names = []
  try {
    names = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {}
  const hits = names.filter((n) => n === id || n.startsWith(`${id}-`))
  if (!hits.length) return { error: `không thấy thư mục ${config.workspace.cards_dir}/${id}-*` }
  if (hits.length > 1) return { error: `nhiều thư mục khớp thẻ ${id}: ${hits.join(', ')}` }
  return { dir: path.join(base, hits[0]) }
}
