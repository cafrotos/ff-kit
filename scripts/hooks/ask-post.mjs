// Preserve immutable pre-hook scope and CLI decisions; Gate receipts retain their own validation.
import { readHookInput } from '../lib/hook-io.mjs'
import { findRoot, loadConfigOrDefaults } from '../lib/config.mjs'
import { recordGates, GateRefusal, gateScope } from '../lib/gates.mjs'
import { recordEnvAttention } from '../lib/attention.mjs'
import { confirmEscapes } from '../lib/knowledge-log.mjs'
import { resolveHookContext,capturedQuestionContext,recordAnswers,recordCapturedGates,cliAnswerFor } from '../lib/question-history.mjs'

// Gate bị từ chối ghi phải đến tay người (systemMessage) và agent (additionalContext), không được im lặng ở pending.
function surface(reasons) {
  const text = `[ff] Câu trả lời Gate CHƯA được ghi nhận (Gate vẫn pending, chưa có bản ghi duyệt):\n${reasons.map((r) => `- ${r}`).join('\n')}`
  process.stderr.write(text + '\n')
  process.stdout.write(JSON.stringify({ systemMessage: text, hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } }) + '\n')
}

const input = readHookInput()
const root = findRoot(input.cwd ?? process.cwd())
if (!root) process.exit(0)
const config = loadConfigOrDefaults(root).config
await recordEnvAttention(root,{who:'agent'})
const current = resolveHookContext(root,config,input)
const captured = capturedQuestionContext(root,input,{cardId:process.env.FF_CARD_ID,runId:process.env.FF_RUN_ID})
const context = config.worker.driver.enabled ? captured : current
// History validates immutable captured snapshots before granting any Gate
// evidence. Existing decisions are returned on retry, so application has its
// own durable identity claim shared across captures.
const decisions = await recordAnswers(root,context,input,{newOnly:config.worker.driver.enabled})
let gateFailed=false
if(config.worker.driver.enabled){
  const result = await recordCapturedGates(root,config,current,decisions)
  gateFailed=Boolean(result.failed)
  if(result.failed)surface(result.reasons?.length?result.reasons:['Gate receipt không hợp lệ; câu trả lời vẫn được giữ trong lịch sử.'])
}else{
  // Legacy standalone payloads may have no capture/session/tool identity.
  const questions=(input.tool_input?.questions??[]).filter(q=>{
    const answer=cliAnswerFor(input,q.question)
    return answer!==null && answer.trim()!==''
  })
  const answers=Object.fromEntries(questions.map(q=>[q.question,cliAnswerFor(input,q.question)]))
  try { recordGates(root,config,{...input.tool_input,questions},{answers}) }
  catch (e) { gateFailed=true; surface([e instanceof GateRefusal ? e.message : 'Gate receipt không hợp lệ; câu trả lời vẫn được giữ trong lịch sử.']) }
}
// KNW-05: người duyệt Gate A của revision = xác nhận ngả "vì sao lọt" đã đề xuất cho revision đó.
if(!gateFailed)for(const d of decisions){
  const rev=gateScope(d.snapshot?.question??'').match(/^(rev-[1-9]\d*)/)?.[1]
  if(d.snapshot?.header==='GATE_A'&&d.normalizedValue==='duyệt'&&rev)
    try{await confirmEscapes(root,{cardId:d.cardId,revision:rev,gateDecisionId:d.decisionId,at:d.answeredAt})}catch{}
}
process.exit(0)
