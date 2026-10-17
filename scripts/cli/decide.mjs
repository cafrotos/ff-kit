import {findRoot,loadConfig} from '../lib/config.mjs'
import {decideForTask,shadowReport} from '../lib/knowledge.mjs'
import {contradictShadow} from '../lib/knowledge-log.mjs'
export const summary='decide <id> — tư vấn quyết định mềm có phạm vi (chế độ bóng); --stats độ khớp theo lớp/repo; --contradict khi người đảo quyết định tự động'
export async function run(args,ctx) {
 try {
  const request={},pos=[]
  const names={'--class':'class','--decision-key':'decisionKey','--repo':'repo','--question':'question','--options':'options','--gate':'gate','--reason':'reason'}
  let stats=false,contradict=false
  for(let i=0;i<args.length;i++){
   if(args[i]==='--stats'){stats=true;continue}
   if(args[i]==='--contradict'){contradict=true;continue}
   if(args[i].startsWith('--')){const key=names[args[i]];if(!key||request[key]!==undefined||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Invalid decide arguments');request[key]=args[++i]}
   else pos.push(args[i])
  }
  const root=findRoot(ctx.cwd);if(!root)throw new Error('No ff.config.yaml')
  const {config}=loadConfig(root)
  if(stats){
   if(pos.length||contradict||request.gate||request.question||request.options||request.decisionKey)throw new Error('Usage: ff decide --stats [--class <class>] [--repo <repo>]')
   ctx.stdout.write(JSON.stringify(shadowReport(root,config,request))+'\n');return 0
  }
  if(contradict){
   if(!request.class||request.repo===undefined||pos.length>1)throw new Error('Usage: ff decide --contradict [<id>] --class <class> --repo <repo> [--decision-key <key>] [--reason <text>]')
   const r=await contradictShadow(root,{class:request.class,repo:request.repo,decisionKey:request.decisionKey,cardId:pos[0],reason:request.reason})
   ctx.stdout.write(JSON.stringify({reset:true,class:request.class,repo:request.repo,...r})+'\n');return 0
  }
  if(pos.length!==1||! /^[A-Za-z0-9]+$/.test(pos[0]))throw new Error('Usage: ff decide <id> --class <class> --decision-key <key> --repo <repo> --question <text> [--options "a|b|c"]')
  request.cardId=pos[0]
  if(request.gate){if(!['GATE_A','GATE_C','SHIP'].includes(request.gate))throw new Error('Invalid gate')}
  else if(!['class','decisionKey','repo','question'].every(k=>request[k]))throw new Error('Missing decide arguments')
  if(request.options)request.options=request.options.split('|')
  ctx.stdout.write(JSON.stringify(await decideForTask(root,config,request))+'\n');return 0
 }catch(e){ctx.stderr.write(`ff decide: ${e.message}\n`);return 1}
}
