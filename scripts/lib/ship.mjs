// Recoverable S1. All Git arguments are arrays; only configured checks use a shell.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {findCardDir} from './cards.mjs'
import {inspectCard} from '../cli/state.mjs'
import {repoDir,cardBranch} from '../cli/repo-common.mjs'
import {getTaskCommitRange} from './task-commits.mjs'
import {captureShipTargets,validateShipApproval,shipApprovalPath} from './ship-approval.mjs'
import {readStageReceipt,validateStageReceipt} from './stage-receipts.mjs'
import {readShipState,updateShipState} from './ship-store.mjs'
import {preflightStage} from './doctor.mjs'
import {GitHubPrClient,defaultRunGh,normalizeRepoIdentity} from './github-pr.mjs'
import {withFileMutex,BusyError} from './file-mutex.mjs'
import {testedCommit,shipTestRel} from './ship-test-record.mjs'
import {testRepoDir} from './code-dir.mjs'
async function destinationMutex(file,owner,action){
 const deadline=Date.now()+120000
 for(;;){let entered=false;try{return await withFileMutex(file,owner,()=>{entered=true;return action()})}catch(e){if(entered||!(e instanceof BusyError)||Date.now()>=deadline)throw e;await new Promise(resolve=>setTimeout(resolve,50))}}
}
const hash=x=>createHash('sha256').update(x).digest('hex')
const insist=(ok,reason)=>{if(!ok)throw new Error(reason)}
export const defaultRunGit=(cwd,args)=>spawnSync('git',args,{cwd,encoding:'utf8',timeout:120000})
export const defaultRunCommand=(command,cwd)=>spawnSync(command,{cwd,shell:true,encoding:'utf8',timeout:120000})
function checked(cwd,args){const r=defaultRunGit(cwd,args);insist(r.status===0,`git:${args[0]}`);return r.stdout.trim()}
function canonical(url,cwd){if(url.startsWith('file://'))return fs.realpathSync(new URL(url));if(path.isAbsolute(url)||!/^([^/]+:)/.test(url))return fs.realpathSync(path.resolve(cwd,url));return url.replace(/\/$/,'').replace(/\.git$/,'')}
function sourceContext(root,config,cardId){const card=findCardDir(root,config,cardId);insist(!card.error,'card');const state=inspectCard(root,config,card.dir);return {cardDir:card.dir,state,revision:state.activeRevision??''}}
function preconditions(root,config,cardId,now){
 const c=sourceContext(root,config,cardId);insist(c.state.gates.GATE_C.status==='approved','gate_c')
 for(const stage of ['build','verify']){const r=readStageReceipt(root,cardId,stage,c.revision);insist(r&&['pass','no_change'].includes(r.outcome)&&validateStageReceipt(root,config,r).valid,`receipt:${stage}`)}
 const targets=captureShipTargets(root,config,cardId),approval=JSON.parse(fs.readFileSync(shipApprovalPath(root,cardId),'utf8'));insist(validateShipApproval(root,config,approval,targets,now()).valid,'ship_approval')
 for(const target of targets){const repo=config.repos.find(r=>r.name===target.repo),source=repoDir(root,config.workspace.worktrees_dir,path.basename(c.cardDir),repo),mirror=path.resolve(root,repo.path)
  insist(!checked(source,['status','--porcelain']),'dirty');insist(cardBranch(path.join(c.cardDir,'01-dossier.md'))===target.taskBranch,'task_branch')
  insist(target.shipBranch!==repo.base_branch&&target.taskBranch!==repo.base_branch,'protected_branch')
  const urls=JSON.parse(target.origin),expected={fetch:checked(mirror,['remote','get-url','--all','origin']).split('\n'),push:checked(mirror,['remote','get-url','--push','--all','origin']).split('\n')}
  // One effective destination avoids an unverifiable partial multi-URL push.
  insist(urls.fetch.length===1&&urls.push.length===1&&expected.fetch.length===1&&expected.push.length===1,'origin_multiple')
  insist(canonical(urls.fetch[0],source)===canonical(expected.fetch[0],mirror)&&canonical(urls.push[0],source)===canonical(expected.push[0],mirror)&&canonical(urls.fetch[0],source)===canonical(urls.push[0],source),'origin')
  insist(typeof repo.commands?.build==='string'&&repo.commands.build.trim()&&typeof repo.commands?.test==='string'&&repo.commands.test.trim(),'commands')
 }
 return {...c,targets,heads:Object.fromEntries(targets.map(t=>[t.repo,t.sourceHead]))}
}
const runKey=c=>hash(JSON.stringify([c.revision,c.targets]))
/** Opaque source/destination identity, including origin and PR base, for synchronous CAS guards. */
export function shipSourceIdentity(root,config,cardId){try{const scope=sourceContext(root,config,cardId);return runKey({...scope,targets:captureShipTargets(root,config,cardId)})}catch{return null}}
function contains(cwd,branch,sha){try{checked(cwd,['fetch','--no-tags','origin',`+refs/heads/${branch}:refs/remotes/origin/${branch}`]);return defaultRunGit(cwd,['merge-base','--is-ancestor',sha,`refs/remotes/origin/${branch}`]).status===0}catch{return false}}
/** Trusted synchronous observation. Saved booleans alone never establish completion. */
export function inspectShip(root,config,cardId){
 cardId=String(cardId).split('-')[0];const view={cardId,mode:config.ship?.mode??'dev_only',source:'cli',confirmed:false,revision:'',heads:{},repos:[],s1Complete:false,s2Complete:false,complete:false}
 try{
  // Completed delivery remains a historical fact after approval TTL. This clock
  // is used only for observation; runShip has no historical-authorization input.
  const saved=readShipState(root,cardId),scope=sourceContext(root,config,cardId),targets=captureShipTargets(root,config,cardId),candidate=saved?.runs.find(r=>r.key===runKey({...scope,targets}))
  let observationTime=Date.now()
  if(candidate&&targets.every(t=>candidate.repos[t.repo]?.status==='done'))observationTime=JSON.parse(fs.readFileSync(shipApprovalPath(root,cardId),'utf8')).issuedAt
  const c=preconditions(root,config,cardId,()=>observationTime);view.sourceIdentity=runKey(c);view.confirmed=true;view.revision=c.revision;view.heads=c.heads;const state=readShipState(root,cardId),run=state?.runs.find(r=>r.key===runKey(c));if(!run)return view
  view.repos=c.targets.map(target=>{const r=run.repos[target.repo],repo=config.repos.find(x=>x.name===target.repo),source=repoDir(root,config.workspace.worktrees_dir,path.basename(c.cardDir),repo);let verified=false
   if(r?.status==='done'&&r.approvedSourceHead===target.sourceHead&&r.checksPassed&&(r.noChange||(r.targetHead&&r.checksHead===r.targetHead&&r.checksTree===checked(r.devCheckout,['rev-parse',`${r.targetHead}^{tree}`])))){if(r.noChange)verified=r.baseSha===target.sourceHead&&r.commits?.length===0;else if(r.skipped)verified=contains(source,target.taskBranch,target.sourceHead)&&!!r.targetHead&&contains(r.devCheckout,target.shipBranch,r.targetHead);else verified=!!r.targetHead&&contains(r.devCheckout,target.shipBranch,r.targetHead)&&contains(source,target.taskBranch,target.sourceHead)}
   return {repo:target.repo,approvedSourceHead:target.sourceHead,sourceHead:target.sourceHead,taskBranch:target.taskBranch,shipBranch:target.shipBranch,baseBranch:target.baseBranch,devHead:r?.targetHead??null,requiresPr:config.ship?.mode==='dev_and_pr'&&!r?.noChange,s1Complete:verified,checksPassed:verified&&r?.checksPassed===true,status:verified?'done':r?.status??'pending'}
  });view.shippedAt=Object.values(run.repos).flatMap(r=>r.s1CompletedAt?[r.s1CompletedAt]:(r.steps??[]).filter(s=>s.status==='done'&&s.name!=='pr-mutation').map(s=>s.completedAt??s.at)).sort().at(-1)??run.createdAt??null;view.s1Complete=view.repos.length>0&&view.repos.every(r=>r.s1Complete);view.s2Complete=config.ship?.mode!=='dev_and_pr';view.complete=view.s1Complete&&view.s2Complete;view.devHashes=Object.fromEntries(view.repos.filter(r=>r.devHead).map(r=>[r.repo,r.devHead]));return view
 }catch{view.blockedReason='setup:ship_preconditions';return view}
}
export async function runShip({root,config,cardId,runGit=defaultRunGit,runCommand=defaultRunCommand,now=Date.now,github,preflightRunCommand}){
 cardId=String(cardId).split('-')[0];let c,key
 const auth=()=>{const current=preconditions(root,config,cardId,now);if(key)insist(current.revision===c.revision&&JSON.stringify(current.targets)===JSON.stringify(c.targets)&&runKey(current)===key,'scope_changed');return current}
 const patch=async(name,reduce)=>updateShipState(root,cardId,s=>{const r=s.runs.find(r=>r.key===key);reduce(r.repos[name],r);return s})
 try{
  c=auth();key=runKey(c)
  const preflight=preflightStage(root,config,{stage:'ship',mode:'S1',runCommand:preflightRunCommand});insist(preflight.ok,preflight.reason)
  await updateShipState(root,cardId,s=>{if(!s.runs.some(r=>r.key===key))s.runs.push({key,revision:c.revision,heads:c.heads,createdAt:new Date(now()).toISOString(),repos:{}});return s})
  for(const target of c.targets){
   const repo=config.repos.find(r=>r.name===target.repo),source=repoDir(root,config.workspace.worktrees_dir,path.basename(c.cardDir),repo),origin=JSON.parse(target.origin).fetch[0]
   const destination=hash(JSON.stringify([canonical(origin,source),target.shipBranch])),lock=path.join(os.tmpdir(),`ff-ship-locks-${process.getuid?.()??'user'}`,destination+'.lock')
   await destinationMutex(lock,{operation:'ship',destination},async()=>{
    auth()
    let row=readShipState(root,cardId).runs.find(r=>r.key===key).repos[repo.name]
    if(!row){await updateShipState(root,cardId,s=>{s.runs.find(r=>r.key===key).repos[repo.name]={repo:repo.name,origin:target.origin,approvedSourceHead:target.sourceHead,taskBranch:target.taskBranch,shipBranch:target.shipBranch,devCheckout:path.join(root,'.ff/ship-checkouts',cardId,key,hash(repo.name).slice(0,16)),status:'pending',steps:[]};return s});row=readShipState(root,cardId).runs.find(r=>r.key===key).repos[repo.name]}
    const refresh=()=>readShipState(root,cardId).runs.find(r=>r.key===key).repos[repo.name]
    async function operation(name,action,apply=()=>{}){
     auth()
     await patch(repo.name,r=>{r.steps.push({name,status:'intent',at:new Date(now()).toISOString()})})
     let result
     try{
      // Intent persistence can await another state transaction: bind scope again
      // immediately before the effect, as well as after an awaited effect.
      auth()
      result=await action()
     }catch(error){
      await patch(repo.name,r=>{r.steps.at(-1).status='unknown';if(error.ownedEvidence){r.ownedEvidence=error.ownedEvidence;r.checksPassed=false}})
      if(['scope_changed','owned_checkout_mismatch'].includes(error.message))throw error
      throw new Error(`unknown:${name}`)
     }
     try{auth()}catch(error){await patch(repo.name,r=>{r.steps.at(-1).status='done';r.steps.at(-1).scopeValid=false});throw error}
     await patch(repo.name,r=>{r.steps.at(-1).status='done';r.steps.at(-1).completedAt=new Date(now()).toISOString();apply(r,result)})
     return result
    }
    async function g(name,cwd,args,apply=()=>{}){const result=await operation(name,()=>{if(name==='push-dev'||name==='push-task')assertOwnedTarget();return runGit(cwd,args)},(row,result)=>{row.steps.at(-1).exitCode=Number.isInteger(result?.status)?result.status:null;if(result?.status===0)apply(row,result.stdout?.trim()??'')});insist(result?.status===0,`git:${name}`);return result.stdout?.trim()??''}
    const dir=row.devCheckout
    function readOwnedTarget(){
     const expectedHead=refresh().targetHead
     return {
      expectedHead,actualHead:checked(dir,['rev-parse','HEAD']),
      expectedTree:checked(dir,['rev-parse',`${expectedHead}^{tree}`]),actualTree:checked(dir,['rev-parse','HEAD^{tree}']),
      indexClean:defaultRunGit(dir,['diff','--cached','--quiet',expectedHead,'--']).status===0,
      worktreeClean:defaultRunGit(dir,['diff','--quiet','--']).status===0,
     }
    }
    function assertOwnedTarget(evidence=readOwnedTarget()){
     if(evidence.actualHead!==evidence.expectedHead||evidence.actualTree!==evidence.expectedTree||!evidence.indexClean||!evidence.worktreeClean){
      const error=new Error('owned_checkout_mismatch');error.ownedEvidence=evidence;throw error
     }
     return evidence
    }
    async function ownedTarget(){
     return operation('validate-owned-target',()=>assertOwnedTarget(),(r,evidence)=>{r.ownedEvidence=evidence})
    }
    const remoteTask=()=>checked(source,['ls-remote','--heads','origin',`refs/heads/${target.taskBranch}`]).split(/\s/)[0]||null
    // Snapshot before touching the destination checkout; never compute ranges there.
    if(!row.commits){await operation('snapshot',()=>getTaskCommitRange({root,config,cardDir:c.cardDir,repo,repoPath:source}),(r,range)=>{insist(range.sourceHead===target.sourceHead,'source_changed');insist(range.alreadyShipped||range.commits.length<=1,'squash');r.commits=range.alreadyShipped?[]:range.commits;r.baseSha=range.baseSha;r.alreadyShipped=range.alreadyShipped});row=refresh()}
    if(!row.commits.length){
     // A previous run must prove dev delivery; remote task existence is not dev evidence.
     const previous=readShipState(root,cardId).runs.flatMap(x=>Object.values(x.repos)).find(r=>r.approvedSourceHead===target.sourceHead&&r.targetHead&&r.checksPassed&&r.checksHead===r.targetHead&&r.checksTree===checked(r.devCheckout,['rev-parse',`${r.targetHead}^{tree}`]))
     if(row.alreadyShipped){insist(previous&&contains(previous.devCheckout,target.shipBranch,previous.targetHead),'unproven_already_shipped');await patch(repo.name,r=>{r.targetHead=previous.targetHead;r.devCheckout=previous.devCheckout;r.checksPassed=true;r.checksHead=previous.checksHead;r.checksTree=previous.checksTree;r.status='done';r.s1CompletedAt??=new Date(now()).toISOString();r.skipped=true})}
     else {await patch(repo.name,r=>{r.status='done';r.s1CompletedAt??=new Date(now()).toISOString();r.skipped=true;r.checksPassed=true;r.noChange=true})}
     return
    }
    const sha=row.commits[0]
    insist(sha===target.sourceHead&&row.commits.length===1,'squash')
    // If clone was interrupted only an absent directory or an intact owned clone is accepted.
    if(!fs.existsSync(path.join(dir,'.git'))){insist(!fs.existsSync(dir),'checkout_unknown');fs.mkdirSync(path.dirname(dir),{recursive:true,mode:0o700});await g('clone',root,['clone','--no-hardlinks','--no-checkout',source,dir]);await g('origin',dir,['remote','set-url','origin',origin])}
    // Interrupted clone before origin update can only be repaired when no cherry-pick exists.
    if(checked(dir,['remote','get-url','origin'])!==origin){insist(!refresh().targetHead,'checkout_origin');await g('origin',dir,['remote','set-url','origin',origin])}
    const fetch=()=>g('fetch',dir,['fetch','--no-tags','origin',`+refs/heads/${target.shipBranch}:refs/remotes/origin/${target.shipBranch}`])
    const delivered=async()=>{await fetch();const r=refresh();if(r.targetHead&&defaultRunGit(dir,['merge-base','--is-ancestor',r.targetHead,`refs/remotes/origin/${target.shipBranch}`]).status===0){await patch(repo.name,x=>{x.devPushed=true});return true}return false}
    let done=await delivered()
    if(!done){
     // Reconcile a cherry-pick result lost before its checkpoint using exact trailer+parent.
     row=refresh();if(!row.targetHead&&row.steps.some(s=>s.name==='cherry-pick'&&s.status==='intent'||s.name==='cherry-pick'&&s.status==='unknown')){
      const body=checked(dir,['log','-1','--format=%B']),parentResult=defaultRunGit(dir,['rev-parse','--verify','HEAD^']),parent=parentResult.status===0?parentResult.stdout.trim():null
      if(body.includes(`(cherry picked from commit ${sha})`)&&parent===row.devBefore)await patch(repo.name,r=>{r.targetHead=checked(dir,['rev-parse','HEAD']);r.sourceToTarget={[sha]:r.targetHead}})
      else {const pending=defaultRunGit(dir,['rev-parse','--verify','CHERRY_PICK_HEAD']);if(pending.status===0)await g('abort',dir,['cherry-pick','--abort']);insist(checked(dir,['rev-parse','HEAD'])===row.devBefore,'cherry_pick_unknown')}
     }
     done=await delivered()
    }
    for(let replay=0;!done&&replay<=2;replay++){
     await fetch();const before=checked(dir,['rev-parse',`refs/remotes/origin/${target.shipBranch}`]);row=refresh()
     if(row.targetHead)await ownedTarget()
     if(!row.targetHead||row.devBefore!==before){
      await g('checkout',dir,['checkout','--detach',`refs/remotes/origin/${target.shipBranch}`],r=>{r.devBefore=before;r.targetHead=null;r.checksPassed=false})
      await g('identity-name',dir,['config','user.name',checked(source,['show','-s','--format=%an',sha])]);await g('identity-email',dir,['config','user.email',checked(source,['show','-s','--format=%ae',sha])])
      const tested=testedCommit(root,cardId,c.revision,repo.name,sha,before);let adopted=false
      // S1 reuses the commit verify already ran against when the ship-branch tip is unchanged; checks below still run on it.
      if(tested){try{await g('fetch-tested',dir,['fetch','--no-tags',tested.checkout,`refs/heads/${tested.testBranch}`]);await g('adopt-tested',dir,['checkout','--detach',tested.testSha],r=>{r.targetHead=checked(dir,['rev-parse','HEAD']);r.sourceToTarget={[sha]:r.targetHead};r.testedCommit=true});adopted=refresh().targetHead===tested.testSha}catch(error){if(error.message==='scope_changed')throw error;defaultRunGit(dir,['checkout','--detach',`refs/remotes/origin/${target.shipBranch}`])}}
      if(!adopted)try{await g('cherry-pick',dir,['cherry-pick','-x',sha],r=>{r.targetHead=checked(dir,['rev-parse','HEAD']);r.sourceToTarget={[sha]:r.targetHead}})}catch(error){if(error.message==='scope_changed')throw error;if(defaultRunGit(dir,['rev-parse','--verify','CHERRY_PICK_HEAD']).status===0){const files=checked(dir,['diff','--name-only','--diff-filter=U']).split('\n').filter(Boolean);await patch(repo.name,r=>{r.conflictFiles=files});await g('abort',dir,['cherry-pick','--abort'])}throw new Error('conflict')}
     }
     await ownedTarget()
     for(const rel of repo.env_files??[]){await operation('env-copy',()=>{insist(typeof rel==='string'&&!path.isAbsolute(rel)&&!rel.split(/[\\/]/).includes('..'),'env_path');const src=path.resolve(source,rel),dest=path.resolve(dir,rel);if(!fs.existsSync(src))return;insist(fs.realpathSync(src)===src,'env_symlink');fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});insist(fs.realpathSync(path.dirname(dest))===path.dirname(dest)&&(!fs.existsSync(dest)||!fs.lstatSync(dest).isSymbolicLink()),'env_symlink');fs.copyFileSync(src,dest);fs.chmodSync(dest,0o600)})}
     try{for(const [name,command] of Object.entries(repo.commands??{}).sort(([a],[b])=>(a==='install'?-1:0)-(b==='install'?-1:0))){if(!command||!(/^(install|build|test|lint|type[-_]?check)(?:[-_].*)?$/.test(name)))continue;await ownedTarget();const result=await operation(`check:${name}`,()=>{assertOwnedTarget();return runCommand(command,dir)},(r,result)=>{const exitCode=Number.isInteger(result?.status)?result.status:null;r.steps.at(-1).exitCode=exitCode;r.checks??=[];r.checks.push({name,exitCode})});await ownedTarget();insist(result?.status===0,'checks')}const evidence=await ownedTarget();await patch(repo.name,r=>{r.checksHead=evidence.actualHead;r.checksTree=evidence.actualTree;r.checksPassed=true})}catch(error){if(['owned_checkout_mismatch','scope_changed'].includes(error.message))throw error;await ownedTarget();await g('checks-reset',dir,['reset','--hard',`refs/remotes/origin/${target.shipBranch}`]);await patch(repo.name,r=>{r.targetHead=null;r.checksPassed=false});throw new Error('checks')}
     // Intent contains target SHA before push; thrown delivery is reconciled before replay.
     const evidence=await ownedTarget();insist(refresh().checksPassed&&refresh().checksHead===evidence.actualHead&&refresh().checksTree===evidence.actualTree,'owned_checkout_mismatch')
     try{await g('push-dev',dir,['push','origin',`${refresh().targetHead}:refs/heads/${target.shipBranch}`])}catch{}
     done=await delivered();if(!done){const advanced=checked(dir,['rev-parse',`refs/remotes/origin/${target.shipBranch}`])!==refresh().devBefore;insist(advanced,'push_dev_unknown');if(replay===2)throw new Error('diverged');await patch(repo.name,r=>{r.targetHead=null;r.checksPassed=false})}
    }
    insist(done&&refresh().checksPassed&&refresh().checksHead===refresh().targetHead&&refresh().checksTree===checked(dir,['rev-parse',`${refresh().targetHead}^{tree}`]),'dev_unverified')
    await ownedTarget()
    if(remoteTask()!==target.sourceHead){try{await g('push-task',source,['push','origin',`${target.sourceHead}:refs/heads/${target.taskBranch}`])}catch{} }
    await operation('verify-task',()=>{insist(remoteTask()===target.sourceHead,'push_task_unknown')},r=>{r.taskPushed=true;r.status='done';r.s1CompletedAt??=new Date(now()).toISOString()})
   })
  }
  if(config.ship?.mode==='dev_and_pr'){
   const delivered=inspectShip(root,config,cardId);insist(delivered.s1Complete,'s1_incomplete')
   for(const target of c.targets){
    const row=readShipState(root,cardId).runs.find(r=>r.key===key).repos[target.repo];if(row.noChange)continue
    const repo=config.repos.find(r=>r.name===target.repo),source=repoDir(root,config.workspace.worktrees_dir,path.basename(c.cardDir),repo)
    const repoIdentity=normalizeRepoIdentity(JSON.parse(target.origin).fetch[0])
    let ghAuth;try{ghAuth=await (github?.runGh??defaultRunGh)(['auth','status'],root)}catch{ghAuth={status:1}}
    const preflight=preflightStage(root,config,{stage:'ship',mode:'S2',runCommand:(command,args,options)=>command==='gh'?ghAuth:(preflightRunCommand??((cmd,argv,opts)=>spawnSync(cmd,argv,{...opts,encoding:'utf8'})))(command,args,options)})
    if(!preflight.ok){await patch(repo.name,r=>{r.s2Status='blocked:gh'});continue}
    const client=new GitHubPrClient({runGh:github?.runGh,beforeMutation:async()=>{auth();await patch(repo.name,r=>{r.steps.push({name:'pr-mutation',status:'intent',at:new Date(now()).toISOString()})});auth()},afterMutation:async error=>{auth();await patch(repo.name,r=>{r.steps.at(-1).status=error?'unknown':'done'})}})
    const file=path.join(root,'.ff/ship',`${cardId}-${hash(repo.name).slice(0,8)}-pr.md`)
    writeShipPrBody({cardDir:c.cardDir,revision:c.revision,cardId,file})
    const destination=hash(JSON.stringify([canonical(JSON.parse(target.origin).fetch[0],source),target.shipBranch]))
    await destinationMutex(path.join(os.tmpdir(),`ff-ship-locks-${process.getuid?.()??'user'}`,destination+'.lock'),{operation:'ship-pr',destination},async()=>{
    auth()
    try{const pr=await client.ensurePullRequest({cwd:source,repoIdentity,taskBranch:target.taskBranch,baseBranch:target.baseBranch,sourceHead:target.sourceHead,title:`${path.basename(c.cardDir)} (#${cardId})`,bodyFile:file,revision:c.revision,cardId});auth();await patch(repo.name,r=>{r.pr=pr;r.s2Status='done'})}
    catch(error){await patch(repo.name,r=>{r.s2Status='blocked:'+(/^(pr_|gh)/.test(error.message)?error.message:'scope_changed')});if(error.message==='scope_changed')throw error}
    })
   }
  }

 }catch(e){if(key){await updateShipState(root,cardId,s=>{const run=s.runs.find(r=>r.key===key);if(run){run.blockedReason=/^(?:conflict|checks|scope_changed|owned_checkout_mismatch|diverged|push_dev_unknown|push_task_unknown|unproven_already_shipped|squash)$/.test(e.message)?e.message:'preconditions_or_unknown';for(const r of Object.values(run.repos))if(r.status!=='done')r.status='blocked:'+run.blockedReason}return s})}const view=await inspectPrShip(root,config,cardId,{github});if(view.complete)return view;view.blockedReason=readShipState(root,cardId)?.runs.find(r=>r.key===key)?.blockedReason??'setup:ship_preconditions';return view}
 return inspectPrShip(root,config,cardId,{github})
}

