import './helpers/hermetic-home.mjs'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import {makeShipWorkspace} from './helpers/ship.mjs'
import {commitShipFixture} from './helpers/ship-authorized.mjs'
import {autoVerifyFixture,report} from './helpers/auto-verify.mjs'
import {capture} from './helpers/io.mjs'
import {main} from '../scripts/cli/main.mjs'
import {DEFAULT_DENY_PATHS} from '../scripts/lib/config.mjs'
import {parseConfigText} from '../scripts/lib/config.mjs'
import {validate} from '../scripts/lib/schema.mjs'
import {decide} from '../scripts/lib/knowledge.mjs'
import {appendDecision} from '../scripts/lib/question-history.mjs'
import {inspectCard} from '../scripts/cli/state.mjs'
import {nextStage} from '../ff-worker/src/core/driver.mjs'
import {renderShipMilestone} from '../ff-worker/src/core/ship-watch.mjs'
import {dailyReportTick} from '../ff-worker/src/core/daily-report.mjs'
import {buildReport,renderReport} from '../scripts/lib/report.mjs'
import {run as workerRun} from '../scripts/cli/worker.mjs'

const BRIEF=(g={})=>`---\ngate_a:\n  size: ${g.size??'nho'}\n  open_choices: ${g.open_choices??false}\n  user_visible_assumptions: ${g.uva??false}\n  hard_risk: ${g.hard_risk??false}\n  adversary_blocking: ${g.adv??false}\n  reader_blocking: ${g.reader??false}\n---\n| Mục | Nguồn |\n|---|---|\n| Keep | D-01 |\n`
const setConfig=(f,ap)=>{const p=path.join(f.root,'ff.config.yaml');const c=YAML.parse(fs.readFileSync(p,'utf8'));c.autopilot=ap;fs.writeFileSync(p,YAML.stringify(c));f.config.autopilot=ap}
const run=async(f,...argv)=>{const c=capture(f.root);const code=await main(argv,c.ctx);return {code,...c.buf}}
// Gate A chưa duyệt, Brief có frontmatter gate_a.
const gateAFixture=async(t,{ap={enabled:true,gate_a:'on',ship:true},brief=BRIEF()}={})=>{
 const f=makeShipWorkspace(t);commitShipFixture(f);const x=await autoVerifyFixture(f)
 fs.rmSync(path.join(f.root,'.ff/gates/123-GATE_A.json'));fs.writeFileSync(path.join(f.root,x.card,'brief.md'),brief);setConfig(f,ap)
 fs.appendFileSync(path.join(f.cardDir,'01-dossier.md'),'\n## Mô tả\n\nKeep.\n')
 fs.writeFileSync(path.join(f.cardDir,'01b-ledger.md'),'| ID | Trích | Ở đâu | Ghi chú |\n|---|---|---|---|\n| D-01 | Keep. | Mô tả | sự kiện |\n')
 return {f,x}
}
const auto=(f)=>run(f,'gate-auto','123','--gate','GATE_A','--reason','Brief rõ, mọi cờ false')

test('config: autopilot có mặc định, schema chấp nhận và từ chối giá trị sai',()=>{
 const {config}=parseConfigText('repos: []\n');assert.deepEqual(config.autopilot,{enabled:false,gate_a:'on',ship:true,deny_paths:DEFAULT_DENY_PATHS})
 const base=(ap)=>{const c=structuredClone(config);c.autopilot=ap;return validate(c).filter(e=>/autopilot/.test(JSON.stringify(e)))}
 assert.deepEqual(base({enabled:true,gate_a:'shadow',ship:false,daily_report_at:'18:30'}),[])
 assert.ok(base({gate_a:'maybe'}).length);assert.ok(base({daily_report_at:'6pm'}).length);assert.ok(base({enabled:'yes'}).length)
})

