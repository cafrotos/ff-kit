// Luật chặn dùng chung cho Claude Code, OpenCode, agy. Đọc repo/worktree/e2e từ ff.config.yaml.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { tokenize, stripHeredocs, segments, stripPrefix, headTokens } from './shell.mjs'
import { realish } from './paths.mjs'

const SHIP_MARKER_TTL_S = 2 * 60 * 60
const ALLOW_TTL_S = 4 * 60 * 60
export const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'edit', 'write', 'patch', 'multiedit', 'replace_file_content', 'multi_replace_file_content', 'write_to_file']
const WRITE_VERB_RE = /\bsed\s+(?:-\w*i|--in-place)|\bperl\s+-\w*i|\btee\b|\bcp\b|\bmv\b|\brm\b|\bchmod\b|\bchflags\b|\btruncate\b/
const WRAPPER_RE = /\b(?:ba|z)?sh\s+-\w*c\b|\beval\b|\$\(|`|\bxargs\b/
const FF_EXEMPT_RE = /(?:^|[\s/])ff\s+(?:relock|lock-tests)\b/
const FF_ASK_RE = /(?:^|[\s/])ff\s+(?:ship-approve|relock)\b/

const under = (p, dir) => (p + path.sep).startsWith(dir + path.sep)
const expandHome = (p) => (p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p)
const unanchor = (s) => s.replace(/^\^/, '').replace(/\$$/, '')
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function makeGuard(rootIn, config) {
  const root = realish(rootIn)
  const g = config.guard
  const relWt = config.workspace.worktrees_dir
  const worktrees = path.resolve(root, relWt)
  const repoRoots = [...config.repos.map((r) => r.path), ...(g.protected_paths ?? [])].map((p) => path.resolve(root, p))
  const str = (v) => (typeof v === 'string' && v ? v : null)
  const e2eDir = str(config.e2e?.dir) ? path.resolve(root, config.e2e.dir) : null
  const e2eTests = str(config.e2e?.tests_dir) ? path.resolve(root, config.e2e.tests_dir) : null
  const testsRel = e2eDir && e2eTests ? path.relative(e2eDir, e2eTests).split(path.sep).join('/') : null
  const migRe = new RegExp(g.migration_script_re)
  const prodRe = new RegExp(g.forbidden_script_re)
  const allowedBash = (g.allowed_bash ?? []).map((s) => new RegExp(s))
  const forbiddenRes = [
    /\bgit\s+(?:-C\s+\S+\s+)?push\b/,
    /\bgit\s+(?:-C\s+\S+\s+)?stash\b/,
    /\bgit\s+(?:-C\s+\S+\s+)?add\s+(?:-A|--all|\.)(?=\s|$|["'`)])/,
    /\bcommit\s+(?:-a\w*|--all)(?=\s|$|["'`)])/,
    /(?:^|[\s;&|`("'])(?:kill|pkill|killall)(?=\s|$|["'`)])/,
    new RegExp(unanchor(g.migration_script_re)),
    new RegExp(unanchor(g.forbidden_script_re) + '\\b'),
  ]

  const resolveDir = (base, p) => realish(path.resolve(base, expandHome(p)))
  const inRootRepo = (p) => repoRoots.some((r) => under(p, r))
  const inWorktree = (p) => under(p, worktrees)
  const slugOf = (p) => {
    if (inWorktree(p)) return path.relative(worktrees, p).split(path.sep)[0] || null
    if (e2eTests && under(p, e2eTests)) {
      const parts = path.relative(e2eTests, p).split(path.sep)
      return parts.length > 1 && /^[A-Za-z0-9]+-.+$/.test(parts[0]) ? parts[0] : null
    }
    return null
  }
  const idOf = (slug) => (slug ? slug.split('-')[0] : '<id>')
  const isEdit = (tool) => !tool || EDIT_TOOLS.includes(tool)

  const lockedOf = (slug) => {
    try {
      return fs.readFileSync(path.join(worktrees, slug, '.ff-test-lock'), 'utf8').split('\n')
        .map((l) => l.match(/^[0-9a-f]{64}\s{2}(.+)$/)).filter(Boolean).map((m) => path.join(root, m[1]))
    } catch {
      return []
    }
  }
  const allLocked = () => {
    let slugs = []
    try { slugs = fs.readdirSync(worktrees) } catch {}
    return slugs.flatMap(lockedOf)
  }
  const lockMsg = (slug) => `file test đã khóa; đổi qua: ff relock ${idOf(slug)} --reason "…" (cần user cho phép)`

  function checkLockedFile(tool, abs) {
    if (!isEdit(tool)) return null
    const slug = slugOf(abs)
    if (!slug) return null
    return lockedOf(slug).includes(abs) ? lockMsg(slug) : null
  }

  function checkAllowlist(tool, abs) {
    if (!isEdit(tool) || !inWorktree(abs)) return null
    const slug = slugOf(abs)
    if (!slug) return null
    let lines
    try { lines = fs.readFileSync(path.join(worktrees, slug, '.ff-allow'), 'utf8').split('\n') } catch { return null }
    const ts = Number((lines[0] ?? '').match(/^ts=(\d+)$/)?.[1])
    if (!Number.isFinite(ts) || Date.now() / 1000 - ts > ALLOW_TTL_S) return null
    const rel = path.relative(path.join(worktrees, slug), abs).split(path.sep).join('/')
    if (lines.slice(1).map((l) => l.trim()).filter(Boolean).includes(rel)) return null
    return `file ngoài allowlist của đợt; thêm qua: ff allow ${idOf(slug)} <file>`
  }

  function checkLockedBash(cmd, cwd) {
    const locked = allLocked()
    if (!locked.length) return null
    for (const seg of segments(cmd)) {
      if (FF_EXEMPT_RE.test(seg)) continue
      const hits = locked.filter((l) => seg.includes(l) || seg.includes(path.relative(root, l)) || seg.includes(path.basename(l)))
      if (!hits.length) continue
      const redirects = [...seg.matchAll(/(?<![\d&=-])>>?\s*(\S+)/g)].map((m) => m[1].replace(/^['"]|['"]$/g, ''))
      const redirHit = redirects.some((t) => hits.some((l) => realish(path.resolve(cwd, t)) === l || path.basename(t) === path.basename(l)))
      if (redirHit || WRITE_VERB_RE.test(seg)) return lockMsg(slugOf(hits[0]))
    }
    return null
  }

  function parseGit(tokens, dir) {
    let gitDir = dir
    let i = 1
    while (i < tokens.length && tokens[i].startsWith('-')) {
      if (tokens[i] === '-C') gitDir = resolveDir(gitDir, tokens[++i] ?? '.')
      else if (tokens[i] === '-c') i++
      i++
    }
    return { sub: tokens[i], args: tokens.slice(i + 1), gitDir }
  }

  function shipApproved(dir) {
    const slug = slugOf(dir)
    if (!slug || !inWorktree(dir)) return { ok: false, why: `lệnh không chạy trong ${relWt}/<id>-<slug>/` }
    const marker = path.join(worktrees, slug, '.ff-ship-approved')
    if (!fs.existsSync(marker)) return { ok: false, why: `chưa có ${path.relative(root, marker)}`, slug }
    const ts = Number(fs.readFileSync(marker, 'utf8').trim().split(/\s+/)[0])
    const age = Date.now() / 1000 - ts
    if (!Number.isFinite(age) || age > SHIP_MARKER_TTL_S) return { ok: false, why: 'marker ship đã quá 2 giờ', slug }
    return { ok: true }
  }

  function checkWrapped(cmd) {
    const body = stripHeredocs(cmd)
    if (!WRAPPER_RE.test(body)) return null
    if (!forbiddenRes.some((re) => re.test(body))) return null
    return 'chạy lệnh trực tiếp, không bọc trong bash -c/eval/$(…)'
  }

  function checkBash(cmd, cwd, mode) {
    const wrapped = checkWrapped(cmd)
    if (wrapped) return wrapped
    let dir = cwd
    for (const seg of segments(cmd)) {
      const tokens = headTokens(seg)
      if (!tokens.length) continue
      const [head] = tokens
      if (head === 'cd') {
        dir = resolveDir(dir, tokens[1] ?? os.homedir())
        continue
      }
      if (allowedBash.some((re) => re.test(seg))) continue

      if (mode === 'base') {
        const killAt = tokens.findIndex((t, i) => ['kill', 'pkill', 'killall'].includes(t) && (i === 0 || tokens[0] === 'xargs'))
        if (killAt >= 0 && !(tokens[killAt] === 'kill' && tokens[killAt + 1] === '-0'))
          return 'Không kill/pkill trực tiếp. Tắt service bằng `ff verify-down <id>`; tiến trình của repo gốc/task khác → báo user.'

        const runsScript = ['yarn', 'npm', 'npx', 'pnpm', 'typeorm', 'ts-node'].includes(head)
        const migTok = runsScript && tokens.find((t) => migRe.test(t.replace(prodRe, '')))
        if (migTok) {
          if (prodRe.test(migTok)) return `Cấm chạy ${migTok} từ agent.`
          const cwdFlag = tokens.indexOf('--cwd')
          const target = cwdFlag >= 0 ? resolveDir(dir, tokens[cwdFlag + 1] ?? '.') : dir
          if (!inWorktree(target))
            return `${migTok} chỉ được chạy trong ${relWt}/<id>-<slug>/<repo> (DB dùng chung). Dùng \`ff verify-up <id> <app>\`.`
        }

        if (e2eDir && testsRel) {
          const pwAt = tokens.findIndex((t, i) => /(^|\/)playwright$/.test(t) && tokens[i + 1] === 'test')
          const bareTest = dir === e2eDir && ['yarn', 'npm', 'pnpm'].includes(head) && (tokens[1] === 'test' || (tokens[1] === 'run' && tokens[2] === 'test'))
          if (pwAt >= 0 || bareTest) {
            const rest = pwAt >= 0 ? tokens.slice(pwAt + 2) : tokens.slice(2)
            const pathRe = new RegExp(`(^|/)${escapeRe(testsRel)}/[^/\\s]+`)
            if (!rest.some((t) => pathRe.test(t)))
              return `Chạy Playwright phải kèm path: \`npx playwright test ${testsRel}/<id>-<slug>/\`. Lệnh trần quét cả thẻ cũ và fail trên dữ liệu cũ.`
          }
        }
      }

      if (head !== 'git') continue
      const { sub, args, gitDir } = parseGit(tokens, dir)

      if (mode === 'base') {
        if (sub === 'push') {
          const s = shipApproved(gitDir)
          if (!s.ok)
            return `Cấm git push (${s.why}). Chỉ push qua /ship-to-dev SAU KHI user xác nhận, rồi chạy \`ff ship-approve ${s.slug ? idOf(s.slug) : '<id>'}\` (user sẽ được hỏi). "Chạy/ok/verify PASS" không phải lệnh push.`
        }
        if (sub === 'add' && args.some((t) => ['-A', '--all', '.', ':/', '-u', '--update'].includes(t)))
          return 'Cấm `git add -A/./-u` — chỉ add đúng từng file của task (tránh cuốn .env, file build, file task khác).'
        if (sub === 'commit' && args.some((t) => t === '--all' || /^-[A-Za-z]*a[A-Za-z]*$/.test(t)))
          return 'Cấm `git commit -a` — add đúng từng file của task rồi commit.'
        if (sub === 'stash' && !['list', 'show'].includes(args[0]))
          return 'Cấm `git stash` — stash ẩn việc dở của user. Cây bẩn thì dừng và báo user.'
      }

      if (mode === 'feature-flow' && inRootRepo(gitDir) && !inWorktree(gitDir)) {
        const writes = ['commit', 'reset', 'rebase', 'merge', 'cherry-pick', 'am', 'apply', 'revert']
        const newBranch = (sub === 'checkout' && args.some((t) => t === '-b' || t === '-B')) || (sub === 'switch' && args.some((t) => t === '-c' || t === '-C'))
        if (writes.includes(sub) || newBranch)
          return `Repo gốc ${path.relative(root, gitDir) || '.'} chỉ là bản gương — không \`git ${sub}\` ở đây. Làm trong ${relWt}/<id>-<slug>/ (\`ff copy <id>\`).`
      }
    }
    return null
  }

  function checkMirrorFile(tool, abs) {
    if (!isEdit(tool)) return null
    if (!inRootRepo(abs) || inWorktree(abs)) return null
    if (['CLAUDE.md', 'AGENTS.md'].includes(path.basename(abs))) return null
    return `Repo gốc là bản gương — không sửa ${path.relative(root, abs)}. Sửa bản trong ${relWt}/<id>-<slug>/${path.relative(root, abs)}.`
  }

  function evaluate({ cmd, file, tool, cwd, mode = 'base', input = {} }) {
    const c = realish(cwd)
    const abs = file ? realish(path.resolve(c, expandHome(file))) : null
    let reason = null
    if (cmd) reason = checkLockedBash(cmd, c) ?? checkBash(cmd, c, mode)
    if (!reason && abs) reason = checkLockedFile(tool, abs) ?? checkAllowlist(tool, abs)
    if (!reason && mode === 'feature-flow' && abs) reason = checkMirrorFile(tool, abs)
    return reason
  }

  const needsAsk = (cmd) => segments(cmd).some((s) => FF_ASK_RE.test(s))

  return { root, evaluate, needsAsk }
}
