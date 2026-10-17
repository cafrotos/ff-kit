import fs from 'node:fs'
import path from 'node:path'

const EXT = 'tsx?|jsx?|mjs|cjs|json|less|css|scss|sql|ya?ml|md|sh|html'
const REF_RE = new RegExp(`([\\w@.\\-/]+\\.(?:${EXT})):(\\d+)(?:-(\\d+))?`, 'g')

/** Copy under worktrees_dir when it exists (after `ff copy`), else the workspace root. */
export function refSearchRoot(root, config, cardDir) {
  const base = path.resolve(root, config.workspace.worktrees_dir, path.basename(cardDir))
  return fs.existsSync(base) ? base : root
}

/** Every `path:line[-line]` in text must name an existing file whose length covers the range. */
export function checkFileRefs(text, { searchRoot, repos, extraRoots = [] }) {
  const problems = []
  const refs = new Set([...text.matchAll(REF_RE)].map(m => m[0]))
  for (const ref of refs) {
    const [, raw, a, b] = ref.match(/^(.+):(\d+)(?:-(\d+))?$/)
    const from = Number(a), to = Number(b ?? a)
    const roots = [searchRoot, ...repos.map(repo => path.resolve(searchRoot, path.basename(repo.path)))]
    const inside = (base, file) => file.startsWith(base + path.sep)
    const candidates = [
      ...roots.map(dir => path.resolve(dir, raw)).filter(file => inside(searchRoot, file)),
      ...extraRoots.flatMap(dir => { const file = path.resolve(dir, raw); return inside(dir, file) ? [file] : [] }),
    ].filter(file => fs.existsSync(file) && fs.statSync(file).isFile())
    if (!candidates.length) { problems.push({ ref, reason: 'file không tồn tại' }); continue }
    const counts = candidates.map(file => { const s = fs.readFileSync(file, 'utf8'); return s.split('\n').length - (s.endsWith('\n') ? 1 : 0) })
    if (from < 1 || to < from || !counts.some(count => to <= count)) problems.push({ ref, reason: 'dòng ngoài file' })
  }
  return problems
}
