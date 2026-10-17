// UserPromptSubmit: proves worker dispatch delivery and marks human turns busy.
// A worker prompt that is not byte-identical to the current dispatch (e.g. typed
// onto a leftover draft) is blocked, so a mixed instruction never executes.
import { randomUUID } from 'node:crypto'
import { readHookInput } from '../lib/hook-io.mjs'
import { findRoot,loadConfigOrDefaults } from '../lib/config.mjs'
import { notify,makeEvent } from '../lib/notify.mjs'
import { resolveHookContext,recordRunnerObservation } from '../lib/question-history.mjs'
import { readTask } from '../../ff-worker/src/core/task-store.mjs'
import { buildStagePrompt } from '../../ff-worker/src/core/tmux-claude-runner.mjs'
const input=readHookInput()
const root=findRoot(input.cwd??process.cwd())
if(!root)process.exit(0)
const config=loadConfigOrDefaults(root).config
if(!config.worker.driver.enabled)process.exit(0)
const context=resolveHookContext(root,config,input)
if(!context)process.exit(0)
const prompt=String(input.prompt??'')
const marker=prompt.indexOf(' Worker dispatch ')
if(marker<0){
  // The hook input carries only session_id/transcript_path/cwd/prompt; no field tells a typed prompt from an
  // injected one. Claude Code wraps background task/subagent results in a leading <task-notification> block
  // (seen in real transcripts), so that prefix is the only reliable marker. Both are "busy" turns for the driver.
  const source=/^\s*<task-notification>/.test(prompt)?'system':'human'
  await recordRunnerObservation(root,context,'prompt_submitted',source,randomUUID())
  process.exit(0)
}
let canonical=null
try { const task=readTask(root,context.cardId); if(task?.pendingDispatch)canonical=buildStagePrompt(task) } catch {}
if(canonical!==null && prompt.trim()===canonical){
  await recordRunnerObservation(root,context,'prompt_submitted','worker',context.dispatchId)
  process.exit(0)
}
await recordRunnerObservation(root,context,'prompt_submitted','worker_rejected',randomUUID())
const extra=canonical!==null&&prompt.endsWith(canonical)?prompt.slice(0,prompt.length-canonical.length).trim():''
await notify(root,makeEvent({kind:'attention',taskId:context.cardId,title:'Lệnh worker bị chặn: prompt không khớp dispatch hiện tại',body:extra?'Ô nhập còn nội dung của bạn; worker sẽ thử lại khi phiên rảnh.':'Dispatch cũ hoặc bị sửa; kiểm tra ff worker status.'}))
process.stdout.write(JSON.stringify({decision:'block',reason:`[ff] Lệnh worker bị chặn vì không khớp dispatch hiện tại.${extra?` Nội dung bạn đang gõ dở: ${extra}`:''}`}))
process.exit(0)
