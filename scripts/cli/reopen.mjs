import fs from 'node:fs'
import path from 'node:path'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { findCardDir } from '../lib/cards.mjs'
import { activeRevision, gateStatus, ledgerFor } from '../lib/gates.mjs'
import { readTask, writeTask } from '../../ff-worker/src/core/task-store.mjs'
import { git, repoDir, cardBranch } from './repo-common.mjs'

export const summary = 'reopen <id> --reason <text> — tạo hợp đồng rev-N, giữ lịch sử Gate'
export async function run(args, ctx) {
  try {
    const [id, flag, reason, ...rest] = args
    if (!id || flag !== '--reason' || !reason?.trim() || rest.length) throw new Error('dùng: ' + summary)
    const root = findRoot(ctx.cwd)
    if (!root) throw new Error('không thấy ff.config.yaml')
    const { config } = loadConfig(root), card = findCardDir(root, config, id)
    if (card.error) throw new Error(card.error)
    if (!fs.realpathSync(card.dir).startsWith(fs.realpathSync(root) + path.sep)) throw new Error('thẻ vượt khỏi workspace')
    const previous = activeRevision(card.dir)
    if (previous) {
      const rel = `${previous}/05-verify-report.md`
      const content = fs.existsSync(path.join(card.dir, rel)) ? fs.readFileSync(path.join(card.dir, rel), 'utf8') : ''
      if (gateStatus(root, id, 'GATE_C', rel, content, ledgerFor(card.dir, previous)) !== 'approved') throw new Error(`${previous} chưa hoàn tất Gate C; tiếp tục revision hiện tại`)
    }
    const revision = `rev-${previous ? Number(previous.slice(4)) + 1 : 1}`, dir = path.join(card.dir, revision)
    const slug = path.basename(card.dir), bases = {}, branch = cardBranch(path.join(card.dir, '01-dossier.md'))
    for (const repo of config.repos) {
      const copy = repoDir(root, config.workspace.worktrees_dir, slug, repo)
      if (!fs.existsSync(path.join(copy, '.git'))) continue
      const current = git(copy, ['branch', '--show-current'])
      if (!branch || current.status !== 0 || current.stdout.trim() !== branch) throw new Error(`${repo.name} phải ở nhánh task ${branch ?? '(thiếu Branch trong dossier)'} trước reopen; giữ nguyên bản copy`)
      const head = git(copy, ['rev-parse', 'HEAD'])
      if (head.status !== 0) throw new Error(`không đọc được revision base của ${repo.name}`)
      bases[repo.name] = head.stdout.trim()
    }
    const metadata = { version: 1, revision, reason: reason.trim(), createdAt: new Date().toISOString(), previousRevision: previous, bases }
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'revision.json'), JSON.stringify(metadata, null, 2) + '\n', { mode: 0o600 })
    for (const [name, title] of [['delta.md', 'Delta Brief'], ['02-spec.md', 'Spec'], ['03-design.md', 'Design'], ['05-verify-report.md', 'Verify report']]) {
      fs.writeFileSync(path.join(dir, name), `> Trạng thái: CHỜ DUYỆT\n# ${title} ${id} ${revision}\n\n<!-- Điền hợp đồng từ dossier/ledger trước khi trình Gate; không phải bằng chứng hoàn tất. -->\n`, { mode: 0o600 })
    }
    const task = readTask(root, id)
    if (task) writeTask(root, { ...task, phase: 'received', revision, launchAttempts: 0, startedAt: undefined, completedAt: undefined, updatedAt: new Date().toISOString() })
    ctx.stdout.write(`Reopen ${id}: ${path.relative(root, dir)}; Gate A dùng [#${id}] [${revision}] và delta.md\n`)
    return 0
  } catch (e) { ctx.stderr.write(`ff reopen: ${e.message}\n`); return 1 }
}
