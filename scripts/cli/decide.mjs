import {findRoot,loadConfig} from '../lib/config.mjs'
import {decideForTask,shadowReport} from '../lib/knowledge.mjs'
import {describeGateAState} from '../lib/gate-a-auto.mjs'
import {contradictShadow} from '../lib/knowledge-log.mjs'
export const summary='decide <id> — tư vấn quyết định mềm có phạm vi (chế độ bóng); --stats [--json] độ khớp theo lớp/repo (bảng tiếng Việt, --json cho máy); --contradict khi người đảo quyết định tự động'
export function statsTable(rep) {
 const head=`Độ khớp chế độ bóng (cửa sổ ${rep.window} lần gần nhất, tin khi ≥ ${rep.minMatch} khớp)`
 const gate=rep.gateA?.length?['Gate A tự duyệt (gate_a_auto):',...rep.gateA.map(g=>`- repo ${g.repo||'(gốc)'}: ${describeGateAState(g)}`)].join('\n'):''
 if(!rep.classes.length)return head+'\nChưa có lớp nào được ghi nhận.'+(gate?'\n'+gate:'')
 const rows=[['Lớp','Repo','Dự đoán','Khớp','Lệch','Không biết','Cửa sổ','Tự quyết','Tin?'],...rep.classes.map(c=>[c.class,c.repo||'-',c.predictions,c.matches,c.mismatches,c.abstains,`${c.windowMatches??0}/${c.windowSize??0}`,c.autoDecisions,c.trusted?'có (tự quyết)':'chưa (vẫn hỏi)'])].map(r=>r.map(String))
 const w=rows[0].map((_,i)=>Math.max(...rows.map(r=>[...r[i]].length)))
 return [head,...rows.map(r=>r.map((c,i)=>c+' '.repeat(w[i]-[...c].length)).join('  ').trimEnd()),...(gate?[gate]:[])].join('\n')
}
export async function run(args,ctx) {
 try {
  const request={},pos=[]
  const names={'--class':'class','--decision-key':'decisionKey','--repo':'repo','--question':'question','--options':'options','--gate':'gate','--reason':'reason'}
  let stats=false,contradict=false,json=false
  for(let i=0;i<args.length;i++){
   if(args[i]==='--stats'){stats=true;continue}
   if(args[i]==='--contradict'){contradict=true;continue}
   if(args[i]==='--json'){json=true;continue}
   if(args[i].startsWith('--')){const key=names[args[i]];if(!key||request[key]!==undefined||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Invalid decide arguments');request[key]=args[++i]}
   else pos.push(args[i])
  }
  const root=findRoot(ctx.cwd);if(!root)throw new Error('No ff.config.yaml')
  const {config}=loadConfig(root)
  if(stats){
   if(pos.length||contradict||request.gate||request.question||request.options||request.decisionKey)throw new Error('Usage: ff decide --stats [--class <class>] [--repo <repo>]')
   const rep=shadowReport(root,config,request)
   ctx.stdout.write(json?JSON.stringify(rep)+'\n':statsTable(rep)+'\n');return 0
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
