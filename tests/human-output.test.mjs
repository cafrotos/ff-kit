import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { main } from '../scripts/cli/main.mjs'
import { makeWorkspace } from './helpers/fixture.mjs'
import { formatEvent } from '../ff-worker/src/adapters/channel/console.mjs'
import { formatMessage } from '../ff-worker/src/adapters/channel/rocketchat.mjs'

const card = 'trellocards/123-filter'
const sections = { function:'Recruiter lọc ứng viên.', current:'Đổi trang làm mất bộ lọc.', requested:'Giữ bộ lọc khi đổi trang.', target:'Trang tiếp theo giữ cùng bộ lọc.', impact:'Danh sách và phân trang; quyền truy cập giữ nguyên.', acceptance:'Lọc rồi đổi trang vẫn chỉ thấy kết quả phù hợp.', uncertainty:'Chưa kiểm reload trình duyệt.' }
const packet = () => ({ version:1, phase:'understand', headline:'Giữ bộ lọc ứng viên', sections:{...sections}, decisions:[{id:'Q1',question:'Giữ khi reload?',options:[{label:'Có',description:'Giữ cả khi tải lại trang.'},{label:'Không',description:'Chỉ giữ khi đổi trang.'}],recommendation:'Không; dossier chỉ yêu cầu đổi trang.'}],nextAction:'Chốt phạm vi tại CLI.' })
function fixture(t) {
  const w=makeWorkspace({ files:{ [`${card}/01-dossier.md`]:'# Dossier\nGiữ bộ lọc khi đổi trang.\n', [`${card}/01b-ledger.md`]:'| Mã | Trích | Vị trí | Ghi chú |\n|---|---|---|---|\n| D-01 | Giữ bộ lọc khi đổi trang. | Mô tả | sự kiện |\n', [`${card}/brief.md`]:'RAW_INTERNAL_DETAIL | D-01\n' } });t.after(w.cleanup);return w;
}
function capture(cwd){const buf={out:'',err:''};return {buf,ctx:{cwd,stdout:{write:s=>buf.out+=s},stderr:{write:s=>buf.err+=s}}}}
function writePacket(root,p=packet(),rel=`${card}/human-output.json`){fs.mkdirSync(path.dirname(path.join(root,rel)),{recursive:true});fs.writeFileSync(path.join(root,rel),JSON.stringify(p));return rel}
async function hook(input){return await new Promise(resolve=>{const p=spawn(process.execPath,['scripts/hooks/ask-pre.mjs'],{cwd:process.cwd()});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('close',status=>resolve({status,out,err}));p.stdin.end(JSON.stringify(input))})}
async function receiver(t){const events=[];const server=http.createServer((req,res)=>{let raw='';req.on('data',b=>raw+=b);req.on('end',()=>{events.push(JSON.parse(raw));res.writeHead(200,{'content-type':'application/json'}).end('{}')})});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close()});return {events,port:server.address().port}}