/** Async trusted S1 + live GitHub observation, for runtime polling. */
export async function inspectPrShip(root,config,cardId,{github}={}){
 const view=inspectShip(root,config,cardId);if(view.mode!=='dev_and_pr'||!view.s1Complete)return view
 const scope=sourceContext(root,config,String(cardId).split('-')[0]),targets=captureShipTargets(root,config,view.cardId),run=readShipState(root,view.cardId)?.runs.find(r=>r.key===runKey({...scope,targets}))
 const client=new GitHubPrClient({runGh:github?.runGh})
 for(const row of view.repos){
  if(!row.requiresPr){row.s2Complete=true;continue}
  const saved=run?.repos[row.repo],repo=config.repos.find(r=>r.name===row.repo)
  try{insist(saved?.pr?.number,'pr_missing');row.pr=await client.inspectPullRequest({cwd:repoDir(root,config.workspace.worktrees_dir,path.basename(scope.cardDir),repo),repoIdentity:normalizeRepoIdentity(JSON.parse(saved.origin).fetch[0]),number:saved.pr.number,approvedSourceHead:row.approvedSourceHead,taskBranch:row.taskBranch,baseBranch:repo.base_branch});row.s2Complete=true}catch(error){row.s2Complete=false;row.s2Status=error.message==='pr_closed'?'blocked:pr_closed':saved?.s2Status??'blocked:gh'}
 }
 const current=inspectShip(root,config,cardId);if(!current.s1Complete||current.revision!==view.revision||current.sourceIdentity!==view.sourceIdentity||JSON.stringify(current.heads)!==JSON.stringify(view.heads))return current
 view.s2Complete=view.repos.every(r=>r.s2Complete);view.complete=view.s1Complete&&view.s2Complete
 view.allPrsMerged=view.s2Complete&&view.repos.filter(r=>r.requiresPr).every(r=>r.pr?.merged&&r.pr.headAtMerge===r.approvedSourceHead)
 return view
}

