import fs from 'node:fs'
import path from 'node:path'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { findCardDir } from '../lib/cards.mjs'
import { cardBranch, git, readRevisionBase, repoDir } from './repo-common.mjs'

export const summary = 'squash-check <id> — kiểm số commit, nội dung commit và file không được ship'
const junk = /(^|\/)(?:\.env(?:\.|$)|tsconfig\.tsbuildinfo|\.run-dev\.pids|\.dev-logs\/|\.ff-ship-approved)/

export async function run(args, ctx) {
  const id = args[0]
  if (!id || args.length !== 1) { ctx.stderr.write('dùng: ff squash-check <id>\n'); return 2 }
  const root = findRoot(ctx.cwd)
  if (!root) { ctx.stderr.write('ff squash-check: không thấy ff.config.yaml\n'); return 4 }
  const config = loadConfig(root).config
  const card = findCardDir(root, config, id)
  if (card.error) { ctx.stderr.write(`ff squash-check: ${card.error}\n`); return 2 }
  const slug = path.basename(card.dir)
  const branch = cardBranch(path.join(card.dir, '01-dossier.md'))
  const hasSubtasks = fs.existsSync(path.join(card.dir, '00-subtasks.md'))
  let bad = false
  for (const repo of config.repos) {
    const dir = repoDir(root, config.workspace.worktrees_dir, slug, repo)
    if (!fs.existsSync(path.join(dir, '.git'))) {
      ctx.stderr.write(`ff squash-check: thiếu bản copy ${path.relative(root, dir)}\n`)
      bad = true
      continue
    }
    const remote = git(dir, ['config', '--get', 'remote.ff-local.url']).status === 0 ? 'ff-local' : 'origin'
    let base = `${remote}/${repo.base_branch}`
    let baseline
    try { baseline = readRevisionBase(card.dir, repo.name, dir) } catch (error) {
      ctx.stderr.write(`ff squash-check: ${error.message}\n`)
      bad = true
      continue
    }
    if (baseline) base = baseline.sha
    else if (branch && git(dir, ['rev-parse', '--verify', '--quiet', `${remote}/${branch}`]).status === 0 && git(dir, ['merge-base', '--is-ancestor', `${remote}/${branch}`, 'HEAD']).status === 0) base = `${remote}/${branch}`
    const merge = git(dir, ['merge-base', 'HEAD', base])
    if (merge.status !== 0) {
      ctx.stderr.write(`ff squash-check: không tìm được merge-base ${repo.name} với ${base}\n`)
      bad = true
      continue
    }
    const counted = git(dir, ['rev-list', '--count', `${merge.stdout.trim()}..HEAD`])
    const status = git(dir, ['status', '--porcelain'])
    if (counted.status !== 0 || status.status !== 0 || !/^\d+$/.test(counted.stdout.trim())) {
      ctx.stderr.write(`ff squash-check: git lỗi trong ${repo.name}; không thể kiểm tra commit/trạng thái\n`)
      bad = true
      continue
    }
    const count = Number(counted.stdout.trim())
    ctx.stdout.write(`## ${repo.name} — ${count} commit trên ${baseline ? baseline.revision : base.slice(remote.length + 1)}\n`)
    const dirty = status.stdout.split(/\r?\n/).filter(Boolean)
    if (dirty.length) { ctx.stdout.write(`  ❌ còn file chưa commit: ${dirty.length}\n`); bad = true }
    if (!count) { ctx.stdout.write('  (không có commit trên nhánh gốc)\n'); continue }
    const commitLog = git(dir, ['log', '--format=%h %s', `${merge.stdout.trim()}..HEAD`])
    const commitBody = git(dir, ['log', '-1', '--format=%B'])
    const changed = git(dir, ['diff', '--name-only', `${merge.stdout.trim()}..HEAD`])
    if ([commitLog, commitBody, changed].some((result) => result.status !== 0)) {
      ctx.stderr.write(`ff squash-check: git lỗi trong ${repo.name}; không thể kiểm tra nội dung\n`)
      bad = true
      continue
    }
    const commits = commitLog.stdout.trim()
    if (count !== 1 && !hasSubtasks) {
      ctx.stdout.write('  ❌ cần đúng 1 commit cho mỗi repo\n')
      bad = true
    }
    const body = commitBody.stdout.split(/\r?\n/).slice(1)
    if (!body.some((line) => line.trim() === `Trello: #${id}`)) {
      ctx.stdout.write(`  ❌ commit message thiếu dòng 'Trello: #${id}'\n`)
      bad = true
    }
    if (commits) ctx.stdout.write(`${commits.split('\n').map((line) => `  ${line}`).join('\n')}\n`)
    const files = changed.stdout.split(/\r?\n/).filter(Boolean)
    const invalid = files.filter((file) => junk.test(file) && !/(^|\/)\.env\.example$/.test(file))
    if (invalid.length) {
      ctx.stdout.write(`  ❌ file không được commit: ${invalid.join(', ')}\n`)
      bad = true
    }
  }
  ctx.stdout.write(bad ? '❌ squash-check chưa đạt\n' : '✅ squash-check đạt\n')
  return bad ? 1 : 0
}
