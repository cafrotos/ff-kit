// Preserve immutable pre-hook scope and CLI decisions; Gate receipts retain their own validation.
import { readHookInput } from '../lib/hook-io.mjs'
import { findRoot, loadConfigOrDefaults } from '../lib/config.mjs'
import { recordGates } from '../lib/gates.mjs'
import { resolveHookContext,capturedQuestionContext,recordAnswers,recordCapturedGates,cliAnswerFor } from '../lib/question-history.mjs'

const input = readHookInput()
const root = findRoot(input.cwd ?? process.cwd())
if (!root) process.exit(0)
const config = loadConfigOrDefaults(root).config
const current = resolveHookContext(root,config,input)
const captured = capturedQuestionContext(root,input,{cardId:process.env.FF_CARD_ID,runId:process.env.FF_RUN_ID})
const context = config.worker.driver.enabled ? captured : current
// History validates immutable captured snapshots before granting any Gate
// evidence. Existing decisions are returned on retry, so application has its
// own durable identity claim shared across captures.
const decisions = await recordAnswers(root,context,input,{newOnly:config.worker.driver.enabled})
if(config.worker.driver.enabled){
  const result = await recordCapturedGates(root,config,current,decisions)
  if(result.failed)process.stderr.write('[ff] Gate receipt không hợp lệ; câu trả lời vẫn được giữ trong lịch sử.\n')
}else{
  // Legacy standalone payloads may have no capture/session/tool identity.
  const questions=(input.tool_input?.questions??[]).filter(q=>{
    const answer=cliAnswerFor(input,q.question)
    return answer!==null && answer.trim()!==''
  })
  const answers=Object.fromEntries(questions.map(q=>[q.question,cliAnswerFor(input,q.question)]))
  try { recordGates(root,config,{...input.tool_input,questions},{answers}) }
  catch { process.stderr.write('[ff] Gate receipt không hợp lệ; câu trả lời vẫn được giữ trong lịch sử.\n') }
}
process.exit(0)