test('Gate A tự qua: receipt auto_passed, không phải approved; sửa Brief thì stale',async t=>{
 const {f,x}=await gateAFixture(t);const r=await auto(f)
 assert.equal(r.code,0,r.err);assert.match(r.out,/Gate A: AUTO_PASSED \(root\); đây không phải user duyệt/)
 const rec=JSON.parse(fs.readFileSync(path.join(f.root,'.ff/gates/123-GATE_A.json'),'utf8'));assert.equal(rec.status,'auto_passed');assert.equal(rec.approved,false)
 assert.equal(inspectCard(f.root,f.config,f.cardDir).gates.GATE_A.status,'auto_passed')
 fs.appendFileSync(path.join(f.root,x.card,'brief.md'),'sửa\n');assert.equal(inspectCard(f.root,f.config,f.cardDir).gates.GATE_A.status,'stale')
})
const refuses=async(t,tag,opts)=>{const {f}=await gateAFixture(t,opts);const r=await auto(f);assert.equal(r.code,1,r.out);assert.match(r.err,tag,r.err);assert.ok(!fs.existsSync(path.join(f.root,'.ff/gates/123-GATE_A.json')))}
test('Gate A từ chối: autopilot tắt',t=>refuses(t,/autopilot\.enabled chưa bật/,{ap:{enabled:false,gate_a:'on',ship:true}}))
test('Gate A từ chối: gate_a=off',t=>refuses(t,/autopilot\.gate_a=off/,{ap:{enabled:true,gate_a:'off',ship:true}}))
test('Gate A từ chối: gate_a=shadow vẫn hỏi người',t=>refuses(t,/chế độ bóng/,{ap:{enabled:true,gate_a:'shadow',ship:true}}))
test('Gate A từ chối: cỡ Lớn',t=>refuses(t,/cỡ Lớn/,{brief:BRIEF({size:'lon'})}))
test('Gate A từ chối: từng cờ true',async t=>{
 for(const [k,tag] of [['open_choices',/open_choices/],['uva',/user_visible_assumptions/],['hard_risk',/hard_risk/],['adv',/adversary_blocking/],['reader',/reader_blocking/]])await refuses(t,tag,{brief:BRIEF({[k]:true})})
})
test('Gate A từ chối: cờ là chuỗi, thiếu khối, size sai',async t=>{
 await refuses(t,/open_choices phải là boolean thật/,{brief:BRIEF({open_choices:'"false"'})})
 await refuses(t,/thiếu khối frontmatter gate_a/,{brief:'Keep D-01\n'})
 await refuses(t,/gate_a\.size phải là/,{brief:BRIEF({size:'khổng lồ'})})
})
test('Gate A từ chối: trace/ledger hỏng',t=>refuses(t,/trace:/,{brief:BRIEF()+'\n| Mã | x |\n|---|---|\n| a | b |\n'}))

test('infra-rule: chỉ ghi được khi có câu trả lời của người; get/list đọc lại',async t=>{
 const f=makeShipWorkspace(t);const none=await run(f,'infra-rule','set','sms','manual','--note','thử tay','--from-question','Q7')
 assert.equal(none.code,1);assert.match(none.err,/không thấy câu trả lời của người cho Q7/)
 const rec={decisionId:'d1',questionId:'qid1',cardId:'123',header:'Q7',answer:'Miễn, tôi thử tay',provenance:{source:'cli',actor:'human'}}
 await appendDecision(f.root,{...rec,decisionId:'agent1',questionId:'qa',header:'Q8',provenance:{source:'agent'}})
 assert.equal((await run(f,'infra-rule','set','sms','manual','--from-question','Q8')).code,1)
 await appendDecision(f.root,rec)
 const ok=await run(f,'infra-rule','set','sms','manual','--note','thử tay','--from-question','Q7');assert.equal(ok.code,0,ok.err)
 assert.equal((await run(f,'infra-rule','set','bad name','manual','--from-question','Q7')).code,1)
 assert.equal((await run(f,'infra-rule','set','sms','maybe','--from-question','Q7')).code,1)
 const g=await run(f,'infra-rule','get','sms','--json');assert.equal(JSON.parse(g.out).answer,'manual');assert.equal(JSON.parse(g.out).decisionId,'d1')
 assert.match((await run(f,'infra-rule','list')).out,/sms: miễn, người thử tay \(manual\)/)
 assert.equal((await run(f,'infra-rule','get','nope')).code,3)
})

