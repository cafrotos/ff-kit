import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { makeHarnessFixture } from './helpers/harness.mjs'
import * as watch from '../ff-worker/src/core/ship-watch.mjs'
import { driveTask, nextStage } from '../ff-worker/src/core/driver.mjs'
import { readTask } from '../ff-worker/src/core/task-store.mjs'
const head='a'.repeat(40), other='b'.repeat(40)
const task={cardId:'123',revision:'',runId:'r',dispatchId:'',stage:'acceptance',questions:[],handledEventIds:[],pendingEffects:[]}
const ship={cardId:'123',revision:'',heads:{web:head},mode:'dev_only',s1Complete:true,s2Complete:true,repos:[{repo:'web',approvedSourceHead:head,s1Complete:true}],shippedAt:'2026-01-01T00:00:00.000Z',sourceIdentity:'identity'}
test('watcher distinguishes S1 from ready after required S2; no snapshot mutation',async()=>{
 const original=structuredClone(task)
 assert.equal((await watch.observeShippedTask({task,ship:{...ship,s1Complete:false},source:{},now:()=>0})).length,0)
 const partial=await watch.observeShippedTask({task,ship:{...ship,s2Complete:false,mode:'dev_and_pr'},source:{},now:()=>0})
 assert.deepEqual(partial.map(e=>e.payload.milestone),['s1'])
 const events=await watch.observeShippedTask({task,ship,source:{},now:()=>0})
 assert.equal(events[0].type,'ship_observed');assert.equal(events[0].runId,'r');assert.deepEqual(task,original)
})
test('unknown is not conflict; conflict identity includes repo PR source and base',async()=>{
 const inspect=base=>watch.observeShippedTask({task,ship:{...ship,mode:'dev_and_pr',repos:[{...ship.repos[0],pr:{number:7,sourceHead:head,baseHead:base,mergeability:'conflicting'}}]},source:{},now:()=>0})
 const a=await inspect(head),b=await inspect(other)
 assert.notEqual(a.find(e=>e.payload.reason==='pr_conflict').eventId,b.find(e=>e.payload.reason==='pr_conflict').eventId)
 const unknown=await watch.observeShippedTask({task,ship:{...ship,repos:[{...ship.repos[0],pr:{number:7,mergeability:'unknown'}}]},source:{},now:()=>0})
 assert.equal(unknown.some(e=>e.payload.reason==='pr_conflict'),false)
})
test('reopen uses human comment after latest S1 and requires description; done uses Fix',async()=>{
 const source={observeCard:async()=>({list:'Reopen',description:'',comments:[{id:'1',at:'2026-02-01T00:00:00Z',text:'change'}]})}
 let events=await watch.observeShippedTask({task,ship,source,reopenList:'Reopen',now:()=>0})
 assert.equal(events.find(e=>e.type==='reopen_observed'),undefined);assert.ok(events.some(e=>e.payload.reason==='reopen_description'))
 source.observeCard=async()=>({list:'Reopen',description:'change',comments:[{id:'ff',at:'2026-02-02T00:00:00Z',text:'[ff] comment'},{id:'human',at:'2026-02-01T00:00:00Z',text:'change'}]})
 events=await watch.observeShippedTask({task,ship,source,reopenList:'Reopen',now:()=>0});assert.equal(events.find(e=>e.type==='reopen_observed').payload.commentId,'human')
 events=await watch.observeShippedTask({task:{...task,stage:'done'},ship,source,reopenList:'Reopen',now:()=>0});assert.ok(events.some(e=>e.payload.reason==='reopen_fix'))
})
test('completion needs exact merged heads on every repo, CLI acceptance never Gate C or card move',()=>{
 assert.equal(nextStage({task,state:{heads:ship.heads},ship}).stage,'acceptance')
 assert.equal(nextStage({task,state:{heads:ship.heads},ship:{...ship,acceptance:{source:'cli',confirmed:true,revision:'',heads:ship.heads}}}).stage,'done')
 const prs={repos:[{repo:'web',merged:true,headAtMerge:other,approvedSourceHead:head}]}
 assert.equal(nextStage({task,state:{heads:ship.heads},ship:{...ship,mode:'dev_and_pr'},pr:prs}).stage,'acceptance')
})
test('driver persists effects before lost response and reconciles comments without duplicate',async t=>{
 const f=makeHarnessFixture(t);f.seedTask(f.task({stage:'acceptance',dispatchId:'',pendingDispatch:null}))
 let moves=0,comments=0,remoteList='Doing',remoteComments=new Map()
 const source={observeCard:async()=>({list:remoteList}),moveTo:async()=>{assert.ok(readTask(f.root,'123').pendingEffects.some(e=>e.kind==='move'));moves++;remoteList='Accept';throw Error('lost')},findComment:async(id,key)=>remoteComments.get(key),comment:async(id,text)=>{assert.ok(readTask(f.root,'123').pendingEffects.some(e=>e.kind==='comment'));comments++;remoteComments.set(text.split(' ')[1],{text});throw Error('lost')}}
 const observation={state:{activeRevision:null},heads:{},allowEffects:false,ship:{...ship,heads:{}},source,acceptList:'Accept'}
 for(let i=0;i<3;i++) await driveTask({root:f.root,config:f.config,task:readTask(f.root,'123'),observation,now:f.clock.now})
 assert.equal(moves,1);assert.equal(comments,2)
})