test('present prints a business synthesis without dumping artifacts and works without worker',async t=>{
 const w=fixture(t),{buf,ctx}=capture(w.root);const file=writePacket(w.root);
 assert.equal(await main(['present','123','--file',file,'--gate','GATE_A'],ctx),0);
 for(const text of Object.values(sections))assert.ok(buf.out.includes(text));assert.doesNotMatch(buf.out,/RAW_INTERNAL_DETAIL/);assert.match(buf.err,/not_sent/);
 const saved=JSON.parse(fs.readFileSync(path.join(w.root,'.ff/presentations/123.understand.root.json'),'utf8'));assert.equal(saved.taskId,'123');assert.equal(saved.revision,null);assert.ok(saved.sourceHashes['brief.md']);assert.equal(saved.gate,'GATE_A');
});
test('present rejects missing sections and stale identity before printing/sending',async t=>{
 const w=fixture(t);for(const change of [p=>delete p.sections.impact,p=>p.revision='rev-1',p=>p.scope='../outside']){const p=packet();change(p);const file=writePacket(w.root,p),{buf,ctx}=capture(w.root);assert.equal(await main(['present','123','--file',file],ctx),2);assert.equal(buf.out,'')}
});
test('present binds active revision and requires current source artifacts',async t=>{
 const w=fixture(t);fs.mkdirSync(path.join(w.root,card,'rev-2'));const file=writePacket(w.root,packet(),`${card}/rev-2/human-output.json`);let c=capture(w.root);assert.equal(await main(['present','123','--file',file],c.ctx),2);fs.writeFileSync(path.join(w.root,card,'rev-2/delta.md'),'Delta: giữ bộ lọc khi reopen.');c=capture(w.root);assert.equal(await main(['present','123','--file',file],c.ctx),0);assert.match(c.buf.out,/rev-2/);
});
test('Ask hook retains all questions and options and uses only a current presentation',async t=>{
 const w=fixture(t),file=writePacket(w.root),c=capture(w.root);assert.equal(await main(['present','123','--file',file,'--gate','GATE_A'],c.ctx),0);
 const rc=await receiver(t);fs.writeFileSync(path.join(w.root,'.ff/worker.json'),JSON.stringify({port:rc.port}));
 const input={cwd:w.root,tool_input:{questions:[{header:'Q1',question:'[#123] Giữ khi reload?',options:[{label:'Có',description:'Giữ cả reload.'},{label:'Không',description:'Chỉ đổi trang.'}]},{header:'Q2',question:'[#123] '+ 'Mô tả rõ '.repeat(30),options:[{label:'A',description:'Hệ quả dài tiếng Việt.'},{label:'B',description:'Hệ quả khác.'}]}]}};
 assert.equal((await hook(input)).status,0);assert.match(rc.events[0].body,/Recruiter lọc/);assert.match(rc.events[0].body,/Hệ quả dài tiếng Việt/);assert.ok(rc.events[0].body.includes(input.tool_input.questions[1].question));assert.equal(rc.events[0].taskId,'123');
 fs.appendFileSync(path.join(w.root,card,'brief.md'),'changed');assert.equal((await hook(input)).status,0);assert.doesNotMatch(rc.events[1].body,/Recruiter lọc/);assert.match(rc.events[1].body,/tổng hợp.*(?:thiếu|hết hiệu lực)|chưa có.*tổng hợp/i);
});
test('console and RocketChat preserve identical metadata and decisions',()=>{const event={kind:'gate',taskId:'123',title:'Duyệt',fields:{revision:'rev-2',phase:'verify',scope:'task-1'},body:'Q1 Có: hệ quả; Q2 Không: hệ quả khác'};assert.equal(formatEvent(event),formatMessage(event));assert.match(formatEvent(event),/rev-2/)});
test('standalone ship request still presents human scope and requires confirmation without worker',async t=>{const w=fixture(t),c=capture(w.root);assert.equal(await main(['ship-request','--task','123','--title','Ship bộ lọc','--body','Phạm vi đã nghiệm thu: giữ bộ lọc; web/task → dev, commit abc.'],c.ctx),0);assert.match(c.buf.out,/Phạm vi đã nghiệm thu/);assert.match(c.buf.err,/not_sent/);assert.match(c.buf.out,/CLI/)});
test('ordinary questions cannot mix scopes or use an earlier revision',async t=>{const w=fixture(t);const q=(question)=>({header:'Q1',question,options:[{label:'A'},{label:'B'}]});let r=await hook({cwd:w.root,tool_input:{questions:[q('[#123] [task-1] x'),q('[#123] [task-2] y')]}});assert.equal(r.status,2);assert.match(r.err,/phạm vi|scope/);fs.mkdirSync(path.join(w.root,card,'rev-2'));r=await hook({cwd:w.root,tool_input:{questions:[q('[#123] [rev-1] x')]}});assert.equal(r.status,2);assert.match(r.err,/revision/)});
test('changed or malformed cached presentation is not rendered even when source hashes match',async t=>{const w=fixture(t);const c=capture(w.root);assert.equal(await main(['present','123','--file',writePacket(w.root),'--gate','GATE_A'],c.ctx),0);const f=path.join(w.root,'.ff/presentations/123.understand.root.json');const original=JSON.parse(fs.readFileSync(f));const rc=await receiver(t);fs.writeFileSync(path.join(w.root,'.ff/worker.json'),JSON.stringify({port:rc.port}));for(const alter of [p=>p.headline='FORGED_SUMMARY',p=>p.decisions=null,p=>delete p.createdAt]){const p=structuredClone(original);alter(p);fs.writeFileSync(f,JSON.stringify(p));const r=await hook({cwd:w.root,tool_input:{questions:[{header:'Q1',question:'[#123] Chọn phạm vi?',options:[{label:'A'},{label:'B'}]}]}});assert.equal(r.status,0,r.err);assert.doesNotMatch(rc.events.at(-1).body,/FORGED_SUMMARY|Recruiter lọc/);assert.match(rc.events.at(-1).body,/thiếu hoặc hết hiệu lực/)}});
test('cluster presentation invalidates when its brief, ledger or shared design changes',async t=>{const w=fixture(t);const dir=path.join(w.root,card,'task-1');fs.mkdirSync(dir);for(const f of ['brief.md','01b-ledger.md','02-spec.md','03-design.md'])fs.writeFileSync(path.join(dir,f),'Cluster source '+f);fs.writeFileSync(path.join(w.root,card,'03-design.md'),'Shared contract');const p={...packet(),phase:'design',scope:'task-1',sections:{realization:'Theo Brief',differences:'Không',impact:'Quyền giữ nguyên',uncertainty:'Không'}};const file=writePacket(w.root,p);const {readPresentation}=await import('../scripts/lib/human-output.mjs');const {loadConfig}=await import('../scripts/lib/config.mjs');const config=loadConfig(w.root).config;for(const rel of ['task-1/brief.md','task-1/01b-ledger.md','03-design.md']){assert.equal(await main(['present','123','--file',file,'--gate','GATE_B'],capture(w.root).ctx),0);const f=path.join(w.root,card,rel);fs.appendFileSync(f,'Changed');assert.equal(readPresentation(w.root,config,'123',{gate:'GATE_B',scope:'task-1'}),null,rel)}});
test('reopen clears active acceptance metadata from the previous milestone',async t=>{const w=fixture(t);const {writeTask,readTask}=await import('../ff-worker/src/core/task-store.mjs');writeTask(w.root,{cardId:'123',phase:'completed',acceptance:'accepted',acceptedRevision:'',acceptedAt:'old',shipState:'not_shipped'});assert.equal(await main(['reopen','123','--reason','Giữ bộ lọc vẫn lỗi'],capture(w.root).ctx),0);const task=readTask(w.root,'123');assert.equal(task.revision,'rev-1');assert.equal(task.acceptance,undefined);assert.equal(task.acceptedRevision,undefined);assert.equal(task.shipState,undefined)});
test('whole-function verify presentation binds child contracts without invented root spec/design',async t=>{const w=fixture(t);for(const child of ['task-1','task-2']){const dir=path.join(w.root,card,child);fs.mkdirSync(dir);for(const f of ['brief.md','01b-ledger.md','02-spec.md','03-design.md'])fs.writeFileSync(path.join(dir,f),child+' '+f)}fs.writeFileSync(path.join(w.root,card,'05-verify-report.md'),'Whole-function report');const p={...packet(),phase:'verify',sections:{expectedActual:'Hai cụm đúng spec.',evidence:'Test từng cụm và tích hợp.',regression:'Quyền giữ nguyên.',limitations:'Không',conclusion:'Đạt; chờ Gate C.'}},c=capture(w.root);assert.equal(await main(['present','123','--file',writePacket(w.root,p),'--gate','GATE_C'],c.ctx),0,c.buf.err);const saved=JSON.parse(fs.readFileSync(path.join(w.root,'.ff/presentations/123.verify.root.json')));assert.ok(saved.sourceHashes['task-1/02-spec.md']);assert.ok(saved.sourceHashes['task-2/03-design.md'])});
test('revision-local ledger decisions invalidate a current presentation',async t=>{const w=fixture(t);const dir=path.join(w.root,card,'rev-2');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'delta.md'),'Delta');fs.writeFileSync(path.join(dir,'01b-ledger.md'),'Revision decisions');const c=capture(w.root);assert.equal(await main(['present','123','--file',writePacket(w.root,packet(),`${card}/rev-2/human-output.json`)],c.ctx),0);const {readPresentation}=await import('../scripts/lib/human-output.mjs');const {loadConfig}=await import('../scripts/lib/config.mjs');fs.appendFileSync(path.join(dir,'01b-ledger.md'),'Changed');assert.equal(readPresentation(w.root,loadConfig(w.root).config,'123',{phase:'understand'}),null)});

