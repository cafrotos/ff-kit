// Human ship decisions authorize an immutable packet, never an agent boolean.
import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {findCardDir} from './cards.mjs'
import {activeRevision} from './gates.mjs'
import {readPresentation} from './human-output.mjs'
import {readQuestionHistory} from './question-history.mjs'
import {autoBinding,validateAutoBinding} from './auto-ship.mjs'

function card(root,config,id){const c=findCardDir(root,config,String(id));if(c.error)throw new Error(c.error);return c.dir}
function git(dir,args){const r=spawnSync('git',args,{cwd:dir,encoding:'utf8',timeout:5000});if(r.status!==0)throw new Error(`ship target git ${args[0]} failed`);return r.stdout.trim()}
export function captureShipTargets(root,config,cardId){
 const dir=card(root,config,cardId),wt=path.resolve(root,config.workspace.worktrees_dir,path.basename(dir)),targets=[]
 for(const repo of config.repos){
  const copy=path.join(wt,path.basename(repo.path));if(!fs.existsSync(path.join(copy,'.git')))continue
  const real=fs.realpathSync(copy),base=fs.realpathSync(wt)
  if(!real.startsWith(base+path.sep))throw new Error('ship target outside workspace')
  const local=spawnSync('git',['config','--bool','ff.localOnly'],{cwd:copy,encoding:'utf8'})
  if(local.stdout?.trim()==='true')throw new Error('local-only copy cannot ship')
  const sourceHead=git(copy,['rev-parse','HEAD']),taskBranch=git(copy,['symbolic-ref','--short','HEAD'])
  const shipBranch=repo.ship_branch
  if(!shipBranch||shipBranch===taskBranch)throw new Error('invalid ship branch')
  git(copy,['check-ref-format',`refs/heads/${shipBranch}`])
  const origin=JSON.stringify({fetch:git(copy,['remote','get-url','--all','origin']).split('\n'),push:git(copy,['remote','get-url','--push','--all','origin']).split('\n')})
  targets.push({repo:repo.name,sourceHead,origin,shipBranch,taskBranch,baseBranch:repo.base_branch})
 }
 if(!targets.length)throw new Error('no ship targets')
 return targets
}
export function shipApprovalPath(root,cardId){if(!/^[A-Za-z0-9]+$/.test(String(cardId)))throw new Error('invalid cardId');return path.join(root,'.ff','ship-approvals',`${cardId}.json`)}
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});if(fs.lstatSync(path.dirname(file)).isSymbolicLink()||!fs.realpathSync(path.dirname(file)).startsWith(fs.realpathSync(path.resolve(file,'../../..'))+path.sep))throw new Error('unsafe approval path');const tmp=`${file}.${randomUUID()}.tmp`;try{fs.writeFileSync(tmp,JSON.stringify(value)+'\n',{mode:0o600,flag:'wx'});const fd=fs.openSync(tmp,'r');try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(tmp,file);const parent=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(parent)}finally{fs.closeSync(parent)}}finally{fs.rmSync(tmp,{force:true})}}
export function shipQuestion(packet){const d=packet.decisions.find(x=>x.id==='Q1');return d?`[#${packet.taskId}]${packet.revision?` [${packet.revision}]`:''} ${d.question}`:null}
function decisionFor(root,config,cardId,questionId){
 const packet=readPresentation(root,config,cardId,{phase:'ship'})
 if(packet?.purpose==='acceptance')throw new Error('acceptance is not ship approval')
 if(!packet?.targets)throw new Error('current bound ship packet required')
 const q=readQuestionHistory(root,String(cardId)).find(q=>q.questionId===questionId)
 const d=q?.decision
 const decisions=fs.existsSync(path.join(root,'.ff','decisions.jsonl'))?fs.readFileSync(path.join(root,'.ff','decisions.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[]
 const durable=decisions.find(x=>x.questionId===questionId)
 const expected=packet.decisions.find(x=>x.id==='Q1')
 if(!q||q.status!=='answered'||q.header!=='Q1'||q.revision!==(packet.revision??'')||q.presentationId!==packet.presentationId||!d||!durable||JSON.stringify(durable)!==JSON.stringify(d)||d.provenance?.source!=='cli'||d.provenance.claudeSessionId!==q.claudeSessionId||d.provenance.toolUseId!==q.toolUseId||d.normalizedValue!=='duyệt'||d.answer!=='Duyệt'||!expected||q.snapshot.question!==shipQuestion(packet)||q.snapshot.multiSelect||JSON.stringify(q.snapshot.options)!==JSON.stringify(expected.options))throw new Error('captured human ship Q1 approval required')
 return {packet,decision:d}
}
export function createShipApproval(root,config,{cardId,questionId,now=Date.now()}){
 const {packet,decision}=decisionFor(root,config,String(cardId),questionId)
 const answered=Date.parse(decision.answeredAt)
 if(!Number.isFinite(now)||!Number.isFinite(answered)||answered>now||now-answered>7200000)throw new Error('ship decision time invalid or expired')
 const targets=captureShipTargets(root,config,cardId)
 if(JSON.stringify(targets)!==JSON.stringify(packet.targets))throw new Error('ship targets changed; present and ask again')
 const file=shipApprovalPath(root,cardId)
 let previous;try{previous=JSON.parse(fs.readFileSync(file,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
 if(previous?.questionId===questionId){if(!validateShipApproval(root,config,previous,targets,now).valid)throw new Error('ship approval stale');return previous}
 const receipt={version:1,cardId:String(cardId),revision:packet.revision??'',questionId,presentationId:packet.presentationId,issuedAt:answered,expiresAt:answered+7200000,targets}
 atomic(file,receipt);return receipt
}
/** Auto variant (N6): bound to the auto_passed Gate C receipt, each repo HEAD and ship branch instead of a human Q1 answer. */
export function createAutoShipApproval(root,config,{cardId,now=Date.now()}){
 const binding=autoBinding(root,config,String(cardId)),targets=captureShipTargets(root,config,cardId)
 const receipt={version:2,auto:true,cardId:String(cardId),revision:binding.revision,binding,issuedAt:now,expiresAt:now+7200000,targets}
 atomic(shipApprovalPath(root,cardId),receipt);return receipt
}
/** Legacy worker / manual card (driver off): no captured Q1 exists, so the human act is the guard-asked `ff ship-approve`. Bound to revision, HEADs and destinations. */
export function createLegacyShipApproval(root,config,{cardId,now=Date.now()}){
 if(config.worker?.driver?.enabled===true)throw new Error('driver bật: cần --question-id')
 const dir=card(root,config,String(cardId)),targets=captureShipTargets(root,config,cardId)
 const receipt={version:3,legacy:true,cardId:String(cardId),revision:activeRevision(dir)??'',issuedAt:now,expiresAt:now+7200000,targets}
 atomic(shipApprovalPath(root,cardId),receipt);return receipt
}
export function validateShipApproval(root,config,approval,targets,now=Date.now()){
 const reasons=[]
 try{
  if(approval?.version===2){
   if(approval.auto!==true||approval.binding?.auto!==true||approval.binding.cardId!==approval.cardId)throw new Error('invalid auto receipt')
   if(approval.revision!==(activeRevision(card(root,config,approval.cardId))??'')||approval.binding.revision!==approval.revision)throw new Error('revision changed')
   if(!Number.isFinite(now)||!Number.isFinite(approval.issuedAt)||approval.issuedAt>now||approval.expiresAt!==approval.issuedAt+7200000||now>approval.expiresAt)throw new Error('approval expired or future time')
   const b=validateAutoBinding(root,config,approval.binding);if(!b.valid)throw new Error(b.reasons[0])
   if(JSON.stringify(approval.targets)!==JSON.stringify(targets)||JSON.stringify(captureShipTargets(root,config,approval.cardId))!==JSON.stringify(targets))throw new Error('ship targets changed')
   return {valid:true,reasons:[]}
  }
  if(approval?.version===3){
   if(approval.legacy!==true||config.worker?.driver?.enabled===true)throw new Error('legacy receipt not allowed with driver')
   if(approval.revision!==(activeRevision(card(root,config,approval.cardId))??''))throw new Error('revision changed')
   if(!Number.isFinite(now)||!Number.isFinite(approval.issuedAt)||approval.issuedAt>now||approval.expiresAt!==approval.issuedAt+7200000||now>approval.expiresAt)throw new Error('approval expired or future time')
   if(JSON.stringify(approval.targets)!==JSON.stringify(targets)||JSON.stringify(captureShipTargets(root,config,approval.cardId))!==JSON.stringify(targets))throw new Error('ship targets changed')
   return {valid:true,reasons:[]}
  }
  if(approval?.version!==1)throw new Error('invalid receipt version')
  const dir=card(root,config,approval.cardId)
  if(approval.revision!==(activeRevision(dir)??''))throw new Error('revision changed')
  if(!Number.isFinite(now)||!Number.isFinite(approval.issuedAt)||approval.issuedAt>now||approval.expiresAt!==approval.issuedAt+7200000||now>approval.expiresAt)throw new Error('approval expired or future time')
  const {packet,decision}=decisionFor(root,config,approval.cardId,approval.questionId)
  if(approval.presentationId!==packet.presentationId||approval.issuedAt!==Date.parse(decision.answeredAt))throw new Error('approval identity changed')
  if(JSON.stringify(approval.targets)!==JSON.stringify(targets)||JSON.stringify(packet.targets)!==JSON.stringify(targets)||JSON.stringify(captureShipTargets(root,config,approval.cardId))!==JSON.stringify(targets))throw new Error('ship targets changed')
 }catch(e){reasons.push(e.message)}
 return {valid:reasons.length===0,reasons}
}
