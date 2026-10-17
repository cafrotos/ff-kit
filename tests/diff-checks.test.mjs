import './helpers/hermetic-home.mjs'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import {makeShipWorkspace} from './helpers/ship.mjs'
import {autoVerifyFixture} from './helpers/auto-verify.mjs'
import {git} from './helpers/fixture.mjs'
import {capture} from './helpers/io.mjs'
import {main} from '../scripts/cli/main.mjs'
import {globToRegExp,matchDeny,parsePlanFiles,checkDiff,DEFAULT_DENY_PATHS} from '../scripts/lib/diff-checks.mjs'
import {parseConfigText} from '../scripts/lib/config.mjs'
import {validate} from '../scripts/lib/schema.mjs'

const commit=(f,files,msg='change\n\nTrello: #123')=>{
 for(const [rel,body] of Object.entries(files)){const p=path.join(f.copies.web,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,body);git(f.copies.web,'add',rel)}
 git(f.copies.web,'-c','user.name=t','-c','user.email=t@t','commit','-qm',msg)
}
const PLAN=(...files)=>`# Plan\n\n## Đợt 1 — x (file ghi: ${files.join(', ')})\n\n### Task 1.1: a — model: sonnet\n**Files (được ghi):** ${files.map(x=>`\`${x}\``).join(', ')}\n`
const ap=(f,extra={})=>{const p=path.join(f.root,'ff.config.yaml');const c=YAML.parse(fs.readFileSync(p,'utf8'));c.autopilot={enabled:true,gate_a:'on',ship:true,...extra};fs.writeFileSync(p,YAML.stringify(c));f.config.autopilot=c.autopilot}
const run=async(f,...argv)=>{const c=capture(f.root);const code=await main(argv,c.ctx);return {code,...c.buf}}
const gateC=(f)=>run(f,'gate-auto','123','--gate','GATE_C','--reason','đủ')

test('glob: ** nhiều cấp, * trong một cấp, không phân biệt hoa thường',()=>{
 const m=(g,p)=>globToRegExp(g).test(p)
 assert.ok(m('**/auth/**','auth/x.ts')&&m('**/auth/**','src/api/auth/login/x.ts')&&!m('**/auth/**','src/author/x.ts'))
 assert.ok(m('**/*role*','src/UserRoles.ts')&&m('**/.env*','.env.local')&&m('**/.env*','apps/a/.env')&&m('**/Dockerfile*','x/Dockerfile.prod'))
 assert.ok(m('.github/workflows/**','.github/workflows/ci.yml')&&!m('.github/workflows/**','x/.github/workflows/ci.yml'))
})
test('deny mặc định: migration không bị cấm',()=>{
 for(const p of ['src/auth/a.ts','src/payments/p.ts','billing/x.ts','src/permissions.ts','src/policy.ts','.env.production','secrets/k.json','credentials/a','.github/workflows/ci.yml','Dockerfile','docker-compose.yml','k8s/a.yaml','infra/main.tf'])assert.ok(matchDeny(p,DEFAULT_DENY_PATHS),p)
 for(const p of ['db/migrations/001_add_col.sql','src/migrations/x.ts','src/components/Button.tsx','prisma/schema.prisma'])assert.equal(matchDeny(p,DEFAULT_DENY_PATHS),null,p)
})
test('parsePlanFiles: dòng Files, tiêu đề file ghi, bullet nối tiếp, bỏ link/chú thích',()=>{
 const md=`## Đợt 1 — api (file ghi: \`src/a.ts\`, src/b.ts)\n### Task 1.1: x — model: haiku\n**Files (được ghi):** \`src/c.ts\` (mới), \`./src/d.ts:12\`\n### Task 1.2: y\n**Files (được ghi):**\n- \`src/e.ts\`\n- \`web/src/f.ts\`\n\nNgoài: \`src/zzz.ts\`\n**Neo:** \`foo\`\nXem https://x.y/z.html\n`
 assert.deepEqual([...parsePlanFiles(md)].sort(),['src/a.ts','src/b.ts','src/c.ts','src/d.ts','src/e.ts','web/src/f.ts'])
 assert.equal(parsePlanFiles('Implement\n').size,0)
})
test('schema + mặc định: autopilot.deny_paths và repos[].autopilot_deny_paths',()=>{
 const {config}=parseConfigText('repos: []\n');assert.deepEqual(config.autopilot.deny_paths,DEFAULT_DENY_PATHS)
 const ok=structuredClone(config);ok.autopilot.deny_paths=['a/**'];assert.deepEqual(validate(ok).filter(e=>/deny/.test(JSON.stringify(e))),[])
 const bad=structuredClone(config);bad.autopilot.deny_paths='x';assert.ok(validate(bad).some(e=>/deny_paths/.test(JSON.stringify(e))))
})