test('human text redacts credential assignments, bearer values and credential URLs',async()=>{
 const {redactHumanText}=await import('../scripts/lib/human-output.mjs')
 const text=redactHumanText('Authorization: Bearer sample-private-value; token=private-token; API_KEY="private-key value" https://name:password@example.test')
 assert.doesNotMatch(text,/sample-private-value|private-token|private-key value|name:password/)
 assert.match(text,/REDACTED/)
})


test('ship render and events redact all URL userinfo while private target binding stays exact',async()=>{
 const {renderPresentation,presentationEvent,redactHumanText}=await import('../scripts/lib/human-output.mjs')
 const origin=JSON.stringify({fetch:['https://opaquecredential@example.com/repo.git'],push:['https://opaqueuser:opaquepassword@example.com/repo.git','ssh://opaquessh@example.com/repo.git']})
 const p={version:1,taskId:'123',phase:'ship',headline:'Ship',revision:null,scope:'',presentationId:'synthetic',sections:{acceptedScope:'Scope',destination:'Remote',checks:'Checked',limitations:'None'},decisions:[],nextAction:'Wait',targets:[{repo:'web',sourceHead:'abc',origin,shipBranch:'dev',taskBranch:'task/123'}]}
 for(const output of [redactHumanText(origin),renderPresentation(p),JSON.stringify(presentationEvent(p))]){
  assert.doesNotMatch(output,/opaquecredential|opaqueuser|opaquepassword|opaquessh/)
  assert.match(output,/REDACTED/)
  assert.match(output,/example.com/)
 }
 assert.equal(p.targets[0].origin,origin)
})

