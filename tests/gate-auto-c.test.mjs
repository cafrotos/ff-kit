import './helpers/hermetic-home.mjs'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {makeShipWorkspace} from './helpers/ship.mjs'
import {commitShipFixture} from './helpers/ship-authorized.mjs'
import {autoVerifyFixture,report,LEDGER} from './helpers/auto-verify.mjs'
import {capture} from './helpers/io.mjs'
import {main} from '../scripts/cli/main.mjs'
import {parseReport,checkAutoGateC} from '../scripts/lib/auto-verify.mjs'
import {phaseSourceProblems,traceCheck} from '../scripts/lib/trace.mjs'
import {inspectCard} from '../scripts/cli/state.mjs'
import {validate} from '../scripts/lib/schema.mjs'
import {parseConfigText} from '../scripts/lib/config.mjs'
import {recordQuestion} from '../scripts/lib/question-history.mjs'
import {randomUUID} from 'node:crypto'

const setup=async(t,opts)=>{const f=makeShipWorkspace(t);commitShipFixture(f);const x=await autoVerifyFixture(f,opts);return {f,x}}
const auto=async(f)=>{const c=capture(f.root);const code=await main(['gate-auto','123','--gate','GATE_C','--reason','đủ điều kiện'],c.ctx);return {code,...c.buf}}
const refuses=async(t,tag,opts,mutate)=>{const {f,x}=await setup(t,opts);await mutate?.(f,x);const r=await auto(f);assert.equal(r.code,1,r.out+r.err);assert.match(r.err,tag,r.err);return r}

test('happy path: Gate C auto_passed, không phải approved; sửa report thì stale',async t=>{
 const {f,x}=await setup(t);const r=await auto(f)
 assert.equal(r.code,0,r.err);assert.match(r.out,/Gate C: AUTO_PASSED \(root\); đây không phải user duyệt/)
 const state=()=>inspectCard(f.root,f.config,f.cardDir).gates.GATE_C.status
 assert.equal(state(),'auto_passed')
 const rec=JSON.parse(fs.readFileSync(path.join(f.root,'.ff/gates/123-GATE_C.json'),'utf8'));assert.equal(rec.approved,false)
 fs.appendFileSync(path.join(f.root,x.card,'05-verify-report.md'),'sửa\n');assert.equal(state(),'stale')
})
const ext=report({ac2:'UNVERIFIED[ext:sms]'})
test('ext-exempt: UNVERIFIED[ext:hạ-tầng] được miễn khi ff decide test-scope verify-exemption trả proceed',async t=>{
 const {f}=await setup(t,{reportText:ext}),calls=[]
 const decide=async(root,config,req)=>{calls.push(req);return {verdict:'proceed'}}
 const r=await checkAutoGateC(f.root,f.config,f.cardDir,{decide})
 assert.deepEqual(r.failures,[]);assert.deepEqual(r.exemptAcs,['AC-02 [ext:sms]'])
 assert.equal(calls[0].class,'test-scope');assert.equal(calls[0].decisionKey,'verify-exemption:sms');assert.equal(calls[0].cardId,'123');assert.equal(calls[0].repo,'web');assert.match(calls[0].question,/"sms"/)
})
test('ext không miễn khi ff decide escalate',async t=>{
 const {f}=await setup(t,{reportText:ext})
 const r=await checkAutoGateC(f.root,f.config,f.cardDir,{decide:async()=>({verdict:'escalate',reason:'x'})})
 assert.deepEqual(r.exemptAcs,[]);assert.ok(r.failures.some(m=>/\(c\) AC-02: hạ tầng ngoài "sms" chưa được ff decide cho miễn \(test-scope, verify-exemption:sms\)/.test(m)),r.failures.join())
 const bad=await checkAutoGateC(f.root,f.config,f.cardDir,{decide:async()=>{throw new Error('boom')}});assert.equal(bad.failures.length,1)
})
test('(c) ext với ff decide thật (chưa có tiền lệ) thì Gate C không tự qua',t=>refuses(t,/\(c\) AC-02: hạ tầng ngoài "sms"/,{reportText:ext}))
test('(a) Gate A chưa duyệt',t=>refuses(t,/\(a\)/,{},(f)=>fs.rmSync(path.join(f.root,'.ff/gates/123-GATE_A.json'))))
test('(b) thiếu biên nhận build',t=>refuses(t,/\(b\) thiếu biên nhận build/,{},(f)=>fs.rmSync(path.join(f.root,'.ff/harness/receipts/123/root/build.json'))))
test('(b) thiếu ship-test',t=>refuses(t,/\(b\) ship-test/,{},(f)=>fs.rmSync(path.join(f.root,'.ff/ship-test/123/root.json'))))
test('(c) AC FAIL',t=>refuses(t,/\(c\) AC-02: FAIL/,{reportText:report({ac2:'FAIL'})}))
test('(c) UNVERIFIED trơn',t=>refuses(t,/\(c\) AC-02: UNVERIFIED/,{reportText:report({ac2:'UNVERIFIED'})}))
test('(c) thiếu AC trong báo cáo',t=>refuses(t,/\(c\) AC-02: có trong 02-spec/,{reportText:report({skip:['AC-02']})}))
test('(d) hồi quy gãy',t=>refuses(t,/\(d\) hồi quy gãy/,{reportText:report({reg:'Gãy'})}))
test('(e) test khóa bị đổi',t=>refuses(t,/\(e\) test đã khóa bị đổi/,{},(f)=>fs.appendFileSync(path.join(f.root,'e2e/123/keep.spec.ts'),'// đổi\n')))
test('(f) còn câu hỏi mở',t=>refuses(t,/\(f\) còn câu hỏi chưa trả lời/,{},async(f)=>{
 const options=[{label:'A',description:'a'},{label:'B',description:'b'}],sid=randomUUID()
 await recordQuestion(f.root,{cardId:'123',revision:'',runId:'run',dispatchId:'',claudeSessionId:sid,presentationId:null},{session_id:sid,tool_use_id:randomUUID(),tool_input:{questions:[{header:'Q9',question:'[#123] Chọn?',options,multiSelect:false}]}})
}))
test('(g) D-xx pha build tự suy ra',t=>refuses(t,/\(g\) D-02 tự suy ra chưa được người xác nhận/,{ledger:LEDGER+'| D-02 | x | y | (build) Nguồn: suy-ra |\n'}))

