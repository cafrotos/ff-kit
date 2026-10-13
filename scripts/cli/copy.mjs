import fs from 'node:fs'
import path from 'node:path'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { findCardDir } from '../lib/cards.mjs'
import { cardBranch, git, repoDir, runConfigured } from './repo-common.mjs'

export const summary = 'copy <id> — tạo bản copy repo theo branch trong dossier'

export async function run(args, ctx) {
  const id = args[0]
  if (!id || args.length !== 1) { ctx.stderr.write('dùng: ff copy <id>\n'); return 2 }
  const root = findRoot(ctx.cwd)
  if (!root) { ctx.stderr.write('ff copy: không thấy ff.config.yaml\n'); return 4 }
  const config = loadConfig(root).config
  const card = findCardDir(root, config, id)
  if (card.error) { ctx.stderr.write(`ff copy: ${card.error}\n`); return 2 }
  const slug = path.basename(card.dir)
  const branch = cardBranch(path.join(card.dir, '01-dossier.md'))
  if (!branch) { ctx.stderr.write('ff copy: không đọc được tên branch ở mục Branch của dossier; không tự đặt tên\n'); return 1 }
  const worktree = path.resolve(root, config.workspace.worktrees_dir, slug)
  if (fs.existsSync(worktree)) {
    const complete = config.repos.every((repo) => fs.existsSync(path.join(worktree, path.basename(repo.path), '.git')))
    if (complete) { ctx.stdout.write(`Bản copy đã có: ${path.relative(root, worktree)} — không tạo lại.\n`); return 0 }
    ctx.stderr.write(`ff copy: bản copy chưa hoàn chỉnh tại ${path.relative(root, worktree)}; giữ nguyên để tránh mất dữ liệu\n`)
    return 1
  }
  for (const repo of config.repos) {
    const source = path.resolve(root, repo.path)
    const current = git(source, ['branch', '--show-current'])
    if (current.status !== 0 || current.stdout.trim() !== repo.base_branch) {
      ctx.stderr.write(`ff copy: repo gốc ${repo.name} phải ở ${repo.base_branch}; hiện là ${current.stdout?.trim() || 'không rõ'}\n`)
      return 1
    }
    if (git(source, ['check-ref-format', '--branch', branch]).status !== 0) {
      ctx.stderr.write('ff copy: branch trong dossier không hợp lệ\n')
      return 1
    }
  }
  fs.mkdirSync(worktree, { recursive: true })
  try {
    for (const repo of config.repos) {
      const source = path.resolve(root, repo.path)
      const target = repoDir(root, config.workspace.worktrees_dir, slug, repo)
      const clone = git(root, ['clone', '--local', source, target])
      if (clone.status !== 0) throw new Error(`git clone lỗi cho ${repo.name}: ${clone.stderr.trim().split('\n').at(-1)}`)
      const localBranch = git(target, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
      if (localBranch.status === 0) {
        const switched = git(target, ['switch', branch])
        if (switched.status !== 0) throw new Error(`không chuyển được ${repo.name} sang ${branch}`)
      } else {
        const from = git(target, ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`]).status === 0 ? `origin/${branch}` : `origin/${repo.base_branch}`
        const switched = git(target, ['switch', '--create', branch, from])
        if (switched.status !== 0) throw new Error(`không tạo được branch ${branch} cho ${repo.name} từ ${from}`)
      }
      for (const rel of repo.env_files ?? []) {
        const sourceFile = path.resolve(source, rel)
        const targetFile = path.resolve(target, rel)
        if (!sourceFile.startsWith(source + path.sep) || !targetFile.startsWith(target + path.sep)) throw new Error(`env_files có đường dẫn ngoài repo: ${rel}`)
        if (!fs.existsSync(sourceFile)) continue
        fs.mkdirSync(path.dirname(targetFile), { recursive: true })
        fs.copyFileSync(sourceFile, targetFile)
        fs.chmodSync(targetFile, fs.statSync(sourceFile).mode & 0o777)
      }
      if (repo.commands?.install) {
        const result = runConfigured(repo.commands.install, target, ctx)
        if (result.status !== 0) throw new Error(`lệnh install lỗi cho ${repo.name}`)
      }
      ctx.stdout.write(`Đã tạo ${path.relative(root, target)} trên ${branch}\n`)
    }
    return 0
  } catch (e) {
    fs.rmSync(worktree, { recursive: true, force: true })
    ctx.stderr.write(`ff copy: ${e.message}; đã dọn bản copy vừa tạo\n`)
    return 1
  }
}
