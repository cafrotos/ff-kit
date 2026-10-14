import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { activeRevision } from '../lib/gates.mjs'

export function git(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' })
}

export function repoDir(root, worktreesDir, cardSlug, repo) {
  return path.resolve(root, worktreesDir, cardSlug, path.basename(repo.path))
}

export function cardBranch(file) {
  if (!fs.existsSync(file)) return null
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  let section = false
  let fence = false
  for (const line of lines) {
    if (/^## .*Branch/i.test(line)) { section = true; continue }
    if (section && /^## /.test(line)) break
    if (!section) continue
    if (/^\s*```/.test(line)) { fence = !fence; continue }
    if (fence && line.trim()) return line.trim().replace(/`/g, '').split(/\s+/)[0]
  }
  return null
}

export function runConfigured(command, cwd, ctx) {
  if (ctx.runCommand) return ctx.runCommand(command, cwd)
  return spawnSync(command, { cwd, shell: true, encoding: 'utf8', timeout: 120000 })
}

export function configureCopyOrigin(source, target, name, ctx) {
  const checked = (args) => {
    const result = git(target, args)
    if (result.status !== 0) throw new Error(`git ${args[0]} lỗi cho ${name}: ${(result.stderr ?? '').trim()}`)
    return result
  }
  const upstream = git(source, ['config', '--get-all', 'remote.origin.url'])
  checked(['remote', 'rename', 'origin', 'ff-local'])
  if (upstream.status === 0 && upstream.stdout.trim()) {
    const urls = upstream.stdout.trim().split(/\r?\n/).map((url) => normalizeOriginUrl(source, url))
    checked(['remote', 'add', 'origin', urls[0]])
    for (const url of urls.slice(1)) checked(['config', '--add', 'remote.origin.url', url])
    const push = git(source, ['config', '--get-all', 'remote.origin.pushurl'])
    if (push.status !== 0 && push.status !== 1) throw new Error(`không đọc được push URL của ${name}`)
    if (push.status === 0) for (const url of push.stdout.trim().split(/\r?\n/)) checked(['config', '--add', 'remote.origin.pushurl', normalizeOriginUrl(source, url)])
  } else if (upstream.status === 1) {
    checked(['remote', 'add', 'origin', source])
    checked(['config', 'ff.localOnly', 'true'])
    ctx.stderr.write(`ff copy: ${name} không có upstream origin; bản copy chỉ dùng local, không được ship.\n`)
  } else throw new Error(`không đọc được origin của ${name}`)
}

function normalizeOriginUrl(source, url) {
  // URI schemes, Git's scp-like host:path syntax and absolute paths retain their meaning.
  if (path.isAbsolute(url) || /^[^/]+:/.test(url)) return url
  return path.resolve(source, url)
}

export function readRevisionBase(cardDir, repoName, repoPath) {
  const revision = activeRevision(cardDir)
  if (!revision) return null
  const metadata = JSON.parse(fs.readFileSync(path.join(cardDir, revision, 'revision.json'), 'utf8'))
  const sha = metadata.bases?.[repoName]
  if (metadata.revision !== revision || typeof sha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)) throw new Error(`${revision}: thiếu hoặc sai baseline ${repoName}; chạy ff copy trước khi sửa repo`)
  if (git(repoPath, ['merge-base', '--is-ancestor', sha, 'HEAD']).status !== 0) throw new Error(`${revision}: baseline ${repoName} không phải ancestor của HEAD`)
  return { revision, sha }
}
