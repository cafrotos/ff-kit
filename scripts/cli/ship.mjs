import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {findRoot,loadConfig} from '../lib/config.mjs'
import {findCardDir} from '../lib/cards.mjs'
import {runShip} from '../lib/ship.mjs'
import {beginStage,finishStage,stageContext,readStageReceipt} from '../lib/stage-receipts.mjs'
export const summary='ship <id> — recoverable dev and task branch delivery'
const hash=x=>createHash('sha256').update(x).digest('hex')
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
  ctx.stdout.write(JSON.stringify(view,null,2)+'\n');return view.complete?0:1
 }catch{ctx.stderr.write('ff ship: blocked by dispatch or current evidence\n');return 1}
}
