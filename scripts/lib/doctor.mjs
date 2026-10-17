// Kiểm xác định, không LLM. Không bao giờ in giá trị secret.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import pkg from '../../package.json' with { type: 'json' }
import { resolveTrelloLists, DEFAULT_DENY_PATHS } from './config.mjs'
import { resolveLocalDir } from '../../ff-worker/src/adapters/task-source/local.mjs'
import { validate } from './schema.mjs'
import { presentKeys, requiredKeysByGroup } from './env.mjs'
import { checkLock } from './lock.mjs'
import { commandBinaries, tokenize } from './shell.mjs'
import { validateWorkflowPin } from './stage-receipts.mjs'
import { assertClaudeLaunchCapabilities } from './workflow-snapshot.mjs'
import { wikiDirCheck } from './wiki.mjs'

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

const PKG_VERSION = pkg.version

/** Compare the plugin version Claude Code loaded (installed_plugins.json) with this CLI's version. */
export function checkPluginVersion({ homeDir = os.homedir(), installedPluginsPath, cliVersion = PKG_VERSION } = {}) {
  const file = installedPluginsPath ?? path.join(homeDir, '.claude/plugins/installed_plugins.json')
  let entries
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    entries = (data.plugins ?? data)['ff-kit@ff-kit']
  } catch { return { status: 'warn', msg: `không đọc được ${file}: bỏ qua kiểm tra version plugin/CLI` } }
  if (!Array.isArray(entries) || !entries.length) return { status: 'warn', msg: 'ff-kit@ff-kit chưa có trong installed_plugins.json: bỏ qua kiểm tra version plugin/CLI' }
  const entry = entries.find((e) => e?.scope === 'user') ?? entries[0]
  const v = entry?.version
  if (v === cliVersion) return { status: 'ok', msg: `plugin và CLI cùng version ${cliVersion}` }
  return { status: 'bad', msg: `plugin ff-kit ${v ?? '?'} khác CLI ${cliVersion}; chạy: claude plugin marketplace update ff-kit && claude plugin update ff-kit@ff-kit rồi khởi động lại các phiên Claude` }
}

/** Đọc đúng cờ hasTrustDialogAccepted của workspace trong ~/.claude.json (không đọc gì khác). */
export function checkWorkspaceTrust(root, { homeDir = os.homedir() } = {}) {
  let accepted = false
  try {
    const p = JSON.parse(fs.readFileSync(path.join(homeDir, '.claude.json'), 'utf8'))?.projects
    accepted = p?.[root]?.hasTrustDialogAccepted === true
  } catch { /* thiếu file/key → cảnh báo */ }
  return accepted ? null : `Claude Code chưa tin thư mục ${root}: mở \`claude\` một lần trong workspace và chọn "Yes, I trust this folder", nếu không phiên worker sẽ kẹt ở hộp thoại trust`
}

/** Deny quá rộng trên `.ff/` (đọc) chặn agent đọc workflow đã ghim `.ff/workflows/<digest>/` (stage-protocol, rules, references, templates). */
export function broadFfReadDenies(root) {
  const found = []
  for (const name of ['settings.json', 'settings.local.json']) {
    let deny
    try { deny = JSON.parse(fs.readFileSync(path.join(root, '.claude', name), 'utf8'))?.permissions?.deny } catch { continue }
    for (const entry of Array.isArray(deny) ? deny : []) {
      const m = typeof entry === 'string' ? entry.match(/^(Read|Grep|Glob|Bash)\((.*)\)$/) : null
      if (m && /(^|[\s/])\.ff(\/\*{0,2})?$/.test(m[2].trim())) found.push(`${name}: ${entry}`)
    }
  }
  return found
}
export const FF_READ_DENY_FIX = 'Read(./.ff.env), Read(./.ff.env.*), Read(./.ff/worker.json), Read(./.ff/runner/**), Read(./.ff/tasks/**), Read(./.ff/harness/**) (giữ Edit/Write(./.ff/**))'

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' })

