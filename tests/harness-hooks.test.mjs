import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { makeHarnessFixture } from './helpers/harness.mjs'
import { listHarnessEvents } from '../scripts/lib/harness-events.mjs'
import { readTask } from '../ff-worker/src/core/task-store.mjs'
import { workflowPackage } from './helpers/workflow.mjs'
import { prepareWorkflowSnapshot } from '../scripts/lib/workflow-snapshot.mjs'

const SESSION='35349a6a-f735-4d64-b646-c7bbfe5affad'
const scope={cardId:'123',revision:'',runId:'run-1',dispatchId:'dispatch-1'}
const q=(header='Q1',question='[#123] Chọn phạm vi?')=>({header,question,options:header.startsWith('GATE_')?[{label:'Duyệt'},{label:'Cần sửa'}]:[{label:'Có'},{label:'Không'}]})
function seed(w,overrides={}){
 if(!w.workflow){const packageRoot=path.join(w.root,'fixture-plugin');workflowPackage(packageRoot);w.workflow=prepareWorkflowSnapshot({root:w.root,packageRoot,cliVersion:'0.1.0'})}
 w.seedTask(w.task({...scope,claudeSessionId:SESSION,workflow:w.workflow,pendingDispatch:{...scope,stage:'understand'},...overrides}))
}
function hook(name,w,input={},env={}){return new Promise(resolve=>{const p=spawn(process.execPath,[`scripts/hooks/${name}.mjs`],{env:{...process.env,FF_CARD_ID:'123',FF_RUN_ID:'run-1',CLAUDE_PLUGIN_ROOT:w.workflow?.path,CLAUDE_ENV_FILE:path.join(w.root,'.ff/claude-env'),...env}});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('close',status=>resolve({status,out,err}));p.stdin.end(JSON.stringify({cwd:w.root,session_id:SESSION,...input}))})}
const events=w=>listHarnessEvents(w.root,'123')
const input=(id,questions=[q()],answers)=>({tool_use_id:id,tool_input:{questions},...(answers?{tool_response:{answers}}:{})})
async function bound(t){const w=makeHarnessFixture(t);seed(w);assert.equal((await hook('session-start',w)).status,0);return w}
async function receiver(t,w){const got=[];const s=http.createServer((req,res)=>{let raw='';req.on('data',b=>raw+=b);req.on('end',()=>{got.push(JSON.parse(raw));res.writeHead(204).end()})});await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>{s.closeAllConnections();s.close()});w.writeArtifact('.ff/worker.json',JSON.stringify({port:s.address().port}));return got}

