// Kiểm xác định, không LLM. Không bao giờ in giá trị secret.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { validate } from './schema.mjs'
import { presentKeys, requiredKeysByGroup } from './env.mjs'
import { checkLock } from './lock.mjs'
import { commandBinaries, tokenize } from './shell.mjs'
import { validateWorkflowPin } from './stage-receipts.mjs'
import { assertClaudeLaunchCapabilities } from './workflow-snapshot.mjs'

export function whichInPath(bin, cwd) {
  const isExec = (f) => {
    try {
      fs.accessSync(f, fs.constants.X_OK)
      return fs.statSync(f).isFile()
    } catch {
      return false
    }
  }
  if (bin.includes('/')) return isExec(path.resolve(cwd, bin))
  return (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).some((d) => isExec(path.join(d, bin)))
}

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' })

export function runDoctor(root, { config, raw }, { which = whichInPath, runCommand = (cmd, args, options = {}) => spawnSync(cmd, args, { ...options, encoding: 'utf8' }) } = {}) {
  const checks = []
  const warnings = []
  const ok = (msg, group = 'core') => checks.push({ ok: true, msg, group })
  const bad = (msg, group = 'core') => checks.push({ ok: false, msg, group })
  const finish = () => {
    const groups = Object.fromEntries(['core', 'worker', 'e2e'].map((g) => [g, checks.filter((c) => c.group === g).every((c) => c.ok)]))
    return { ok: checks.every((c) => c.ok), groups, checks, warnings }
  }
  const errs = validate(config)
  if (errs.length) {
    for (const e of errs) bad(`schema ${e}`)
    return finish()
  }
  ok('schema hợp lệ')

  if (config.worker?.driver?.enabled) {
    const engine = config.engine?.default ?? 'claude'
    const [command] = tokenize(config.engine?.commands?.[engine] ?? engine)
    try {
      if (engine !== 'claude') throw new Error('setup:runner: harness requires Claude')
      const rc = config.worker.driver.remote_control !== false
      try {
        assertClaudeLaunchCapabilities({ command, env: {}, args: rc ? ['--remote-control'] : [] })
        ok(`setup:runner: Claude supports pinned workflow launch${rc ? ' + Remote Control' : ''}`, 'worker')
      } catch (e) {
        if (rc && /--remote-control/.test(e.message)) bad('setup:runner: Claude thiếu --remote-control; nâng cấp Claude Code hoặc đặt worker.driver.remote_control: false', 'worker')
        else throw e
      }
    } catch { bad('setup:runner: verify Claude plugin-dir, session-id, resume and permission-mode auto support', 'worker') }
    try {
      const dir = path.join(root, '.ff/tasks')
      const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => /^[A-Za-z0-9]+\.json$/.test(name)) : []
      for (const name of names) {
        const task = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
        if (['done', 'completed'].includes(task.stage ?? task.phase)) continue
        try { validateWorkflowPin(root, task.workflow); ok(`workflow pin ${name}: intact`, 'worker') }
        catch { bad(`workflow pin ${name}: missing or invalid snapshot; no global fallback`, 'worker') }
      }
    } catch { bad('workflow task snapshots cannot be inspected', 'worker') }
  }

  if (!which('codegraph', root)) warnings.push('CodeGraph chưa có trong PATH; agent tìm code sẽ dùng cách dự phòng')
  warnings.push('Không kiểm tra plugin Playwright tự động; xác nhận plugin trong Claude Code nếu dùng ff-observer hoặc ff-verifier')

  for (const k of ['cards_dir', 'worktrees_dir']) {
    const rel = config.workspace[k]
    fs.existsSync(path.resolve(root, rel)) ? ok(`workspace.${k} có: ${rel}`) : bad(`workspace.${k} không tồn tại: ${rel}`)
  }

  const checkCmds = (label, cmds, cwd, group = 'core') => {
    for (const [name, cmd] of Object.entries(cmds)) {
      if (!cmd) continue
      for (const bin of commandBinaries(cmd)) if (!which(bin, cwd)) bad(`${label}: lệnh ${name} cần "${bin}" nhưng không thấy trong PATH`, group)
    }
  }

  for (const r of config.repos) {
    const p = path.resolve(root, r.path)
    if (!fs.existsSync(p)) { bad(`repo ${r.name}: không có thư mục ${r.path}`); continue }
    if (git(p, ['rev-parse', '--git-dir']).status !== 0) { bad(`repo ${r.name}: ${r.path} không phải git repo`); continue }
    const has = (ref) => git(p, ['rev-parse', '--verify', '--quiet', ref]).status === 0
    for (const [k, b] of [['base_branch', r.base_branch], ['ship_branch', r.ship_branch]]) {
      has(`refs/heads/${b}`) || has(`refs/remotes/origin/${b}`)
        ? ok(`repo ${r.name}: ${k} ${b} có`)
        : bad(`repo ${r.name}: không có nhánh ${b} (${k}; local hoặc origin)`)
    }
    checkCmds(`repo ${r.name}`, r.commands ?? {}, p)
  }

  // Nhóm e2e (D20): chỉ chặn ff-verify, không chặn skill.
  if (config.e2e) {
    const dir = path.resolve(root, config.e2e.dir)
    if (!fs.existsSync(dir)) bad(`e2e.dir không tồn tại: ${config.e2e.dir}`, 'e2e')
    else {
      for (const k of ['playwright_config', 'tests_dir']) {
        if (config.e2e[k] && !fs.existsSync(path.resolve(root, config.e2e[k]))) bad(`e2e.${k} không tồn tại: ${config.e2e[k]}`, 'e2e')
      }
      checkCmds('e2e', { up_cmd: config.e2e.up_cmd, down_cmd: config.e2e.down_cmd, test_cmd: config.e2e.test_cmd }, dir, 'e2e')
      const playwrightPkg = path.join(dir, 'node_modules', '@playwright', 'test')
      if (!fs.existsSync(playwrightPkg)) bad('e2e thiếu node_modules/@playwright/test — chạy npm install trong e2e.dir', 'e2e')
      else {
        try {
          const require = createRequire(path.join(dir, 'package.json'))
          const browser = require('playwright').chromium.executablePath()
          if (!fs.existsSync(browser)) bad('e2e chưa cài browser Chromium — chạy npx playwright install chromium', 'e2e')
        } catch {
          bad('không đọc được Playwright hoặc browser Chromium chưa cài', 'e2e')
        }
        const playwrightBin = path.join(dir, 'node_modules', '.bin', 'playwright')
        if (!fs.existsSync(playwrightBin)) bad('e2e thiếu node_modules/.bin/playwright', 'e2e')
        else {
          const listed = runCommand(playwrightBin, ['test', '--list', '--pass-with-no-tests'], { cwd: dir, encoding: 'utf8', timeout: 15000 })
          if (listed.status !== 0) bad(`npx playwright test --list lỗi trong ${config.e2e.dir}: ${(listed.stderr || listed.stdout || 'không rõ lỗi').trim().split('\n')[0]}`, 'e2e')
          else ok('e2e: playwright test --list chạy được', 'e2e')
        }
      }
    }
  }
  if (config.e2e && config.worker?.driver?.enabled) {
    const services = config.e2e.services ?? []
    if (!services.length && !(config.e2e.up_cmd && config.e2e.down_cmd)) bad('e2e chưa khai báo e2e.services (hoặc cặp up_cmd/down_cmd cũ) nên ff không thể khởi động app để verify — chạy /ff-kit:ff-init', 'e2e')
    const ports = new Map()
    for (const svc of services) {
      const label = `e2e.services.${svc.name}`
      const repo = config.repos.find((r) => r.name === svc.repo)
      if (!repo) { bad(`${label}: repo không có trong repos[]: ${svc.repo}`, 'e2e'); continue }
      if (ports.has(svc.port)) bad(`${label}: cổng ${svc.port} trùng với service ${ports.get(svc.port)}`, 'e2e')
      else ports.set(svc.port, svc.name)
      const base = path.resolve(root, repo.path)
      checkCmds(label, { cmd: svc.cmd, prepare: svc.prepare }, fs.existsSync(base) ? base : root, 'e2e')
      for (const o of svc.env_overrides ?? []) {
        if (o.from && !fs.existsSync(path.resolve(base, o.from))) bad(`${label}: env_overrides thiếu template ${o.from} trong repo ${repo.name}`, 'e2e')
      }
    }
  }
  if (config.e2e || config.worker?.driver?.enabled) {
    for (const repo of config.repos) {
      for (const rel of repo.env_files ?? []) {
        if (!fs.existsSync(path.resolve(root, repo.path, rel))) bad(`repo ${repo.name}: env_files thiếu ${rel}; ff-test không copy được vào checkout verify`, 'e2e')
      }
    }
  }
  if (config.db && !fs.existsSync(path.resolve(root, config.db.env_file))) bad(`db.env_file không tồn tại: ${config.db.env_file}`, 'e2e')
  if (config.e2e?.auth?.strategy === 'jwt-mint') {
    const secret = config.e2e.auth.jwt?.secret
    if (secret) {
      const secretPath = path.resolve(root, secret.file)
      if (!fs.existsSync(secretPath)) bad(`e2e JWT secret file không tồn tại: ${secret.file}`, 'e2e')
      else if (!presentKeys(secretPath)?.has(secret.key)) bad(`e2e JWT secret thiếu key: ${secret.key} trong ${secret.file}`, 'e2e')
    }
    for (const [field, value] of Object.entries(config.e2e.auth.jwt?.payload ?? {})) {
      const tokens = [...value.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1])
      const malformed = (value.includes('{') || value.includes('}')) && tokens.length === 0
      if (malformed || tokens.some((token) => token !== 'uuid' && !/^user\.[A-Za-z_][A-Za-z0-9_.]*$/.test(token))) {
        bad(`e2e.auth.jwt.payload.${field} có placeholder không hỗ trợ`, 'e2e')
      }
    }
  }
  for (const [k, rel] of Object.entries(config.project_docs ?? {})) {
    if (!fs.existsSync(path.resolve(root, rel))) bad(`project_docs.${k} không tồn tại: ${rel}`)
  }
  if (!config.worker.task_source) bad('chưa cấu hình worker.task_source — chỉ dùng skill tay được, /ff-worker start sẽ từ chối', 'worker')
  if (config.worker.task_source?.adapter === 'trello') {
    const t = config.worker.task_source.trello ?? {}
    warnings.push(t.filter_assigned_only === false
      ? 'Trello filter: TẮT (filter_assigned_only: false) — worker xử lý mọi thẻ trong poll_lists'
      : `Trello filter: chỉ thẻ gán cho ${t.assignee ? 'assignee đã cấu hình' : 'token owner'}`)
    warnings.push(typeof t.park_list === 'string' && t.park_list.trim()
      ? `Trello park_list: '${t.park_list.trim()}' — cần tồn tại trên board (worker kiểm khi chuyển thẻ)`
      : 'Trello park_list chưa đặt — park sẽ không chuyển thẻ sang list nào')
  }

  const envName = config.secrets.env_file
  const keys = presentKeys(path.resolve(root, envName))
  for (const [group, need] of Object.entries(requiredKeysByGroup(config))) {
    if (!need.length) continue
    const label = group === 'worker' ? 'adapter đã chọn' : 'đăng nhập e2e'
    if (!keys) bad(`${envName} chưa có — cần: ${need.join(', ')}`, group)
    else {
      const miss = need.filter((k) => !keys.has(k))
      miss.length ? bad(`${envName} thiếu key: ${miss.join(', ')}`, group) : ok(`${envName} đủ key cho ${label}`, group)
    }
  }

  checks.push(...checkLock(root, raw, envName).map((c) => ({ ...c, group: 'core' })))
  return finish()
}