const seedRule=async(f,answer,name='sms')=>{
 await appendDecision(f.root,{decisionId:'h'+answer,questionId:'q'+answer,cardId:'123',header:'Q1',answer:'x',provenance:{source:'cli',actor:'human'}})
 assert.equal((await run(f,'infra-rule','set',name,answer,'--note','gọi thật','--from-question','q'+answer)).code,0)
}
const extReport=report({ac2:'UNVERIFIED[ext:sms]'})
test('Gate C: luật hạ tầng manual miễn AC, ghi checklist thử tay vào receipt',async t=>{
 const f=makeShipWorkspace(t);commitShipFixture(f);const x=await autoVerifyFixture(f,{reportText:extReport})
 fs.mkdirSync(path.join(f.root,x.card,'evidence'),{recursive:true})
 fs.writeFileSync(path.join(f.root,x.card,'evidence/verify-ac.json'),JSON.stringify({criteria:[{id:'AC-02',status:'unverified',manual:true,manual_steps:'Gọi thử số 1900 và nghe lời chào'}]}))
 await seedRule(f,'manual')
 const r=await run(f,'gate-auto','123','--gate','GATE_C','--reason','đủ');assert.equal(r.code,0,r.err+r.out);assert.match(r.out,/Cần thử tay trên dev: AC-02 \(Gọi thử số 1900/)
 const rec=JSON.parse(fs.readFileSync(path.join(f.root,'.ff/gates/123-GATE_C.json'),'utf8'))
 assert.deepEqual(rec.autoChecks.manualAcs,[{id:'AC-02',infra:'sms',steps:'Gọi thử số 1900 và nghe lời chào'}]);assert.equal(rec.autoChecks.infraRules[0].name,'sms')
 const {gateCAuto}=await import('../scripts/lib/gates.mjs');assert.equal(gateCAuto(f.root,'123',f.cardDir).manualAcs.length,1)
})
for(const answer of ['mock','block'])test(`Gate C: luật hạ tầng ${answer} không miễn`,async t=>{
 const f=makeShipWorkspace(t);commitShipFixture(f);await autoVerifyFixture(f,{reportText:extReport});await seedRule(f,answer)
 const r=await run(f,'gate-auto','123','--gate','GATE_C','--reason','đủ');assert.equal(r.code,1);assert.match(r.err,new RegExp(`luật hạ tầng "sms" = ${answer==='block'?'chặn thẻ':'dùng giả lập'}`))
})
test('Gate C: AC UNVERIFIED đánh dấu manual nhưng không có luật hạ tầng thì không qua',async t=>{
 const f=makeShipWorkspace(t);commitShipFixture(f);const x=await autoVerifyFixture(f,{reportText:report({ac2:'UNVERIFIED'})})
 fs.mkdirSync(path.join(f.root,x.card,'evidence'),{recursive:true})
 fs.writeFileSync(path.join(f.root,x.card,'evidence/verify-ac.json'),JSON.stringify({criteria:[{id:'AC-02',manual:true,manual_steps:'x'}]}))
 const r=await run(f,'gate-auto','123','--gate','GATE_C','--reason','đủ');assert.equal(r.code,1);assert.match(r.err,/AC-02: đánh dấu manual nhưng chưa có luật hạ tầng/)
 fs.writeFileSync(path.join(f.root,x.card,'evidence/verify-ac.json'),JSON.stringify({criteria:[{id:'AC-02',manual:'true'}]}))
 assert.match((await run(f,'gate-auto','123','--gate','GATE_C','--reason','đủ')).err,/"manual" phải là boolean true/)
})

test('KNW-02: autopilot bỏ migration/schema khỏi từ khóa rủi ro, giữ delete/role/permission',()=>{
 const request={cardId:'a',revision:'',project:'p',repo:'r',businessScope:'checkout',policyVersion:'v',decisionKey:'button',class:'copy-text',question:'Button?',options:['Save','Cancel']}
 const rows=Array.from({length:3},(_,i)=>({...request,decisionId:`d${i}`,normalizedValue:'save',provenance:{source:'cli',originId:`o${i}`}}))
 for(const question of ['change schema','migration now'])assert.equal(decide({records:rows,request:{...request,question}}).verdict,'escalate')
 for(const question of ['change schema','migration now'])assert.equal(decide({records:rows,request:{...request,question},policy:{autopilot_enabled:true}}).verdict,'proceed')
 for(const question of ['delete record','role title','permission text'])assert.equal(decide({records:rows,request:{...request,question},policy:{autopilot_enabled:true}}).verdict,'escalate')
})

test('driver: autopilot.ship=false giữ Gate C auto_passed chờ người; mặc định vẫn ship',()=>{
 const H='a'.repeat(40),receipt=(stage)=>({valid:true,hash:stage,receipt:{cardId:'1',stage,revision:'',heads:{app:H},outcome:'pass'}})
 const task={cardId:'1',revision:'',runId:'r',stage:'verify',history:[],questions:[],gateDecisions:[],consumedFailures:[],pendingEffects:[]}
 const state={heads:{app:H},activeRevision:null,gates:{GATE_C:{status:'auto_passed'}},receipts:{build:receipt('build'),verify:receipt('verify')}}
 assert.equal(nextStage({task,state}).action,'dispatch')
 assert.equal(nextStage({task,state,autopilot:{enabled:true,ship:true}}).action,'dispatch')
 const held=nextStage({task,state,autopilot:{enabled:true,ship:false}});assert.deepEqual([held.action,held.waitingOn,held.reason],['stay','ship_confirm','autopilot_ship_off'])
 assert.equal(nextStage({task,state,autopilot:{enabled:false,ship:false}}).action,'dispatch')
})

test('ship-approve --auto bị từ chối khi autopilot.ship=false',async t=>{
 const f=makeShipWorkspace(t);commitShipFixture(f);await autoVerifyFixture(f);setConfig(f,{enabled:true,gate_a:'on',ship:false})
 await run(f,'gate-auto','123','--gate','GATE_C','--reason','đủ')
 const r=await run(f,'ship-approve','123','--auto');assert.equal(r.code,1);assert.match(r.err,/autopilot\.ship=false/)
})

test('renderShipMilestone ready kèm checklist thử tay',()=>{
 const ship={repos:[{repo:'web',approvedSourceHead:'a'.repeat(40),devHead:'b'.repeat(40),checksPassed:true}]}
 assert.doesNotMatch(renderShipMilestone(ship,'ready'),/thử tay/)
 const t=renderShipMilestone(ship,'ready',undefined,undefined,[{id:'AC-02',infra:'sms',steps:'Gọi thử'}]);assert.match(t,/Cần thử tay trên dev:\n- AC-02 \[sms\]: Gọi thử/)
})

test('ff report: bảng thẻ, quyết định tự động, luật hạ tầng; --json; --today lọc theo ngày',async t=>{
 const f=makeShipWorkspace(t);commitShipFixture(f);const x=await autoVerifyFixture(f,{reportText:extReport})
 fs.mkdirSync(path.join(f.root,x.card,'evidence'),{recursive:true})
 fs.writeFileSync(path.join(f.root,x.card,'evidence/verify-ac.json'),JSON.stringify({criteria:[{id:'AC-02',manual:true,manual_steps:'Gọi thử'}]}))
 await seedRule(f,'manual');await run(f,'gate-auto','123','--gate','GATE_C','--reason','đủ điều kiện')
 await appendDecision(f.root,{decisionId:'ag1',cardId:'123',question:'Đặt tên nút?',decisionKey:'btn',verdict:'proceed',default:'lưu',reason:'tiền lệ',at:new Date().toISOString(),provenance:{source:'agent'}})
 const r=await run(f,'report');assert.equal(r.code,0,r.err)
 assert.match(r.out,/^Báo cáo ff/);assert.match(r.out,/Gate C tự qua — đủ điều kiện/);assert.match(r.out,/tự quyết câu mềm "Đặt tên nút\?" → lưu — tiền lệ/)
 assert.match(r.out,/áp luật hạ tầng "sms"/);assert.match(r.out,/Luật hạ tầng mới "sms"/);assert.match(r.out,/Cần thử tay trên dev\n- #123 AC-02 \[sms\]: Gọi thử/)
 const j=JSON.parse((await run(f,'report','--json')).out);assert.equal(j.auto.length,3)
 assert.equal(JSON.parse((await run(f,'report','--today','--json')).out).auto.length,3)
 const tomorrow=buildReport(f.root,f.config,{today:true,now:Date.now()+3*86400000});assert.equal(tomorrow.auto.length,0);assert.match(renderReport(tomorrow),/hôm nay/)
 assert.equal((await run(f,'report','--bad')).code,1)
})
test('ff report: nhãn trạng thái thẻ',async t=>{
 const f=makeShipWorkspace(t);const {writeTask}=await import('../ff-worker/src/core/task-store.mjs')
 const base={cardId:'9',revision:'',runId:'r',dispatchId:'',stateVersion:1,history:[],questions:[],pendingEffects:[]}
 const line=(extra)=>{writeTask(f.root,{...base,...extra});return renderReport(buildReport(f.root,f.config)).split('\n').find(l=>l.startsWith('- #9'))}
 assert.match(line({stage:'acceptance'}),/đã lên dev, chờ bạn xác nhận/)
 assert.match(line({stage:'build',executionStatus:'blocked',blockReason:'repair_limit'}),/kẹt: repair_limit/)
 assert.match(line({stage:'build',executionStatus:'idle'}),/đang làm: viết code/)
 assert.match(line({stage:'done'}),/xong/)
})

test('báo cáo ngày: gửi một lần mỗi ngày sau giờ cấu hình',async t=>{
 const f=makeShipWorkspace(t);const sent=[];const channel={notify:async e=>{sent.push(e)}}
 const cfg=(ap)=>({...f.config,autopilot:ap}),at=(h,m)=>new Date(2026,9,24,h,m).getTime()
 assert.equal((await dailyReportTick({root:f.root,config:cfg({enabled:true}),channel,now:at(20,0)})).status,'disabled')
 const c=cfg({enabled:true,daily_report_at:'18:30'})
 assert.equal((await dailyReportTick({root:f.root,config:c,channel,now:at(18,0)})).status,'early')
 assert.equal((await dailyReportTick({root:f.root,config:c,channel,now:at(18,31)})).status,'sent-now')
 assert.equal((await dailyReportTick({root:f.root,config:c,channel,now:at(19,0)})).status,'sent')
 assert.equal(sent.length,1);assert.match(sent[0].body,/Báo cáo ff hôm nay/)
 assert.equal((await dailyReportTick({root:f.root,config:c,channel,now:at(18,31)+86400000})).status,'sent-now')
})

test('ff worker stop dọn phiên tmux; start dọn phiên cũ của worker đã chết',async t=>{
 const f=makeShipWorkspace(t);fs.mkdirSync(path.join(f.root,'.ff'),{recursive:true})
 // stop khi worker đã thoát nhưng phiên tmux còn
 fs.writeFileSync(path.join(f.root,'.ff/worker.json'),JSON.stringify({state:'ready',pid:2147483646}))
 let calls=[],{ctx,buf}=capture(f.root);ctx.runTmux=(a)=>{calls.push(a);return {status:0}};ctx.wait=async()=>{}
 assert.equal(await workerRun(['stop'],ctx),0,buf.err)
 assert.ok(calls.some(a=>a[0]==='kill-session'&&a[2]==='=ff-worker'),JSON.stringify(calls));assert.match(buf.out,/dừng êm/)
 // start: phiên còn, worker chết → kill-session rồi tạo lại (không báo "đã tồn tại")
 calls=[];({ctx,buf}=capture(f.root));ctx.which=()=>true;ctx.wait=async()=>{}
 let created=false;ctx.runTmux=(a)=>{calls.push(a);if(a[0]==='new-session'){created=true;return {status:1}};return {status:0}}
 await workerRun(['start'],ctx)
 assert.doesNotMatch(buf.err,/đã tồn tại/)
 if(created||calls.some(a=>a[0]==='kill-session'))assert.ok(calls.findIndex(a=>a[0]==='kill-session')<calls.findIndex(a=>a[0]==='new-session')||!created)
})

// ---- Rút lại Gate A tự qua khi sai (SRS 6.4 mục 7) ----
import {spawn} from 'node:child_process'
import {readKnowledgeEvents,appendKnowledgeEvent,shadowStats} from '../scripts/lib/knowledge-log.mjs'
import {gateAAutoState} from '../scripts/lib/gate-a-auto.mjs'
const events=(f,type)=>readKnowledgeEvents(f.root,{type})
const repoName=(f)=>f.config.repos[0].name
const hookRun=(f,input)=>new Promise(resolve=>{
 const p=spawn(process.execPath,['scripts/hooks/ask-post.mjs'],{env:{...process.env,FF_CARD_ID:'',FF_RUN_ID:''}})
 let err='';p.stderr.on('data',b=>err+=b);p.on('close',status=>resolve({status,err}));p.stdin.end(JSON.stringify({cwd:f.root,session_id:'35349a6a-f735-4d64-b646-c7bbfe5affad',...input}))
})
const answerGate=(f,gate,q,answer,id)=>hookRun(f,{tool_use_id:id,tool_input:{questions:[{header:gate,question:q,options:[{label:'Duyệt'},{label:'Cần sửa'}]}]},tool_response:{answers:{[q]:answer}}})
// Giả lập n lần dự đoán "duyệt" + người duyệt khớp để lớp học lại.
const legacy=(f)=>{const p=path.join(f.root,'ff.config.yaml');const c=YAML.parse(fs.readFileSync(p,'utf8'));c.worker={...(c.worker??{}),driver:{...(c.worker?.driver??{}),enabled:false}};fs.writeFileSync(p,YAML.stringify(c));f.config.worker=c.worker}
const seedMatches=async(f,n)=>{for(let i=0;i<n;i++)await appendKnowledgeEvent(f.root,{type:'shadow_result',eventId:`seed-${i}-${Math.random()}`,class:'gate_a_auto',repo:repoName(f),match:true,predicted:'duyệt',actual:'duyệt'})}

test('never-reset: gate_a=on tự qua ngay dù lớp chưa có dữ liệu',async t=>{
 const {f}=await gateAFixture(t);legacy(f);const r=await auto(f);assert.equal(r.code,0,r.err)
 assert.equal(gateAAutoState(f.root,f.config)[0].status,'trusted');assert.equal(events(f,'shadow_prediction').length,0)
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'.ff/gates/123-GATE_A.json'),'utf8')).status,'auto_passed')
})