test('durable CLI acceptance binds the actual shipped identity after ship receipt cleared pending dispatch',async t=>{
 const {recordQuestion,recordAnswers}=await import('../scripts/lib/question-history.mjs')
 const {listHarnessEvents}=await import('../scripts/lib/harness-events.mjs')
 const f=makeHarnessFixture(t),session='1f8a9f32-36c8-4479-8aee-4d745c188452'
 const seeded=f.task({stage:'acceptance',claudeSessionId:session,dispatchId:'ship-finished',dispatchState:'finished',completedReceipt:{stage:'ship',outcome:'pass'},pendingDispatch:null})
 f.seedTask(seeded)
 const bound={revision:'',heads:{},sourceIdentity:'A'}
 const input={session_id:session,tool_use_id:'accept',tool_input:{questions:[{header:'ACCEPTANCE',question:'[#123] Duyệt bản đã ship?',options:[{label:'Duyệt',description:'OK'},{label:'Không duyệt',description:'Fix'}]}]}}
 await recordQuestion(f.root,{...seeded,acceptanceBinding:bound},input)
 await recordAnswers(f.root,seeded,{...input,tool_response:{answers:{'[#123] Duyệt bản đã ship?':'Duyệt'}}})
 assert.ok(listHarnessEvents(f.root,'123').some(e=>e.type==='acceptance_recorded'))
 let saved=await driveTask({root:f.root,config:f.config,task:readTask(f.root,'123'),observation:{state:{activeRevision:null},heads:{},ship:{...ship,heads:{},sourceIdentity:'A'},allowEffects:false},now:f.clock.now})
 assert.equal(saved.stage,'done')
 f.seedTask({...seeded,stateVersion:saved.stateVersion})
 saved=await driveTask({root:f.root,config:f.config,task:readTask(f.root,'123'),observation:{state:{activeRevision:null},heads:{},ship:{...ship,heads:{},sourceIdentity:'B'},allowEffects:false},now:f.clock.now})
 assert.equal(saved.stage,'acceptance')
})
test('reopen id is durable across retry/concurrent callers and retains UUID/context',async t=>{
 const {reopenTask}=await import('../scripts/cli/reopen.mjs'),{listHarnessEvents}=await import('../scripts/lib/harness-events.mjs')
 const path=await import('node:path'),f=makeHarnessFixture(t)
 fs.writeFileSync(path.join(f.cardDir,'01-dossier.md'),'# Data')
 f.seedTask(f.task({stage:'acceptance',claudeSessionId:'same-session',tmuxSession:'same-tmux'}))
 const options={root:f.root,config:{...f.config,repos:[]},id:'123',reason:'human feedback',eventId:'comment:one'}
 const revisions=await Promise.all([reopenTask(options),reopenTask(options)])
 assert.deepEqual(revisions,['rev-1','rev-1']);assert.equal(listHarnessEvents(f.root,'123').filter(e=>e.type==='revision_created').length,1)
 const saved=await driveTask({root:f.root,config:f.config,task:readTask(f.root,'123'),observation:{state:{activeRevision:'rev-1'},heads:{},allowEffects:false},now:f.clock.now})
 assert.equal(saved.stage,'understand');assert.equal(saved.claudeSessionId,'same-session');assert.equal(saved.tmuxSession,'same-tmux')
})

