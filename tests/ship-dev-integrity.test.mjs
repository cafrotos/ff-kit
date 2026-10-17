import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import YAML from 'yaml'
import {spawnSync} from 'node:child_process'
import {makeShipWorkspace} from './helpers/ship.mjs'
import {git} from './helpers/fixture.mjs'
import {recordGates} from '../scripts/lib/gates.mjs'
import {beginStage,finishStage} from '../scripts/lib/stage-receipts.mjs'
import {writeTask} from '../ff-worker/src/core/task-store.mjs'
import {preparePresentation,savePresentation} from '../scripts/lib/human-output.mjs'
import {recordQuestion,recordAnswers} from '../scripts/lib/question-history.mjs'
import {createShipApproval} from '../scripts/lib/ship-approval.mjs'
import {prepareShipTest} from '../scripts/lib/ship.mjs'

const api=await import('../scripts/lib/ship.mjs').catch(()=>({}))
const store=await import('../scripts/lib/ship-store.mjs').catch(()=>({}))
const hash=x=>createHash('sha256').update(x).digest('hex')
function commit(f,file='a.txt'){fs.writeFileSync(path.join(f.copies.web,file),file);git(f.copies.web,'add',file);git(f.copies.web,'-c','user.name=t','-c','user.email=t@t','commit','-qm',`change ${file}\n\nTrello: #123`);return git(f.copies.web,'rev-parse','HEAD')}
async function authorize(f,prep={}){
 await prepareShipTest({root:f.root,config:f.config,cardId:'123',...prep}) // verify now runs on the ship-branch test checkout
 const {root,config,cardDir,copies}=f; config.worker.driver={enabled:true};config.repos[0].commands={build:'node -v',test:'node -v'};config.e2e={tests_dir:'e2e'};fs.writeFileSync(path.join(root,'ff.config.yaml'),YAML.stringify(config))
 const write=(rel,s)=>{const p=path.join(root,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);return p}
 const card=path.relative(root,cardDir),files={
 [`${card}/01b-ledger.md`]:'| D-01 | keep | dossier | |\n', [`${card}/brief.md`]:'Keep D-01\n', [`${card}/02-spec.md`]:'- **AC-01** Keep — D-01\n', [`${card}/03-design.md`]:'Keep D-01\n', [`${card}/04-plan.md`]:'Implement\n', [`${card}/05-verify-report.md`]:'AC-01 PASS\n', 'e2e/123/keep.spec.ts':"test('AC-01',()=>{})\n"}
 for(const [p,s] of Object.entries(files))write(p,s)
 for(const gate of ['GATE_A','GATE_B','GATE_C'])recordGates(root,config,{questions:[{header:gate,question:'[#123] Approve?'}]},{answers:{'[#123] Approve?':'Duyệt'}})
 const lock='worktrees/123/.ff-test-lock';write(lock,`${hash(files['e2e/123/keep.spec.ts'])}  e2e/123/keep.spec.ts\n`)
 const manifest=JSON.stringify({version:1,cliVersion:'0.1.0',files:{'bin/ff':hash('#!/bin/sh\nexit 0\n'),'dist/cli.mjs':hash('// cli\n')}}),digest=hash(manifest),snap=`.ff/workflows/${digest}`
 write(`${snap}/manifest.json`,manifest);fs.chmodSync(write(`${snap}/bin/ff`,'#!/bin/sh\nexit 0\n'),0o755);write(`${snap}/dist/cli.mjs`,'// cli\n')
 const workflow={digest,path:snap,binDir:`${snap}/bin`,cliPath:`${snap}/bin/ff`,pluginPath:snap,cliVersion:'0.1.0'},heads={web:git(copies.web,'rev-parse','HEAD')}
 const log=`${card}/evidence/check.log`,review=`${card}/evidence/review.json`,matrix=`${card}/evidence/ac.json`
 write(log,'checks pass\n');write(review,JSON.stringify({status:'pass',revision:'',heads,findings:[]}));write(matrix,JSON.stringify({revision:'',heads,criteria:[{id:'AC-01',status:'pass',evidence:[log]}]}))
 const artifactHashes=Object.fromEntries([`${card}/01-dossier.md`,...Object.keys(files).filter(p=>p.startsWith(card)),log,review,matrix,'.ff/ship-test/123/root.json'].map(p=>[p,hash(fs.readFileSync(path.join(root,p)))]))
 for(const stage of ['build','verify']){
  const dispatchId=stage+randomUUID(),task={cardId:'123',revision:'',runId:'run',dispatchId,stage,pendingDispatch:{revision:'',runId:'run',dispatchId,stage},workflow};writeTask(root,task)
  const evidence={cardId:'123',revision:'',runId:'run',dispatchId,heads,workflow:{digest,cliVersion:'0.1.0'},artifactHashes,testLockHash:hash(fs.readFileSync(path.join(root,lock))),checks:[{command:'node -v',cwd:'worktrees/123/web',exitCode:0,logPath:log,logHash:hash(fs.readFileSync(path.join(root,log)))}],reviewRefs:[review],acMatrixRef:matrix}
  await beginStage(root,config,{cardId:'123',dispatchId});await finishStage(root,config,{cardId:'123',dispatchId,outcome:'pass',evidenceFile:write(`${card}/evidence/input.json`,JSON.stringify(evidence))})
 }
 const question='Ship?',options=[{label:'Duyệt',description:'Ship'},{label:'Không duyệt',description:'Stop'}]
 const packet=preparePresentation(root,config,'123',{version:1,phase:'ship',headline:'Ship',sections:{acceptedScope:'scope',destination:'target',checks:'checked',limitations:'none'},decisions:[{id:'Q1',question,options,recommendation:'Duyệt'}],nextAction:'Ship'});savePresentation(root,packet)
 const context={cardId:'123',revision:'',runId:'run',dispatchId:'',claudeSessionId:randomUUID(),presentationId:packet.presentationId},input={session_id:context.claudeSessionId,tool_use_id:randomUUID(),tool_input:{questions:[{header:'Q1',question:'[#123] Ship?',options,multiSelect:false}]}}
 const [q]=await recordQuestion(root,context,input);await recordAnswers(root,context,{...input,tool_response:{answers:{'[#123] Ship?':'Duyệt'}}});createShipApproval(root,config,{cardId:'123',questionId:q.questionId})
}
const execute=(f,extra={})=>api.runShip({root:f.root,config:f.config,cardId:'123',...extra})

