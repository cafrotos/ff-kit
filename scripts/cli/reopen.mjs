import { inspectPrShip, shipSourceIdentity } from '../lib/ship.mjs'
import { captureReopenBases } from '../lib/task-commits.mjs'
import { appendHarnessEvent } from '../lib/harness-events.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { findCardDir } from '../lib/cards.mjs'
import { activeRevision, gateStatus, ledgerFor } from '../lib/gates.mjs'
import { withFileMutexRetry } from '../lib/file-mutex.mjs'
import { taskPath, VersionConflictError, readTask, writeTask } from '../../ff-worker/src/core/task-store.mjs'
import { git, repoDir, cardBranch } from './repo-common.mjs'

export const summary = 'reopen <id> --reason <text> — tạo hợp đồng rev-N, giữ lịch sử Gate'
export async function run(args, ctx) {
  try {
    const [id, flag, reason, ...rest] = args
    const eventId=rest[0]==='--event-id'&&rest.length===2?rest[1]:undefined
    if (!id || flag !== '--reason' || !reason?.trim() || (rest.length&&!eventId)) throw new Error('dùng: ' + summary)
    const root = findRoot(ctx.cwd)
    if (!root) throw new Error('không thấy ff.config.yaml')
    const { config } = loadConfig(root), card = findCardDir(root, config, id)
    if (card.error) throw new Error(card.error)
    if (!fs.realpathSync(card.dir).startsWith(fs.realpathSync(root) + path.sep)) throw new Error('thẻ vượt khỏi workspace')
    const cardId=path.basename(card.dir).split('-')[0]
    const revision = await reopenTask({root,config,id:cardId,reason,eventId})
    const dir = path.join(card.dir,revision)
    ctx.stdout.write(`Reopen ${id}: ${path.relative(root, dir)}; Gate A dùng [#${id}] [${revision}] và delta.md\n`)
    return 0
  } catch (e) { ctx.stderr.write(`ff reopen: ${e.message}\n`); return 1 }
}