test('acceptance ship packet preserves ship approval packet and never selects newer verify presentation',async t=>{
 const {makeShipWorkspace}=await import('./helpers/ship.mjs'),{preparePresentation,savePresentation,readPresentation}=await import('../scripts/lib/human-output.mjs')
 const f=makeShipWorkspace(t)
 for(const name of ['brief.md','02-spec.md','03-design.md','05-verify-report.md'])fs.writeFileSync(path.join(f.cardDir,name),'fixture')
 const input={version:1,phase:'ship',headline:'Shipped commit and checks; deployment unknown',sections:{acceptedScope:'scope',destination:'targets',checks:'passed',limitations:'deployment unknown'},decisions:[{id:'Q1',question:'Duyệt bản đã ship?',options:[{label:'Duyệt',description:'Accept'},{label:'Không duyệt',description:'Feedback'}],recommendation:'Review'}],nextAction:'CLI acceptance'}
 const approval=preparePresentation(f.root,f.config,'123',input);savePresentation(f.root,approval)
 const acceptance=preparePresentation(f.root,f.config,'123',{...input,purpose:'acceptance'});savePresentation(f.root,acceptance)
 assert.equal(readPresentation(f.root,f.config,'123',{phase:'ship'}).presentationId,approval.presentationId)
 assert.equal(readPresentation(f.root,f.config,'123',{phase:'ship',purpose:'acceptance'}).purpose,'acceptance')
})

