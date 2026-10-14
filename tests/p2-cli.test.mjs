import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { validateQuerySafety } from '../scripts/cli/db-query.mjs'
import { makeWorkspace, git, baseConfig } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'
import { allow, lockTests, relock, probeSlice, shipApprove } from '../scripts/cli/gate-tools.mjs'
import { acMatrix, designCheck } from '../scripts/cli/spec-checks.mjs'
import * as e2eLint from '../scripts/cli/e2e-lint.mjs'
import * as dbQuery from '../scripts/cli/db-query.mjs'

test('db-query chỉ nhận SELECT, WITH SELECT, EXPLAIN và bỏ qua literal',()=>{
  assert.equal(validateQuerySafety("select 'DELETE; DROP' as value; select 2").length,2)
  assert.throws(()=>validateQuerySafety('UPDATE users SET x=1'),/chỉ cho phép/)
  assert.throws(()=>validateQuerySafety('WITH x AS (DELETE FROM t) SELECT * FROM x'),/thao tác ghi/)
})

test('db-query chọn driver từ config, giới hạn file query và không lộ secret khi lỗi', async () => {
  const config = baseConfig()
  config.db = { driver: 'mysql', env_file: 'db.env' }
  config.project_docs = { verification_queries_dir: 'queries' }
  const ws = makeWorkspace({ config, files: {
    'db.env': 'DATABASE_PASSWORD=supersecret\nMYSQL_USER=user\n',
    'queries/read.sql': 'SELECT 1',
  } })
  try {
    let options
    const queries = []
    const ctx = capture(ws.root)
    ctx.ctx.connectDb = async (args) => {
      options = args
      return {
        connect: async () => {},
        query: async (sql) => {
          queries.push(sql)
          return { rows: sql === 'SELECT 1' ? [{ ok: 1 }] : [] }
        },
        end: async () => {},
      }
    }
    assert.equal(await dbQuery.run(['--file', 'queries/read.sql', '--json'], ctx.ctx), 0)
    assert.equal(options.config.db.driver, 'mysql')
    assert.equal(options.env.DATABASE_PASSWORD, 'supersecret')
    assert.deepEqual(queries, [
      'SET SESSION max_execution_time = 15000',
      'SET SESSION innodb_lock_wait_timeout = 5',
      'START TRANSACTION READ ONLY', 'SELECT 1', 'ROLLBACK',
    ])
    assert.deepEqual(JSON.parse(ctx.buf.out), [{ ok: 1 }])
    assert.doesNotMatch(ctx.buf.out + ctx.buf.err, /supersecret/)
    ctx.ctx.connectDb = async () => ({
      connect: async () => {},
      query: async (sql) => { if (sql === 'SELECT 1') throw new Error('failed supersecret'); return { rows: [] } },
      end: async () => {},
    })
    assert.equal(await dbQuery.run(['--sql', 'SELECT 1'], ctx.ctx), 1)
    assert.doesNotMatch(ctx.buf.err, /supersecret/)
    assert.match(ctx.buf.err, /\[redacted\]/)
    const rejected = capture(ws.root)
    assert.equal(await dbQuery.run(['--file', '../db.env'], rejected.ctx), 1)
    assert.match(rejected.buf.err, /phải nằm trong/)
  } finally { ws.cleanup() }
})

test('e2e-lint liệt kê heuristic và strict trả lỗi khi có dấu hiệu',async()=>{
  const ws=makeWorkspace({config:null,lock:false});try{fs.writeFileSync(path.join(ws.root,'weak.spec.ts'),"test.skip(true, 'file')\ntest('case', async () => {\n  test.skip(!process.env.X)\n  await page.click('x', { force: true })\n  await page.waitForTimeout(100)\n})\n");const normal=capture(ws.root);assert.equal(await e2eLint.run(['weak.spec.ts'],normal.ctx),0);assert.match(normal.buf.out,/force: true/);assert.match(normal.buf.out,/test.skip cấp file\/describe: 1/);assert.match(normal.buf.out,/test.skip trong thân test: 1/);const strict=capture(ws.root);assert.equal(await e2eLint.run(['weak.spec.ts','--strict'],strict.ctx),1)}finally{ws.cleanup()}
})

