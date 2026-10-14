import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeGuard } from '../scripts/lib/guard-rules.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { makeWorkspace, baseConfig } from './helpers/fixture.mjs'

const WT = 'worktrees/999-guard-test'
const now = () => Math.floor(Date.now() / 1000)

function setup(t, mut = (c) => c) {
  const config = baseConfig()
  config.repos = [
    { name: 'api', path: 'api', base_branch: 'dev', ship_branch: 'dev', commands: { build: 'node -v' } },
    { name: 'web', path: 'web', base_branch: 'dev', ship_branch: 'dev', commands: { build: 'node -v' } },
  ]
  config.e2e = { dir: 'e2e', tests_dir: 'e2e/tests' }
  const ws = makeWorkspace({ config: mut(config), gitRepos: false })
  t.after(ws.cleanup)
  for (const d of ['e2e/tests', `${WT}/api`]) fs.mkdirSync(path.join(ws.root, d), { recursive: true })
  const G = makeGuard(ws.root, loadConfig(ws.root).config)
  const at = (rel) => path.join(ws.root, rel)
  const check = (want, mode, cwd, cmd) => {
    const r = G.evaluate({ cmd, cwd: at(cwd), mode })
    assert.equal(r === null ? 0 : 2, want, `[${mode}] (${cwd}) ${cmd} → ${r}`)
  }
  const checkFile = (want, mode, tool, cwd, file) => {
    const r = G.evaluate({ file, tool, cwd: at(cwd), mode })
    assert.equal(r === null ? 0 : 2, want, `[${mode} ${tool}] ${file} → ${r}`)
  }
  return { root: ws.root, at, G, check, checkFile }
}

test('push chỉ qua khi có marker ship còn hạn', (t) => {
  const { at, check } = setup(t)
  check(2, 'base', 'api', 'git push origin prod')
  check(2, 'base', WT, 'cd api && git push -u origin feature/x')
  fs.writeFileSync(at(`${WT}/.ff-ship-approved`), `${now()}\n`)
  check(0, 'base', WT, 'cd api && git push -u origin feature/x')
  check(0, 'base', '.', `git -C ${WT}/api push origin dev`)
  fs.writeFileSync(at(`${WT}/.ff-ship-approved`), `${now() - 3 * 3600}\n`)
  check(2, 'base', WT, 'cd api && git push origin dev')
  fs.rmSync(at(`${WT}/.ff-ship-approved`))
  check(2, 'base', 'api', 'FF_ALLOW_PUSH=1 git push origin feature/x')
  check(2, 'base', 'api', 'echo FF_ALLOW_PUSH=1; git push origin feature/x')
})

test('add / commit / stash', (t) => {
  const { check } = setup(t)
  const d = `${WT}/api`
  check(2, 'base', d, 'git add -A')
  check(2, 'base', d, 'git add .')
  check(2, 'base', d, 'git add -u')
  check(0, 'base', d, 'git add src/a.ts ./src/b.ts')
  check(2, 'base', d, "git commit -am 'x'")
  check(0, 'base', d, "git commit -m 'add all the things'")
  check(2, 'base', d, 'git stash')
  check(2, 'base', d, 'git stash push -m wip')
  check(0, 'base', d, 'git stash list')
})

test('kill', (t) => {
  const { check } = setup(t)
  check(2, 'base', WT, 'kill 1234')
  check(2, 'base', WT, 'lsof -ti:3001 | xargs kill -9')
  check(2, 'base', WT, 'pkill -f vite')
  check(0, 'base', WT, 'kill -0 1234')
  check(0, 'base', WT, 'ff verify-down 999')
})

test('migration chỉ trong worktree, :prod cấm hẳn', (t) => {
  const { check } = setup(t)
  check(2, 'base', 'api', 'yarn migration:run')
  check(0, 'base', `${WT}/api`, 'yarn migration:run')
  check(0, 'base', '.', `cd ${WT}/api && yarn migration:run`)
  check(2, 'base', `${WT}/api`, 'yarn migration:run:prod')
  check(0, 'base', 'api', 'yarn migration:show')
  check(2, 'base', 'api', 'yarn run migration:run')
})

test('migration theo regex cấu hình', (t) => {
  const { check } = setup(t, (c) => ({ ...c, guard: { migration_script_re: '^db:migrate$' } }))
  check(2, 'base', 'api', 'npm run db:migrate')
  check(0, 'base', 'api', 'yarn migration:run')
})