test('reopen sau Gate A tự qua: ghi reset kèm lý do + thẻ, lần gate-auto kế tiếp từ chối như chế độ bóng, 9/10 khớp thì tự qua lại',async t=>{
 const {f}=await gateAFixture(t);legacy(f);assert.equal((await auto(f)).code,0)
 const ro=await run(f,'reopen','123','--reason','QA fail: sai yêu cầu',...[]);assert.equal(ro.code,0,ro.err)
 const resets=events(f,'shadow_reset');assert.equal(resets.length,1)
 assert.deepEqual([resets[0].class,resets[0].repo,resets[0].cardId],['gate_a_auto',repoName(f),'123']);assert.match(resets[0].reason,/mở lại.*QA fail/)
 assert.equal(gateAAutoState(f.root,f.config)[0].status,'learning')
 // rev-1: Brief mới (delta.md) hợp lệ, vẫn bị từ chối vì đang học lại
 fs.writeFileSync(path.join(f.cardDir,'rev-1/delta.md'),BRIEF());
 let r=await auto(f);assert.equal(r.code,1,r.out);assert.match(r.err,/đang học lại sau lần duyệt sai: 0\/9/)
 assert.ok(!fs.existsSync(path.join(f.root,'.ff/gates/123-rev-1-GATE_A.json')))
 const preds=events(f,'shadow_prediction');assert.equal(preds.length,1);assert.equal(preds[0].class,'gate_a_auto');assert.equal(preds[0].predicted,'duyệt')
 // 8 khớp: vẫn học lại; 9 khớp trong 10: tin cậy lại
 await seedMatches(f,8);r=await auto(f);assert.equal(r.code,1)
 await seedMatches(f,2);assert.equal(gateAAutoState(f.root,f.config)[0].status,'trusted')
 r=await auto(f);assert.equal(r.code,0,r.err);assert.match(r.out,/AUTO_PASSED/)
})

