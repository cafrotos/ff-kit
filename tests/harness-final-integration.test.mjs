import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { makeHarnessFixture } from './helpers/harness.mjs'
import { workflowPackage } from './helpers/workflow.mjs'
import { prepareWorkflowSnapshot } from '../scripts/lib/workflow-snapshot.mjs'
import { beginStage, finishStage } from '../scripts/lib/stage-receipts.mjs'
import { driveTask } from '../ff-worker/src/core/driver.mjs'
import { readTask, harnessTaskStatus } from '../ff-worker/src/core/task-store.mjs'
import { observeShippedTask } from '../ff-worker/src/core/ship-watch.mjs'
import { runHarnessCycle } from '../ff-worker/src/core/runtime.mjs'
const head='a'.repeat(40), dev='b'.repeat(40)
const ship = {cardId:'123', revision:'', heads:{}, sourceIdentity:'A', mode:'dev_only', s1Complete:true, s2Complete:true, shippedAt:'2026-01-01T00:00:00Z', repos:[]}
const observe = overrides => ({state:{activeRevision:null},heads:{},allowEffects:false,...overrides})
const drive = (f, observation, extra={}) => driveTask({root:f.root,config:f.config,task:readTask(f.root,'123'),observation,now:f.clock.now,...extra})
for (const mode of ['dev_only','dev_and_pr']) test(`I1 ${mode}: done move reconciles response loss and already-local-done`, async t=>{
 const f=makeHarnessFixture(t), notices=[]
 const pr={repo:'web',merged:true,headAtMerge:head,approvedSourceHead:head}
 const current={...ship,mode,heads:{web:head},repos:[{repo:'web',requiresPr:true,approvedSourceHead:head,pr}]}
 f.seedTask(f.task({stage:'acceptance',acceptance:{source:'cli',confirmed:true,revision:'',heads:current.heads,sourceIdentity:'A'}}))
 let list='Acceptance', moves=0
 const source={observeCard:async()=>({list}),moveTo:async(id,target)=>{moves++;list=target;throw Error('response lost')}}
 const observation=observe({heads:current.heads,ship:current,pr:{repos:[pr]},source,doneList:'Done',channel:{notify:async e=>notices.push(e)}})
 await drive(f,observation);await drive(f,observation);await drive(f,observation)
 assert.equal(list,'Done');assert.equal(moves,1);assert.equal(readTask(f.root,'123').stage,'done')
 const saved=readTask(f.root,'123');f.seedTask({...saved,pendingEffects:[],stage:'done'})
 list='Acceptance';await drive(f,observation);await drive(f,observation)
 assert.equal(list,'Done');assert.equal(moves,2)
 list='Acceptance';f.seedTask({...readTask(f.root,'123'),pendingEffects:[]})
 await drive(f,{...observation,validateShip:()=>false});assert.equal(list,'Acceptance')
})
for (const stage of ['understand','build','ship']) for (const outcome of ['environment_blocked','needs_human','implementation_failed']) test(`I2 finished ${stage}/${outcome} stays blocked across idle and restart`,async t=>{
 const f=makeHarnessFixture(t), pkg=path.join(f.root,'plugin');workflowPackage(pkg)
 const workflow=prepareWorkflowSnapshot({root:f.root,packageRoot:pkg,cliVersion:'0.1.0'})
 f.seedTask(f.task({workflow,stage,claudeSessionId:'same',dispatchId:'d',pendingDispatch:{runId:'run-1',revision:'',dispatchId:'d',stage}}))
 const diagnostic='failure';f.writeArtifact('diagnostic.log',diagnostic)
 const evidenceFile=f.writeArtifact('evidence.json',JSON.stringify({cardId:'123',revision:'',runId:'run-1',dispatchId:'d',workflow:{digest:workflow.digest,cliVersion:workflow.cliVersion},heads:{},artifactHashes:{'diagnostic.log':createHash('sha256').update(diagnostic).digest('hex')},checks:[],reviewRefs:[],testLockHash:null,acMatrixRef:null}))
 await beginStage(f.root,f.config,{cardId:'123',dispatchId:'d'});await finishStage(f.root,f.config,{cardId:'123',dispatchId:'d',outcome,evidenceFile})
 const runner={inspect:async()=>({status:'idle',inputEmpty:true,dispatchStatus:'finished'}),sendStage:async()=>assert.fail('must not redispatch')}
 for(let n=0;n<3;n++){
  const saved=await drive(f,observe({allowEffects:true,state:{activeRevision:null,readyForBuild:true}}),{runner})
  assert.equal(saved.waitingOn,outcome==='environment_blocked'?`setup:${stage}`:'needs_human');assert.equal(saved.executionStatus,'blocked')
  assert.equal(saved.pendingDispatch,null);assert.equal(saved.repairCycles['']??0,0);assert.equal(saved.claudeSessionId,'same')
 }
})
test('I3 stuck wait retains pending evidence, releases slot and stops all working accounting',async t=>{
 const f=makeHarnessFixture(t), pending={runId:'run-1',revision:'',dispatchId:'d',stage:'build'}
 f.seedTask(f.task({stage:'build',dispatchId:'d',pendingDispatch:pending,dispatchState:'unknown',executionStatus:'working',workingReserved:true,claudeSessionId:'same',tmuxSession:'pane',lastProgressAt:new Date(f.clock.now()).toISOString()}))
 const step=epoch=>drive(f,observe({accounting:{kind:'checkpoint',epoch,at:new Date(f.clock.now()).toISOString(),verifiedWorking:true},control:{kind:'slot',epoch,reserved:true}}))
 await step('a');f.clock.advance(90*60000);let saved=await step('a')
 assert.equal(saved.waitingOn,'stuck');assert.equal(saved.executionStatus,'waiting_human');assert.equal(saved.workingReserved,false);assert.equal(saved.workingSince,null);assert.equal(harnessTaskStatus(saved).waitingOn,'stuck')
 const charged=saved.workingMs
 await drive(f,observe({events:[f.event({eventId:'later-progress',dispatchId:'d',type:'question_opened',payload:{questionId:'unrelated',header:'Q1'}})]}))
 assert.equal(readTask(f.root,'123').waitingOn,'stuck')
 await drive(f,observe({events:[f.event({eventId:'later-answer',dispatchId:'d',type:'question_answered',payload:{questionId:'unrelated',header:'Q1'}})]}))
 assert.equal(readTask(f.root,'123').waitingOn,'stuck')
 f.clock.advance(48*3600000);await step('a');f.clock.advance(48*3600000);saved=await step('restart')
 assert.equal(saved.workingMs,charged);assert.equal(saved.alerts.lifetime,undefined);assert.deepEqual(saved.pendingDispatch,pending);assert.equal(saved.claudeSessionId,'same');assert.equal(saved.tmuxSession,'pane');assert.equal(saved.dispatchState,'unknown')
})
test('I4 runtime durably notifies setup blocks once, including a changed reason and restart',async t=>{
 const f=makeHarnessFixture(t),notices=[]
 const source={poll:async()=>[{id:'123',name:'Task'}],fetchDossier:async()=> '# Data'}
 let reason='workflow_pin_invalid'
 const runner={start:async()=>({status:'blocked',reason}),inspect:async()=>({status:'blocked',reason})}
 const args={root:f.root,config:f.config,source,runner,channel:{notify:async e=>notices.push(e.fields.reason)},now:f.clock.now}
 await runHarnessCycle(args);await runHarnessCycle({...args,runner:{...runner}})
 assert.deepEqual(notices,['setup:workflow_pin_invalid'])
 const saved=readTask(f.root,'123');f.seedTask({...saved,waitingOn:'setup:dispatch_unknown'})
 await runHarnessCycle({...args,runner:{...runner}});await runHarnessCycle(args)
 assert.deepEqual(notices,['setup:workflow_pin_invalid','setup:dispatch_unknown'])
})
test('I4 repair-limit/human blocks notify once; transient startup stays quiet',async t=>{
 const f=makeHarnessFixture(t),notices=[], channel={notify:async e=>notices.push(e.fields.reason)}
 for(const wait of ['setup:session_unconfirmed','setup:runner_unproven','needs_human','setup:dispatch_unknown']){
  f.seedTask({...f.task({executionStatus:'blocked',waitingOn:wait}),stateVersion:readTask(f.root,'123')?.stateVersion??1,pendingEffects:readTask(f.root,'123')?.pendingEffects??[]})
  await drive(f,observe({channel}));await drive(f,observe({channel}))
 }
 assert.deepEqual(notices,['needs_human','setup:dispatch_unknown'])
})
test('I4 startup waits notify once only after the 2 minute grace, with a trust-dialog hint',async t=>{
 const f=makeHarnessFixture(t),notices=[], channel={notify:async e=>notices.push(e)}
 for(const wait of ['setup:session_unconfirmed','setup:runner_unproven']){
  const prev=readTask(f.root,'123')
  f.seedTask({...f.task({executionStatus:'blocked',waitingOn:wait,runId:'run-'+wait}),stateVersion:prev?.stateVersion??1,pendingEffects:[{kind:'launch',status:'done',runId:'run-'+wait,at:new Date(f.clock.now()).toISOString()}]})
  await drive(f,observe({channel}));assert.equal(notices.length,0,'within grace')
  f.clock.advance(119000);await drive(f,observe({channel}));assert.equal(notices.length,0)
  f.clock.advance(2000);await drive(f,observe({channel}));await drive(f,observe({channel}))
  assert.equal(notices.length,1);assert.equal(notices[0].fields.reason,wait);assert.match(notices[0].title,/trust\/permission/)
  notices.length=0
 }
})
for(const comments of [[],[{id:'old',at:'2025-12-01T00:00:00Z',text:'old'}],[{id:'ff',at:'2026-02-01T00:00:00Z',text:'[ff] generated'}]])test('M1 missing fresh human feedback waits and notifies once',async t=>{
 const f=makeHarnessFixture(t),notices=[];f.seedTask(f.task({stage:'acceptance'}))
 let current=comments,moves=0
 const source={observeCard:async()=>({list:'Reopened',description:'details',comments:current}),moveTo:async()=>{moves++}}
 const observation=observe({ship,source,acceptList:'Acceptance',reopenList:'Reopened',channel:{notify:async e=>notices.push(e.fields.reason)}})
 await drive(f,observation);await drive(f,observation)
 assert.deepEqual(notices,['reopen_feedback']);assert.equal(moves,0);assert.equal(readTask(f.root,'123').revision,'')
 current=[...comments,{id:'new',at:'2026-02-02T00:00:00Z',text:'fix issue'}]
 const events=await observeShippedTask({task:readTask(f.root,'123'),ship,source,reopenList:'Reopened'})
 assert.equal(events.filter(e=>e.type==='reopen_observed').length,1)
})
test('M2 separate sanitized S1, PR and ready milestones survive response loss/restart',async t=>{
 const f=makeHarnessFixture(t);f.seedTask(f.task({stage:'ship',waitingOn:'ship_confirm'}))
 const remote=new Map(),comments=[]
 const source={findComment:async(id,key)=>remote.get(key),comment:async(id,text)=>{const key=text.split(' ')[1];remote.set(key,text);comments.push(text);throw Error('lost')}}
 const repo={repo:'web',approvedSourceHead:head,devHead:dev,s1Complete:true,checksPassed:true}
 const current={...ship,mode:'dev_and_pr',heads:{web:head},s2Complete:false,repos:[repo],description:'Bearer MUST_NOT_COPY',devHashes:{web:dev}}
 const observation=observe({heads:current.heads,ship:current,source})
 await drive(f,observation);await drive(f,observation)
 assert.equal(comments.length,1);assert.match(comments[0],/S1/);assert.match(comments[0],new RegExp(head));assert.match(comments[0],new RegExp(dev));assert.match(comments[0],/checks: passed/);assert.match(comments[0],/deployment unverified/)
 current.s2Complete=true;repo.pr={number:7,url:'https://github.com/team/repo/pull/7',title:'password=DO_NOT_COPY'}
 await drive(f,observation);await drive(f,observation)
 assert.equal(comments.length,3);assert.ok(comments.some(c=>c.includes('https://github.com/team/repo/pull/7')));assert.ok(comments.some(c=>c.includes('Ready')))
 assert.doesNotMatch(comments.join('\n'),/MUST_NOT_COPY|DO_NOT_COPY|password=/)
 repo.pr={number:8,url:'https://user:secret@github.com/team/repo/pull/8?token=SECRET'}
 await drive(f,observation);assert.doesNotMatch(comments.join('\n'),/secret|SECRET|token=/)
})

