// Kiểm xác định, không LLM. Không bao giờ in giá trị secret.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { validate } from './schema.mjs'
import { presentKeys, requiredKeysByGroup } from './env.mjs'
import { checkLock } from './lock.mjs'
import { commandBinaries } from './shell.mjs'

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

export function runDoctor(root, { config, raw }, { which = whichInPath } = {}) {
  const checks = []
  const ok = (msg, group = 'core') => checks.push({ ok: true, msg, group })
  const bad = (msg, group = 'core') => checks.push({ ok: false, msg, group })
  const finish = () => {
    const groups = Object.fromEntries(['core', 'worker', 'e2e'].map((g) => [g, checks.filter((c) => c.group === g).every((c) => c.ok)]))
    return { ok: checks.every((c) => c.ok), groups, checks }
  }
  const errs = validate(config)
  if (errs.length) {
    for (const e of errs) bad(`schema ${e}`)
    return finish()
  }
  ok('schema hợp lệ')

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
    }
  }
  if (config.db && !fs.existsSync(path.resolve(root, config.db.env_file))) bad(`db.env_file không tồn tại: ${config.db.env_file}`, 'e2e')
  for (const [k, rel] of Object.entries(config.project_docs ?? {})) {
    if (!fs.existsSync(path.resolve(root, rel))) bad(`project_docs.${k} không tồn tại: ${rel}`)
  }
  if (!config.worker.task_source) bad('chưa cấu hình worker.task_source — chỉ dùng skill tay được, /ff-worker start sẽ từ chối', 'worker')

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
