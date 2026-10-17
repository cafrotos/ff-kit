import fs from 'node:fs'
import path from 'node:path'
import { baseConfig, makeWorkspace, git } from './fixture.mjs'

export function makeShipWorkspace(t, { repoNames = ['web'], taskId = '123' } = {}) {
  const config = baseConfig()
  config.repos = repoNames.map(name => ({ name, path: name, base_branch: 'prod', ship_branch: 'dev', commands: {} }))
  const w = makeWorkspace({ config }); t.after(w.cleanup)
  const cardDir = path.join(w.root, 'trellocards', taskId)
  fs.mkdirSync(cardDir)
  const branches = {}, copies = {}, origins = {}, forkShas = {}
  for (const repo of config.repos) {
    const source = path.join(w.root, repo.path), branch = `task/${taskId}`
    branches[repo.name] = branch
    origins[repo.name] = path.join(w.root, `${repo.name}.git`)
    git(w.root, 'clone', '--bare', source, origins[repo.name])
    git(source, 'remote', 'add', 'origin', origins[repo.name])
    git(source, 'branch', 'dev'); git(source, 'push', 'origin', 'dev')
    const copy = path.join(w.root, 'worktrees', taskId, repo.name)
    fs.mkdirSync(path.dirname(copy), { recursive: true })
    git(w.root, 'clone', source, copy)
    git(copy, 'remote', 'rename', 'origin', 'ff-local')
    git(copy, 'remote', 'add', 'origin', origins[repo.name])
    git(copy, 'switch', '-c', branch)
    copies[repo.name] = copy; forkShas[repo.name] = git(copy, 'rev-parse', 'HEAD')
  }
  fs.writeFileSync(path.join(cardDir, '01-dossier.md'), `## Branch\n\n\`\`\`\n${branches[repoNames[0]]}\n\`\`\`\n`)
  return { root: w.root, config, cardDir, copies, origins, branches, forkShas }
}
