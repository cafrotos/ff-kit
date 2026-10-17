import path from 'node:path'
import {findRoot,loadConfig} from '../lib/config.mjs'
import {findCardDir} from '../lib/cards.mjs'
import {prepareShipTest} from '../lib/ship.mjs'
export const summary='ship-test <id> — dựng nhánh ff-test/<id> từ origin/<ship_branch> + commit squash để verify'
export async function run(args,ctx){
 if(args.length!==1||!/^[A-Za-z0-9]+(?:-[A-Za-z0-9-]+)?$/.test(args[0])){ctx.stderr.write('dùng: ff ship-test <id>\n');return 2}
 const root=findRoot(ctx.cwd);if(!root){ctx.stderr.write('ff ship-test: không thấy ff.config.yaml\n');return 4}
 let config;try{config=loadConfig(root).config}catch{ctx.stderr.write('ff ship-test: cấu hình không hợp lệ\n');return 4}
 const card=findCardDir(root,config,args[0]);if(card.error){ctx.stderr.write('ff ship-test: không thấy thẻ\n');return 2}
 try{
  const r=await prepareShipTest({root,config,cardId:path.basename(card.dir).split('-')[0],runGit:ctx.runGit,now:ctx.now})
  if(!r.ok){ctx.stderr.write(`ff ship-test: conflict ở ${r.repo} (${r.files.join(', ')||'không rõ file'}); không tự giải quyết, kết thúc pha verify bằng needs_human\n`);return 1}
  ctx.stdout.write(JSON.stringify({ok:true,recordPath:r.recordPath,repos:Object.fromEntries(Object.entries(r.record.repos).map(([k,v])=>[k,{checkout:v.checkout,featureSha:v.featureSha,baseSha:v.baseSha,testSha:v.testSha}]))},null,2)+'\n');return 0
 }catch(e){ctx.stderr.write(`ff ship-test: bị chặn (${e.message})\n`);return 1}
}
