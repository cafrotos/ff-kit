// scripts/hooks/ask-pre.mjs — PreToolUse(AskUserQuestion): chặn Gate sai quy ước hoặc trace-check đỏ, rồi thông báo.
import { readHookInput } from '../lib/hook-io.mjs'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { findCardDir } from '../lib/cards.mjs'
import { traceCheck } from '../lib/trace.mjs'
import { gateQuestions, validateGateQuestion, activeRevision,gateScope } from '../lib/gates.mjs'
import { notify, makeEvent } from '../lib/notify.mjs'
import { readPresentation,renderPresentation,formatQuestions } from '../lib/human-output.mjs'

const input = readHookInput()
const root = findRoot(input.cwd ?? process.cwd())
if (!root) process.exit(0)
let config
try {
  config = loadConfig(root).config
} catch {
  process.exit(0)
}

const ti = input.tool_input ?? {}
const gates = gateQuestions(ti)
for (const g of gates) {
  if (!g.cardId) {
    process.stderr.write(`[ff] Câu hỏi ${g.gate} phải bắt đầu bằng "[#<id thẻ>]", vd "[#123] Duyệt Brief?".\n`)
    process.exit(2)
  }
  const card = findCardDir(root, config, g.cardId)
  if (card.error) { process.stderr.write(`[ff] ${card.error}\n`); process.exit(2) }
  try { validateGateQuestion(card.dir, g.question) } catch (e) {
    process.stderr.write(`[ff] ${e.message}\n`)
    process.exit(2)
  }
  if (g.gate === 'GATE_A' || g.gate === 'GATE_B') {
    const r = traceCheck(card.dir)
    if (!r.ok) {
      process.stderr.write(`[ff] trace-check đỏ cho thẻ #${g.cardId} — sửa rồi trình lại ${g.gate}:\n${r.errors.map((e) => `- ${e}`).join('\n')}\n`)
      process.exit(2)
    }
  }
}

const prefix = config.worker.tmux.session_prefix
const questions = Array.isArray(ti.questions) ? ti.questions : []
const ids = [...new Set(questions.map(q=>String(q.question??'').match(/^\s*\[#([A-Za-z0-9]+)\]/)?.[1]).filter(Boolean))]
if(ids.length>1){process.stderr.write('[ff] Một lượt hỏi chỉ thuộc một thẻ.\n');process.exit(2)}
const id=gates[0]?.cardId??ids[0]??'', scope=String(questions[0]?.question??'').match(/\[(task-\d+(?:-[A-Za-z0-9-]+)?)\]/)?.[1]??''
if(ids.length&&new Set(questions.map(q=>gateScope(String(q.question??'')))).size>1){process.stderr.write('[ff] Một lượt hỏi chỉ thuộc một revision/phạm vi.\n');process.exit(2)}
let packet=null,revision=null
if(id){const card=findCardDir(root,config,id);if(card.dir){
  revision=activeRevision(card.dir)
  try{for(const q of questions)validateGateQuestion(card.dir,String(q.question??''))}catch(e){process.stderr.write(`[ff] ${e.message}\n`);process.exit(2)}
  packet=readPresentation(root,config,id,{gate:gates[0]?.gate,scope})
}}
const body=[packet?renderPresentation(packet):'Bản tổng hợp cho human thiếu hoặc hết hiệu lực; cần xem lại ngữ cảnh trong CLI.',formatQuestions(questions),id?`Mở phiên CLI để trả lời/duyệt: tmux attach -t ${prefix}${id}`:'Trả lời/duyệt trong phiên CLI hiện tại; channel chỉ thông báo.'].join('\n\n')
const event=makeEvent({kind:gates.length?'gate':'ask',taskId:id,title:gates.length?`${gates[0].gate} thẻ #${id} chờ duyệt`:'Cần quyết định trong CLI',fields:{revision:revision??'gốc',scope:scope||'toàn thẻ',...(packet?{phase:packet.phase,presentation:packet.presentationId}:{})},body})
if(Buffer.byteLength(JSON.stringify(event))>60*1024){process.stderr.write('[ff] Nội dung hỏi quá lớn; rút gọn tổng hợp, không cắt lựa chọn.\n');process.exit(2)}
const delivery=await notify(root,event,{log:s=>process.stderr.write(s)})
if(!delivery.delivered)process.stderr.write(`[ff] channel: ${delivery.status??'not_sent'}; quyết định vẫn ở CLI.\n`)
process.exit(0)