test('unknown dev push delivery reconciles; partial S1 retries task only',async t=>{
 const f=makeShipWorkspace(t);commit(f);await authorize(f);const bump=()=>{const o=path.join(f.root,'bump');git(f.root,'clone',f.origins.web,o);git(o,'switch','dev');fs.writeFileSync(path.join(o,'bump'),'x');git(o,'add','.');git(o,'-c','user.name=t','-c','user.email=t@t','commit','-qm','bump');git(o,'push','origin','dev')};bump();let lost=true,taskFail=true,picks=0
 const runner=(cwd,args)=>{if(args.includes('cherry-pick')&&!args.includes('--abort'))picks++;if(args[0]==='push'&&args.at(-1).endsWith(':refs/heads/task/123')&&taskFail)return {status:1,stdout:'',stderr:''};const r=spawnSync('git',args,{cwd,encoding:'utf8'});if(args[0]==='push'&&args.at(-1).endsWith(':refs/heads/dev')&&lost){lost=false;throw new Error('response lost')}return r}
 let view=await execute(f,{runGit:runner});assert.equal(view.s1Complete,false);assert.equal(git(f.origins.web,'rev-list','--count',`${f.forkShas.web}..dev`),'2');taskFail=false
 view=await execute(f,{runGit:runner});assert.equal(view.s1Complete,true,JSON.stringify(view));assert.equal(picks,1)
})

test('dirty, local-only, changed origin and expired approval block without pushes',async t=>{
 for(const kind of ['dirty','local','origin','expired','build']){
 const f=makeShipWorkspace(t);commit(f);await authorize(f)
 if(kind==='dirty')fs.writeFileSync(path.join(f.copies.web,'dirty'),'x')
 if(kind==='local')git(f.copies.web,'config','ff.localOnly','true')
 if(kind==='origin')git(f.copies.web,'remote','set-url','origin',f.origins.web+'wrong')
 if(kind==='build')fs.unlinkSync(path.join(f.root,'.ff/harness/receipts/123/root/build.json'))
 const view=await execute(f,kind==='expired'?{now:()=>Date.now()+7200001}:{})
 assert.equal(view.s1Complete,false,kind);assert.equal(git(f.origins.web,'rev-parse','dev'),f.forkShas.web,kind)
 }
})

test('approval expiry between dev and task pushes preserves verified dev only',async t=>{
 const f=makeShipWorkspace(t);commit(f);await authorize(f);let expired=false,taskPush=0;const start=Date.now()
 const runner=(cwd,args)=>{if(args[0]==='push'&&args.at(-1).endsWith(':refs/heads/task/123'))taskPush++;const r=spawnSync('git',args,{cwd,encoding:'utf8'});if(args[0]==='push'&&args.at(-1).endsWith(':refs/heads/dev'))expired=true;return r}
 const v=await execute(f,{runGit:runner,now:()=>start+(expired?7200001:0)});assert.equal(v.s1Complete,false);assert.equal(taskPush,0);assert.equal(git(f.origins.web,'rev-list','--count',`${f.forkShas.web}..dev`),'1')
})

test('intent before cherry-pick on a root dev commit recovers without needing HEAD parent',async t=>{const f=makeShipWorkspace(t);commit(f);await authorize(f);assert.equal((await execute(f,{runCommand:()=>({status:1})})).s1Complete,false);await store.updateShipState(f.root,'123',s=>{const r=s.runs.at(-1).repos.web;r.steps.push({name:'cherry-pick',status:'intent'});return s});const v=await execute(f);assert.equal(v.s1Complete,true,JSON.stringify(v))})

test('checks cannot move owned HEAD or alter index/tree and certify the saved target',async t=>{
 for(const mutation of ['head','index','tree']){
  const f=makeShipWorkspace(t);commit(f);await authorize(f);let checks=0,pushes=0
  const v=await execute(f,{runCommand:(_cmd,cwd)=>{checks++;if(mutation==='head')git(cwd,'checkout','--detach','HEAD^');else{fs.writeFileSync(path.join(cwd,'a.txt'),'changed');if(mutation==='index'){git(cwd,'add','a.txt');fs.writeFileSync(path.join(cwd,'a.txt'),'a.txt')}}return {status:0}},runGit:(cwd,args)=>{if(args[0]==='push')pushes++;return spawnSync('git',args,{cwd,encoding:'utf8'})}})
  assert.equal(v.s1Complete,false,mutation);assert.equal(checks,1,mutation);assert.equal(pushes,0,mutation);assert.equal(git(f.origins.web,'rev-parse','dev'),f.forkShas.web)
  const row=store.readShipState(f.root,'123').runs.at(-1).repos.web;assert.notEqual(row.checksPassed,true);assert.equal(row.status,'blocked:owned_checkout_mismatch');assert.ok(row.ownedEvidence)
 }
})
