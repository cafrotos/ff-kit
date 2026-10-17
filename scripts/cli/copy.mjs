import { originalFork } from '../lib/task-commits.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { findCardDir } from '../lib/cards.mjs'
import { activeRevision } from '../lib/gates.mjs'
import { cardBranch, configureCopyOrigin, git, repoDir, runConfigured } from './repo-common.mjs'

export const summary = 'copy <id> — tạo bản copy repo theo branch trong dossier'

function registerRevisionBases(root, config, cardDir, slug) {
  const revision = activeRevision(cardDir)
  if (!revision) return
  const file = path.join(cardDir, revision, 'revision.json')
  const metadata = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (metadata.revision !== revision || (metadata.bases && (typeof metadata.bases !== 'object' || Array.isArray(metadata.bases)))) throw new Error(`metadata ${revision} không hợp lệ`)
  const bases = { ...metadata.bases }
  const missing = config.repos.filter(repo => !Object.hasOwn(bases, repo.name))
  if (!missing.length) return
  const branch = cardBranch(path.join(cardDir, '01-dossier.md'))
  // Validate every missing base before registering any fork or revision metadata.
  for (const repo of missing) {
    const dir = repoDir(root, config.workspace.worktrees_dir, slug, repo)
    if (metadata.shippedRepos?.includes(repo.name)) throw new Error(`thiếu baseline repo đã ship ${repo.name}`)
    const shipped = git(dir, ['config', '--get', 'ff.shippedTaskHead'])
    if (shipped.status === 0) throw new Error(`thiếu baseline repo đã ship ${repo.name}`)
    if (shipped.status !== 1) throw new Error(`không kiểm tra được mốc đã ship ${repo.name}`)
    if (!branch || branch.startsWith('refs/') || git(dir, ['check-ref-format', '--branch', branch]).status !== 0) throw new Error('branch không hợp lệ')
    const ref = `refs/heads/${branch}`
    const remote = git(dir, ['ls-remote', '--heads', 'origin', ref])
    if (remote.status !== 0) throw new Error(`không xác minh được mốc remote ${repo.name}`)
    if (remote.stdout.trim()) throw new Error(`thiếu baseline repo đã ship trên remote ${repo.name}`)
    if (git(dir, ['rev-parse', '--verify', 'HEAD']).status !== 0) throw new Error(`không đọc được baseline ${revision}/${repo.name}`)
  }
  for (const repo of missing) {
    const dir = repoDir(root, config.workspace.worktrees_dir, slug, repo)
    bases[repo.name] = originalFork(dir, repo)
  }
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify({ ...metadata, bases }, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(temp, file)
}

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
    if (complete) {
      for (const repo of config.repos) {
        const dir = repoDir(root, config.workspace.worktrees_dir, slug, repo)
        if (git(dir, ['branch', '--show-current']).stdout.trim() !== branch) {
          ctx.stderr.write(`ff copy: ${repo.name} không ở branch ${branch}; giữ nguyên bản copy để kiểm tra\n`)
          return 1
        }
        const source = path.resolve(root, repo.path)
        const origin = git(dir, ['remote', 'get-url', 'origin'])
        if (origin.status === 0 && origin.stdout.trim() === source && git(dir, ['config', '--get', 'remote.ff-local.url']).status === 1) {
          try {
            configureCopyOrigin(source, dir, repo.name, ctx)
            if (git(dir, ['config', `branch.${branch}.remote`, 'origin']).status !== 0) throw new Error('không đặt được upstream')
          } catch (e) { ctx.stderr.write(`ff copy: ${e.message}; giữ nguyên bản copy\n`); return 1 }
        }
        if (git(dir, ['config', '--get', 'ff.localOnly']).stdout.trim() === 'true') ctx.stderr.write(`ff copy: ${repo.name} không có upstream origin; bản copy chỉ dùng local, không được ship.\n`)
      }
      try { registerRevisionBases(root, config, card.dir, slug) } catch (e) { ctx.stderr.write(`ff copy: ${e.message}; giữ nguyên bản copy\n`); return 1 }
      ctx.stdout.write(`Bản copy đã có: ${path.relative(root, worktree)} — không tạo lại.\n`)
      return 0
    }
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
    if (branch.startsWith('refs/') || git(source, ['check-ref-format', '--branch', branch]).status !== 0) {
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
      configureCopyOrigin(source, target, repo.name, ctx)
      const localBranch = git(target, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
      if (localBranch.status === 0) {
        const switched = git(target, ['switch', branch])
        if (switched.status !== 0) throw new Error(`không chuyển được ${repo.name} sang ${branch}`)
      } else {
        const from = git(target, ['show-ref', '--verify', '--quiet', `refs/remotes/ff-local/${branch}`]).status === 0 ? `ff-local/${branch}` : `ff-local/${repo.base_branch}`
        const switched = git(target, ['switch', '--create', branch, from])
        if (switched.status !== 0) throw new Error(`không tạo được branch ${branch} cho ${repo.name} từ ${from}`)
      }
      originalFork(target, repo)
      // Publishing must target upstream, while ff-local only supplies copied history.
      if (git(target, ['config', `branch.${branch}.remote`, 'origin']).status !== 0) throw new Error(`không đặt được upstream cho ${repo.name}`)
      if (git(target, ['config', `branch.${branch}.merge`, `refs/heads/${branch}`]).status !== 0) throw new Error(`không đặt được branch upstream cho ${repo.name}`)
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
    registerRevisionBases(root, config, card.dir, slug)
    return 0
  } catch (e) {
    fs.rmSync(worktree, { recursive: true, force: true })
    ctx.stderr.write(`ff copy: ${e.message}; đã dọn bản copy vừa tạo\n`)
    return 1
  }
}
