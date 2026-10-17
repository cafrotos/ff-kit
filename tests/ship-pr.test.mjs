import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const api=await import('../scripts/lib/github-pr.mjs').catch(()=>({}))
test('reconciles lost create, exact head and squash merge observation',async()=>{
 const calls=[];let exists=false
 const client=new api.GitHubPrClient({runGh:async(args,cwd)=>{calls.push(args);if(args[1]==='list')return {status:0,stdout:JSON.stringify(exists?[{number:1}]:[])};if(args[1]==='create'){exists=true;throw Error('lost')}return {status:0,stdout:JSON.stringify({number:1,url:'https://github.com/o/r/pull/1',state:'MERGED',headRepository:{nameWithOwner:'o/r'},headRefName:'task',baseRefName:'main',headRefOid:'abc',baseRefOid:'newbase',mergedAt:'today',mergeable:'UNKNOWN',comments:[]})}}})
 const file=path.join(os.tmpdir(),'ff-pr-test-body');fs.writeFileSync(file,'report')
 const p=await client.ensurePullRequest({cwd:os.tmpdir(),repoIdentity:'git@github.com:o/r.git',taskBranch:'task',baseBranch:'main',sourceHead:'abc',title:'Title',bodyFile:file,revision:'',cardId:'123'})
 assert.equal(p.headAtMerge,'abc');assert.equal(p.mergeability,'unknown');assert.equal(calls.filter(a=>a[1]==='create').length,1);assert.ok(calls.every(a=>a.includes('o/r')))
})
test('rejects mismatching head and closed PR; normalizes origin',async()=>{
 assert.equal(api.normalizeRepoIdentity('https://github.com/owner/repo.git'),'owner/repo')
 for(const raw of [{state:'CLOSED',headRefOid:'abc'},{state:'OPEN',headRefOid:'wrong'}]){
 const c=new api.GitHubPrClient({runGh:()=>({status:0,stdout:JSON.stringify({...raw,headRepository:{nameWithOwner:'o/r'},headRefName:'task',baseRefName:'main'})})})
 await assert.rejects(c.inspectPullRequest({cwd:'.',repoIdentity:'o/r',number:1,approvedSourceHead:'abc',taskBranch:'task',baseBranch:'main'}))
 }
})
test('gh failures block, conflict remains an observation, body is bounded',async()=>{
 for(const runGh of [()=>{throw Error('ENOENT')},()=>({status:1})]){
 const c=new api.GitHubPrClient({runGh});await assert.rejects(c.inspectPullRequest({cwd:'.',repoIdentity:'o/r',number:1,approvedSourceHead:'abc'}),/gh/)
 }
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ff-pr-')),file=path.join(dir,'body');fs.writeFileSync(file,'x'.repeat(70000));let mutated=0
 const c=new api.GitHubPrClient({beforeMutation:()=>{mutated++},runGh:(args)=>({status:0,stdout:JSON.stringify(args[1]==='list'?[{number:1}]:{number:1,state:'OPEN',headRepository:{nameWithOwner:'o/r'},headRefName:'task',baseRefName:'main',headRefOid:'abc',mergeable:'CONFLICTING'})})})
 const view=await c.ensurePullRequest({cwd:dir,repoIdentity:'o/r',taskBranch:'task',baseBranch:'main',sourceHead:'abc',title:'title',bodyFile:file,revision:''})
 assert.equal(view.mergeability,'conflicting');assert.equal(mutated,0);assert.ok(fs.readFileSync(file,'utf8').length<=60000);assert.match(fs.readFileSync(file,'utf8'),/truncated/);fs.rmSync(dir,{recursive:true})
})
test('lost comment reconciles marker and authorization denial prevents mutation',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ff-pr-')),file=path.join(dir,'body');fs.writeFileSync(file,'report');let comments=[],count=0
 const runGh=args=>{if(args[1]==='list')return {status:0,stdout:'[{"number":1}]'};if(args[1]==='comment'){count++;comments=[{body:fs.readFileSync(file,'utf8')}];throw Error('timeout')};return {status:0,stdout:JSON.stringify({number:1,state:'OPEN',headRepository:{nameWithOwner:'o/r'},headRefName:'task',baseRefName:'main',headRefOid:'abc',comments})}}
 const input={cwd:dir,repoIdentity:'o/r',taskBranch:'task',baseBranch:'main',sourceHead:'abc',title:'title',bodyFile:file,revision:'rev-2',cardId:'123'}
 const c=new api.GitHubPrClient({runGh});await c.ensurePullRequest(input);await c.ensurePullRequest(input);assert.equal(count,1)
 comments=[];await assert.rejects(new api.GitHubPrClient({runGh,beforeMutation:()=>{throw Error('scope_changed')}}).ensurePullRequest(input),/scope_changed/);assert.equal(count,1);fs.rmSync(dir,{recursive:true})
})
test('near-limit report text is preserved, or explicitly annotated when truncated',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ff-pr-limit-')),file=path.join(dir,'body')
 const client=new api.GitHubPrClient({runGh:args=>({status:0,stdout:JSON.stringify(args[1]==='list'?[{number:1}]:{number:1,state:'OPEN',headRepository:{nameWithOwner:'o/r'},headRefOid:'abc'})})})
 for(const size of [59968,59972,60000]){fs.writeFileSync(file,'x'.repeat(size));await client.ensurePullRequest({cwd:dir,repoIdentity:'o/r',sourceHead:'abc',bodyFile:file,revision:'',cardId:'123'});const body=fs.readFileSync(file,'utf8'),retained=body.match(/^x*/)[0].length;assert.ok(body.length<=60000);if(retained<size)assert.match(body,/Report truncated/);else assert.equal(retained,size)}
 fs.rmSync(dir,{recursive:true})
})
test('revision report pipeline uploads active revision text only; missing report never falls back',async()=>{
 const {writeShipPrBody}=await import('../scripts/lib/ship.mjs'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'ff-pr-revision-')),file=path.join(dir,'body')
 fs.writeFileSync(path.join(dir,'05-verify-report.md'),'ORIGINAL ONLY');fs.mkdirSync(path.join(dir,'rev-2'));fs.writeFileSync(path.join(dir,'rev-2/05-verify-report.md'),'APPROVED REVISION ONLY')
 writeShipPrBody({cardDir:dir,revision:'rev-2',cardId:'123',file})
 let uploaded='',comments=[]
 const client=new api.GitHubPrClient({runGh:args=>{if(args[1]==='comment'){uploaded=fs.readFileSync(args[args.indexOf('--body-file')+1],'utf8');comments=[{body:uploaded}];return {status:0}}return {status:0,stdout:JSON.stringify(args[1]==='list'?[{number:1}]:{number:1,state:'OPEN',headRepository:{nameWithOwner:'o/r'},headRefName:'task',baseRefName:'main',headRefOid:'abc',comments})}}})
 await client.ensurePullRequest({cwd:dir,repoIdentity:'o/r',taskBranch:'task',baseBranch:'main',sourceHead:'abc',bodyFile:file,revision:'rev-2',cardId:'123'})
 assert.match(uploaded,/APPROVED REVISION ONLY/);assert.doesNotMatch(uploaded,/ORIGINAL ONLY/)
 assert.throws(()=>writeShipPrBody({cardDir:dir,revision:'rev-3',cardId:'123',file}),/ENOENT/);fs.rmSync(dir,{recursive:true})
})