test('I4 failed or response-lost channel calls retain unknown attention without retrying',async t=>{
 const f=makeHarnessFixture(t);f.seedTask(f.task({executionStatus:'blocked',waitingOn:'needs_human',blockReason:'repair_limit'}))
 let calls=0
 const channel={notify:async()=>{calls++;assert.equal(readTask(f.root,'123').pendingEffects.find(e=>e.attention).status,'unknown');throw Error('delivery uncertain')}}
 await drive(f,observe({channel}));await drive(f,observe({channel:{...channel}}))
 assert.equal(calls,1);assert.equal(readTask(f.root,'123').pendingEffects.find(e=>e.attention).status,'unknown');assert.equal(harnessTaskStatus(readTask(f.root,'123')).attention.unknown,1)
 const saved=readTask(f.root,'123');f.seedTask({...saved,blockReason:'build_needs_human'})
 await drive(f,observe({channel}));assert.equal(calls,2)
 assert.equal(readTask(f.root,'123').pendingEffects.filter(e=>e.attention).length,2)
})
test('I4 attention intent stays pending until a channel exists',async t=>{
 const f=makeHarnessFixture(t);f.seedTask(f.task({executionStatus:'blocked',waitingOn:'setup:workflow_pin_invalid'}))
 await drive(f,observe({}));assert.equal(readTask(f.root,'123').pendingEffects.find(e=>e.attention).status,'intent')
 let count=0;await drive(f,observe({channel:{notify:async()=>count++}}));await drive(f,observe({channel:{notify:async()=>count++}}))
 assert.equal(count,1);assert.equal(readTask(f.root,'123').pendingEffects.find(e=>e.attention).status,'done')
})

