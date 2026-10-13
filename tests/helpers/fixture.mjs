import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import YAML from 'yaml'

export function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

export function baseConfig() {
  return {
    version: 1,
    workspace: { root: '.', cards_dir: 'trellocards', worktrees_dir: 'worktrees' },
    repos: [{ name: 'web', path: 'web', base_branch: 'dev', ship_branch: 'dev', commands: { install: 'node -v', build: 'node -v' } }],
    worker: {
      max_concurrent_tasks: 2,
      task_source: { adapter: 'trello', trello: { board_id: 'b1', poll_lists: ['Doing', 'QA Fail'], done_list: 'Ready For QA' } },
      channel: { adapter: 'console' },
    },
    secrets: { env_file: '.ff.env' },
  }
}

// Tạo workspace tạm: repo git thật (nhánh base_branch, 1 commit), cards_dir, worktrees_dir, ff.config.yaml, file thêm.
export function makeWorkspace({ config = baseConfig(), files = {}, gitRepos = true } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ff-kit-')))
  const cfg = config ?? {}
  for (const r of cfg.repos ?? []) {
    const p = path.join(root, r.path)
    fs.mkdirSync(p, { recursive: true })
    if (gitRepos) {
      git(p, 'init', '-q', '-b', r.base_branch)
      git(p, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
    }
  }
  fs.mkdirSync(path.join(root, cfg.workspace?.cards_dir ?? 'trellocards'), { recursive: true })
  fs.mkdirSync(path.join(root, cfg.workspace?.worktrees_dir ?? 'worktrees'), { recursive: true })
  if (config !== null) fs.writeFileSync(path.join(root, 'ff.config.yaml'), YAML.stringify(config))
  for (const [rel, content] of Object.entries(files)) {
    const f = path.join(root, rel)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, content)
  }
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}
