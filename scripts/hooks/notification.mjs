// Permission waiting is distinct from normal idle and never an approval.
import { createHash } from 'node:crypto'
import { readHookInput } from '../lib/hook-io.mjs'
import { findRoot,loadConfigOrDefaults } from '../lib/config.mjs'
import { notify,makeEvent } from '../lib/notify.mjs'
import { resolveHookContext,recordRunnerObservation,readQuestionHistory } from '../lib/question-history.mjs'
import { inferCardId } from '../lib/card-context.mjs'
import { redactHumanText } from '../lib/human-output.mjs'
import { recordEnvAttention } from '../lib/attention.mjs'
const input=readHookInput()
const root=findRoot(input.cwd??process.cwd())
if(!root)process.exit(0)
const config=loadConfigOrDefaults(root).config
if(input.notification_type==='permission_prompt')await recordEnvAttention(root,{who:'human',kind:'permission'})
else if(input.notification_type==='idle_prompt')await recordEnvAttention(root,{who:'human',kind:'idle'})
const message=redactHumanText(input.message??'Kiểm tra phiên CLI hiện tại.')
let taskId=''
try{taskId=inferCardId(root,config,{cwd:input.cwd??process.cwd()})}catch{}
if(config.worker.driver.enabled){
  const context=resolveHookContext(root,config,input)
  if(input.notification_type!=='permission_prompt')process.exit(0)
  // AskUserQuestion đang mở: Claude Code bắn thêm permission_prompt ~6s sau, không phải yêu cầu quyền thật → không báo lần 2.
  if(context&&readQuestionHistory(root,context.cardId).some(q=>q.status==='open'&&q.runId===context.runId))process.exit(0)
  const result=await recordRunnerObservation(root,context,'permission_waiting','permission_prompt',createHash('sha256').update(message).digest('hex'))
  if(!result.stored)process.exit(0)
  taskId=context.cardId
}
await notify(root,makeEvent({kind:'attention',taskId,title:message.slice(0,200),body:message}))
process.exit(0)
