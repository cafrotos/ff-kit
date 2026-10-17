import fs from 'node:fs'
import path from 'node:path'
import { git, cardBranch, repoDir, readRevisionBase } from '../cli/repo-common.mjs'

function checked(dir, args) {
  const result = git(dir, args)
  if (result.status !== 0) throw new Error(`git ${args[0]}: không đọc được mốc remote`)
  return result.stdout.trim()
}
function validBranch(dir, branch) {
  if (!branch || branch.startsWith('refs/') || git(dir, ['check-ref-format', '--branch', branch]).status !== 0) throw new Error('branch không hợp lệ')
}
function remoteHead(dir, branch) {
  validBranch(dir, branch)
  const ref = `refs/heads/${branch}`
  // Fetch before inspection; never trust a stale tracking reference after deletion.
  checked(dir, ['fetch', '--prune', 'origin'])
  const lines = checked(dir, ['ls-remote', '--heads', 'origin', ref])
  const sha = lines.split(/\r?\n/).find(line => line.split(/\s+/)[1] === ref)?.split(/\s+/)[0]
  const prior = git(dir, ['config', '--get', 'ff.shippedTaskHead']).stdout.trim()
  if (!sha && prior) throw new Error('thiếu mốc remote của repo đã ship')
  if (sha) {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)) throw new Error('mốc remote không hợp lệ')
    checked(dir, ['fetch', 'origin', ref])
  }
  return sha || null
}
export function originalFork(dir, repo) {
  validBranch(dir, repo.base_branch)
  const saved = git(dir, ['config', '--get', 'ff.originalFork']).stdout.trim()
  if (saved) return saved
  const remote = git(dir, ['config', '--get', 'remote.ff-local.url']).status === 0 ? 'ff-local' : 'origin'
  // ff-local is the copy-time snapshot, never the moving upstream prod.
  const sha = checked(dir, ['merge-base', 'HEAD', `refs/remotes/${remote}/${repo.base_branch}`])
  checked(dir, ['config', 'ff.originalFork', sha])
  return sha
}
export function getTaskCommitRange({ root, config, cardDir, repo, repoPath }) {
  const branch = cardBranch(path.join(cardDir, '01-dossier.md'))
  validBranch(repoPath, branch)
  if (checked(repoPath, ['branch', '--show-current']) !== branch) throw new Error('repo phải ở branch task')
  const sourceHead = checked(repoPath, ['rev-parse', 'HEAD'])
  const remote = remoteHead(repoPath, branch)
  const baseline = readRevisionBase(cardDir, repo.name, repoPath)
  const fork = originalFork(repoPath, repo)
  const baseSha = baseline?.sha ?? remote ?? fork
  if (baseline && remote && remote !== baseSha && remote !== sourceHead) throw new Error('mốc remote không khớp revision base')
  if (git(repoPath, ['merge-base', '--is-ancestor', baseSha, sourceHead]).status !== 0) throw new Error('mốc remote không phải ancestor của HEAD')
  if (remote && git(repoPath, ['merge-base', '--is-ancestor', remote, sourceHead]).status !== 0) throw new Error('mốc remote không khớp HEAD')
  if (remote) checked(repoPath, ['config', 'ff.shippedTaskHead', remote])
  const commits = checked(repoPath, ['rev-list', '--reverse', `${baseSha}..${sourceHead}`]).split('\n').filter(Boolean)
  return { baseSha, sourceHead, commits, alreadyShipped: remote === sourceHead, firstShip: !remote }
}
export function captureReopenBases({ root, config, cardDir, taskBranch }) {
  const bases = {}, pending = []
  const previous = fs.readdirSync(cardDir).filter(name => /^rev-[1-9]\d*$/.test(name)).sort((a,b) => Number(b.slice(4))-Number(a.slice(4)))[0]
  const shippedRepos = previous ? JSON.parse(fs.readFileSync(path.join(cardDir, previous, 'revision.json'), 'utf8')).shippedRepos ?? [] : []
  for (const repo of config.repos) {
    const dir = repoDir(root, config.workspace.worktrees_dir, path.basename(cardDir), repo)
    if (!fs.existsSync(path.join(dir, '.git'))) {
      if (shippedRepos.includes(repo.name)) throw new Error(`${repo.name}: thiếu repo đã ship / mốc remote`)
      continue
    }
    if (shippedRepos.includes(repo.name) && !git(dir, ['config', '--get', 'ff.shippedTaskHead']).stdout.trim()) throw new Error(`${repo.name}: thiếu mốc remote đã ship`)
    validBranch(dir, taskBranch)
    if (checked(dir, ['branch', '--show-current']) !== taskBranch) throw new Error(`${repo.name}: phải ở branch task trước reopen`)
    const remote = remoteHead(dir, taskBranch), head = checked(dir, ['rev-parse', 'HEAD'])
    if (remote && remote !== head) throw new Error(`${repo.name}: HEAD không khớp mốc remote; giữ nguyên bản copy`)
    bases[repo.name] = remote ?? originalFork(dir, repo)
    if (git(dir, ['merge-base', '--is-ancestor', bases[repo.name], head]).status !== 0) throw new Error(`${repo.name}: mốc không phải ancestor`)
    if (remote) pending.push([dir, remote])
  }
  for (const [dir, sha] of pending) checked(dir, ['config', 'ff.shippedTaskHead', sha])
  return bases
}
