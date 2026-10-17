import './helpers/hermetic-home.mjs'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
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

const run=async(f,...args)=>{const c=capture(f.root);const code=await main(args,c.ctx);return {code,...c.buf}}
const setCfg=(f,fn)=>{const c=loadConfig(f.root).config;fn(c);fs.writeFileSync(path.join(f.root,'ff.config.yaml'),YAML.stringify(c))}
// Legacy worker / manual card: driver off, Gate C approved by a human, ship-test record + test lock present, no stage receipts.
const legacy=async(t,{gateC=true}={})=>{const f=makeShipWorkspace(t);commitShipFixture(f);const x=await autoVerifyFixture(f)
 if(gateC)recordGates(f.root,f.config,{questions:[{header:'GATE_C',question:'[#123] Approve?'}]},{answers:{'[#123] Approve?':'Duyệt'}})
 setCfg(f,c=>{c.worker.driver={enabled:false}});return {f,x}}

test('legacy: ship không cần receipt; thiếu phê duyệt thì nêu đúng một dòng sửa, không lỗi receipt',async t=>{
 const {f}=await legacy(t),r=await run(f,'ship','123')
 assert.equal(r.code,1);assert.match(r.err,/\[ship_approval\].*ff ship-approve 123/);assert.doesNotMatch(r.err,/receipt/)
})
test('legacy: ship-approve (người) rồi ff ship đẩy lên ship_branch',async t=>{
 const {f}=await legacy(t),a=await run(f,'ship-approve','123');assert.equal(a.code,0,a.err)
 const s=await run(f,'ship','123');assert.equal(s.code,0,s.err+s.out);assert.equal(JSON.parse(s.out).s1Complete,true)
 assert.equal(git(f.origins.web,'show','dev:a.txt'),'a.txt')
})
test('driver bật: thiếu receipt build/verify được liệt kê từng dòng kèm cách sửa',async t=>{
 const f=makeShipWorkspace(t);commitShipFixture(f);await autoVerifyFixture(f)
 recordGates(f.root,f.config,{questions:[{header:'GATE_C',question:'[#123] Approve?'}]},{answers:{'[#123] Approve?':'Duyệt'}})
 fs.rmSync(path.join(f.root,'.ff/harness'),{recursive:true,force:true});fs.rmSync(path.join(f.root,'.ff/stage-receipts'),{recursive:true,force:true})
 const r=await run(f,'ship','123');assert.equal(r.code,1)
 assert.match(r.err,/\[receipt:verify\].*driver/);assert.match(r.err,/\[ship_approval\]/)
})
test('legacy: thiếu ship-test và test lock hỏng được nêu kèm lệnh sửa',async t=>{
 const {f,x}=await legacy(t);fs.rmSync(path.join(f.root,'.ff/ship-test'),{recursive:true,force:true})
 fs.chmodSync(path.join(f.root,'e2e/123/keep.spec.ts'),0o644);fs.appendFileSync(path.join(f.root,'e2e/123/keep.spec.ts'),'//x\n')
 const r=await run(f,'ship','123');assert.equal(r.code,1)
 assert.match(r.err,/\[ship_test\].*ff ship-test 123/);assert.match(r.err,/\[test_lock\].*ff relock 123/)
})
test('thiếu commands.test: chặn ship và nêu khóa cấu hình',async t=>{
 const {f}=await legacy(t);setCfg(f,c=>{delete c.repos[0].commands.test})
 const r=await run(f,'ship','123');assert.equal(r.code,1);assert.match(r.err,/\[commands\].*commands\.test.*ff\.config\.yaml/)
})
test('ship-approve <slug>.test: ghi marker ở checkout verify và guard cho push từ đó',async t=>{
 const {f}=await legacy(t),G=makeGuard(f.root,loadConfig(f.root).config),cwd=path.join(f.root,'worktrees/123.test/web')
 assert.match(G.evaluate({cmd:'git push origin HEAD:dev',cwd,mode:'base'}),/chưa có worktrees\/123\.test\/\.ff-ship-approved/)
 const a=await run(f,'ship-approve','123.test');assert.equal(a.code,0,a.err)
 assert.ok(fs.existsSync(path.join(f.root,'worktrees/123.test/.ff-ship-approved')))
 assert.equal(makeGuard(f.root,loadConfig(f.root).config).evaluate({cmd:'git push origin HEAD:dev',cwd,mode:'base'}),null)
})
test('ship-approve <slug>.test: từ chối khi ship-test không còn khớp, liệt kê điều thiếu',async t=>{
 const {f}=await legacy(t);git(f.copies.web,'-c','user.name=t','-c','user.email=t@t','commit','-q','--allow-empty','-m','đổi HEAD')
 const a=await run(f,'ship-approve','123.test');assert.equal(a.code,1);assert.match(a.err,/\[ship_test\].*ff ship-test 123/)
 assert.equal(fs.existsSync(path.join(f.root,'worktrees/123.test/.ff-ship-approved')),false)
})
test('ship-approve thường không nhận slug .test cho lệnh khác (allow/lock-tests vẫn từ chối)',async t=>{
 const {f}=await legacy(t);assert.equal((await run(f,'allow','123.test','a.txt')).code,1)
})