test('driver rejects completion when source identity drifts across awaited observation/effects',async t=>{
 const f=makeHarnessFixture(t);f.seedTask(f.task({stage:'acceptance',acceptance:{source:'cli',confirmed:true,revision:'',heads:{},sourceIdentity:'A'}}))
 let current=true
 const observation={state:{activeRevision:null},heads:{},ship:{...ship,heads:{},sourceIdentity:'A'},allowEffects:false,acceptList:'Accept',reopenList:'Reopen',validateShip:()=>current,source:{observeCard:async()=>{current=false;return {list:'Doing'}},findComment:async()=>null,comment:async()=>assert.fail('stale comment'),moveTo:async()=>assert.fail('stale move')}}
 const saved=await driveTask({root:f.root,config:f.config,task:readTask(f.root,'123'),observation,now:f.clock.now})
 assert.notEqual(saved.stage,'done')
})

test('actual AskPre/Post capture dev_only acceptance after ship finish clears pending dispatch',async t=>{
 const {makeShipWorkspace}=await import('./helpers/ship.mjs'),{commitShipFixture,authorizeShipFixture}=await import('./helpers/ship-authorized.mjs')
 const {runShip,inspectShip}=await import('../scripts/lib/ship.mjs'),{preparePresentation,savePresentation}=await import('../scripts/lib/human-output.mjs')
 const {loadConfig}=await import('../scripts/lib/config.mjs'),{writeTask}=await import('../ff-worker/src/core/task-store.mjs'),{bindHookSession,readQuestionHistory}=await import('../scripts/lib/question-history.mjs')
 const {spawnSync}=await import('node:child_process'),{observeHarnessTask}=await import('../ff-worker/src/core/runtime.mjs')
 const f=makeShipWorkspace(t);commitShipFixture(f);await authorizeShipFixture(f);f.config=loadConfig(f.root).config
 assert.equal((await runShip({root:f.root,config:f.config,cardId:'123'})).complete,true)
 const original=readTask(f.root,'123'),seed=makeHarnessFixture(t).task(),session='1f8a9f32-36c8-4479-8aee-4d745c188452'
 writeTask(f.root,{...seed,...original,stateVersion:1,stage:'acceptance',claudeSessionId:session,dispatchId:'ship-finished',pendingDispatch:null,dispatchState:'finished',completedReceipt:{stage:'ship',outcome:'pass'}})
 const env={...process.env,FF_CARD_ID:'123',FF_RUN_ID:'run'}
 await bindHookSession(f.root,f.config,{session_id:session},env)
 const options=[{label:'Duyệt',description:'Accept shipped revision'},{label:'Không duyệt',description:'Feedback'}]
 const packet=preparePresentation(f.root,f.config,'123',{version:1,phase:'ship',purpose:'acceptance',headline:'Source and checks shipped; deployment unknown',sections:{acceptedScope:'scope',destination:'source commit to dev',checks:'build/test pass',limitations:'deployment unknown'},decisions:[{id:'Q1',question:'Duyệt bản đã ship?',options,recommendation:'Review'}],nextAction:'CLI acceptance'})
 savePresentation(f.root,packet)
 const input={cwd:f.root,session_id:session,tool_use_id:'accept-after-finish',tool_input:{questions:[{header:'ACCEPTANCE',question:'[#123] Duyệt bản đã ship?',options,multiSelect:false}]}}
 const hook=name=>spawnSync(process.execPath,[`scripts/hooks/${name}.mjs`],{cwd:process.cwd(),env,input:JSON.stringify(input),encoding:'utf8'})
 const pre=hook('ask-pre');assert.equal(pre.status,0,pre.stderr)
 input.tool_response={answers:{'[#123] Duyệt bản đã ship?':'Duyệt'}}
 const post=hook('ask-post');assert.equal(post.status,0,post.stderr)
 const q=readQuestionHistory(f.root,'123').find(q=>q.toolUseId==='accept-after-finish');assert.equal(q.decision.decisionContext.acceptanceBinding.sourceIdentity,inspectShip(f.root,f.config,'123').sourceIdentity)
 const saved=await driveTask({root:f.root,config:f.config,task:readTask(f.root,'123'),observation:{...observeHarnessTask({root:f.root,config:f.config,task:readTask(f.root,'123')}),ship:inspectShip(f.root,f.config,'123'),allowEffects:false}})
 assert.equal(saved.stage,'done')
})

