import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {makeShipWorkspace} from './helpers/ship.mjs'
import {commitShipFixture as commit,authorizeShipFixture as authorize} from './helpers/ship-authorized.mjs'
import {git, writeLock} from './helpers/fixture.mjs'
import {prepareShipTest,runShip} from '../scripts/lib/ship.mjs'
import {readShipTest,validateShipTest} from '../scripts/lib/ship-test-record.mjs'
import {readShipState} from '../scripts/lib/ship-store.mjs'

const advance=(f,file,content='x')=>{const tmp=path.join(f.root,'other'+file);git(f.root,'clone',f.origins.web,tmp);git(tmp,'switch','dev');fs.writeFileSync(path.join(tmp,file),content);git(tmp,'add','.');git(tmp,'-c','user.name=t','-c','user.email=t@t','commit','-qm','other '+file);git(tmp,'push','origin','dev');return git(tmp,'rev-parse','HEAD')}
const prep=f=>prepareShipTest({root:f.root,config:f.config,cardId:'123'})

test('test branch = origin/dev + the single feature squash commit, local only', async t => {
  const f = makeShipWorkspace(t), feature = commit(f)
  const r = await prep(f); assert.equal(r.ok, true, JSON.stringify(r))
  const e = r.record.repos.web
  assert.equal(e.featureSha, feature); assert.equal(e.baseSha, git(f.origins.web, 'rev-parse', 'dev'))
  assert.equal(git(e.checkout, 'rev-parse', 'HEAD^'), e.baseSha); assert.equal(git(e.checkout, 'rev-parse', 'ff-test/123'), e.testSha)
  assert.match(git(e.checkout, 'log', '-1', '--format=%B'), new RegExp(`cherry picked from commit ${feature}`))
  assert.notEqual(spawnSync('git', ['show-ref', '--verify', 'refs/heads/ff-test/123'], {cwd: f.origins.web}).status, 0) // never pushed
  assert.equal(git(f.copies.web, 'rev-parse', 'HEAD'), feature) // feature worktree untouched
  assert.deepEqual(readShipTest(f.root, '123', ''), r.record); assert.equal(validateShipTest(r.record, {web: feature}).valid, true)
})
test('conflict -> not ok, files reported, no record and no partial state', async t => {
  const f = makeShipWorkspace(t); commit(f); advance(f, 'a.txt', 'other')
  const r = await prep(f); assert.equal(r.ok, false); assert.equal(r.reason, 'conflict'); assert.deepEqual(r.files, ['a.txt'])
  assert.equal(readShipTest(f.root, '123', ''), null)
  const sub = path.join(f.root, 'worktrees/123.test/web')
  assert.equal(git(sub, 'status', '--porcelain'), ''); assert.equal(git(sub, 'rev-parse', 'HEAD'), git(f.origins.web, 'rev-parse', 'dev'))
})
test('feature must be exactly one commit before first push', async t => {
  const f = makeShipWorkspace(t); commit(f); commit(f, 'b.txt')
  await assert.rejects(prep(f), /squash/); assert.equal(readShipTest(f.root, '123', ''), null)
})
test('re-verify after fix (amend) rebuilds from the current origin tip; old record is invalidated', async t => {
  const f = makeShipWorkspace(t), first = commit(f), r1 = await prep(f)
  fs.writeFileSync(path.join(f.copies.web, 'a.txt'), 'fixed'); git(f.copies.web, 'add', 'a.txt'); git(f.copies.web, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--amend', '--no-edit', '-q')
  const fixed = git(f.copies.web, 'rev-parse', 'HEAD'); assert.notEqual(fixed, first)
  assert.equal(validateShipTest(r1.record, {web: fixed}).valid, false) // stale feature SHA
  const tip = advance(f, 'z.txt'), r2 = await prep(f)
  assert.equal(r2.record.repos.web.baseSha, tip); assert.equal(r2.record.repos.web.featureSha, fixed)
  assert.equal(git(r2.record.repos.web.checkout, 'show', 'HEAD:a.txt'), 'fixed'); assert.equal(git(r2.record.repos.web.checkout, 'show', 'HEAD:z.txt'), 'x')
  assert.equal(git(r2.record.repos.web.checkout, 'rev-list', '--count', `${tip}..HEAD`), '1')
})
test('tampering with the test checkout invalidates the record', async t => {
  const f = makeShipWorkspace(t), feature = commit(f), r = await prep(f), e = r.record.repos.web
  git(e.checkout, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-qm', 'extra')
  assert.equal(validateShipTest(r.record, {web: feature}).valid, false)
})
test('S1 reuses the tested commit when origin/dev is unchanged', async t => {
  const f = makeShipWorkspace(t); commit(f); const r = await prep(f), e = r.record.repos.web; await authorize(f)
  const view = await runShip({root: f.root, config: f.config, cardId: '123'}); assert.equal(view.s1Complete, true, JSON.stringify(view))
  assert.equal(git(f.origins.web, 'rev-parse', 'dev'), e.testSha)
  const row = readShipState(f.root, '123').runs.at(-1).repos.web; assert.equal(row.testedCommit, true)
  assert.equal(git(f.origins.web, 'rev-parse', 'task/123'), e.featureSha)
})
test('S1 re-cherry-picks and runs build+test when origin/dev advanced', async t => {
  const f = makeShipWorkspace(t); commit(f); const r = await prep(f), e = r.record.repos.web; await authorize(f); const tip = advance(f, 'z.txt')
  const ran = []
  const view = await runShip({root: f.root, config: f.config, cardId: '123', runCommand: cmd => { ran.push(cmd); return {status: 0} }})
  assert.equal(view.s1Complete, true, JSON.stringify(view)); assert.deepEqual(ran, ['node -v', 'node -v'])
  const dev = git(f.origins.web, 'rev-parse', 'dev'); assert.notEqual(dev, e.testSha); assert.equal(git(f.origins.web, 'rev-parse', `${dev}^`), tip)
  assert.equal(readShipState(f.root, '123').runs.at(-1).repos.web.testedCommit, undefined)
})
test('advanced base with conflict or red checks blocks and pushes nothing', async t => {
  for (const kind of ['conflict', 'red']) {
    const f = makeShipWorkspace(t); commit(f); await prep(f); await authorize(f); const tip = advance(f, kind === 'conflict' ? 'a.txt' : 'z.txt', 'other')
    const view = await runShip({root: f.root, config: f.config, cardId: '123', runCommand: kind === 'red' ? () => ({status: 1}) : undefined})
    assert.equal(view.s1Complete, false, kind); assert.equal(view.blockedReason, kind === 'conflict' ? 'conflict' : 'checks')
    assert.equal(git(f.origins.web, 'rev-parse', 'dev'), tip, kind); assert.notEqual(spawnSync('git', ['show-ref', '--verify', 'refs/heads/task/123'], {cwd: f.origins.web}).status, 0)
  }
})
test('CLI ff ship-test prints the three SHAs; conflict exits 1', async t => {
  const {run} = await import('../scripts/cli/ship-test.mjs'), f = makeShipWorkspace(t); commit(f)
  const io = () => { const o = {out: '', err: ''}; return {o, ctx: {cwd: f.root, stdout: {write: s => { o.out += s }}, stderr: {write: s => { o.err += s }}}} }
  let c = io(); assert.equal(await run(['123'], c.ctx), 0, c.o.err); const j = JSON.parse(c.o.out); assert.equal(j.repos.web.baseSha, git(f.origins.web, 'rev-parse', 'dev'))
  advance(f, 'a.txt', 'other'); c = io(); assert.equal(await run(['123'], c.ctx), 1); assert.match(c.o.err, /conflict/)
})
test('verify receipt must bind the ship-test record (3 SHAs); required by default', async t => {
  const {validateStageReceipt, readStageReceipt} = await import('../scripts/lib/stage-receipts.mjs')
  const f = makeShipWorkspace(t); commit(f); const r = await prep(f); await authorize(f) // authorize hash-binds the record in the verify receipt
  const valid = () => validateStageReceipt(f.root, f.config, readStageReceipt(f.root, '123', 'verify', ''))
  assert.equal(valid().valid, true, JSON.stringify(valid()))
  const rec = path.join(f.root, '.ff/ship-test/123/root.json'), saved = fs.readFileSync(rec)
  fs.rmSync(rec); assert.equal(valid().valid, false); fs.writeFileSync(rec, saved); assert.equal(valid().valid, true)
  git(r.record.repos.web.checkout, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-qm', 'drift')
  assert.match(valid().reasons[0], /ship-test/)
})
test('verify-up runs migrations from the ship test checkout and refuses without one (required by default)', async t => {
  const {run} = await import('../scripts/cli/verify-up.mjs'), YAML = (await import('yaml')).default, f = makeShipWorkspace(t); commit(f)
  const w = (rel, body = '') => { const p = path.join(f.root, rel); fs.mkdirSync(path.dirname(p), {recursive: true}); fs.writeFileSync(p, body); return p }
  w('ff-e2e/package.json', '{}'); w('ff-e2e/node_modules/@playwright/test/package.json', '{"name":"@playwright/test"}'); w('ff-e2e/up.js'); w('ff-e2e/down.js'); w('ff-e2e/chromium')
  fs.chmodSync(w('ff-e2e/node_modules/.bin/playwright', '#!/bin/sh\nexit 0\n'), 0o755)
  w('ff-e2e/node_modules/playwright/index.js', `exports.chromium = { executablePath: () => ${JSON.stringify(path.join(f.root, 'ff-e2e/chromium'))} }`)
  f.config.e2e = {dir: 'ff-e2e', up_cmd: 'node up.js', down_cmd: 'node down.js', health_urls: ['http://localhost:8080/health'], apps: [{name: 'web', base_url: 'http://localhost:3001'}]}
  f.config.repos[0].commands = {migrate: 'node migrate.js'}
  fs.writeFileSync(path.join(f.root, 'ff.config.yaml'), YAML.stringify(f.config)); writeLock(f.root, f.config)
  const mk = () => { const o = {err: ''}, cwds = []; return {o, cwds, ctx: {cwd: f.root, stdout: {write() {}}, stderr: {write: s => { o.err += s }}, runCommand: (c, cwd) => { cwds.push([c, cwd]); return {status: 0} }, fetch: async () => ({ok: true, status: 200}), sleep: async () => {}, healthAttempts: 1}} }
  let c = mk(); assert.equal(await run(['123', 'web'], c.ctx), 1, c.o.err); assert.match(c.o.err, /ff ship-test 123/) // no record: refused (and lock returned)
  const r = await prep(f); c = mk(); assert.equal(await run(['123', 'web'], c.ctx), 0, c.o.err)
  assert.deepEqual(c.cwds[0], ['node migrate.js', r.record.repos.web.checkout]); assert.ok(c.cwds.some(([cmd]) => cmd === 'node up.js'))
})

test('test checkout is laid out like the workspace under <worktrees_dir>/<slug>.test/, unchanged repos on origin/<ship_branch>, env_files copied from the base repo', async t => {
  const f = makeShipWorkspace(t, {repoNames: ['web', 'api']}); commit(f)
  // api has no card copy -> unchanged
  fs.rmSync(f.copies.api, {recursive: true, force: true})
  f.config.repos[1].env_files = ['.env.local']; f.config.repos[0].env_files = ['.env.local']
  fs.writeFileSync(path.join(f.root, 'api/.env.local'), 'SECRET=1\n'); fs.writeFileSync(path.join(f.root, 'web/.env.local'), 'WEB=1\n')
  const r = await prep(f); assert.equal(r.ok, true, JSON.stringify(r))
  const testRoot = path.join(f.root, 'worktrees/123.test')
  assert.equal(r.record.repos.web.checkout, path.join(testRoot, 'web')); assert.equal(r.record.repos.api.checkout, path.join(testRoot, 'api'))
  assert.equal(r.record.repos.api.unchanged, true); assert.equal(git(r.record.repos.api.checkout, 'rev-parse', 'HEAD'), git(f.origins.api, 'rev-parse', 'dev'))
  assert.equal(fs.readFileSync(path.join(testRoot, 'api/.env.local'), 'utf8'), 'SECRET=1\n'); assert.equal(fs.readFileSync(path.join(testRoot, 'web/.env.local'), 'utf8'), 'WEB=1\n')
  assert.equal(validateShipTest(r.record, {web: git(f.copies.web, 'rev-parse', 'HEAD')}).valid, true)
})
