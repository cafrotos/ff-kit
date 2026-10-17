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

test('first A then delta B preserve source branch/head and task history',async t=>{
 const f=makeShipWorkspace(t),a=commit(f);await authorize(f)
 let view=await execute(f);assert.equal(view.s1Complete,true,JSON.stringify(view))
 assert.equal(git(f.copies.web,'branch','--show-current'),f.branches.web);assert.equal(git(f.copies.web,'rev-parse','HEAD'),a)
 assert.equal(git(f.origins.web,'rev-parse','task/123'),a)
 const b=commit(f,'b.txt');await authorize(f);view=await execute(f);assert.equal(view.s1Complete,true,JSON.stringify(view))
 assert.equal(git(f.origins.web,'rev-parse','task/123'),b);assert.equal(git(f.copies.web,'rev-parse','HEAD'),b)
 const row=store.readShipState(f.root,'123').runs.at(-1).repos.web
 assert.equal(row.approvedSourceHead,b);assert.match(git(row.devCheckout,'log','-1','--format=%B'),new RegExp(b));assert.equal(git(f.origins.web,'rev-list','--count',`${f.forkShas.web}..dev`),'2')
 const count=git(f.origins.web,'rev-list','--count','dev');await execute(f);assert.equal(git(f.origins.web,'rev-list','--count','dev'),count)
})

test('dev advances between checks and push: fetch/replay preserves both changes',async t=>{
 const f=makeShipWorkspace(t);commit(f);await authorize(f);const tmp=path.join(f.root,'other');git(f.root,'clone',f.origins.web,tmp);git(tmp,'switch','dev');let advances=0,pushes=0
 const runner=(cwd,args)=>{if(args[0]==='push'&&args.at(-1).endsWith(':refs/heads/dev')){pushes++;if(advances++===0){fs.writeFileSync(path.join(tmp,'other'),'x');git(tmp,'add','.');git(tmp,'-c','user.name=t','-c','user.email=t@t','commit','-qm','other');git(tmp,'push','origin','dev')}}return spawnSync('git',args,{cwd,encoding:'utf8'})}
 const v=await execute(f,{runGit:runner});assert.equal(v.s1Complete,true,JSON.stringify(v));assert.equal(pushes,2);assert.equal(git(f.origins.web,'show','dev:other'),'x');assert.equal(git(f.origins.web,'show','dev:a.txt'),'a.txt')
})

test('dev advance replay is bounded to two retries',async t=>{
 const f=makeShipWorkspace(t);commit(f);await authorize(f);const tmp=path.join(f.root,'other');git(f.root,'clone',f.origins.web,tmp);git(tmp,'switch','dev');let pushes=0
 const runner=(cwd,args)=>{if(args[0]==='push'&&args.at(-1).endsWith(':refs/heads/dev')){pushes++;fs.writeFileSync(path.join(tmp,'other'+pushes),'x');git(tmp,'add','.');git(tmp,'-c','user.name=t','-c','user.email=t@t','commit','-qm','advance');git(tmp,'push','origin','dev')}return spawnSync('git',args,{cwd,encoding:'utf8'})}
 const v=await execute(f,{runGit:runner});assert.equal(v.s1Complete,false);assert.equal(pushes,3);assert.equal(v.blockedReason,'diverged')
})

test('no-change repo skips with saved range evidence',async t=>{const f=makeShipWorkspace(t);await authorize(f);const v=await execute(f);assert.equal(v.s1Complete,true,JSON.stringify(v));assert.equal(git(f.origins.web,'rev-parse','dev'),f.forkShas.web)})

test('configured install always runs before build and test',async t=>{const f=makeShipWorkspace(t);commit(f);await authorize(f);f.config.repos[0].commands.install='node --version';const seen=[];const v=await execute(f,{runCommand:(cmd)=>{seen.push(cmd);return {status:0}}});assert.equal(v.s1Complete,true);assert.deepEqual(seen,['node --version','node -v','node -v'])})
