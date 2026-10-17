import fs from 'node:fs'
import path from 'node:path'
import { findRoot,loadConfig } from '../lib/config.mjs'
import { workerRequest } from '../lib/worker-client.mjs'
import { readPresentation,renderPresentation,presentationEvent } from '../lib/human-output.mjs'

export const summary = 'ship-request --task <id> --title <text> [--body <text>] — gửi yêu cầu ship để người dùng xác nhận'

export async function run(args, ctx) {
  const options = {}
  for (let i = 0; i < args.length; i++) {
    const match = /^--(task|title|body)$/.exec(args[i])
    if (!match || !args[i + 1] || args[i + 1].startsWith('--')) { ctx.stderr.write(`dùng: ff ship-request --task <id> --title <text> [--body <text>]\n`); return 2 }
    options[match[1]] = args[++i]
  }
  if (!/^[A-Za-z0-9]+$/.test(options.task ?? '') || !options.title?.trim()) {
    ctx.stderr.write('ff ship-request: cần --task <id> và --title <text>\n')
    return 2
  }
  const root = findRoot(ctx.cwd)
  if (!root) { ctx.stderr.write('ff ship-request: không thấy ff.config.yaml\n'); return 4 }
  let packet=null
  try {packet=readPresentation(root,loadConfig(root).config,options.task,{phase:'ship'})}catch{}
  if(!packet)ctx.stderr.write('[ff ship-request] Bản tổng hợp hiện tại thiếu hoặc hết hiệu lực; nội dung --body chỉ là lời nhắc, hãy trình lại bằng ff present trước quyết định.\n')
  const body=packet?renderPresentation(packet):options.body??''
  ctx.stdout.write(`${packet?'':`[#${options.task}] ${options.title}\n`}${body}\nXác nhận ship trong CLI; thông báo channel không cấp quyền push.\n`)
  const request={taskId:options.task,title:options.title,body,...(packet?{fields:presentationEvent(packet).fields}:{})}
  if(Buffer.byteLength(JSON.stringify(request))>60*1024){ctx.stderr.write('ff ship-request: tổng hợp quá lớn; rút gọn trước khi gửi\n');return 2}
  try {
    const result=await workerRequest(root,'/ship-request',request,ctx.fetch)
    if(result?.status&&result.status!=='delivered')ctx.stderr.write(`[ff ship-request] channel: ${result.status}; xác nhận vẫn ở CLI\n`)
    else ctx.stdout.write('đã gửi yêu cầu ship để người dùng xác nhận\n')
    return 0
  } catch {const status=fs.existsSync(path.join(root,'.ff/worker.json'))?'unknown':'not_sent';ctx.stderr.write(`[ff ship-request] channel: ${status}; xác nhận vẫn ở CLI\n`);return 0}
}
