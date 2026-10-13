import fs from 'node:fs'
import path from 'node:path'

export function verifyLockPath(root, config) {
  return path.resolve(root, config.workspace.worktrees_dir, '.verify.lock')
}

export function readVerifyLock(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    try { return JSON.parse(raw) } catch { return { slug: raw.trim().split(/\s+/)[0] ?? '' } }
  } catch { return null }
}

export function acquireVerifyLock(file, slug) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  try {
    const fd = fs.openSync(file, 'wx', 0o600)
    fs.writeFileSync(fd, JSON.stringify({ slug, pid: process.pid, startedAt: new Date().toISOString() }) + '\n')
    fs.closeSync(fd)
    return { acquired: true }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const current = readVerifyLock(file)
    return { acquired: current?.slug === slug, current }
  }
}

export function releaseVerifyLock(file, slug, force = false) {
  const current = readVerifyLock(file)
  if (!current) return { released: false, current: null }
  if (current.slug !== slug && !force) return { released: false, current }
  fs.rmSync(file)
  return { released: true, current }
}
