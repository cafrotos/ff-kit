import path from 'node:path'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { git } from './repo-common.mjs'

export const summary = 'sync [--check] — cập nhật repo gốc theo repos[].base_branch'

export async function run(args, ctx) {
  const check = args.includes('--check')
  if (args.some((arg) => arg !== '--check')) {
    ctx.stderr.write('dùng: ff sync [--check]\n')
    return 2
  }
  const root = findRoot(ctx.cwd)
  if (!root) { ctx.stderr.write('ff sync: không thấy ff.config.yaml\n'); return 4 }
  const config = loadConfig(root).config
  let rc = 0
  for (const repo of config.repos) {
    const dir = path.resolve(root, repo.path)
    if (git(dir, ['rev-parse', '--git-dir']).status !== 0) {
      ctx.stderr.write(`ff sync: ${repo.name} không phải git repo (${repo.path})\n`)
      rc = 1
      continue
    }
    const branch = git(dir, ['branch', '--show-current']).stdout.trim()
    const dirty = git(dir, ['status', '--porcelain']).stdout.trim()
    if (check) {
      const ahead = git(dir, ['rev-list', '--count', `HEAD..origin/${repo.base_branch}`])
      ctx.stdout.write(`[${repo.name}] nhánh=${branch}, thiếu ${ahead.status === 0 ? ahead.stdout.trim() : '?'} commit so với origin/${repo.base_branch}, file sửa: ${dirty ? dirty.split('\n').length : 0}\n`)
      continue
    }
    if (dirty) {
      ctx.stderr.write(`ff sync: ${repo.name} có thay đổi chưa commit; giữ nguyên và dừng đồng bộ repo này\n`)
      rc = 1
      continue
    }
    const fetched = git(dir, ['fetch', 'origin'])
    if (fetched.status !== 0) {
      ctx.stderr.write(`ff sync: git fetch origin lỗi trong ${repo.path}: ${fetched.stderr.trim().split('\n').at(-1)}\n`)
      rc = 1
      continue
    }
    if (branch !== repo.base_branch) {
      const checkout = git(dir, ['switch', repo.base_branch])
      if (checkout.status !== 0) {
        ctx.stderr.write(`ff sync: không chuyển được sang ${repo.base_branch} trong ${repo.path}\n`)
        rc = 1
        continue
      }
    }
    const merged = git(dir, ['merge', '--ff-only', `origin/${repo.base_branch}`])
    if (merged.status !== 0) {
      ctx.stderr.write(`ff sync: fast-forward ${repo.name} từ origin/${repo.base_branch} lỗi: ${merged.stderr.trim().split('\n').at(-1)}\n`)
      rc = 1
      continue
    }
    ctx.stdout.write(`đã đồng bộ ${repo.name} theo ${repo.base_branch}\n`)
  }
  return rc
}