test('checkDiff: file ngoài plan, deny_paths, package mới; bump version và migration được qua',async t=>{
 const f=makeShipWorkspace(t);ap(f)
 git(f.copies.web,'-c','user.name=t','-c','user.email=t@t','commit','-q','--allow-empty','-m','x')
 commit(f,{'package.json':JSON.stringify({dependencies:{a:'1.0.0'},devDependencies:{b:'1.0.0'}})},'base pkg')
 git(f.copies.web,'update-ref','refs/remotes/ff-local/prod','HEAD')
 commit(f,{'package.json':JSON.stringify({dependencies:{a:'2.0.0',c:'1.0.0'},devDependencies:{b:'1.0.0'},peerDependencies:{d:'1'}}),'src/ok.ts':'1','src/extra.ts':'1','src/auth/login.ts':'1','db/migrations/1.sql':'1','e2e/123/new.spec.ts':'1'})
 fs.writeFileSync(path.join(f.cardDir,'04-plan.md'),PLAN('package.json','src/ok.ts','src/auth/login.ts','db/migrations/1.sql'))
 f.config.e2e={dir:'e2e',tests_dir:'e2e'}
 const r=checkDiff(f.root,f.config,f.cardDir)
 assert.equal(r.ok,false)
 assert.deepEqual(r.violations.plan,['web/src/extra.ts'])
 assert.deepEqual(r.violations.deny.map(d=>d.file),['web/src/auth/login.ts'])
 assert.deepEqual(r.violations.deps.map(d=>d.pkg).sort(),['c','d'])
 assert.match(r.messages.join('\n'),/không có trong lịch sử.*src\/extra\.ts/)
 // repo deny bổ sung
 f.config.repos[0].autopilot_deny_paths=['db/**']
 assert.ok(checkDiff(f.root,f.config,f.cardDir).violations.deny.some(d=>d.file==='web/db/migrations/1.sql'))
 // deny_paths cấu hình thay mặc định
 f.config.repos[0].autopilot_deny_paths=[];f.config.autopilot.deny_paths=[]
 assert.deepEqual(checkDiff(f.root,f.config,f.cardDir).violations.deny,[])
})
test('checkDiff: plan không có danh sách file → không qua (fail-safe)',t=>{
 const f=makeShipWorkspace(t);ap(f);commit(f,{'a.txt':'a'});fs.writeFileSync(path.join(f.cardDir,'04-plan.md'),'Implement\n')
 const r=checkDiff(f.root,f.config,f.cardDir);assert.equal(r.ok,false);assert.match(r.messages.join(),/không đọc được danh sách file/)
 fs.rmSync(path.join(f.cardDir,'04-plan.md'));assert.match(checkDiff(f.root,f.config,f.cardDir).messages.join(),/không có 04-plan\.md/)
})

test('gate-auto GATE_C: autopilot bật + diff sạch thì qua và ghi autoChecks.diff',async t=>{
 const f=makeShipWorkspace(t);commit(f,{'src/a.ts':'1'});await autoVerifyFixture(f,{plan:PLAN('src/a.ts')});ap(f)
 const r=await gateC(f);assert.equal(r.code,0,r.err)
 const rec=JSON.parse(fs.readFileSync(path.join(f.root,'.ff/gates/123-GATE_C.json'),'utf8'))
 assert.equal(rec.autoChecks.diff.ok,true);assert.deepEqual(rec.autoChecks.diff.changed,{web:['src/a.ts']})
})
test('gate-auto GATE_C: autopilot tắt thì không kiểm diff (như hiện nay)',async t=>{
 const f=makeShipWorkspace(t);commit(f,{'src/auth/a.ts':'1'});await autoVerifyFixture(f);
 const r=await gateC(f);assert.equal(r.code,0,r.err);assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'.ff/gates/123-GATE_C.json'),'utf8')).autoChecks.diff,undefined)
})
test('gate-auto GATE_C: từ chối khi file ngoài plan / deny / package mới, liệt kê tiếng Việt',async t=>{
 const f=makeShipWorkspace(t);commit(f,{'src/a.ts':'1','src/b.ts':'1','src/payments/x.ts':'1','package.json':'{"dependencies":{"left-pad":"1"}}'})
 await autoVerifyFixture(f,{plan:PLAN('src/a.ts','src/payments/x.ts','package.json')});ap(f)
 const r=await gateC(f);assert.equal(r.code,1)
 assert.match(r.err,/\(diff\).*không có trong lịch sử.*web\/src\/b\.ts/);assert.match(r.err,/deny_paths.*web\/src\/payments\/x\.ts/);assert.match(r.err,/package mới: left-pad/)
 assert.equal(fs.existsSync(path.join(f.root,'.ff/gates/123-GATE_C.json')),false)
})
test('ship-approve --auto: từ chối khi diff vi phạm dù Gate C đã auto_passed lúc autopilot tắt',async t=>{
 const f=makeShipWorkspace(t);commit(f,{'src/a.ts':'1','infra/main.tf':'1'})
 await autoVerifyFixture(f,{plan:PLAN('src/a.ts','infra/main.tf')});assert.equal((await gateC(f)).code,0)
 ap(f);const r=await run(f,'ship-approve','123','--auto');assert.equal(r.code,1);assert.match(r.err,/autopilot không tự ship được.*infra\/main\.tf/s)
})
test('chéo Gate A: deny_paths + Gate A auto_passed hard_risk=false thì rút lại Gate A',async t=>{
 const f=makeShipWorkspace(t);commit(f,{'src/auth/a.ts':'1'})
 await autoVerifyFixture(f,{plan:PLAN('src/auth/a.ts')})
 const brief=`---\ngate_a:\n  size: nho\n  open_choices: false\n  user_visible_assumptions: false\n  hard_risk: false\n  adversary_blocking: false\n  reader_blocking: false\n---\nKeep D-01\n`
 const gate=path.join(f.root,'.ff/gates/123-GATE_A.json');const rec=JSON.parse(fs.readFileSync(gate,'utf8'))
 fs.writeFileSync(gate,JSON.stringify({...rec,status:'auto_passed',autoRepos:['web']}))
 fs.writeFileSync(path.join(f.cardDir,'brief.md'),brief);ap(f)
 const r=await gateC(f);assert.equal(r.code,1);assert.match(r.err,/deny_paths.*auth\/a\.ts/);assert.match(r.err,/Gate A tự qua đã bị rút lại/)
 const ev=fs.readFileSync(path.join(f.root,'.ff/knowledge.jsonl'),'utf8');assert.match(ev,/khai không rủi ro nhưng diff chạm web\/src\/auth\/a\.ts/)
})