test('ac-matrix phân biệt COVERED/SKIP/MISSING/ORPHAN/DROPPED và design-check bắt dòng sai',async()=>{
  const config=baseConfig();config.e2e={dir:'e2e',tests_dir:'e2e/tests'};const ws=makeWorkspace({config});try{const card=path.join(ws.root,'trellocards/321-example/task-1');fs.mkdirSync(card,{recursive:true});fs.writeFileSync(path.join(card,'02-spec.md'),'- **AC-01** — Có test\n- **AC-02** — Skip\n- **AC-03** — Thiếu test\n- **AC-04** — _(bỏ)_\n- **AC-06a** — Hậu tố\n');fs.writeFileSync(path.join(card,'03-design.md'),'tham chiếu đúng `src.js:1`, sai `src.js:99`; `realFunction`; `missingFunctionZZZ`.\n');const td=path.join(ws.root,'e2e/tests/321-example');fs.mkdirSync(td,{recursive:true});fs.mkdirSync(path.join(ws.root,'web'),{recursive:true});const testFile=path.join(td,'task-1-x.spec.ts');fs.writeFileSync(testFile,"test('AC-01 does thing', async()=>{})\ntest.skip('AC-02 skipped', async()=>{})\ntest('AC-05 orphan', async()=>{})\ntest('AC-06 works without suffix', async()=>{})\n");fs.writeFileSync(path.join(ws.root,'web/src.js'),'function realFunction() {}\n');const a=capture(ws.root);assert.equal(await acMatrix.run(['321','task-1'],a.ctx),1);for(const status of ['AC-01: COVERED','AC-02: SKIP','AC-03: MISSING','AC-04: DROPPED','AC-05: ORPHAN','AC-06a: COVERED'])assert.match(a.buf.out,new RegExp(status));const wt=path.join(ws.root,'worktrees/321-example');fs.mkdirSync(path.join(wt,'web'),{recursive:true});fs.copyFileSync(path.join(ws.root,'web/src.js'),path.join(wt,'web/src.js'));const testHash=createHash('sha256').update(fs.readFileSync(testFile)).digest('hex');fs.writeFileSync(path.join(wt,'.ff-test-lock'),`${testHash}  ${path.relative(ws.root,testFile)}\n`);const locked=capture(ws.root);await acMatrix.run(['321','task-1'],locked.ctx);assert.match(locked.buf.out,/hash khớp/);fs.appendFileSync(testFile,'// changed after lock\n');const drift=capture(ws.root);assert.equal(await acMatrix.run(['321','task-1'],drift.ctx),1);assert.match(drift.buf.out,/HASH ĐỔI/);const d=capture(ws.root);assert.equal(await designCheck.run(['321','task-1'],d.ctx),1);assert.match(d.buf.out,/dòng ngoài file/);assert.doesNotMatch(d.buf.out,/src\.js:1 —/);assert.match(d.buf.out,/missingFunctionZZZ/)}finally{ws.cleanup()}
})

test('allow tạo allowlist và probe phát hiện file ngoài phạm vi',async()=>{
  const config=baseConfig();config.repos[0].base_branch='main';const ws=makeWorkspace({config});try{const slug='123-task';const wt=path.join(ws.root,'worktrees',slug),repo=path.join(wt,'web');fs.mkdirSync(repo,{recursive:true});git(repo,'init','-q','-b','main');git(repo,'-c','user.email=t@t','-c','user.name=t','commit','-q','--allow-empty','-m','init');git(repo,'checkout','-q','-b','feature');fs.writeFileSync(path.join(repo,'committed.ts'),'committed');git(repo,'add','committed.ts');git(repo,'-c','user.email=t@t','-c','user.name=t','commit','-q','-m','feature');fs.writeFileSync(path.join(repo,'ok.ts'),'ok');fs.writeFileSync(path.join(repo,'bad.ts'),'bad');const cap=capture(ws.root);await allow.run([slug,'web/ok.ts'],cap.ctx);assert.equal(fs.existsSync(path.join(wt,'.ff-allow')),true);const p=capture(ws.root);assert.equal(await probeSlice.run([slug,'--json'],p.ctx),1);assert.match(p.buf.out,/ALLOWLIST_VIOLATION/);assert.match(p.buf.out,/committed\.ts/)}finally{ws.cleanup()}
})

