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

test('checks fail and cherry-pick conflict never push',async t=>{
 for(const kind of ['checks','conflict']){const f=makeShipWorkspace(t);commit(f);await authorize(f)
 if(kind==='conflict'){const tmp=path.join(f.root,'other');git(f.root,'clone',f.origins.web,tmp);git(tmp,'switch','dev');fs.writeFileSync(path.join(tmp,'a.txt'),'other');git(tmp,'add','.');git(tmp,'-c','user.name=t','-c','user.email=t@t','commit','-qm','other');git(tmp,'push','origin','dev')}
 const before=git(f.origins.web,'rev-parse','dev'),v=await execute(f,kind==='checks'?{runCommand:()=>({status:1})}:{})
 assert.equal(v.s1Complete,false);assert.equal(git(f.origins.web,'rev-parse','dev'),before);assert.notEqual(spawnSync('git',['show-ref','--verify','refs/heads/task/123'],{cwd:f.origins.web}).status,0);if(kind==='checks')assert.ok(store.readShipState(f.root,'123').runs.at(-1).repos.web.steps.some(s=>s.name==='check:build'&&s.exitCode===1));if(kind==='conflict')assert.deepEqual(store.readShipState(f.root,'123').runs.at(-1).repos.web.conflictFiles,['a.txt'])
 }
})

test('configured environment copied privately and checks execute in owned checkout',async t=>{
 const f=makeShipWorkspace(t);commit(f);git(f.copies.web,'config','core.excludesFile',path.join(f.root,'ignore'));fs.writeFileSync(path.join(f.root,'ignore'),'.env\n');fs.writeFileSync(path.join(f.copies.web,'.env'),'PRIVATE');f.config.repos[0].env_files=['.env'];await authorize(f);let seen=0
 const view=await execute(f,{runCommand:(cmd,cwd)=>{assert.notEqual(cwd,f.copies.web);assert.equal(fs.readFileSync(path.join(cwd,'.env'),'utf8'),'PRIVATE');assert.equal(fs.statSync(path.join(cwd,'.env')).mode&0o777,0o600);seen++;return {status:0}}});assert.equal(view.s1Complete,true);assert.equal(seen,2);assert.doesNotMatch(JSON.stringify(view),/PRIVATE/)
})

test('recovery refuses clean owned HEAD different from the saved unchecked target',async t=>{
 const f=makeShipWorkspace(t);commit(f);await authorize(f);const start=Date.now();let expired=false
 const now=()=>{const r=store.readShipState(f.root,'123')?.runs.at(-1)?.repos.web;if(r?.targetHead&&!r.checksPassed)expired=true;return start+(expired?7200001:0)}
 assert.equal((await execute(f,{now})).s1Complete,false)
 const row=store.readShipState(f.root,'123').runs.at(-1).repos.web;assert.ok(row.targetHead);assert.notEqual(row.checksPassed,true)
 git(row.devCheckout,'checkout','--detach',row.devBefore)
 let checks=0,pushes=0;const v=await execute(f,{runCommand:()=>{checks++;return {status:0}},runGit:(cwd,args)=>{if(args[0]==='push')pushes++;return spawnSync('git',args,{cwd,encoding:'utf8'})}})
 assert.equal(v.s1Complete,false);assert.equal(checks,0);assert.equal(pushes,0);assert.equal(git(f.origins.web,'rev-parse','dev'),f.forkShas.web);assert.equal(git(row.devCheckout,'rev-parse','HEAD'),row.devBefore)
 const blocked=store.readShipState(f.root,'123').runs.at(-1).repos.web;assert.equal(blocked.status,'blocked:owned_checkout_mismatch');assert.equal(blocked.ownedEvidence.expectedHead,row.targetHead);assert.equal(blocked.ownedEvidence.actualHead,row.devBefore)
})

test('replacement scope with real renewed approval cannot authorize old-scope operations',async t=>{
 const f=makeShipWorkspace(t),a=commit(f);await authorize(f);let replaced=false,b,checks=0;const effects=[]
 const v=await execute(f,{runGit:(cwd,args)=>{effects.push({afterReplacement:replaced,args});return spawnSync('git',args,{cwd,encoding:'utf8'})},runCommand:async()=>{checks++;if(!replaced){commit(f,'b.txt');git(f.copies.web,'reset','--soft',f.forkShas.web);git(f.copies.web,'-c','user.name=t','-c','user.email=t@t','commit','-qm','replacement\n\nTrello: #123');b=git(f.copies.web,'rev-parse','HEAD');await authorize(f,{mutex:(_l,_o,fn)=>fn()});replaced=true}return {status:0}}})
 assert.notEqual(b,a);assert.equal(git(f.copies.web,'rev-parse','HEAD'),b);assert.equal(v.s1Complete,false);assert.equal(checks,1);assert.deepEqual(effects.filter(e=>e.afterReplacement),[]);assert.equal(git(f.origins.web,'rev-parse','dev'),f.forkShas.web);assert.notEqual(spawnSync('git',['show-ref','--verify','refs/heads/task/123'],{cwd:f.origins.web}).status,0)
 assert.equal(store.readShipState(f.root,'123').runs[0].repos.web.status,'blocked:scope_changed')
})

test('remote advance cannot hide an unexpected owned recovery HEAD before replay',async t=>{const f=makeShipWorkspace(t);commit(f);await authorize(f);const start=Date.now();let expired=false;await execute(f,{now:()=>{const r=store.readShipState(f.root,'123')?.runs.at(-1)?.repos.web;if(r?.targetHead&&!r.checksPassed)expired=true;return start+(expired?7200001:0)}});const row=store.readShipState(f.root,'123').runs.at(-1).repos.web;git(row.devCheckout,'checkout','--detach',row.devBefore);const other=path.join(f.root,'advance');git(f.root,'clone',f.origins.web,other);git(other,'switch','dev');git(other,'-c','user.name=t','-c','user.email=t@t','commit','--allow-empty','-qm','advance');git(other,'push','origin','dev');const before=git(f.origins.web,'rev-parse','dev');let checks=0;const v=await execute(f,{runCommand:()=>{checks++;return {status:0}}});assert.equal(v.s1Complete,false);assert.equal(checks,0);assert.equal(git(f.origins.web,'rev-parse','dev'),before);assert.equal(git(row.devCheckout,'rev-parse','HEAD'),row.devBefore)})