test('playwright phải kèm path thẻ', (t) => {
  const { check } = setup(t)
  check(2, 'base', 'e2e', 'npx playwright test')
  check(2, 'base', 'e2e', 'yarn test')
  check(0, 'base', 'e2e', 'npx playwright test tests/123-abc/')
  check(0, 'base', '.', 'cd e2e && npx playwright test tests/123-abc/x.spec.ts')
  check(0, 'base', 'web/apps/crm', 'yarn test')
})

test('heredoc và chuỗi chỉ là dữ liệu', (t) => {
  const { check } = setup(t)
  check(0, 'base', '.', "python3 - <<'EOF'\ns = 'yarn migration:revert và git push origin dev, git stash'\nEOF")
  check(0, 'base', '.', "grep -n 'migration:run' docs/x.md")
  check(2, 'base', '.', 'cat <<EOF > /tmp/x\nhi\nEOF\ngit stash')
  check(0, 'base', 'api', 'git status -sb && git log --oneline -3')
  check(0, 'base', 'api', 'git checkout dev && git pull')
})

test('lệnh bọc', (t) => {
  const { check } = setup(t)
  check(2, 'base', WT, 'bash -c "git push origin dev"')
  check(2, 'base', WT, "sh -c 'git stash'")
  check(2, 'base', WT, 'eval "git add -A"')
  check(2, 'base', WT, 'echo $(git push origin x)')
  check(2, 'base', WT, 'echo `pkill node`')
  check(2, 'base', '.', 'bash -c "yarn migration:run"')
  check(2, 'base', `${WT}/api`, 'bash -c "yarn migration:run:prod"')
  check(0, 'base', WT, "T=$(git log -1 --format=%B origin/$B | grep -m1 '^Trello: #')")
  check(0, 'base', WT, 'M=$(git rev-parse HEAD)')
  check(0, 'base', WT, 'bash -c "echo hello"')
  check(0, 'base', WT, 'echo $(git add ./src/a.ts)')
  check(0, 'base', WT, 'git log -1 --format=%B | grep -qxF "$T"')
  check(0, 'base', WT, 'echo skill')
  check(2, 'base', '.', '(cd api && git stash)')
})

test('feature-flow: repo gốc là bản gương', (t) => {
  const { check, checkFile } = setup(t)
  check(2, 'feature-flow', 'api', 'git commit -m x')
  check(2, 'feature-flow', '.', 'git -C web checkout -b feature/x')
  check(0, 'feature-flow', 'api', 'git checkout dev && git pull')
  check(0, 'feature-flow', `${WT}/api`, 'git commit -m x')
  check(2, 'feature-flow', 'api', 'git push origin x')
  checkFile(2, 'feature-flow', 'Edit', '.', 'web/apps/recruit/src/a.tsx')
  checkFile(2, 'feature-flow', 'Write', 'api', 'src/x.ts')
  checkFile(0, 'feature-flow', 'Edit', '.', `${WT}/api/src/x.ts`)
  checkFile(0, 'feature-flow', 'Edit', '.', 'web/CLAUDE.md')
  checkFile(0, 'feature-flow', 'Edit', '.', 'trellocards/123-x/02-spec.md')
  checkFile(0, 'feature-flow', 'Read', '.', 'web/apps/recruit/src/a.tsx')
})

test('protected_paths và allowed_bash', (t) => {
  const { check, checkFile } = setup(t, (c) => ({ ...c, guard: { protected_paths: ['shared'], allowed_bash: ['^git push origin docs$'] } }))
  checkFile(2, 'feature-flow', 'Edit', '.', 'shared/a.ts')
  check(0, 'base', 'api', 'git push origin docs')
  check(2, 'base', 'api', 'git push origin dev')
})