test('persisted A effects cannot replay using a fresh source B observation',async t=>{
 const f=makeHarnessFixture(t)
 f.seedTask(f.task({stage:'acceptance',pendingEffects:[{kind:'move',eventId:'A',status:'unknown',list:'Accept',revision:'',sourceIdentity:'A'}]}))
 let moved=0
 const source={observeCard:async()=>({list:'Doing'}),moveTo:async()=>{moved++}}
 const saved=await driveTask({root:f.root,config:f.config,task:readTask(f.root,'123'),observation:{state:{activeRevision:null},heads:{},ship:{...ship,heads:{},sourceIdentity:'B',s1Complete:false},source,allowEffects:false}})
 assert.equal(moved,0);assert.equal(saved.pendingEffects[0].status,'unknown')
})


test('driver restart repairs committed reopen event before discarding its old intent',async t=>{
 const {reopenTask}=await import('../scripts/cli/reopen.mjs'),{listHarnessEvents}=await import('../scripts/lib/harness-events.mjs')
 const path=await import('node:path'),f=makeHarnessFixture(t),config={...f.config,repos:[]}
 fs.writeFileSync(path.join(f.cardDir,'01-dossier.md'),'# Data')
 const original=f.task({stage:'acceptance',claudeSessionId:'same-session',tmuxSession:'same-tmux',pendingEffects:[{kind:'reopen',eventId:'comment:crash',revision:'',sourceIdentity:'old-source',status:'intent',reason:'human feedback'}]})
 f.seedTask(original)
 await reopenTask({root:f.root,config,id:'123',reason:'human feedback',eventId:'comment:crash'})
 // Exact durable crash window: renamed revision artifacts, no appended event.
 fs.rmSync(path.join(f.root,'.ff','harness','inbox','123'),{recursive:true,force:true})
 assert.equal(listHarnessEvents(f.root,'123').length,0)
 for(let poll=0;poll<3;poll++){
  const saved=await driveTask({root:f.root,config,task:readTask(f.root,'123'),observation:{state:{activeRevision:'rev-1'},heads:{},allowEffects:false},now:f.clock.now})
  const events=listHarnessEvents(f.root,'123').filter(e=>e.type==='revision_created')
  assert.equal(events.length,1)
  assert.equal(events[0].eventId,'comment:crash')
  for(const key of ['cardId','revision','runId','dispatchId'])assert.equal(events[0][key],original[key])
  assert.equal(saved.revision,'rev-1');assert.equal(saved.stage,'understand')
  assert.equal(saved.runId,original.runId);assert.equal(saved.claudeSessionId,original.claudeSessionId);assert.equal(saved.tmuxSession,original.tmuxSession)
  assert.deepEqual(fs.readdirSync(f.cardDir).filter(n=>/^rev-/.test(n)),['rev-1'])
 }
})

test('driver restart retains intent when committed reopen event scope is missing',async t=>{
 const {reopenTask}=await import('../scripts/cli/reopen.mjs')
 const path=await import('node:path'),f=makeHarnessFixture(t),config={...f.config,repos:[]}
 fs.writeFileSync(path.join(f.cardDir,'01-dossier.md'),'# Data')
 const original=f.task({stage:'acceptance',pendingEffects:[{kind:'reopen',eventId:'comment:missing-scope',revision:'',sourceIdentity:'old-source',status:'intent',reason:'human feedback'}]})
 f.seedTask(original)
 await reopenTask({root:f.root,config,id:'123',reason:'human feedback',eventId:'comment:missing-scope'})
 fs.rmSync(path.join(f.root,'.ff','harness','inbox','123'),{recursive:true,force:true})
 const metadata=path.join(f.cardDir,'rev-1','revision.json'),record=JSON.parse(fs.readFileSync(metadata,'utf8'))
 delete record.eventScope;fs.writeFileSync(metadata,JSON.stringify(record,null,2)+'\n')
 await assert.rejects(driveTask({root:f.root,config,task:readTask(f.root,'123'),observation:{state:{activeRevision:'rev-1'},heads:{},allowEffects:false},now:f.clock.now}),/event scope/i)
 const saved=readTask(f.root,'123')
 assert.equal(saved.revision,'');assert.deepEqual(saved.pendingEffects,original.pendingEffects)
 assert.deepEqual(fs.readdirSync(f.cardDir).filter(n=>/^rev-/.test(n)),['rev-1'])
 const {listHarnessEvents}=await import('../scripts/lib/harness-events.mjs')
 assert.equal(listHarnessEvents(f.root,'123').length,0)
})
