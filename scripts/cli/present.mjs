import fs from 'node:fs'
import path from 'node:path'
import { findRoot,loadConfig } from '../lib/config.mjs'
import { findCardDir } from '../lib/cards.mjs'
import { activeRevision } from '../lib/gates.mjs'
import { preparePresentation,savePresentation,renderPresentation,presentationEvent } from '../lib/human-output.mjs'
import { notify } from '../lib/notify.mjs'
export const summary='present <id> --file <activeDir>/human-output.json [--gate GATE_A|GATE_B|GATE_C] — tổng hợp cho human, channel một chiều'
export async function run(args,ctx){try{
 const id=args[0],root=findRoot(ctx.cwd);if(!root||!id)throw new Error('dùng: ff '+summary)
 const opts={};for(let i=1;i<args.length;i++){if(!['--file','--gate'].includes(args[i])||!args[i+1])throw new Error('tham số present không hợp lệ');opts[args[i].slice(2)]=args[++i]}
 if(!opts.file)throw new Error('thiếu --file')
 const {config}=loadConfig(root),card=findCardDir(root,config,id);if(card.error)throw new Error(card.error)
 const revision=activeRevision(card.dir),current=fs.realpathSync(path.join(card.dir,revision??'')),file=fs.realpathSync(path.resolve(root,opts.file))
 if(!file.startsWith(current+path.sep)||!/^human-output(?:-[A-Za-z0-9-]+)?\.json$/.test(path.basename(file)))throw new Error('file tổng hợp phải là human-output*.json trong activeDir hiện tại')
 const packet=preparePresentation(root,config,id,JSON.parse(fs.readFileSync(file,'utf8')),{gate:opts.gate})
 const event=presentationEvent(packet);if(Buffer.byteLength(JSON.stringify(event))>60*1024)throw new Error('notification quá lớn; rút gọn tổng hợp')
 savePresentation(root,packet);ctx.stdout.write(renderPresentation(packet)+'\n')
 const delivery=await notify(root,event,{log:()=>{}});ctx.stderr.write(`[ff present] channel: ${delivery.status??(delivery.delivered?'delivered':'not_sent')}\n`);return 0
 }catch(e){ctx.stderr.write(`ff present: ${e.message}\n`);return 2}}
