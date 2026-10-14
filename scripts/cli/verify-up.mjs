import fs from 'node:fs'
import path from 'node:path'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { runDoctor } from '../lib/doctor.mjs'
import { findCardDir } from '../lib/cards.mjs'
import { repoDir, runConfigured } from './repo-common.mjs'
import { acquireVerifyLock, releaseVerifyLock, verifyLockPath } from '../lib/verify-lock.mjs'

export const summary = 'verify-up <id> <app> — lấy lock, chạy migration/server và kiểm health URL'

export async function run(args, ctx) {
  const [id, appName, ...extra] = args
  if (!id || !appName || extra.length) { ctx.stderr.write('dùng: ff verify-up <id> <app>\n'); return 2 }
  const root = findRoot(ctx.cwd)
  if (!root) { ctx.stderr.write('ff verify-up: không thấy ff.config.yaml\n'); return 4 }
  const loaded = loadConfig(root)
  const config = loaded.config
  const card = findCardDir(root, config, id)
  if (card.error) { ctx.stderr.write(`ff verify-up: ${card.error}\n`); return 2 }
  const slug = path.basename(card.dir)
  const app = config.e2e?.apps?.find((item) => item.name === appName)
  if (!app) { ctx.stderr.write(`ff verify-up: app '${appName}' không có trong e2e.apps\n`); return 2 }
  if (!config.e2e.up_cmd) { ctx.stderr.write('ff verify-up: thiếu e2e.up_cmd\n'); return 4 }
  const doctor = runDoctor(root, loaded)
  if (!doctor.groups.core || !doctor.groups.e2e) {
    const errors = doctor.checks.filter((c) => !c.ok && ['core', 'e2e'].includes(c.group)).map((c) => c.msg)
    ctx.stderr.write(`ff verify-up: doctor core/e2e đỏ; ${errors.join('; ')}\n`)
    return 4
  }
  const lock = verifyLockPath(root, config)
  const acquired = acquireVerifyLock(lock, slug)
  if (!acquired.acquired) {
    ctx.stderr.write(`ff verify-up: thẻ khác đang verify (${acquired.current?.slug ?? 'không rõ'})\n`)
    return 1
  }
  const releaseBeforeStart = () => {
    if (!acquired.current) releaseVerifyLock(lock, slug)
    return acquired.current ? 'giữ lock đã có' : 'đã trả lock'
  }
  for (const repo of config.repos) {
    const dir = repoDir(root, config.workspace.worktrees_dir, slug, repo)
    if (!fs.existsSync(dir)) {
      ctx.stderr.write(`ff verify-up: thiếu bản copy ${path.relative(root, dir)}; ${releaseBeforeStart()}\n`)
      return 1
    }
    if (!repo.commands?.migrate) continue
    const result = runConfigured(repo.commands.migrate, dir, ctx)
    if (result.status !== 0) {
      ctx.stderr.write(`ff verify-up: migration lỗi trong ${repo.name}; dừng, không tự revert; ${releaseBeforeStart()}\n`)
      return 1
    }
  }
  const e2eDir = path.resolve(root, config.e2e.dir)
  const started = runConfigured(config.e2e.up_cmd, e2eDir, ctx)
  if (started.status !== 0) {
    ctx.stderr.write('ff verify-up: e2e.up_cmd lỗi; có thể đã khởi động một phần, giữ lock; chạy ff verify-down để dọn\n')
    return 1
  }
  const urls = [...new Set([...(config.e2e.health_urls ?? []), app.base_url])]
  const fetcher = ctx.fetch ?? globalThis.fetch
  const sleep = ctx.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const attempts = Math.min(30, Math.max(1, Math.trunc(ctx.healthAttempts ?? 10)))
  for (const url of urls) {
    let healthy = false
    let failure = 'không kết nối được'
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await fetcher(url, { signal: AbortSignal.timeout(3000) })
        healthy = response?.ok !== false && Number(response?.status) >= 200 && Number(response?.status) < 300
        failure = `HTTP ${response?.status ?? 'không rõ'}`
        if (healthy) break
      } catch (error) { failure = error.message }
      if (attempt + 1 < attempts) await sleep(500)
    }
    if (!healthy) {
      ctx.stderr.write(`ff verify-up: health lỗi ${url} (${failure}); giữ lock; chạy ff verify-down để dọn\n`)
      return 1
    }
  }
  ctx.stdout.write(`verify-up: server sẵn sàng cho ${slug} / ${appName}; lock đang giữ\n`)
  return 0
}