/** Remote fetch is outside the task mutex; artifact creation/event append share one CAS boundary. */
export async function reopenTask({root,config,id,reason,eventId,expectedSourceIdentity,recoverOnly=false,github}) {
    if (!/^[A-Za-z0-9]+$/.test(id) || !reason?.trim() || (eventId && !/^[A-Za-z0-9:_-]{1,160}$/.test(eventId))) throw new Error('invalid reopen identity')
    const card=findCardDir(root,config,id)
    if(card.error)throw new Error(card.error)
    const recover=async(persist=false)=>{
      if(!eventId)return null
      for(const name of fs.readdirSync(card.dir).filter(n=>/^rev-[1-9]\d*$/.test(n))){
        const file=path.join(card.dir,name,'revision.json')
        if(!fs.existsSync(file))continue
        const meta=JSON.parse(fs.readFileSync(file,'utf8'))
        if(meta.eventId!==eventId)continue
        const scope=meta.eventScope
        if(!scope||scope.cardId!==id||!/^$|^rev-[1-9]\d*$/.test(scope.revision)||typeof scope.runId!=='string'||!scope.runId.trim()||typeof scope.dispatchId!=='string'||!/^\d{4}-\d\d-\d\dT/.test(meta.createdAt??'')||!Number.isFinite(Date.parse(meta.createdAt)))throw new Error('committed reopen event scope missing or incomplete')
        if(persist)await appendHarnessEvent(root,{...scope,eventId,type:'revision_created',at:meta.createdAt,payload:{revision:name}})
        return name
      }
      return null
    }
    const existing=await recover();if(existing)return withFileMutexRetry(`${taskPath(root,id)}.lock`,{operation:'reopen-recover',cardId:id},()=>recover(true))
    if(recoverOnly)throw new Error('committed reopen revision not found')
    const task = readTask(root, id)
    const sourceIdentity=expectedSourceIdentity??shipSourceIdentity(root,config,id)
    if(expectedSourceIdentity&&shipSourceIdentity(root,config,id)!==expectedSourceIdentity)throw new Error('reopen source changed')
    const harness = config.worker?.driver?.enabled === true
    if (harness && (!task?.stateVersion || task.stage === 'done' || task.prView?.repos?.some(pr => pr.merged || pr.state === 'closed' || pr.state === 'merged'))) throw new Error('không reopen task done/PR đã đóng hoặc task chưa thuộc harness; dùng thẻ Fix mới')
    if(harness&&config.ship?.mode==='dev_and_pr'){
      const view=await inspectPrShip(root,config,id,{github})
      if(view.repos.some(r=>r.pr?.merged||r.s2Status==='blocked:pr_closed'))throw new Error('PR đã merge/đóng; dùng thẻ Fix mới')
      if(view.s1Complete&&view.repos.some(r=>r.requiresPr&&!r.pr))throw new Error('chờ xác minh PR trước reopen')
    }
    const previous = activeRevision(card.dir)
    if (harness && (previous ? Number(previous.slice(4)) : 0) >= (config.ship?.max_reopen ?? 3)) throw new Error('đã đạt max_reopen; dùng thẻ Fix mới')
    if (previous) {
      const rel = `${previous}/05-verify-report.md`
      const content = fs.existsSync(path.join(card.dir, rel)) ? fs.readFileSync(path.join(card.dir, rel), 'utf8') : ''
      if (gateStatus(root, id, 'GATE_C', rel, content, ledgerFor(card.dir, previous)) !== 'approved') throw new Error(`${previous} chưa hoàn tất Gate C; tiếp tục revision hiện tại`)
    }
    const revision = `rev-${previous ? Number(previous.slice(4)) + 1 : 1}`, dir = path.join(card.dir, revision)
    const branch = cardBranch(path.join(card.dir, '01-dossier.md'))
    const bases = captureReopenBases({ root, config, cardDir: card.dir, taskBranch: branch })
    return withFileMutexRetry(`${taskPath(root,id)}.lock`,{operation:'reopen',cardId:id},async()=>{
      const existing=await recover(true);if(existing)return existing
      const current=readTask(root,id)
      if((current?.stateVersion??0)!==(task?.stateVersion??0))throw new VersionConflictError(id,task?.stateVersion??0,current?.stateVersion??0)
      if(sourceIdentity&&shipSourceIdentity(root,config,id)!==sourceIdentity)throw new Error('reopen source changed')
      if(activeRevision(card.dir)!==previous)throw new Error('revision changed during reopen')
    const metadata = { version: 1, revision, reason: reason.trim(), createdAt: new Date().toISOString(), previousRevision: previous, eventScope:harness?{cardId:id,revision:task.revision,runId:task.runId,dispatchId:task.dispatchId}:null, eventId:eventId??null, bases, shippedRepos: config.repos.filter(repo => git(repoDir(root, config.workspace.worktrees_dir, path.basename(card.dir), repo), ['config', '--get', 'ff.shippedTaskHead']).stdout?.trim()).map(repo => repo.name) }
    const staging=path.join(card.dir,`.reopen-${revision}`)
    fs.rmSync(staging,{recursive:true,force:true});fs.mkdirSync(staging)
    for (const [name, title] of [['delta.md', 'Delta Brief'], ['02-spec.md', 'Spec'], ['03-design.md', 'Design'], ['05-verify-report.md', 'Verify report']]) {
      fs.writeFileSync(path.join(staging, name), `> Trạng thái: CHỜ DUYỆT\n# ${title} ${id} ${revision}\n\n<!-- Điền hợp đồng từ dossier/ledger trước khi trình Gate; không phải bằng chứng hoàn tất. -->\n`, { mode: 0o600 })
    }
    fs.writeFileSync(path.join(staging,'revision.json'),JSON.stringify(metadata,null,2)+'\n',{mode:0o600})
    for(const name of fs.readdirSync(staging)){const fd=fs.openSync(path.join(staging,name),'r');try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}}
    const staged=fs.openSync(staging,'r');try{fs.fsyncSync(staged)}finally{fs.closeSync(staged)}
    fs.renameSync(staging,dir)
    const fd=fs.openSync(card.dir,'r');try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
    if (harness) await appendHarnessEvent(root, {
      eventId: eventId ?? `revision:${id}:${revision}`, cardId: id, revision: task.revision, runId: task.runId, dispatchId: task.dispatchId,
      type: 'revision_created', at: metadata.createdAt, payload: { revision },
    })
    else if (task && !task.stateVersion) writeTask(root, { ...task, phase: 'received', revision, launchAttempts: 0, startedAt: undefined, completedAt: undefined,
      acceptance:undefined,acceptedAt:undefined,acceptedRevision:undefined,shipState:undefined,updatedAt: new Date().toISOString() })
      return revision
    })
}
