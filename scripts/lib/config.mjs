// Loader dùng chung cho CLI, guard, hooks và (Plan 3) worker.
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { validate } from './schema.mjs'

export const CONFIG_FILE = 'ff.config.yaml'
export const LOCK_FILE = 'ff.config.lock.json'

export class ConfigError extends Error {}

export const DEFAULTS = {
  workspace: { root: '.', cards_dir: 'trellocards', worktrees_dir: 'worktrees' },
  guard: { protected_paths: [], allowed_bash: [], migration_script_re: '^migration:(run|revert)$', forbidden_script_re: ':prod$' },
  engine: { default: 'claude', commands: {} },
  worker: {
    max_concurrent_tasks: 2,
    channel: { adapter: 'console' },
    tmux: { session_prefix: 'ff-', cleanup_on_success: true, cleanup_on_failure: false, max_session_lifetime_hours: 24 },
    http: { port: 0 },
    reload: { watch: true, debounce_ms: 2000 },
  },
  secrets: { env_file: '.ff.env' },
}

export function findRoot(start = process.cwd()) {
  let dir = path.resolve(start)
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_FILE))) return fs.realpathSync(dir)
    const up = path.dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

function merge(def, val) {
  if (val === undefined) return structuredClone(def)
  if (isObj(def) && isObj(val)) {
    const out = { ...val }
    for (const k of Object.keys(def)) out[k] = merge(def[k], val[k])
    return out
  }
  return val
}

export function parseConfigText(text) {
  const doc = YAML.parseDocument(text.replace(/^﻿/, ''))
  if (doc.errors.length) {
    const e = doc.errors[0]
    const line = e.linePos?.[0]?.line ?? '?'
    throw new ConfigError(`${CONFIG_FILE}: lỗi YAML dòng ${line}: ${e.message.split('\n')[0]}`)
  }
  const raw = doc.toJS() ?? {}
  return { config: merge(DEFAULTS, raw), raw }
}

export function loadConfig(root) {
  let text
  try {
    text = fs.readFileSync(path.join(root, CONFIG_FILE), 'utf8')
  } catch {
    throw new ConfigError(`không đọc được ${path.join(root, CONFIG_FILE)}`)
  }
  return parseConfigText(text)
}

// Guard cần chạy được kể cả khi config hỏng hoặc sai schema.
// YAML đọc được nhưng sai schema → giữ phần dùng được (repo có path, regex biên dịch được), phần sai thay bằng mặc định,
// để 1 lỗi nhỏ (vd thiếu ship_branch sau khi nâng cấp) không âm thầm tắt luật khóa test / repo gốc.
// YAML không đọc được → mặc định hoàn toàn.
export function loadConfigOrDefaults(root) {
  let loaded
  try {
    loaded = loadConfig(root)
  } catch {
    return { ...parseConfigText('repos: []\n'), broken: true }
  }
  const broken = validate(loaded.config).length > 0
  return { config: broken ? sanitize(loaded.config) : loaded.config, raw: loaded.raw, broken }
}

function sanitize(c) {
  const d = parseConfigText('repos: []\n').config
  const str = (v, dv) => (typeof v === 'string' && v ? v : dv)
  const reOk = (v, dv) => {
    if (typeof v !== 'string') return dv
    try {
      new RegExp(v)
      return v
    } catch {
      return dv
    }
  }
  const ws = isObj(c.workspace) ? c.workspace : {}
  const g = isObj(c.guard) ? c.guard : {}
  return {
    ...d,
    ...c,
    workspace: { root: str(ws.root, '.'), cards_dir: str(ws.cards_dir, d.workspace.cards_dir), worktrees_dir: str(ws.worktrees_dir, d.workspace.worktrees_dir) },
    repos: (Array.isArray(c.repos) ? c.repos : []).filter((r) => isObj(r) && typeof r.path === 'string' && r.path),
    guard: {
      protected_paths: (Array.isArray(g.protected_paths) ? g.protected_paths : []).filter((x) => typeof x === 'string'),
      allowed_bash: (Array.isArray(g.allowed_bash) ? g.allowed_bash : []).filter((x) => reOk(x, null) !== null),
      migration_script_re: reOk(g.migration_script_re, d.guard.migration_script_re),
      forbidden_script_re: reOk(g.forbidden_script_re, d.guard.forbidden_script_re),
    },
    e2e: isObj(c.e2e) && typeof c.e2e.dir === 'string' ? c.e2e : undefined,
    db: isObj(c.db) && typeof c.db.env_file === 'string' ? c.db : undefined,
    secrets: { env_file: str(c.secrets?.env_file, '.ff.env') },
    worker: isObj(c.worker) ? { ...d.worker, ...c.worker, tmux: { ...d.worker.tmux, ...(isObj(c.worker.tmux) ? c.worker.tmux : {}) } } : d.worker,
  }
}

export function getKey(obj, key) {
  let cur = obj
  for (const part of key.split('.')) {
    if (Array.isArray(cur)) cur = cur.find((x) => isObj(x) && x.name === part) ?? (/^\d+$/.test(part) ? cur[Number(part)] : undefined)
    else if (isObj(cur) && Object.hasOwn(cur, part)) cur = cur[part]
    else return { found: false }
    if (cur === undefined || cur === null) return { found: false }
  }
  return { found: true, value: cur }
}