/** Stage-local checks. Worker startup remains independent of GitHub CLI availability. */
export function preflightStage(root, loaded, { stage, mode, runCommand = (cmd, args, options = {}) => spawnSync(cmd, args, { ...options, encoding: 'utf8' }) } = {}) {
  const checks = []
  const add = (pass, msg) => checks.push({ ok: !!pass, msg })
  const config = loaded?.config ?? loaded
  const fail = (reason) => ({ ok: false, checks, reason })
  if (!config || !['understand', 'build', 'verify', 'ship'].includes(stage)) {
    add(false, 'stage/config invalid')
    return fail('setup:stage')
  }
  if (stage === 'verify') {
    const doctorInput = loaded?.config
      ? { config: loaded.config, raw: loaded.raw ?? loaded.config }
      : { config, raw: config }
    const e2eChecks = runDoctor(root, doctorInput, { runCommand }).checks.filter((check) => check.group === 'e2e')
    for (const check of e2eChecks) add(check.ok, 'e2e preflight check')
    if (checks.some(c => !c.ok)) return fail('setup:e2e')
  }
  if (stage === 'ship') {
    for (const repo of config.repos ?? []) {
      const repoPath = path.resolve(root, repo.path)
      const remote = runCommand('git', ['remote', 'get-url', 'origin'], { cwd: repoPath })
      const branch = runCommand('git', ['branch', '--show-current'], { cwd: repoPath })
      const shipRef = runCommand('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${repo.ship_branch}`], { cwd: repoPath })
      const goodRemote = remote.status === 0 && !!String(remote.stdout ?? '').trim()
      const goodBranch = branch.status === 0 && !!String(branch.stdout ?? '').trim()
      add(goodRemote, `repo ${repo.name}: origin configured`)
      add(goodBranch, `repo ${repo.name}: current branch available`)
      add(shipRef.status === 0, `repo ${repo.name}: origin ship_branch available`)
    }
    if (checks.some(c => !c.ok)) return fail('setup:ship')
  }
  if (stage === 'ship' && mode === 'S2') {
    const gh = runCommand('gh', ['auth', 'status'], { cwd: root })
    add(gh.status === 0, 'gh authenticated for S2')
    if (checks.some(c => !c.ok)) return fail('blocked:gh')
  }
  return { ok: true, checks, reason: null }
}
