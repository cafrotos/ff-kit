import './helpers/hermetic-home.mjs'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import YAML from 'yaml'
import {makeShipWorkspace} from './helpers/ship.mjs'
import {commitShipFixture} from './helpers/ship-authorized.mjs'
import {autoVerifyFixture} from './helpers/auto-verify.mjs'
import {git} from './helpers/fixture.mjs'
import {capture} from './helpers/io.mjs'
import {main} from '../scripts/cli/main.mjs'
import {makeGuard} from '../scripts/lib/guard-rules.mjs'
import {loadConfig} from '../scripts/lib/config.mjs'
import {recordGates} from '../scripts/lib/gates.mjs'
import {readTask,writeTask} from '../ff-worker/src/core/task-store.mjs'
import {validateShipApproval,captureShipTargets,shipApprovalPath} from '../scripts/lib/ship-approval.mjs'

const run=async(f,...args)=>{const c=capture(f.root);const code=await main(args,c.ctx);return {code,...c.buf}}
const setup=async(t,{gateC=true}={})=>{const f=makeShipWorkspace(t);commitShipFixture(f);const x=await autoVerifyFixture(f)
 if(gateC){const r=await run(f,'gate-auto','123','--gate','GATE_C','--reason','đủ');assert.equal(r.code,0,r.err)}
 return {f,x}}
const reportPath=(f,x)=>path.join(f.root,x.card,'05-verify-report.md')

test('ship-approve --auto bị từ chối khi Gate C chưa có',async t=>{
 const {f}=await setup(t,{gateC:false});const r=await run(f,'ship-approve','123','--auto')
 assert.equal(r.code,1);assert.match(r.err,/Gate C chưa ở trạng thái auto_passed/);assert.equal(fs.existsSync(shipApprovalPath(f.root,'123')),false)
})
test('ship-approve --auto bị từ chối khi Gate C do người duyệt',async t=>{
 const {f,x}=await setup(t,{gateC:false})
 recordGates(f.root,f.config,{questions:[{header:'GATE_C',question:'[#123] Approve?'}]},{answers:{'[#123] Approve?':'Duyệt'}})
 const r=await run(f,'ship-approve','123','--auto');assert.equal(r.code,1);assert.match(r.err,/approved/)
})
test('ship-approve --auto bị từ chối khi Gate C stale',async t=>{
 const {f,x}=await setup(t);fs.appendFileSync(reportPath(f,x),'đổi\n')
 const r=await run(f,'ship-approve','123','--auto');assert.equal(r.code,1);assert.match(r.err,/stale/)
})
test('ship-approve --auto không nhận --question-id',async t=>{
 const {f}=await setup(t);assert.equal((await run(f,'ship-approve','123','--auto','--question-id','x')).code,1)
})