test('packet-only decision context scopes actual human answers and maps labels',async t=>{
 const w=fixture(t),p=packet()
 p.decisions[0].decisionContext={repo:'web',businessScope:'filters',decisionKey:'reload',class:'default-value',normalizedOptions:{'Có':'persist','Không':'page-only'}}
 const {loadConfig}=await import('../scripts/lib/config.mjs')
 const {preparePresentation}=await import('../scripts/lib/human-output.mjs')
 const {recordQuestion,recordAnswers}=await import('../scripts/lib/question-history.mjs')
 const config=loadConfig(w.root).config,prepared=preparePresentation(w.root,config,'123',p)
 assert.deepEqual(prepared.decisions[0].decisionContext,p.decisions[0].decisionContext)
 const context={cardId:'123',revision:'',runId:'run',dispatchId:'',claudeSessionId:'session',presentationId:prepared.presentationId,decisionPacket:prepared}
 const q={header:'Q1',question:'[#123] '+p.decisions[0].question,options:p.decisions[0].options}
 const input={session_id:'session',tool_use_id:'tool',tool_input:{questions:[q]},tool_response:{answers:{[q.question]:'Có'}}}
 await recordQuestion(w.root,context,input)
 const [d]=await recordAnswers(w.root,context,input)
 assert.equal(d.normalizedValue,'persist');assert.equal(d.repo,'web');assert.equal(d.decisionKey,'reload');assert.equal(d.project,prepared.project);assert.equal(d.policyVersion,prepared.policyVersion)
 assert.equal(q.decisionContext,undefined)
})

test('ff decide uses current scoped packet and stores advice as agent/shadow only',async t=>{
 const w=fixture(t),p=packet()
 p.decisions[0].decisionContext={repo:'web',businessScope:'filters',decisionKey:'reload',class:'default-value',normalizedOptions:{'Có':'persist','Không':'page-only'}}
 assert.equal(await main(['present','123','--file',writePacket(w.root,p)],capture(w.root).ctx),0)
 const {readDecisions,appendDecision}=await import('../scripts/lib/knowledge.mjs')
 const prepared=JSON.parse(fs.readFileSync(path.join(w.root,'.ff/presentations/123.understand.root.json')))
 for(let i=0;i<3;i++)await appendDecision(w.root,{decisionId:`p${i}`,...p.decisions[0].decisionContext,project:prepared.project,policyVersion:prepared.policyVersion,normalizedValue:'persist',provenance:{source:'cli',originId:`origin${i}`}})
 const {appendKnowledgeEvent}=await import('../scripts/lib/knowledge-log.mjs')
 for(let i=0;i<10;i++)await appendKnowledgeEvent(w.root,{type:'shadow_result',eventId:`trust${i}`,class:'default-value',repo:'web',match:true}) // KNW-10: lớp phải đủ 9/10 khớp mới được tự quyết
 const c=capture(w.root)
 assert.equal(await main(['decide','123','--class','default-value','--decision-key','reload','--repo','web','--question',p.decisions[0].question],c.ctx),0,c.buf.err)
 assert.equal(JSON.parse(c.buf.out).verdict,'proceed')
 const gate=capture(w.root);assert.equal(await main(['decide','--gate','SHIP','123'],gate.ctx),0);assert.equal(JSON.parse(gate.buf.out).verdict,'escalate')
 assert.deepEqual(readDecisions(w.root).slice(-2).map(r=>r.provenance.source),['agent','shadow'])
})

test('ff decide rejects historical label value after packet mapping changes',async t=>{
 const w=fixture(t),p=packet()
 p.decisions[0].options=[{label:'Yes',description:'Keep the setting.'},{label:'No',description:'Use page setting.'}]
 p.decisions[0].decisionContext={repo:'web',businessScope:'filters',decisionKey:'reload',class:'default-value',normalizedOptions:{Yes:'persist',No:'page-only'}}
 assert.equal(await main(['present','123','--file',writePacket(w.root,p)],capture(w.root).ctx),0)
 const {appendDecision}=await import('../scripts/lib/knowledge.mjs')
 const prepared=JSON.parse(fs.readFileSync(path.join(w.root,'.ff/presentations/123.understand.root.json')))
 for(let i=0;i<3;i++)await appendDecision(w.root,{decisionId:`old${i}`,...p.decisions[0].decisionContext,project:prepared.project,policyVersion:prepared.policyVersion,normalizedValue:'yes',provenance:{source:'cli',originId:`old-origin${i}`}})
 const c=capture(w.root)
 assert.equal(await main(['decide','123','--class','default-value','--decision-key','reload','--repo','web','--question',p.decisions[0].question],c.ctx),0,c.buf.err)
 const advice=JSON.parse(c.buf.out)
 assert.equal(advice.verdict,'escalate');assert.equal(advice.default,null)
})
