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

test('lost cherry-pick result recovers exact owned commit without repeating it',async t=>{
 const f=makeShipWorkspace(t),sha=commit(f);await authorize(f);const bump=()=>{const o=path.join(f.root,'bump');git(f.root,'clone',f.origins.web,o);git(o,'switch','dev');fs.writeFileSync(path.join(o,'bump'),'x');git(o,'add','.');git(o,'-c','user.name=t','-c','user.email=t@t','commit','-qm','bump');git(o,'push','origin','dev')};bump();let lost=true,picks=0
 const runner=(cwd,args)=>{const r=spawnSync('git',args,{cwd,encoding:'utf8'});if(args[0]==='cherry-pick'&&args[1]==='-x'){picks++;if(lost){lost=false;throw new Error('crash after cherry-pick')}}return r}
 assert.equal((await execute(f,{runGit:runner})).s1Complete,false);const v=await execute(f,{runGit:runner});assert.equal(v.s1Complete,true,JSON.stringify(v));assert.equal(picks,1);assert.equal(git(f.copies.web,'rev-parse','HEAD'),sha)
})

test('inspection accepts dev advancement but refuses stale source and mode completion',async t=>{
 const f=makeShipWorkspace(t);commit(f);await authorize(f);assert.equal((await execute(f)).s1Complete,true)
 const tmp=path.join(f.root,'other');git(f.root,'clone',f.origins.web,tmp);git(tmp,'switch','dev');git(tmp,'-c','user.name=t','-c','user.email=t@t','commit','--allow-empty','-qm','later task');git(tmp,'push','origin','dev')
 assert.equal(api.inspectShip(f.root,f.config,'123').s1Complete,true);f.config.ship={mode:'dev_and_pr'};let v=api.inspectShip(f.root,f.config,'123');assert.equal(v.s1Complete,true);assert.equal(v.s2Complete,false);assert.equal(v.complete,false)
 commit(f,'b.txt');v=api.inspectShip(f.root,f.config,'123');assert.equal(v.s1Complete,false);assert.equal(v.confirmed,false)
})

test('completed S1 remains historical after TTL but new mutations require current approval',async t=>{const f=makeShipWorkspace(t);commit(f);await authorize(f);assert.equal((await execute(f)).s1Complete,true);const future=Date.now()+7200001;t.mock.method(Date,'now',()=>future);assert.equal(api.inspectShip(f.root,f.config,'123').s1Complete,true);let commands=0;const v=await execute(f,{runGit:()=>{commands++;throw new Error('must not mutate')}});assert.equal(commands,0);assert.equal(v.s1Complete,true)})

test('inspection rejects saved passing checks without exact target HEAD/tree binding',async t=>{const f=makeShipWorkspace(t);commit(f);await authorize(f);assert.equal((await execute(f)).s1Complete,true);await store.updateShipState(f.root,'123',s=>{delete s.runs.at(-1).repos.web.checksHead;return s});assert.equal(api.inspectShip(f.root,f.config,'123').s1Complete,false)})