test('khóa test', (t) => {
  const { at, check, checkFile } = setup(t)
  const slug = '990-lock-test'
  const rel = `e2e/tests/${slug}/task-1-a.spec.ts`
  fs.mkdirSync(at(`worktrees/${slug}`), { recursive: true })
  fs.mkdirSync(at(`e2e/tests/${slug}`), { recursive: true })
  fs.writeFileSync(at(rel), 'x')
  fs.writeFileSync(at(`e2e/tests/${slug}/task-1-b.spec.ts`), 'y')
  fs.writeFileSync(at(`worktrees/${slug}/.ff-test-lock`), `${'0'.repeat(64)}  ${rel}\n`)
  checkFile(2, 'base', 'Edit', '.', rel)
  checkFile(2, 'base', 'Write', '.', at(rel))
  checkFile(2, 'feature-flow', 'Edit', '.', rel)
  checkFile(2, 'base', 'MultiEdit', 'e2e', `tests/${slug}/task-1-a.spec.ts`)
  checkFile(0, 'base', 'Read', '.', rel)
  checkFile(0, 'base', 'Edit', '.', `e2e/tests/${slug}/task-1-b.spec.ts`)
  checkFile(0, 'feature-flow', 'Edit', '.', `e2e/tests/${slug}/task-1-b.spec.ts`)
  checkFile(0, 'base', 'Edit', '.', 'web/apps/recruit/src/a.tsx')
  checkFile(0, 'base', 'Write', 'api', 'src/x.ts')
  check(2, 'base', '.', `sed -i '' 's/x/y/' ${rel}`)
  check(2, 'base', 'e2e', `echo hi >> tests/${slug}/task-1-a.spec.ts`)
  check(2, 'base', '.', `rm ${rel}`)
  check(2, 'base', '.', `chmod u+w ${rel}`)
  check(2, 'base', '.', `cp /tmp/a ${rel}`)
  check(0, 'base', '.', `cat ${rel}`)
  check(0, 'base', '.', `cat ${rel} 2>/dev/null | head -3`)
  check(0, 'base', '.', `sed -i '' 's/x/y/' e2e/tests/${slug}/task-1-b.spec.ts`)
  check(0, 'base', '.', 'ff relock 990 --reason x')
  check(0, 'base', '.', 'ff lock-tests 990')
})

test('allowlist đợt', (t) => {
  const { at, checkFile } = setup(t)
  const slug = '990-allow-test'
  fs.mkdirSync(at(`worktrees/${slug}/web/src`), { recursive: true })
  const allow = (ts) => fs.writeFileSync(at(`worktrees/${slug}/.ff-allow`), `ts=${ts}\nweb/src/a.ts\nweb/src/b.ts\n`)
  allow(now())
  checkFile(0, 'base', 'Edit', '.', `worktrees/${slug}/web/src/a.ts`)
  checkFile(0, 'feature-flow', 'Write', '.', at(`worktrees/${slug}/web/src/b.ts`))
  checkFile(2, 'base', 'Edit', '.', `worktrees/${slug}/web/src/c.ts`)
  checkFile(2, 'feature-flow', 'Write', '.', at(`worktrees/${slug}/web/src/c.ts`))
  checkFile(2, 'base', 'MultiEdit', `worktrees/${slug}/web`, 'src/c.ts')
  checkFile(0, 'base', 'Edit', '.', 'web/CLAUDE.md')
  checkFile(0, 'base', 'Read', '.', `worktrees/${slug}/web/src/c.ts`)
  checkFile(0, 'base', 'Edit', '.', `trellocards/${slug}/04-plan.md`)
  checkFile(0, 'base', 'Write', '.', `${WT}/api/src/x.ts`)
  allow(now() - 5 * 3600)
  checkFile(0, 'base', 'Edit', '.', `worktrees/${slug}/web/src/c.ts`)
  fs.rmSync(at(`worktrees/${slug}/.ff-allow`))
  checkFile(0, 'base', 'Edit', '.', `worktrees/${slug}/web/src/c.ts`)
})

test('guard qua đường dẫn symlink', (t) => {
  const { root, G } = setup(t)
  const link = root + '-link'
  fs.symlinkSync(root, link)
  t.after(() => fs.unlinkSync(link))
  assert.notEqual(G.evaluate({ cmd: 'git commit -m x', cwd: path.join(link, 'api'), mode: 'feature-flow' }), null)
  assert.notEqual(G.evaluate({ file: path.join(link, 'web/src/a.ts'), tool: 'Edit', cwd: link, mode: 'feature-flow' }), null)
  assert.equal(G.evaluate({ cmd: 'git commit -m x', cwd: path.join(link, WT, 'api'), mode: 'feature-flow' }), null)
})
