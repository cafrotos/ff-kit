// scripts/hooks/ask-pre.mjs — PreToolUse(AskUserQuestion): chặn Gate sai quy ước hoặc trace-check đỏ, rồi thông báo.
import {accessHint,slugFromDir} from '../lib/access-hint.mjs'
import { readHookInput } from '../lib/hook-io.mjs'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { findCardDir } from '../lib/cards.mjs'
import { traceCheck } from '../lib/trace.mjs'
import { knowledgeIds } from '../lib/wiki.mjs'
import { gateQuestions, validateGateQuestion, gatePrerequisiteProblem, activeRevision, gateScope, APPROVE_LABEL } from '../lib/gates.mjs'
import { notify, makeEvent } from '../lib/notify.mjs'
import { readPresentation,renderPresentation,formatQuestions,redactHumanText } from '../lib/human-output.mjs'
import { inspectShip } from '../lib/ship.mjs'
import { recordEnvAttention } from '../lib/attention.mjs'
import { resolveHookContext,recordQuestion,claimHookAttention,matchPacketDecision,isQHeader } from '../lib/question-history.mjs'
import { readKnowledgeEvents,questionHash } from '../lib/knowledge-log.mjs'
import { SOFT_CLASSES } from '../lib/knowledge.mjs'

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
const warnings = []
const gates = gateQuestions(ti)
for (const g of gates) {
  if (!g.cardId) {
    process.stderr.write(`[ff] Câu hỏi ${g.gate} phải bắt đầu bằng "[#<id thẻ>]", vd "[#123] Duyệt Brief?".\n`)
    process.exit(2)
  }
  // Approval matches the label exactly; a decorated label ("Duyệt (Recommended)") would silently never approve.
  const labels = (ti.questions ?? []).find(q => q?.header === g.gate && q.question === g.question)?.options?.map(o => o?.label)
  if (JSON.stringify(labels) !== JSON.stringify([APPROVE_LABEL, 'Cần sửa'])) {
    process.stderr.write(`[ff] Câu hỏi ${g.gate} phải có đúng hai lựa chọn "${APPROVE_LABEL}" và "Cần sửa", theo thứ tự, không thêm chữ vào nhãn. Hỏi lại.\n`)
    process.exit(2)
  }
  const card = findCardDir(root, config, g.cardId)
  if (card.error) { process.stderr.write(`[ff] ${card.error}\n`); process.exit(2) }
  try { validateGateQuestion(card.dir, g.question) } catch (e) {
    process.stderr.write(`[ff] ${e.message}\n`)
    process.exit(2)
  }
  // Không chặn (câu hỏi vẫn được ghi vào lịch sử), nhưng báo trước để agent sửa thay vì để người bấm Duyệt vô ích.
  const blocked = gatePrerequisiteProblem(root, config, g.cardId, g.gate, g.question)
  if (blocked) warnings.push(`${g.gate} thẻ #${g.cardId} sẽ KHÔNG ghi được dù người bấm Duyệt: ${blocked}`)
  if (g.gate === 'GATE_A' || g.gate === 'GATE_B') {
    const r = traceCheck(card.dir, { knowledge: knowledgeIds(root, config) })
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
  packet=readPresentation(root,config,id,{gate:gates[0]?.gate,scope,...(questions.some(q=>q.header==='ACCEPTANCE')?{phase:'ship',purpose:'acceptance'}:{})})
}}
const body=[packet?renderPresentation(packet):'Bản tổng hợp cho human thiếu hoặc hết hiệu lực; cần xem lại ngữ cảnh trong CLI.',formatQuestions(questions),id?`Trả lời/duyệt: ${accessHint({config,cardId:id,slug:slugFromDir(findCardDir(root,config,id).dir,id)})}`:'Trả lời/duyệt trong phiên CLI hiện tại; channel chỉ thông báo.'].join('\n\n')
const event=makeEvent({kind:gates.length?'gate':'ask',taskId:id,title:gates.length?`${gates[0].gate} thẻ #${id} chờ duyệt`:'Cần quyết định trong CLI',fields:{revision:revision??'gốc',scope:scope||'toàn thẻ',...(packet?{phase:packet.phase,presentation:packet.presentationId}:{})},body})
if(Buffer.byteLength(JSON.stringify(event))>60*1024){process.stderr.write('[ff] Nội dung hỏi quá lớn; rút gọn tổng hợp, không cắt lựa chọn.\n');process.exit(2)}
const context=resolveHookContext(root,config,input)
if(config.worker.driver.enabled && !context){process.stderr.write('[ff] Harness blocked: missing or unconfirmed session context.\n');process.exit(2)}
if(context && ids.some(cardId=>cardId!==context.cardId)){process.stderr.write('[ff] Câu hỏi không thuộc thẻ của phiên CLI.\n');process.exit(2)}
let acceptanceBinding
if(questions.some(q=>q.header==='ACCEPTANCE')){
  const shipped=inspectShip(root,config,id),d=packet?.decisions?.[0]
  const prefix=`[#${id}]${packet?.revision?` [${packet.revision}]`:''}`
  const q=questions[0]
  if(!context||questions.length!==1||packet?.purpose!=='acceptance'||packet.phase!=='ship'||!shipped.s1Complete||shipped.mode!=='dev_only'||shipped.revision!==context.revision||!d||q.question!==`${prefix} ${d.question}`||JSON.stringify(q.options)!==JSON.stringify(d.options)||q.multiSelect===true){process.stderr.write('[ff] Acceptance requires a current shipped dev_only packet and exact CLI question.\n');process.exit(2)}
  acceptanceBinding={revision:shipped.revision,heads:shipped.heads,sourceIdentity:shipped.sourceIdentity}
}
// KNW-04: mỗi Q phải khớp một quyết định có decisionContext trong packet hiện hành, nếu không câu trả lời chỉ được ghi `unscoped` (không thành tiền lệ).
const predictions=readKnowledgeEvents(root,{type:'shadow_prediction'})
for(const q of questions){
  if(!isQHeader(q.header))continue
  const d=matchPacketDecision(packet,q),c=d?.decisionContext
  if(!c){warnings.push(`${q.header} thiếu class/decisionKey: câu hỏi không khớp quyết định có decisionContext trong packet ff present hiện hành (phải đúng câu và đúng nhãn). Câu trả lời vẫn được ghi nhưng ở dạng unscoped, KHÔNG làm tiền lệ cho ff decide. Thêm decisionContext {repo,businessScope,decisionKey,class,normalizedOptions} vào quyết định trong human-output.json, chạy lại ff present, rồi hỏi đúng câu/nhãn của packet.`);continue}
  if(SOFT_CLASSES.includes(c.class)&&!predictions.some(e=>e.cardId===id&&e.class===c.class&&e.decisionKey===c.decisionKey&&e.repo===c.repo&&e.questionHash===questionHash(d.question)))
    warnings.push(`${q.header} (${c.class}/${c.decisionKey}) là câu mềm nhưng chưa chạy ff decide: máy chưa ghi dự đoán bóng. Chạy ff decide <id> --class ${c.class} --decision-key ${c.decisionKey} --repo ${c.repo} --question "<câu trong packet>" trước khi hỏi; nếu trả proceed thì dùng giá trị đó và không hỏi.`)
}
if (warnings.length) {
  const text = `[ff] Cảnh báo trước khi hỏi:\n${warnings.map((w) => `- ${w}`).join('\n')}`
  process.stderr.write(text + '\n')
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } }) + '\n')
}
await recordEnvAttention(root,{who:'human',kind:'question'})
const records=await recordQuestion(root,context?{...context,presentationId:packet?.presentationId??null,decisionPacket:packet,...(acceptanceBinding?{acceptanceBinding}:{})}:null,input)
if(config.worker.driver.enabled && context && records.length && !await claimHookAttention(root,context,`questions:${records.map(q=>q.questionId).join(',')}`))process.exit(0)
const safeEvent={...event,title:redactHumanText(event.title),body:redactHumanText(event.body)}
const delivery=await notify(root,safeEvent,{log:s=>process.stderr.write(s)})
if(!delivery.delivered)process.stderr.write(`[ff] channel: ${delivery.status??'not_sent'}; quyết định vẫn ở CLI.\n`)
process.exit(0)