test('SessionStart confirms worker UUID without writing task or pinning dispatch',async t=>{const w=makeHarnessFixture(t);seed(w);const before=fs.readFileSync(path.join(w.root,'.ff/tasks/123.json'),'utf8');await hook('session-start',w);assert.equal(fs.readFileSync(path.join(w.root,'.ff/tasks/123.json'),'utf8'),before);assert.equal(events(w).find(e=>e.type==='session_started')?.payload.status,'confirmed');const dir=createHash('sha256').update('run-1').digest('hex');const binding=JSON.parse(fs.readFileSync(path.join(w.root,'.ff/runner',dir,'binding.json')));assert.equal(binding.claudeSessionId,SESSION);assert.equal(binding.revision,undefined)})
test('SessionStart rejects mismatch, missing UUID and late launcher run without assigning UUID',async t=>{for(const [session,env,reason] of [['wrong',{},'session_mismatch'],[null,{},'missing_session_id'],[SESSION,{FF_RUN_ID:'old'},null]]){const w=makeHarnessFixture(t);seed(w);await hook('session-start',w,{session_id:session},env);assert.equal(readTask(w.root,'123').claudeSessionId,SESSION);assert.equal(events(w).length,reason?1:0);if(reason)assert.deepEqual([events(w)[0].payload.status,events(w)[0].payload.reason],['blocked',reason])}})
test('Q1 and Q2 answers persist once with stable identities, provenance and snapshots',async t=>{const w=await bound(t);const qs=[q(),q('Q2','[#123] Giữ khi reload?')],i=input('tool-1',qs,{[qs[0].question]:' Có ',[qs[1].question]:'Không'});await hook('ask-pre',w,i);await hook('ask-pre',w,i);await hook('ask-post',w,i);await hook('ask-post',w,i);const {readQuestionHistory}=await import('../scripts/lib/question-history.mjs');const history=readQuestionHistory(w.root,'123');assert.equal(history.length,2);assert.equal(new Set(history.map(q=>q.questionId)).size,2);assert.deepEqual(history.map(q=>q.status),['answered','answered']);const lines=fs.readFileSync(path.join(w.root,'.ff/decisions.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(lines.length,2);assert.equal(lines[0].normalizedValue,'có');assert.equal(lines[0].provenance.source,'cli');assert.equal(lines[1].decisionContext.header,'Q2');assert.equal(events(w).filter(e=>e.type==='question_opened').length,2);assert.equal(events(w).filter(e=>e.type==='question_answered').length,2)})
test('late pre-hook does not reopen answered question and missing answer stays open',async t=>{const w=await bound(t);const qs=[q(),q('Q2','[#123] Khác?')],i=input('out-of-order',qs,{[qs[0].question]:'Có'});const {recordAnswers}=await import('../scripts/lib/question-history.mjs');await recordAnswers(w.root,{...scope,claudeSessionId:SESSION}, {session_id:SESSION,...i});await hook('ask-pre',w,i);const {readQuestionHistory}=await import('../scripts/lib/question-history.mjs');assert.deepEqual(readQuestionHistory(w.root,'123').map(q=>q.status),['answered','open']);assert.equal(events(w).filter(e=>e.type==='question_opened').length,1);assert.equal(events(w).filter(e=>e.type==='question_answered').length,1)})
test('post-hook retains pre-captured scope after current dispatch advances and does not clear new questions',async t=>{const w=await bound(t);const old=input('old',[q()],{'[#123] Chọn phạm vi?':'Có'});await hook('ask-pre',w,old);seed(w,{revision:'rev-1',dispatchId:'dispatch-2',pendingDispatch:{runId:'run-1',revision:'rev-1',dispatchId:'dispatch-2',stage:'understand'}});fs.mkdirSync(path.join(w.cardDir,'rev-1'));const fresh=input('new',[q('Q1','[#123] [rev-1] Câu mới?')]);await hook('ask-pre',w,fresh);await hook('ask-post',w,old);const answer=events(w).find(e=>e.type==='question_answered');assert.deepEqual([answer.revision,answer.dispatchId],['','dispatch-1']);const {readQuestionHistory}=await import('../scripts/lib/question-history.mjs');assert.equal(readQuestionHistory(w.root,'123').find(q=>q.toolUseId==='new').status,'open')})
test('two needs-repair Gate answers survive receipt overwrite; missing answer creates no receipt',async t=>{const w=await bound(t);w.writeArtifact('trellocards/123-harness/01-dossier.md','# Thẻ 123\nRequest\n');w.writeArtifact('trellocards/123-harness/01b-ledger.md','| Mã | Trích | Vị trí | Ghi chú |\n|---|---|---|---|\n| D-01 | Request | Mô tả | |\n');w.writeArtifact('trellocards/123-harness/brief.md','| # | Mục | Nguồn |\n|---|---|---|\n| 1 | Request | D-01 |\n');const qs=[q('GATE_A','[#123] Duyệt Brief?')];for(const id of ['repair-1','repair-2']){const pre=await hook('ask-pre',w,input(id,qs));assert.equal(pre.status,0,pre.err);assert.equal((await hook('ask-post',w,input(id,qs,{[qs[0].question]:'Cần sửa'}))).status,0)}const file=path.join(w.root,'.ff/gates/123-GATE_A.json'),before=fs.readFileSync(file,'utf8');await hook('ask-post',w,input('missing',qs));assert.equal(fs.readFileSync(file,'utf8'),before);const lines=fs.readFileSync(path.join(w.root,'.ff/decisions.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(lines.length,2);assert.ok(lines.every(d=>d.normalizedValue==='cần sửa'))})
test('Stop emits only idle; permission_prompt emits separate waiting event and attention once',async t=>{const w=await bound(t),got=await receiver(t,w);await hook('stop',w);await hook('stop',w);await hook('notification',w,{notification_type:'idle_prompt',message:'idle'});const n={notification_type:'permission_prompt',message:'Need permission; token=SECRET_VALUE'};await hook('notification',w,n);await hook('notification',w,n);assert.equal(events(w).filter(e=>e.type==='runner_idle').length,2);assert.equal(events(w).filter(e=>e.type==='permission_waiting').length,1);assert.equal(events(w).filter(e=>e.type==='stage_finished').length,0);assert.equal(got.length,1);assert.doesNotMatch(JSON.stringify(events(w)),/SECRET_VALUE/);assert.doesNotMatch(JSON.stringify(got),/SECRET_VALUE/)})
test('permission_prompt while an AskUserQuestion is open for the run is not a second attention; after answer it works again',async t=>{
  const w=await bound(t),got=await receiver(t,w),qs=[q()]
  await hook('ask-pre',w,input('open-1',qs))
  const base=got.length
  const n={notification_type:'permission_prompt',message:'Claude needs your permission'}
  await hook('notification',w,n)
  assert.equal(events(w).filter(e=>e.type==='permission_waiting').length,0)
  assert.equal(got.length,base)
  await hook('ask-post',w,input('open-1',qs,{[qs[0].question]:'Có'}))
  await hook('notification',w,n)
  assert.equal(events(w).filter(e=>e.type==='permission_waiting').length,1)
  assert.equal(got.length,base+1)
})
test('missing binding or tool identity fails closed without fabricated question events',async t=>{const w=makeHarnessFixture(t);seed(w);await hook('ask-pre',w,input('unbound'));await hook('ask-post',w,input('unbound',[q()],{'[#123] Chọn phạm vi?':'Có'}));await hook('stop',w);assert.equal(events(w).length,0);await hook('session-start',w);await hook('ask-pre',w,input(undefined));assert.equal(events(w).filter(e=>e.type==='question_opened').length,0)})

test('a mismatched SessionStart blocks a previously confirmed run without overwriting binding UUID',async t=>{
  const w=await bound(t),dir=createHash('sha256').update('run-1').digest('hex'),file=path.join(w.root,'.ff/runner',dir,'binding.json'),before=fs.readFileSync(file,'utf8')
  await hook('session-start',w,{session_id:'wrong'})
  assert.equal(fs.readFileSync(file,'utf8'),before)
  const {readRunnerBinding}=await import('../scripts/lib/question-history.mjs')
  assert.equal(readRunnerBinding(w.root,'run-1').status,'blocked')
  await hook('session-start',w)
  await hook('ask-pre',w,input('after-block'))
  assert.equal(events(w).filter(e=>e.type==='question_opened').length,0)
  assert.equal(readRunnerBinding(w.root,'run-1').status,'blocked')
})
test('distinct permission reasons in one dispatch each notify once',async t=>{
  const w=await bound(t),got=await receiver(t,w)
  for(const message of ['Approve command A','Approve command B','Approve command B'])await hook('notification',w,{notification_type:'permission_prompt',message})
  assert.equal(events(w).filter(e=>e.type==='permission_waiting').length,2)
  assert.equal(got.length,2)
})

test('post-hook without pre-capture cannot relabel an old answer with current dispatch',async t=>{
 const w=await bound(t)
 await hook('ask-post',w,input('never-captured',[q()],{'[#123] Chọn phạm vi?':'Có'}))
 assert.equal(events(w).filter(e=>e.type==='question_answered').length,0)
 assert.equal(fs.existsSync(path.join(w.root,'.ff/decisions.jsonl')),false)
})

test('hook scope whitelists task metadata and never copies arbitrary task fields into events/history',async t=>{
 const w=makeHarnessFixture(t);seed(w,{credentials:'MUST_NOT_BE_COPIED',custom:{password:'MUST_NOT_BE_COPIED'}})
 await hook('session-start',w)
 await hook('ask-pre',w,input('whitelist'))
 for(const e of events(w))assert.deepEqual(Object.keys(e).sort(),['at','cardId','dispatchId','eventId','payload','revision','runId','type'])
 assert.doesNotMatch(JSON.stringify(events(w)),/MUST_NOT_BE_COPIED/)
 const {readQuestionHistory}=await import('../scripts/lib/question-history.mjs')
 assert.doesNotMatch(JSON.stringify(readQuestionHistory(w.root,'123')),/MUST_NOT_BE_COPIED/)
})

test('a Gate receipt validation failure still preserves the human answer as history',async t=>{
 const w=await bound(t)
 seed(w,{revision:'rev-1',pendingDispatch:{runId:'run-1',revision:'rev-1',dispatchId:'dispatch-1',stage:'understand'}})
 w.writeArtifact('trellocards/123-harness/rev-1/delta.md','Delta')
 const qs=[q('GATE_C','[#123] [rev-1] Duyệt nghiệm thu?')],i=input('gate-without-prerequisites',qs,{[qs[0].question]:'Duyệt'})
 const pre=await hook('ask-pre',w,i);assert.equal(pre.status,0,pre.err)
 const post=await hook('ask-post',w,i)
 assert.equal(post.status,0,post.err)
 assert.match(post.err,/Gate.*(?:receipt|bản ghi)/)
 const {readQuestionHistory}=await import('../scripts/lib/question-history.mjs')
 assert.equal(readQuestionHistory(w.root,'123')[0].status,'answered')
 assert.equal(events(w).filter(e=>e.type==='question_answered').length,1)
 assert.equal(fs.existsSync(path.join(w.root,'.ff/gates/123-rev-1-GATE_C.json')),false)
})

test('null, empty and malformed answers never become human decisions',async t=>{
 const w=await bound(t),i=input('missing-values')
 await hook('ask-pre',w,i)
 for(const value of [null,[],{},''])await hook('ask-post',w,{...i,tool_response:{answers:{'[#123] Chọn phạm vi?':value}}})
 assert.equal(events(w).filter(e=>e.type==='question_answered').length,0)
 assert.equal(fs.existsSync(path.join(w.root,'.ff/decisions.jsonl')),false)
})

function gateArtifacts(w) {
 w.writeArtifact('trellocards/123-harness/01-dossier.md','# Thẻ 123\nRequest\n')
 w.writeArtifact('trellocards/123-harness/01b-ledger.md','| Mã | Trích | Vị trí | Ghi chú |\n|---|---|---|---|\n| D-01 | Request | Mô tả | |\n')
 w.writeArtifact('trellocards/123-harness/brief.md','| # | Mục | Nguồn |\n|---|---|---|\n| 1 | Request | D-01 |\n')
 return path.join(w.root,'.ff/gates/123-GATE_A.json')
}

for(const [older,newer] of [['Duyệt','Cần sửa'],['Cần sửa','Duyệt']]) {
 test(`replaying older ${older} cannot overwrite newer ${newer} Gate receipt`,async t=>{
  const w=await bound(t),file=gateArtifacts(w),qs=[q('GATE_A','[#123] Duyệt Brief?')]
  const old=input('older-gate',qs,{[qs[0].question]:older}),fresh=input('newer-gate',qs,{[qs[0].question]:newer})
  for(const i of [old,fresh]) {
   const pre=await hook('ask-pre',w,i);assert.equal(pre.status,0,pre.err)
   const post=await hook('ask-post',w,i);assert.equal(post.status,0,post.err)
  }
  const before=fs.readFileSync(file,'utf8')
  await hook('ask-post',w,old)
  assert.equal(fs.readFileSync(file,'utf8'),before)
  const {readQuestionHistory}=await import('../scripts/lib/question-history.mjs')
  assert.deepEqual(readQuestionHistory(w.root,'123').map(q=>q.decision.answer),[older,newer])
 })
}

test('duplicate Gate delivery retains original receipt bytes and artifact hashes',async t=>{
 const w=await bound(t),file=gateArtifacts(w),qs=[q('GATE_A','[#123] Duyệt Brief?')]
 const i=input('immutable-receipt',qs,{[qs[0].question]:'Duyệt'})
 assert.equal((await hook('ask-pre',w,i)).status,0)
 await hook('ask-post',w,i)
 const before=fs.readFileSync(file,'utf8')
 w.writeArtifact('trellocards/123-harness/brief.md','Changed after the approval\n')
 await hook('ask-post',w,i)
 assert.equal(fs.readFileSync(file,'utf8'),before)
})

test('mismatched captured header, text, options or card cannot change a Gate receipt',async t=>{
 const w=await bound(t),file=gateArtifacts(w),qs=[q('GATE_A','[#123] Duyệt Brief?')]
 const valid=input('baseline-gate',qs,{[qs[0].question]:'Duyệt'})
 assert.equal((await hook('ask-pre',w,valid)).status,0)
 await hook('ask-post',w,valid)
 const before=fs.readFileSync(file,'utf8')
 const cases=[
  [q(),qs[0]],
  [qs[0],q('GATE_A','[#123] Duyệt nội dung khác?')],
  [qs[0],{...qs[0],options:[{label:'Duyệt'},{label:'Không duyệt'}]}],
  [q('GATE_A','[#999] Duyệt Brief?'),qs[0]],
 ]
 for(const [index,[captured,post]] of cases.entries()) {
  const id=`mismatch-${index}`
  // Capture API isolates immutable validation from AskPre's independent Gate checks.
  const {recordQuestion}=await import('../scripts/lib/question-history.mjs')
  await recordQuestion(w.root,{...scope,claudeSessionId:SESSION},{session_id:SESSION,...input(id,[captured])})
  for(const answer of ['Duyệt','Cần sửa']) {
   const result=await hook('ask-post',w,input(id,[post],{[post.question]:answer}))
   assert.equal(result.status,0,result.err)
   assert.equal(fs.readFileSync(file,'utf8'),before,`mismatch ${index}: ${answer}`)
  }
 }
 const {readQuestionHistory}=await import('../scripts/lib/question-history.mjs')
 assert.ok(readQuestionHistory(w.root,'123').filter(q=>q.toolUseId.startsWith('mismatch-')).every(q=>q.status==='open'))
})

test('a post interrupted after durable history cannot grant a receipt on redelivery',async t=>{
 const w=await bound(t),file=gateArtifacts(w),qs=[q('GATE_A','[#123] Duyệt Brief?')]
 const i=input('interrupted-before-gate',qs,{[qs[0].question]:'Duyệt'})
 assert.equal((await hook('ask-pre',w,i)).status,0)
 const {recordAnswers}=await import('../scripts/lib/question-history.mjs')
 await recordAnswers(w.root,{...scope,claudeSessionId:SESSION},{session_id:SESSION,...i})
 w.writeArtifact('trellocards/123-harness/brief.md','Changed after the interrupted post\n')
 const post=await hook('ask-post',w,i)
 assert.equal(post.status,0,post.err)
 assert.equal(fs.existsSync(file),false)
 gateArtifacts(w)
 const retryWithNewIdentity=input('fresh-after-interruption',qs,{[qs[0].question]:'Duyệt'})
 assert.equal((await hook('ask-pre',w,retryWithNewIdentity)).status,0)
 await hook('ask-post',w,retryWithNewIdentity)
 assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).approved,true)
})

test('failed Gate validation stays consumed after prerequisites become valid',async t=>{
 const w=await bound(t),file=gateArtifacts(w),qs=[q('GATE_A','[#123] Duyệt Brief?')]
 const i=input('failed-once',qs,{[qs[0].question]:'Duyệt'})
 assert.equal((await hook('ask-pre',w,i)).status,0)
 fs.mkdirSync(path.join(w.cardDir,'rev-1'))
 const first=await hook('ask-post',w,i)
 assert.equal(first.status,0,first.err)
 assert.match(first.err,/Gate.*receipt/)
 assert.equal(fs.existsSync(file),false)
 fs.rmdirSync(path.join(w.cardDir,'rev-1'))
 await hook('ask-post',w,i)
 assert.equal(fs.existsSync(file),false)
 const {readQuestionHistory}=await import('../scripts/lib/question-history.mjs')
 assert.equal(readQuestionHistory(w.root,'123')[0].decision.answer,'Duyệt')
})

test('a delayed earlier decision cannot overwrite a later Gate application across captures',async t=>{
 const w=await bound(t),file=gateArtifacts(w),qs=[q('GATE_A','[#123] Duyệt Brief?')]
 const {recordAnswers,recordCapturedGates}=await import('../scripts/lib/question-history.mjs')
 const context={...scope,claudeSessionId:SESSION},decisions=[]
 for(const [id,answer] of [['delayed-old','Duyệt'],['applied-new','Cần sửa']]) {
  const i=input(id,qs,{[qs[0].question]:answer})
  assert.equal((await hook('ask-pre',w,i)).status,0)
  decisions.push(await recordAnswers(w.root,context,{session_id:SESSION,...i},{newOnly:true}))
 }
 await recordCapturedGates(w.root,w.config,context,decisions[1])
 const before=fs.readFileSync(file,'utf8')
 await recordCapturedGates(w.root,w.config,context,decisions[0])
 assert.equal(fs.readFileSync(file,'utf8'),before)
 assert.equal(JSON.parse(before).answer,'Cần sửa')
})

test('a later persisted Gate rejection suppresses older application before its own receipt',async t=>{
 const w=await bound(t),file=gateArtifacts(w),qs=[q('GATE_A','[#123] Duyệt Brief?')]
 const {recordAnswers,recordCapturedGates}=await import('../scripts/lib/question-history.mjs')
 const context={...scope,claudeSessionId:SESSION},decisions=[]
 for(const [id,answer] of [['pending-old','Duyệt'],['pending-new','Cần sửa']]) {
  const i=input(id,qs,{[qs[0].question]:answer})
  assert.equal((await hook('ask-pre',w,i)).status,0)
  decisions.push(await recordAnswers(w.root,context,{session_id:SESSION,...i},{newOnly:true}))
 }
 await recordCapturedGates(w.root,w.config,context,decisions[0])
 assert.equal(fs.existsSync(file),false)
 await recordCapturedGates(w.root,w.config,context,decisions[1])
 const before=fs.readFileSync(file,'utf8')
 assert.equal(JSON.parse(before).answer,'Cần sửa')
 await recordCapturedGates(w.root,w.config,context,decisions[0])
 assert.equal(fs.readFileSync(file,'utf8'),before)
})

test('decision append cannot pass Gate order check before receipt mutation',async t=>{
 const w=await bound(t),file=gateArtifacts(w),qs=[q('GATE_A','[#123] Duyệt Brief?')]
 const {recordAnswers,recordCapturedGates}=await import('../scripts/lib/question-history.mjs')
 const context={...scope,claudeSessionId:SESSION}
 const old=input('atomic-old',qs,{[qs[0].question]:'Duyệt'}),fresh=input('atomic-new',qs,{[qs[0].question]:'Cần sửa'})
 for(const i of [old,fresh])assert.equal((await hook('ask-pre',w,i)).status,0)
 const earlier=await recordAnswers(w.root,context,{session_id:SESSION,...old},{newOnly:true})
 const childSource=`
  import fs from 'node:fs'
  import {recordAnswers} from ${JSON.stringify(new URL('../scripts/lib/question-history.mjs',import.meta.url).href)}
  const {root,context,input}=JSON.parse(fs.readFileSync(0,'utf8'))
  try {
   const decisions=await recordAnswers(root,context,input,{newOnly:true})
   process.stdout.write(JSON.stringify({stored:decisions.length}))
  } catch(error) {
   if(error.name!=='BusyError')throw error
   process.stdout.write(JSON.stringify({busy:true}))
  }
 `
 const appendNewer=()=>{
  const result=spawnSync(process.execPath,['--input-type=module','-e',childSource],{
   input:JSON.stringify({root:w.root,context,input:{session_id:SESSION,...fresh}}),encoding:'utf8',timeout:10000,
  })
  assert.equal(result.status,0,result.stderr || result.error?.message)
  return JSON.parse(result.stdout)
 }
 const originalRename=fs.renameSync,claimFile=path.join(w.root,'.ff/gate-decisions.json')
 let attempted=null
 fs.renameSync=(source,destination)=>{
  if(destination===claimFile && attempted===null)attempted=appendNewer()
  return originalRename(source,destination)
 }
 try { await recordCapturedGates(w.root,w.config,context,earlier) }
 finally { fs.renameSync=originalRename }
 assert.deepEqual(attempted,{busy:true},'a newer answer must not append between order read and receipt write')
 const before=fs.readFileSync(file,'utf8')
 assert.equal(JSON.parse(before).answer,'Duyệt')
 // The competing delivery now persists after the older transaction and exits
 // before Gate application, reproducing an interrupted newer PostToolUse.
 assert.deepEqual(appendNewer(),{stored:1})
 const retry=await recordAnswers(w.root,context,{session_id:SESSION,...fresh},{newOnly:true})
 assert.deepEqual(retry,[])
 await recordCapturedGates(w.root,w.config,context,retry)
 assert.equal(fs.readFileSync(file,'utf8'),before)
 const {readQuestionHistory}=await import('../scripts/lib/question-history.mjs')
 assert.deepEqual(readQuestionHistory(w.root,'123').map(q=>q.decision.answer),['Duyệt','Cần sửa'])
})

test('UserPromptSubmit records exact worker dispatch, human turns, and blocks a contaminated worker prompt',async t=>{
  const w=await bound(t)
  w.seedTask({...readTask(w.root,'123'),tmuxSession:'ff-123',stateVersion:readTask(w.root,'123').stateVersion+1})
  const {buildStagePrompt}=await import('../ff-worker/src/core/tmux-claude-runner.mjs')
  const canonical=buildStagePrompt(readTask(w.root,'123'))
  const ok=await hook('user-prompt',w,{prompt:canonical})
  assert.equal(ok.status,0,ok.err); assert.equal(ok.out,"")
  await hook('user-prompt',w,{prompt:'thêm test cho số âm'})
  const bad=await hook('user-prompt',w,{prompt:`nháp dở ${canonical}`})
  assert.equal(JSON.parse(bad.out).decision,'block')
  assert.match(JSON.parse(bad.out).reason,/nháp dở/)
  assert.deepEqual(events(w).filter(e=>e.type==='prompt_submitted').map(e=>e.payload.source),['worker','human','worker_rejected'])
  assert.ok(events(w).filter(e=>e.type==='prompt_submitted').every(e=>e.payload.claudeSessionId===SESSION))
})

test('UserPromptSubmit labels Claude Code background task notifications as system, not human',async t=>{
  const w=await bound(t)
  await hook('user-prompt',w,{prompt:'<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>'})
  await hook('user-prompt',w,{prompt:'nhắc: có <task-notification> trong câu của người'})
  assert.deepEqual(events(w).filter(e=>e.type==='prompt_submitted').map(e=>e.payload.source),['system','human'])
})