test('I3 genuine working lifetime still blocks independently of unanswered stuck time',async t=>{
 const f=makeHarnessFixture(t)
 f.seedTask(f.task({executionStatus:'working',workingMs:23*3600000,lastProgressAt:new Date(f.clock.now()).toISOString()}))
 const step=()=>drive(f,observe({accounting:{kind:'checkpoint',epoch:'a',at:new Date(f.clock.now()).toISOString(),verifiedWorking:true}}))
 await step();f.clock.advance(3600000);const saved=await step()
 assert.equal(saved.waitingOn,'needs_human');assert.equal(saved.alerts.lifetime,true);assert.equal(saved.workingMs,24*3600000)
})
test('I4 actual exhausted verify repair budget emits concrete durable attention',async t=>{
 const f=makeHarnessFixture(t),pkg=path.join(f.root,'plugin');workflowPackage(pkg)
 const workflow=prepareWorkflowSnapshot({root:f.root,packageRoot:pkg,cliVersion:'0.1.0'})
 f.seedTask(f.task({workflow,stage:'verify',repairCycles:{'':3},dispatchId:'d',pendingDispatch:{runId:'run-1',revision:'',dispatchId:'d',stage:'verify'}}))
 const diagnostic='failed verify';f.writeArtifact('verify.log',diagnostic)
 const evidenceFile=f.writeArtifact('verify-evidence.json',JSON.stringify({cardId:'123',revision:'',runId:'run-1',dispatchId:'d',workflow:{digest:workflow.digest,cliVersion:workflow.cliVersion},heads:{},artifactHashes:{'verify.log':createHash('sha256').update(diagnostic).digest('hex')},checks:[],reviewRefs:[],testLockHash:null,acMatrixRef:null}))
 await beginStage(f.root,f.config,{cardId:'123',dispatchId:'d'});await finishStage(f.root,f.config,{cardId:'123',dispatchId:'d',outcome:'implementation_failed',evidenceFile})
 const notices=[],channel={notify:async e=>notices.push(e.fields)}
 await drive(f,observe({channel}));await drive(f,observe({channel}))
 assert.equal(notices.length,1);assert.equal(notices[0].detail,'repair_limit');assert.equal(readTask(f.root,'123').repairCycles[''],3)
})
