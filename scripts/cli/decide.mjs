import {findRoot,loadConfig} from '../lib/config.mjs'
import {decideForTask} from '../lib/knowledge.mjs'
export const summary='decide <id> — scoped soft decision advice'
export async function run(args,ctx) {
 try {
  const request={},pos=[]
  const names={'--class':'class','--decision-key':'decisionKey','--repo':'repo','--question':'question','--options':'options','--gate':'gate'}
  for(let i=0;i<args.length;i++){
   if(args[i].startsWith('--')){const key=names[args[i]];if(!key||request[key]!==undefined||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Invalid decide arguments');request[key]=args[++i]}
   else pos.push(args[i])
  }
  if(pos.length!==1||! /^[A-Za-z0-9]+$/.test(pos[0]))throw new Error('Usage: ff decide <id> --class <class> --decision-key <key> --repo <repo> --question <text> [--options "a|b|c"]')
  request.cardId=pos[0]
  if(request.gate){if(!['GATE_A','GATE_C','SHIP'].includes(request.gate))throw new Error('Invalid gate')}
  else if(!['class','decisionKey','repo','question'].every(k=>request[k]))throw new Error('Missing decide arguments')
  if(request.options)request.options=request.options.split('|')
  const root=findRoot(ctx.cwd);if(!root)throw new Error('No ff.config.yaml')
  const {config}=loadConfig(root)
  ctx.stdout.write(JSON.stringify(await decideForTask(root,config,request))+'\n');return 0
 }catch(e){ctx.stderr.write(`ff decide: ${e.message}\n`);return 1}
}
