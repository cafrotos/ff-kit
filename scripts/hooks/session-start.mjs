// scripts/hooks/session-start.mjs — chạy doctor đầu phiên; đỏ thì báo vào ngữ cảnh, `ff cfg get` sẽ từ chối.
import { readHookInput } from '../lib/hook-io.mjs'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { runDoctor } from '../lib/doctor.mjs'
import { writeDoctorState } from '../lib/state.mjs'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { bindHookSession } from '../lib/question-history.mjs'
import { notify,makeEvent } from '../lib/notify.mjs'
import { readTask } from '../../ff-worker/src/core/task-store.mjs'
import { validateWorkflowPin } from '../lib/stage-receipts.mjs'
import { bindWorkflowEnvironment } from '../lib/workflow-snapshot.mjs'

const input = readHookInput()
const root = findRoot(input.cwd ?? process.cwd())
if (!root) process.exit(0)

let binding, workflowError = null
let config
try { config = loadConfig(root).config } catch { /* doctor below reports malformed configuration */ }
// Stale launcher scope cannot confirm or modify a newer run's environment.
if (config?.worker.driver.enabled && /^[A-Za-z0-9]+$/.test(process.env.FF_CARD_ID ?? '') && process.env.FF_RUN_ID) {
  const task = readTask(root, process.env.FF_CARD_ID)
  if (task?.runId === process.env.FF_RUN_ID && task.claudeSessionId === input.session_id) {
    try { validateWorkflowPin(root,task.workflow); bindWorkflowEnvironment(task.workflow) }
    catch { workflowError = 'workflow_environment_invalid'; process.stderr.write('[ff] Pinned workflow/plugin/Bash CLI verification failed; check snapshot and CLAUDE_ENV_FILE.\n') }
  }
}
try { if(config)binding=await bindHookSession(root,config,input,process.env,{blockedReason:workflowError}) }
catch { process.stderr.write('[ff] Session binding không hợp lệ; harness không được xác nhận.\n'); if(config?.worker.driver.enabled)process.exit(2) }
if(binding?.status==='blocked'){
  process.stderr.write(`[ff] Harness blocked: ${binding.reason}.\n`)
  if(binding.stored)await notify(root,makeEvent({kind:'attention',taskId:binding.context.cardId,title:`Harness blocked: ${binding.reason}`,body:'Kiểm tra UUID và launcher trong CLI.'}))
}

let lines
try {
  const r = runDoctor(root, loadConfig(root))
  writeDoctorState(root, r.ok, r.groups)
  const errs = r.checks.filter((c) => !c.ok).map((c) => `- [${c.group}] ${c.msg}`)
  if (r.ok) {
    let status = {}
    try { status = JSON.parse(fs.readFileSync(`${root}/.ff/worker.json`, 'utf8')) } catch {}
    const session = loadConfig(root).config.worker.tmux.session_name ?? 'ff-worker'
    const alive = status.state === 'ready' && spawnSync('tmux', ['has-session', '-t', `=${session}`], { cwd: root, encoding: 'utf8', timeout: 3000 }).status === 0
    lines = ['ff doctor: xanh.', ...(!alive ? ['Worker chưa chạy. Muốn nhận thẻ tự động: gõ /ff-worker start.'] : [])]
  }
  else if (!r.groups.core) lines = ['ff doctor: ĐỎ nhóm core — `ff cfg get` sẽ từ chối tới khi sửa xong:', ...errs, 'Sửa bằng /ff-init, không sửa ff.config.yaml bằng tay.']
  else lines = ['ff doctor: skill chạy được; còn thiếu:', ...errs, !r.groups.worker ? 'Key adapter chỉ worker cần (kéo thẻ, thông báo). Muốn bật worker: điền .ff.env rồi gõ /ff-worker start.' : '']
} catch (e) {
  writeDoctorState(root, false, { core: false, worker: false, e2e: false })
  lines = [`ff doctor: ĐỎ — ${e.message}`, 'Sửa bằng /ff-init.']
}
process.stdout.write(lines.filter(Boolean).join('\n') + '\n')
process.exit(binding?.status === 'blocked' ? 2 : 0)