// Ba dạng plan thật (rút gọn, nội dung giả)
test('parsePlanFiles: bảng "File ghi (repo X)", tiền tố $BE/ và dạng không có tiền tố repo',()=>{
 const table='| Slice | Việc | File ghi (repo system-service) | Model | Lệnh kiểm |\n|---|---|---|---|---|\n| 1 | a | `src/x/a.service.ts`, `src/x/b.dto.ts` | sonnet | tsc |\n| 2 | b | `src/y.ts` (mới) | haiku | tsc |\n'
 assert.deepEqual([...parsePlanFiles(table)].sort(),['src/x/a.service.ts','src/x/b.dto.ts','src/y.ts'])
 const vars='## Đợt 1 — BE (file ghi: `$BE/src/n/p.util.ts` (mới), `$FE/src/q.tsx`)\n**File (duy nhất được ghi):** `$BE/src/n/p.util.ts` (tạo mới)\n'
 assert.deepEqual([...parsePlanFiles(vars)].sort(),['*/src/n/p.util.ts','*/src/q.tsx'])
})
test('checkDiff: plan dạng $VAR/ khớp theo hậu tố đường dẫn; bảng khớp',async t=>{
 const f=makeShipWorkspace(t);ap(f);commit(f,{'apps/recruit/src/q.tsx':'1','src/n/p.util.ts':'1','src/y.ts':'1','src/z.ts':'1'})
 fs.writeFileSync(path.join(f.cardDir,'04-plan.md'),'## Đợt 1 — x (file ghi: `$BE/src/n/p.util.ts`, `$FE/src/q.tsx`)\n\n| Slice | File ghi (repo web) |\n|---|---|\n| 1 | `src/y.ts` |\n')
 const r=checkDiff(f.root,f.config,f.cardDir);assert.deepEqual(r.violations.plan,['web/src/z.ts']);assert.deepEqual(r.violations.errors,[])
})
test('ff allow ghi lịch sử bền (--clear không xóa); checkDiff chấp nhận file có trong lịch sử của revision',async t=>{
 const f=makeShipWorkspace(t);ap(f);commit(f,{'src/a.ts':'1','src/b.ts':'1'});fs.writeFileSync(path.join(f.cardDir,'04-plan.md'),'Implement\n')
 const slug=path.basename(f.cardDir)
 assert.equal((await run(f,'allow',slug,'web/src/a.ts')).code,0)
 assert.equal((await run(f,'allow',slug,'--clear')).code,0)
 const h=fs.readFileSync(path.join(f.root,'.ff/allow-history',`${slug.match(/^[A-Za-z0-9]+/)[0]}.jsonl`),'utf8');assert.match(h,/"file":"web\/src\/a\.ts"/)
 let r=checkDiff(f.root,f.config,f.cardDir);assert.deepEqual(r.violations.plan,['web/src/b.ts']);assert.deepEqual(r.violations.errors,[])
 await run(f,'allow',slug,'web/src/b.ts');assert.equal(checkDiff(f.root,f.config,f.cardDir).ok,true)
})