export function runDoctor(root, { config, raw }, { which = whichInPath, runCommand = (cmd, args, options = {}) => spawnSync(cmd, args, { ...options, encoding: 'utf8' }), homeDir, installedPluginsPath, cliVersion } = {}) {
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

  const pv = checkPluginVersion({ homeDir, installedPluginsPath, cliVersion })
  if (pv.status === 'ok') ok(pv.msg)
  else if (pv.status === 'bad') bad(pv.msg)
  else warnings.push(pv.msg)

  const trustWarn = checkWorkspaceTrust(root, { homeDir })
  if (trustWarn) warnings.push(trustWarn)

  const noServices = !(config.e2e?.services ?? []).length
  const appsWithoutServices = noServices && !(config.e2e?.up_cmd && config.e2e?.down_cmd) && Object.keys(config.e2e?.apps ?? {}).length > 0
  if (appsWithoutServices) bad('e2e.services chưa khai báo: verify không tự bật được app; chạy /ff-init để suy ra services', 'e2e')

  {
    const broad = broadFfReadDenies(root)
    if (broad.length) {
      const msg = `.claude/settings* chặn đọc cả .ff/ (${broad.join('; ')}): agent trong phiên thẻ không đọc được workflow ghim .ff/workflows/<digest>/ (stage-protocol, rules, references). Thay bằng các deny hẹp: ${FF_READ_DENY_FIX}`
      config.worker?.driver?.enabled ? bad(msg, 'worker') : warnings.push(msg)
    }
  }

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

  { const k = wikiDirCheck(root, config); k.ok ? ok(k.msg) : bad(k.msg) }
  {
    const kn = config.knowledge ?? {}
    if (kn.dream?.enabled) {
      const q = kn.quota ?? {}, bin = q.cswap_bin ?? 'cswap'
      if (!which(bin, root)) warnings.push(`knowledge.dream bật nhưng không có ${bin} trong PATH: quota không đọc được, dreaming chỉ chạy trong giờ knowledge.quota.allowed_hours (${q.allowed_hours ?? '1-6'}) và không biết mức dùng thật`)
      if (!which('claude', root)) warnings.push('knowledge.dream bật nhưng không có claude trong PATH: các lượt D0/D1/D2 sẽ thất bại')
      if (!(config.repos ?? []).length) warnings.push('knowledge.dream bật nhưng chưa có repo nào trong cấu hình')
    }
    if (kn.runner === 'opencode') {
      if (!(kn.cheap_lane_repos ?? []).length) warnings.push('knowledge.runner=opencode nhưng cheap_lane_repos rỗng: mọi repo vẫn dùng claude (làn rẻ chỉ bật theo repo vì code rời máy)')
      else warnings.push(`làn rẻ opencode bật cho repo ${kn.cheap_lane_repos.join(', ')}: code của repo đó được gửi tới nhà cung cấp opencode`)
      if (!which('opencode', root)) warnings.push('knowledge.runner=opencode nhưng không có opencode trong PATH')
    }
    for (const r of kn.cheap_lane_repos ?? []) if (!(config.repos ?? []).some(x => x.name === r)) bad(`knowledge.cheap_lane_repos: repo ${r} không có trong cấu hình`)
  }

  {
    const ap = config.autopilot ?? {}
    if (ap.enabled) warnings.push(`autopilot BẬT: Gate A ${ap.gate_a ?? 'on'}, ship ${ap.ship === false ? 'tắt' : 'tự động'}${ap.daily_report_at ? `, báo cáo ngày lúc ${ap.daily_report_at}` : ''}`)
    else warnings.push('autopilot tắt (autopilot.enabled=false)')
    if (ap.enabled) warnings.push(`autopilot deny_paths: ${(ap.deny_paths ?? DEFAULT_DENY_PATHS).length} mẫu${(config.repos ?? []).some((r) => r.autopilot_deny_paths?.length) ? ' (+ riêng từng repo)' : ''}; diff ngoài plan, chạm deny_paths hoặc thêm package mới thì không tự qua Gate C / tự ship`)
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
    if (!appsWithoutServices && !services.length && !(config.e2e.up_cmd && config.e2e.down_cmd)) bad('e2e chưa khai báo e2e.services (hoặc cặp up_cmd/down_cmd cũ) nên ff không thể khởi động app để verify — chạy /ff-kit:ff-init', 'e2e')
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
  warnings.push(`Thông báo: channel.notify_level = ${config.worker.channel?.notify_level ?? 'action'} (action = chỉ đẩy việc cần người; all = đẩy hết)`)
  if (!config.worker.task_source) bad('chưa cấu hình worker.task_source — chỉ dùng skill tay được, /ff-worker start sẽ từ chối', 'worker')
  if (config.worker.task_source?.adapter === 'trello') {
    const t = config.worker.task_source.trello ?? {}
    warnings.push(t.filter_assigned_only === false
      ? 'Trello filter: TẮT (filter_assigned_only: false) — worker xử lý mọi thẻ trong poll_lists'
      : `Trello filter: chỉ thẻ gán cho ${t.assignee ? 'assignee đã cấu hình' : 'token owner'}`)
    warnings.push(typeof t.park_list === 'string' && t.park_list.trim()
      ? `Trello park_list: '${t.park_list.trim()}' — cần tồn tại trên board (worker kiểm khi chuyển thẻ)`
      : 'Trello park_list chưa đặt — park sẽ không chuyển thẻ sang list nào')
    const resolved = resolveTrelloLists(t)
    warnings.push(`Trello doing_list: '${resolved.doing ?? '(không có)'}' · qa_fail_list: '${resolved.qaFail ?? '(không có)'}' (mặc định lấy từ poll_lists)`)
  }

  if (config.worker.task_source?.adapter === 'local') {
    const t = config.worker.task_source.local ?? {}
    try {
      const dir = resolveLocalDir(root, t.dir)
      const rel = path.relative(root, dir) || '.'
      if (!fs.existsSync(dir)) ok(`Thẻ local: thư mục ${rel} chưa có — sẽ tạo khi ff task create`, 'worker')
      else {
        try { fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK); ok(`Thẻ local: ${rel} đọc/ghi được`, 'worker') }
        catch { bad(`Thẻ local: ${rel} không đọc/ghi được`, 'worker') }
      }
    } catch (e) { bad(e.message, 'worker') }
    if (!(t.poll_lists ?? []).some((n) => typeof n === 'string' && n.trim())) bad('Thẻ local: chưa cấu hình poll_lists', 'worker')
    if (typeof t.done_list !== 'string' || !t.done_list.trim()) bad('Thẻ local: chưa cấu hình done_list', 'worker')
    const resolved = resolveTrelloLists(t)
    warnings.push(`Thẻ local doing_list: '${resolved.doing ?? '(không có)'}' · qa_fail_list: '${resolved.qaFail ?? '(không có)'}'`)
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