test('reopen khi Gate A do người duyệt thì không rút lại',async t=>{
 const {f}=await gateAFixture(t);legacy(f);const file=path.join(f.root,'.ff/gates/123-GATE_A.json')
 assert.equal((await auto(f)).code,0);const rec=JSON.parse(fs.readFileSync(file,'utf8'));rec.status='approved';rec.approved=true;fs.writeFileSync(file,JSON.stringify(rec))
 assert.equal((await run(f,'reopen','123','--reason','x')).code,0);assert.equal(events(f,'shadow_reset').length,0)
})

test('người trả lời "Cần sửa" ở Gate sau của cùng revision → reset; thông báo rút lại chỉ một lần',async t=>{
 const {f}=await gateAFixture(t);legacy(f);assert.equal((await auto(f)).code,0)
 const h=await answerGate(f,'GATE_B','[#123] Duyệt design?','Cần sửa','b1');assert.equal(h.status,0,h.err)
 const resets=events(f,'shadow_reset');assert.equal(resets.length,1);assert.match(resets[0].reason,/Cần sửa.*Gate B/)
 assert.equal(gateAAutoState(f.root,f.config)[0].status,'learning')
 assert.match(h.err,/Gate A tự duyệt bị rút lại cho repo .* do .* hỏi người cho tới khi khớp lại 9\/10/)
 await answerGate(f,'GATE_C','[#123] Nghiệm thu?','Cần sửa','c1');assert.equal(events(f,'shadow_reset').length,1,'cùng receipt chỉ rút lại một lần')
})