test('auto: ship nhận Gate C auto_passed, ghi biên nhận ràng buộc và báo kênh',async t=>{
 const {f,x}=await setup(t);await x.finishVerify()
 const events=[],server=http.createServer((req,res)=>{let b='';req.on('data',d=>b+=d);req.on('end',()=>{events.push(JSON.parse(b));res.setHeader('content-type','application/json');res.end('{"delivered":true}')})})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close())
 fs.mkdirSync(path.join(f.root,'.ff'),{recursive:true});fs.writeFileSync(path.join(f.root,'.ff/worker.json'),JSON.stringify({port:server.address().port,token:'t'}))
 const a=await run(f,'ship-approve','123','--auto');assert.equal(a.code,0,a.err)
 const approval=JSON.parse(fs.readFileSync(shipApprovalPath(f.root,'123'),'utf8'))
 assert.equal(approval.version,2);assert.equal(approval.auto,true);assert.equal(approval.binding.shipBranches.web,'dev');assert.equal(approval.binding.heads.web,git(f.copies.web,'rev-parse','HEAD'));assert.match(approval.binding.gateC,/^[a-f0-9]{64}$/)
 writeTask(f.root,{...readTask(f.root,'123'),stage:'ship',dispatchId:'ship-cli',pendingDispatch:{runId:'run',revision:'',dispatchId:'ship-cli',stage:'ship'}})
 const s=await run(f,'ship','123');assert.equal(s.code,0,s.err+s.out);assert.equal(JSON.parse(s.out).s1Complete,true)
 assert.equal(events.length,1);assert.equal(events[0].kind,'info');assert.equal(events[0].title,'Đã tự ship #123 lên dev');assert.ok(events[0].fields['Commit dev'].startsWith('web@'))
 await run(f,'ship','123');assert.equal(events.length,1,'chỉ báo một lần')
})
test('auto: HEAD đổi sau khi duyệt auto thì ff ship và validate từ chối',async t=>{
 const {f,x}=await setup(t);await x.finishVerify();assert.equal((await run(f,'ship-approve','123','--auto')).code,0)
 const approval=JSON.parse(fs.readFileSync(shipApprovalPath(f.root,'123'),'utf8'))
 git(f.copies.web,'-c','user.name=t','-c','user.email=t@t','commit','-q','--allow-empty','-m','trôi HEAD')
 const v=validateShipApproval(f.root,loadConfig(f.root).config,approval,approval.targets);assert.equal(v.valid,false);assert.match(v.reasons[0],/HEAD repo đã đổi/)
 assert.equal((await run(f,'ship','123')).code,1)
})
test('auto: Gate C đổi (duyệt auto lại với report mới) làm biên nhận cũ vô hiệu',async t=>{
 const {f,x}=await setup(t);await x.finishVerify();assert.equal((await run(f,'ship-approve','123','--auto')).code,0)
 const approval=JSON.parse(fs.readFileSync(shipApprovalPath(f.root,'123'),'utf8'))
 fs.appendFileSync(reportPath(f,x),'\nghi chú\n');assert.equal((await run(f,'gate-auto','123','--gate','GATE_C','--reason','lại')).code,0)
 const v=validateShipApproval(f.root,loadConfig(f.root).config,approval,approval.targets);assert.equal(v.valid,false);assert.match(v.reasons[0],/Gate C đã đổi/)
})
test('marker legacy mang ràng buộc; guard từ chối push khi HEAD đổi',async t=>{
 const {f,x}=await setup(t);const cfg=loadConfig(f.root).config;cfg.worker.driver={enabled:false};fs.writeFileSync(path.join(f.root,'ff.config.yaml'),YAML.stringify(cfg))
 assert.equal((await run(f,'ship-approve','123','--auto')).code,0)
 const marker=path.join(f.root,'worktrees/123/.ff-ship-approved'),lines=fs.readFileSync(marker,'utf8').trim().split('\n')
 assert.equal(lines.length,4);assert.equal(JSON.parse(lines[3]).auto,true)
 const G=makeGuard(f.root,loadConfig(f.root).config),cwd=path.join(f.root,'worktrees/123/web')
 assert.equal(G.evaluate({cmd:'git push origin task/123',cwd,mode:'base'}),null)
 git(f.copies.web,'-c','user.name=t','-c','user.email=t@t','commit','-q','--allow-empty','-m','trôi HEAD')
 assert.match(G.evaluate({cmd:'git push origin task/123',cwd,mode:'base'}),/marker ship auto không còn khớp/)
})
test('guard: ship-approve thường vẫn hỏi người, --auto thì không',t=>{
 const f=makeShipWorkspace(t),G=makeGuard(f.root,loadConfig(f.root).config)
 assert.equal(G.needsAsk('ff ship-approve 123'),true);assert.equal(G.needsAsk('ff ship-approve 123 --question-id q1'),true)
 assert.equal(G.needsAsk('ff ship-approve 123 --auto'),false);assert.equal(G.needsAsk('ff ship-approve 123 --auto && ff ship-approve 124'),true)
})
