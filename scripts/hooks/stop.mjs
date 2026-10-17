// Stop is an idle observation, never stage/Gate evidence.
import { randomUUID } from 'node:crypto'
import { readHookInput } from '../lib/hook-io.mjs'
import { findRoot,loadConfigOrDefaults } from '../lib/config.mjs'
import { notify,makeEvent } from '../lib/notify.mjs'
import { inferCardId } from '../lib/card-context.mjs'
import { recordEnvAttention } from '../lib/attention.mjs'
import { resolveHookContext,recordRunnerObservation } from '../lib/question-history.mjs'
const input=readHookInput()
if(input.stop_hook_active)process.exit(0)
const root=findRoot(input.cwd??process.cwd())
if(!root)process.exit(0)
const config=loadConfigOrDefaults(root).config
await recordEnvAttention(root,{who:'human',kind:'idle'})
if(config.worker.driver.enabled){
  // Each actual Stop is a fresh observation, including after same-scope resume.
  // This ID identifies the observation only; conversation identity stays worker-owned.
  await recordRunnerObservation(root,resolveHookContext(root,config,input),'runner_idle','',randomUUID())
}else await notify(root,makeEvent({kind:'attention',taskId:(()=>{try{return inferCardId(root,config,{cwd:input.cwd??process.cwd()})}catch{return ''}})(),title:'Phiên agent đã dừng; kiểm tra trạng thái thẻ và việc đang chờ'}))
process.exit(0)
