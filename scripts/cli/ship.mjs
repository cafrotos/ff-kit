import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {findRoot,loadConfig} from '../lib/config.mjs'
import {findCardDir} from '../lib/cards.mjs'
import {runShip,shipBlockers} from '../lib/ship.mjs'
import {notify,makeEvent} from '../lib/notify.mjs'
import {activeRevision,ledgerFor} from '../lib/gates.mjs'
import {shipApprovalPath} from '../lib/ship-approval.mjs'
import {decideSourced} from '../lib/trace.mjs'
import {beginStage,finishStage,stageContext,readStageReceipt} from '../lib/stage-receipts.mjs'
export const summary='ship <id> — recoverable dev and task branch delivery'
const hash=x=>createHash('sha256').update(x).digest('hex')
// Ship tự động (approval.auto): báo kênh một lần cho mỗi bộ commit dev. Best-effort, không bao giờ làm hỏng ship.
async function notifyAutoShip(root,card,cardId,view,ctx){
 try{
  const approval=JSON.parse(fs.readFileSync(shipApprovalPath(root,cardId),'utf8'));if(approval?.auto!==true)return
  const sig=JSON.stringify(view.devHashes??{}),sent=path.join(root,'.ff','ship-approvals',`${cardId}.notified`)
  if(fs.existsSync(sent)&&fs.readFileSync(sent,'utf8')===sig)return
  const ledger=ledgerFor(card.dir,activeRevision(card.dir)??''),decided=ledger?decideSourced(ledger):[]
  const branches=[...new Set((view.repos??[]).map(r=>r.shipBranch))].join(', ')
  const fields={'AC miễn (hạ tầng ngoài)':(approval.binding?.exemptAcs??[]).join(', ')||'không','D-xx nguồn decide':decided.join(', ')||'không','Commit dev':Object.entries(view.devHashes??{}).map(([r,h])=>`${r}@${h.slice(0,8)}`).join(', ')||'không'}
  await notify(root,makeEvent({kind:'info',taskId:cardId,title:`Đã tự ship #${cardId} lên ${branches}`,fields}),{log:s=>ctx.stderr.write(s)})
  fs.writeFileSync(sent,sig)
 }catch{}
}
export async function run(args,ctx){
 if(args.length!==1||!/^[A-Za-z0-9]+(?:-[A-Za-z0-9-]+)?$/.test(args[0])){ctx.stderr.write('Usage: ff ship <id>\n');return 2}
 const root=findRoot(ctx.cwd);if(!root){ctx.stderr.write('ff ship: no ff.config.yaml\n');return 4}
 let config;try{config=loadConfig(root).config}catch{ctx.stderr.write('ff ship: invalid configuration\n');return 4}
 const card=findCardDir(root,config,args[0]);if(card.error){ctx.stderr.write('ff ship: card not found\n');return 2}
 const cardId=path.basename(card.dir).split('-')[0]
 try{
  const context=stageContext(root,config,cardId)
  if(context.enabled&&context.pendingDispatch){if(context.stage!=='ship')throw new Error('pending stage is not ship');await beginStage(root,config,{cardId,dispatchId:context.dispatchId})}
  const view=await runShip({root,config,cardId,runGit:ctx.runGit,runCommand:ctx.runCommand,now:ctx.now,github:ctx.github,preflightRunCommand:ctx.preflightRunCommand})
  if(view.complete&&context.enabled&&context.pendingDispatch){
   const verify=readStageReceipt(root,cardId,'verify',context.revision),base=`.ff/harness/evidence/${cardId}/${context.revision||'root'}/${hash(context.dispatchId)}`
   fs.mkdirSync(path.join(root,base),{recursive:true,mode:0o700})
   const resultPath=`${base}/ship-result.json`,result=JSON.stringify(view)+'\n';fs.writeFileSync(path.join(root,resultPath),result,{mode:0o600})
   const evidence={...verify,cardId,revision:context.revision,runId:context.runId,dispatchId:context.dispatchId,artifactHashes:{...verify.artifactHashes,[resultPath]:hash(result)}}
   const evidenceFile=`${base}/ship-input.json`;fs.writeFileSync(path.join(root,evidenceFile),JSON.stringify(evidence)+'\n',{mode:0o600})
   await finishStage(root,config,{cardId,dispatchId:context.dispatchId,outcome:'pass',evidenceFile})
  }
  if(view.complete)await notifyAutoShip(root,card,cardId,view,ctx)
  ctx.stdout.write(JSON.stringify(view,null,2)+'\n')
  if(!view.complete&&view.blockers?.length)ctx.stderr.write(`ff ship: chưa ship được, còn thiếu:\n${view.blockers.map(b=>`  - [${b.code}] ${b.fix}`).join('\n')}\n`)
  return view.complete?0:1
 }catch(e){
  const {blockers}=shipBlockers(root,config,cardId,ctx.now??Date.now)
  ctx.stderr.write(`ff ship: bị chặn${blockers.length?', còn thiếu:\n'+blockers.map(b=>`  - [${b.code}] ${b.fix}`).join('\n'):` (${e.message}); chạy \`ff stage context ${cardId}\` xem pha đang chờ`}\n`);return 1
 }
}