test('escape_recorded chỉ về Gate A → reset',async t=>{
 const {f}=await gateAFixture(t);legacy(f);assert.equal((await auto(f)).code,0)
 const {proposeEscape}=await import('../scripts/lib/knowledge-log.mjs')
 await proposeEscape(f.root,{cardId:'123',revision:'rev-1',escapedRevision:'',route:'B',skill:'ff-understand',evidence:'Brief thiếu AC'})
 const q='[#123] [rev-1] Duyệt delta?';fs.mkdirSync(path.join(f.cardDir,'rev-1'),{recursive:true});fs.writeFileSync(path.join(f.cardDir,'rev-1/delta.md'),BRIEF())
 await answerGate(f,'GATE_A',q,'Duyệt','a1')
 assert.equal(events(f,'escape_recorded').length,1);const rs=events(f,'shadow_reset')
 assert.equal(rs.length,1);assert.match(rs[0].reason,/vì sao lọt/)
})

test('giải quyết dự đoán Gate A: khớp / Cần sửa (cũng là mâu thuẫn) / Brief đổi / không có dự đoán',async t=>{
 const {f}=await gateAFixture(t,{ap:{enabled:true,gate_a:'shadow',ship:true}});legacy(f);const repo=repoName(f),q='[#123] Duyệt Brief?'
 assert.equal((await auto(f)).code,1);assert.equal(events(f,'shadow_prediction').length,1)
 await answerGate(f,'GATE_A',q,'Duyệt','g1')
 let res=events(f,'shadow_result');assert.equal(res.length,1);assert.equal(res[0].match,true);assert.equal(res[0].class,'gate_a_auto')
 assert.equal(shadowStats(readKnowledgeEvents(f.root),{}).get('gate_a_auto',repo).windowMatches,1)
 // dự đoán thứ hai + Cần sửa → lệch + reset
 assert.equal((await auto(f)).code,1);await answerGate(f,'GATE_A',q,'Cần sửa','g2')
 res=events(f,'shadow_result');assert.equal(res.at(-1).match,false);assert.equal(events(f,'shadow_reset').length,1)
 // Duyệt nhưng Brief đã đổi sau dự đoán → không khớp
 assert.equal((await auto(f)).code,1);fs.appendFileSync(path.join(f.root,'trellocards',path.basename(f.cardDir),'brief.md'),'\nsửa\n')
 await answerGate(f,'GATE_A',q,'Duyệt','g3');assert.equal(events(f,'shadow_result').at(-1).match,false)
 // không có dự đoán → không ghi gì
 const n=events(f,'shadow_result').length;await answerGate(f,'GATE_A',q,'Duyệt','g4');assert.equal(events(f,'shadow_result').length,n)
})

test('ff report và decide --stats hiện trạng thái gate_a_auto theo repo',async t=>{
 const {f}=await gateAFixture(t);legacy(f);assert.equal((await auto(f)).code,0)
 let s=await run(f,'decide','--stats');assert.match(s.out,/Gate A tự duyệt \(gate_a_auto\):\n- repo .*: tin cậy/)
 await run(f,'reopen','123','--reason','sai');s=await run(f,'decide','--stats');assert.match(s.out,/đang học lại 0\/9 \(đã rút lại lúc .* vì thẻ bị mở lại/)
 assert.match((await run(f,'report')).out,/Gate A tự duyệt\n- repo .*: đang học lại 0\/9/)
 assert.equal(JSON.parse((await run(f,'decide','--stats','--json')).out).gateA[0].status,'learning')
})