/** Build the PR body from the same active report scope validated by Gate C. */
export function writeShipPrBody({cardDir,revision,cardId,file}){
 const report=fs.readFileSync(path.join(cardDir,revision||'','05-verify-report.md'),'utf8')
 fs.writeFileSync(file,report+`\nTrello: #${cardId}\n`,{mode:0o600})
}

/**
 * Verify-on-ship-branch: build local `ff-test/<cardId>` from origin/<ship_branch> + the feature squash commit,
 * in a checkout owned by ship (per-destination mutex). Always rebuilt from a clean state; a conflict
 * leaves no record (needs_human) and is never resolved automatically. Nothing here pushes.
 */
export async function prepareShipTest({root,config,cardId,runGit=defaultRunGit,now=Date.now,mutex=destinationMutex}){
 cardId=String(cardId).split('-')[0]
 const c=sourceContext(root,config,cardId),targets=captureShipTargets(root,config,cardId),file=path.join(root,shipTestRel(cardId,c.revision)),repos={}
 const slug=path.basename(c.cardDir),worktreesDir=config.workspace.worktrees_dir
 fs.rmSync(file,{force:true}) // an old record never survives a new attempt
 const run=(cwd,args)=>{const r=runGit(cwd,args);insist(r?.status===0,`git:${args[0]}`);return r.stdout?.trim()??''}
 // env_files come from the base workspace repo (fallback: the card copy) so the test checkout can start services.
 const copyEnv=(repo,dir,fallback)=>{for(const rel of repo.env_files??[]){if(typeof rel!=='string'||path.isAbsolute(rel)||rel.split(/[\\/]/).includes('..'))continue;const dest=path.resolve(dir,rel);const src=[path.resolve(root,repo.path,rel),fallback&&path.resolve(fallback,rel)].filter(Boolean).find(f=>fs.existsSync(f)&&fs.realpathSync(f)===f);if(!src)continue;fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});fs.copyFileSync(src,dest);fs.chmodSync(dest,0o600)}}
 /** Clone (once) and hard-reset `dir` to origin/<shipBranch>; always a clean rebuild. */
 const baseCheckout=({dir,cloneFrom,origin,shipBranch,branch})=>{
  if(!fs.existsSync(path.join(dir,'.git'))){insist(!fs.existsSync(dir)||!fs.readdirSync(dir).length,'checkout_unknown');fs.mkdirSync(path.dirname(dir),{recursive:true,mode:0o700});run(root,['clone','--no-hardlinks','--no-checkout',cloneFrom,dir])}
  run(dir,['remote','set-url','origin',origin])
  defaultRunGit(dir,['cherry-pick','--abort'])
  run(dir,['fetch','--no-tags','origin',`+refs/heads/${shipBranch}:refs/remotes/origin/${shipBranch}`])
  const base=run(dir,['rev-parse',`refs/remotes/origin/${shipBranch}`])
  run(dir,['checkout','-f','-B',branch,base]);run(dir,['reset','--hard',base]);run(dir,['clean','-fd'])
  return base
 }
 const branch=`ff-test/${cardId}`
 for(const target of targets){
  const repo=config.repos.find(r=>r.name===target.repo),source=repoDir(root,worktreesDir,slug,repo),origin=JSON.parse(target.origin).fetch[0]
  insist(!checked(source,['status','--porcelain']),'dirty');insist(cardBranch(path.join(c.cardDir,'01-dossier.md'))===target.taskBranch,'task_branch')
  insist(target.shipBranch!==repo.base_branch&&target.taskBranch!==repo.base_branch,'protected_branch')
  const destination=hash(JSON.stringify([canonical(origin,source),target.shipBranch])),lock=path.join(os.tmpdir(),`ff-ship-locks-${process.getuid?.()??'user'}`,destination+'.lock')
  const outcome=await mutex(lock,{operation:'ship-test',destination},async()=>{
   // One squash commit is required before the first push; later revisions carry one new commit over the pushed base.
   const range=getTaskCommitRange({root,config,cardDir:c.cardDir,repo,repoPath:source})
   const dir=testRepoDir(root,worktreesDir,slug,repo)
   if(!range.commits.length){ // nothing new to test or ship: the checkout is plain origin/<ship_branch>
    const base=baseCheckout({dir,cloneFrom:source,origin,shipBranch:target.shipBranch,branch});copyEnv(repo,dir,source)
    repos[repo.name]={featureSha:target.sourceHead,noChange:true,shipBranch:target.shipBranch,baseSha:base,testSha:base,testBranch:branch,checkout:dir};return {ok:true}
   }
   insist(range.commits.length===1&&range.commits[0]===target.sourceHead,'squash')
   const sha=target.sourceHead
   const base=baseCheckout({dir,cloneFrom:source,origin,shipBranch:target.shipBranch,branch})
   run(dir,['fetch','--no-tags',source,`+refs/heads/${target.taskBranch}:refs/ff-feature/${cardId}`]);insist(run(dir,['rev-parse',`refs/ff-feature/${cardId}`])===sha,'source_changed')
   run(dir,['config','user.name',run(source,['show','-s','--format=%an',sha])]);run(dir,['config','user.email',run(source,['show','-s','--format=%ae',sha])])
   const pick=runGit(dir,['cherry-pick','-x',sha])
   if(pick?.status!==0){const files=defaultRunGit(dir,['diff','--name-only','--diff-filter=U']).stdout.split('\n').filter(Boolean);defaultRunGit(dir,['cherry-pick','--abort']);defaultRunGit(dir,['reset','--hard',base]);return {ok:false,reason:'conflict',repo:repo.name,files}}
   copyEnv(repo,dir,source)
   repos[repo.name]={featureSha:sha,shipBranch:target.shipBranch,baseSha:base,testSha:run(dir,['rev-parse','HEAD']),testBranch:branch,checkout:dir}
   return {ok:true}
  })
  if(!outcome.ok)return outcome
 }
 // Repos without a card copy are unchanged: same layout, plain origin/<ship_branch>.
 for(const repo of config.repos){
  if(repos[repo.name])continue
  const mirror=path.resolve(root,repo.path),shipBranch=repo.ship_branch??repo.base_branch,dir=testRepoDir(root,worktreesDir,slug,repo)
  const originUrl=defaultRunGit(mirror,['remote','get-url','origin']),origin0=originUrl.status===0&&originUrl.stdout.trim()?originUrl.stdout.trim().split('\n')[0]:mirror
  const origin=!path.isAbsolute(origin0)&&!/^[^/]+:/.test(origin0)?path.resolve(mirror,origin0):origin0
  const destination=hash(JSON.stringify([canonical(origin,mirror),shipBranch])),lock=path.join(os.tmpdir(),`ff-ship-locks-${process.getuid?.()??'user'}`,destination+'.lock')
  await mutex(lock,{operation:'ship-test',destination},async()=>{
   const base=baseCheckout({dir,cloneFrom:mirror,origin,shipBranch,branch});copyEnv(repo,dir,null)
   repos[repo.name]={unchanged:true,shipBranch,baseSha:base,testSha:base,testBranch:branch,checkout:dir}
   return {ok:true}
  })
 }
 const record={version:1,cardId,revision:c.revision,createdAt:new Date(now()).toISOString(),repos}
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,JSON.stringify(record,null,2)+'\n',{mode:0o600})
 return {ok:true,record,recordPath:shipTestRel(cardId,c.revision)}
}
