import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'

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