test('allow từ chối symlink trỏ ra ngoài worktree',async()=>{
  const ws=makeWorkspace();try{const slug='654-link',wt=path.join(ws.root,'worktrees',slug),outside=path.join(ws.root,'outside');fs.mkdirSync(path.join(wt,'web'),{recursive:true});fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(wt,'web','escape'));const cap=capture(ws.root);assert.equal(await allow.run([slug,'web/escape/file.ts'],cap.ctx),1);assert.match(cap.buf.err,/ngoài worktree/);assert.equal(fs.existsSync(path.join(wt,'.ff-allow')),false)}finally{ws.cleanup()}
})

test('allow --clear xóa allowlist hiện có',async()=>{
  const ws=makeWorkspace();try{const slug='655-clear',wt=path.join(ws.root,'worktrees',slug);fs.mkdirSync(wt,{recursive:true});fs.writeFileSync(path.join(wt,'.ff-allow'),'ts=1\nweb/a.ts\n');const cap=capture(ws.root);assert.equal(await allow.run([slug,'--clear'],cap.ctx),0);assert.equal(fs.existsSync(path.join(wt,'.ff-allow')),false)}finally{ws.cleanup()}
})

test('ship-approve ghi marker ngắn hạn và allow hết hạn sau 4 giờ',async()=>{
  const config=baseConfig();config.repos[0].base_branch='main';const ws=makeWorkspace({config});try{const slug='777-short',wt=path.join(ws.root,'worktrees',slug),repo=path.join(wt,'web');fs.mkdirSync(repo,{recursive:true});git(repo,'init','-q','-b','main');git(repo,'-c','user.email=t@t','-c','user.name=t','commit','-q','--allow-empty','-m','init');fs.writeFileSync(path.join(repo,'changed.ts'),'x');const ship=capture(ws.root);assert.equal(await shipApprove.run([slug],ship.ctx),0);assert.match(fs.readFileSync(path.join(wt,'.ff-ship-approved'),'utf8'),/^\d+\n/);fs.writeFileSync(path.join(wt,'.ff-allow'),`ts=${Math.floor(Date.now()/1000)-14401}\nweb/changed.ts\n`);const probe=capture(ws.root);assert.equal(await probeSlice.run([slug,'--json'],probe.ctx),1);assert.match(probe.buf.out,/"expired": true/)}finally{ws.cleanup()}
})

test('lock-tests khóa hash, relock cần lý do và cập nhật manifest',async()=>{
  const ws=makeWorkspace();try{const slug='456-task',wt=path.join(ws.root,'worktrees',slug),file=path.join(ws.root,'web','case.spec.ts');fs.mkdirSync(wt,{recursive:true});fs.writeFileSync(file,'test');const cap=capture(ws.root);assert.equal(await lockTests.run([slug,'web/case.spec.ts'],cap.ctx),0);assert.equal(fs.statSync(file).mode&0o222,0);const noReason=capture(ws.root);assert.equal(await relock.run([slug],noReason.ctx),1);const emptyReason=capture(ws.root);assert.equal(await relock.run([slug,'--reason',''],emptyReason.ctx),1);fs.chmodSync(file,0o644);fs.writeFileSync(file,'changed');const done=capture(ws.root);assert.equal(await relock.run([slug,'--reason','approved change'],done.ctx),0);assert.match(done.buf.out,/1 file thay đổi/)}finally{ws.cleanup()}
})
