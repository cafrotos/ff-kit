import fs from 'node:fs'
import path from 'node:path'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { runDoctor } from '../lib/doctor.mjs'
import { findCardDir } from '../lib/cards.mjs'
import { repoDir, runConfigured, git } from './repo-common.mjs'
import { readShipTest, validateShipTest, shipTestRequired } from '../lib/ship-test-record.mjs'
import { activeRevision } from '../lib/gates.mjs'
import { acquireVerifyLock, releaseVerifyLock, readVerifyLock, updateVerifyLock, verifyLockPath } from '../lib/verify-lock.mjs'
import { applyEnvOverrides, loadServiceEnv, ownedAlive, portInUse, runPrepare, startService, waitPort } from '../lib/services.mjs'
import { testDirPath } from '../lib/code-dir.mjs'

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
  const services = config.e2e.services ?? []
  if (!services.length && !config.e2e.up_cmd) { ctx.stderr.write('ff verify-up: thiếu e2e.services (hoặc e2e.up_cmd cũ); chạy /ff-kit:ff-init để khai báo\n'); return 4 }
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
  // Verify runs from the ship-branch test checkout prepared by `ff ship-test` (origin/<ship_branch> + feature squash).
  const record = readShipTest(root, id.split('-')[0], activeRevision(card.dir) ?? '')
  const dirs = {}
  if (record || shipTestRequired(config)) {
    const heads = {}
    for (const repo of config.repos) {
      const feature = repoDir(root, config.workspace.worktrees_dir, slug, repo)
      const head = fs.existsSync(feature) ? git(feature, ['rev-parse', 'HEAD']) : null
      if (head?.status === 0) heads[repo.name] = head.stdout.trim()
    }
    const checked = validateShipTest(record, heads)
    if (!checked.valid) {
      ctx.stderr.write(`ff verify-up: chưa có checkout test hợp lệ trên nhánh ship (${checked.reason}); chạy ff ship-test ${id}; ${releaseBeforeStart()}\n`)
      return 1
    }
    for (const [name, entry] of Object.entries(record.repos)) if (entry.checkout) dirs[name] = entry.checkout
  }
  const codeRoot = dirs && Object.keys(dirs).length ? testDirPath(root, config.workspace.worktrees_dir, slug) : path.resolve(root, config.workspace.worktrees_dir, slug)
  const dirOf = (repo) => dirs[repo.name] ?? repoDir(root, config.workspace.worktrees_dir, slug, repo)
  const prior = readVerifyLock(lock)?.services ?? []
  const toStart = []
  for (const svc of services) {
    const repo = config.repos.find((r) => r.name === svc.repo)
    if (!repo) { ctx.stderr.write(`ff verify-up: service ${svc.name} trỏ repo không có: ${svc.repo}; ${releaseBeforeStart()}\n`); return 4 }
    const running = prior.find((p) => p.name === svc.name)
    if (running && ownedAlive(running)) continue // started by an earlier verify-up of this card
    if (await portInUse(svc.port)) {
      ctx.stderr.write(`ff verify-up: cổng ${svc.port} (${svc.name}) đang bị một tiến trình khác dùng, không phải do ff khởi động; dừng tiến trình đó rồi chạy lại; ${releaseBeforeStart()}\n`)
      return 1
    }
    toStart.push({ svc, repo })
  }
  for (const repo of config.repos) {
    const dir = dirOf(repo)
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
  const cardId = id.split('-')[0]
  const urlsFromServices = []
  if (services.length) {
    const logDir = path.join(root, '.ff/services', cardId)
    const state = [...prior.filter((p) => services.some((s) => s.name === p.name))]
    const save = () => updateVerifyLock(lock, slug, { services: state, codeDir: codeRoot })
    save()
    const prepared = new Set()
    for (const { svc, repo } of toStart) {
      const repoRoot = dirOf(repo)
      if (svc.prepare && !prepared.has(`${repo.name}\0${svc.prepare}`)) {
        prepared.add(`${repo.name}\0${svc.prepare}`)
        const prep = runPrepare(svc.prepare, repoRoot, path.join(logDir, `prepare-${repo.name}.log`), ctx.prepareTimeoutMs)
        if (prep.status !== 0) { ctx.stderr.write(`ff verify-up: prepare của ${svc.name} lỗi (xem .ff/services/${cardId}/prepare-${repo.name}.log); giữ lock; chạy ff verify-down để dọn\n`); return 1 }
      }
      applyEnvOverrides(repoRoot, svc.env_overrides)
    }
    for (const { svc, repo } of toStart) {
      const cwd = path.resolve(dirOf(repo), svc.cwd ?? '.')
      if (!fs.existsSync(cwd)) { ctx.stderr.write(`ff verify-up: thiếu thư mục ${svc.name}: ${path.relative(root, cwd)}; giữ lock; chạy ff verify-down để dọn\n`); return 1 }
      const entry = startService({ service: svc, cwd, env: loadServiceEnv(svc, cwd), logFile: path.join(logDir, `${svc.name}.log`) })
      state.push(entry)
      save()
    }
    for (const svc of services) {
      const entry = state.find((p) => p.name === svc.name)
      const ready = await waitPort(svc.port, { up: true, timeoutMs: ctx.serviceStartTimeoutMs ?? 180000, alive: () => ownedAlive(entry) })
      if (!ready) {
        ctx.stderr.write(`ff verify-up: service ${svc.name} không mở cổng ${svc.port} (${ownedAlive(entry) ? 'quá thời gian chờ' : 'tiến trình đã thoát'}); xem .ff/services/${cardId}/${svc.name}.log; giữ lock; chạy ff verify-down để dọn\n`)
        return 1
      }
      if (svc.health_url) urlsFromServices.push(svc.health_url)
    }
  } else {
    const env = Object.fromEntries(Object.entries(dirs).map(([name, dir]) => [`FF_REPO_DIR_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`, dir]))
    const started = runConfigured(config.e2e.up_cmd, e2eDir, ctx, env)
    if (started.status !== 0) {
      ctx.stderr.write('ff verify-up: e2e.up_cmd lỗi; có thể đã khởi động một phần, giữ lock; chạy ff verify-down để dọn\n')
      return 1
    }
  }
  const urls = [...new Set([...urlsFromServices, ...(config.e2e.health_urls ?? []), app.base_url])]
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