test('parseReport đọc verdict, ext và hồi quy',()=>{
 const r=parseReport(report({ac2:'**UNVERIFIED[ext:a_b-1]**',reg:'Gãy'}))
 assert.deepEqual(r.rows.map(x=>[x.id,x.verdict,x.key]),[['AC-01','PASS',null],['AC-02','UNVERIFIED_EXT','a_b-1']]);assert.deepEqual(r.regressions,['Tab liền kề'])
})
test('phaseSourceProblems: Nguồn hợp lệ và không hợp lệ',()=>{
 const row=(c,s)=>`| ${c} | q | w | ${s} |\n`,head='| ID | a | b | c |\n|---|---|---|---|\n'
 const ok=['Nguồn: dossier','Nguồn: brief','Nguồn: design','Nguồn: U-03','Nguồn: decide:Q2-ab']
 assert.deepEqual(phaseSourceProblems(head+ok.map((s,i)=>row(`D-0${i+1}`,`(build) ${s}`)).join('')),[])
 assert.deepEqual(phaseSourceProblems(head+row('D-01','(verify) Nguồn: suy-ra')+row('D-02','(build) không nguồn')+row('D-03','không thẻ pha')).map(p=>p.code),['D-01','D-02'])
})
test('trace-check báo D-xx pha build thiếu Nguồn',t=>{
 const {f}=(()=>{const dir=fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR||'/tmp'),'tr-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.writeFileSync(path.join(dir,'01-dossier.md'),'## Yêu cầu\n\nLàm A.\n');fs.writeFileSync(path.join(dir,'01b-ledger.md'),'| ID | Trích | Ở đâu | Ghi chú |\n|---|---|---|---|\n| D-01 | Làm A. | brief | (build) Nguồn: suy-ra |\n');return {f:dir}})()
 assert.ok(traceCheck(f).errors.some(e=>/D-01 tự suy ra chưa được người xác nhận/.test(e)))
})
test('schema bỏ verify.unverifiable_external và ship.max_fix_rounds (khóa lạ bị từ chối)',()=>{
 const text=(extra)=>parseConfigText('version: 1\nworkspace: {root: ., cards_dir: c, worktrees_dir: w}\nrepos:\n  - {name: web, path: web, base_branch: dev, ship_branch: dev, commands: {}}\nworker: {channel: {adapter: console}}\nsecrets: {env_file: .ff.env}\n'+extra).config
 assert.deepEqual(validate(text('')),[])
 assert.notEqual(validate(text('verify:\n  unverifiable_external:\n    - {key: sms, description: x}\n')).length,0)
 assert.notEqual(validate(text('ship: {max_fix_rounds: 2}\n')).length,0)
})
