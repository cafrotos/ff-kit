import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { withFileMutexRetry } from '../../../scripts/lib/file-mutex.mjs'
import { prepareWorkflowSnapshot } from '../../../scripts/lib/workflow-snapshot.mjs'
import { inspectPrShip, shipSourceIdentity } from '../../../scripts/lib/ship.mjs'
import { inspectCard } from '../../../scripts/cli/state.mjs'
import { git, repoDir } from '../../../scripts/cli/repo-common.mjs'
import { readVerifyLock } from '../../../scripts/lib/verify-lock.mjs'
import { driveTask } from './driver.mjs'
import { detectDialog } from './wait-watch.mjs'
import { TmuxClaudeRunner } from './tmux-claude-runner.mjs'
import { findRoot, loadConfig, taskSourceBlock } from '../../../scripts/lib/config.mjs'
import { validate } from '../../../scripts/lib/schema.mjs'
import { runDoctor } from '../../../scripts/lib/doctor.mjs'
import { acquireVerifyLock, releaseVerifyLock, verifyLockPath } from '../../../scripts/lib/verify-lock.mjs'
import { createAdapters } from '../adapters/index.mjs'
import { discoverTasks, processTasks, taskIsActive, expireTask, attemptTaskLaunch, closeShippedLegacyTasks, FINISHED } from './worker.mjs'
import { startWorkerHttp } from './http.mjs'
import { watchConfig } from './reload.mjs'
import { writeWorkerStatus } from './status.mjs'
import { Tmux } from './tmux.mjs'
import { reconcileParking, closeIdleParkedSessions, chatPark, isParked, isQaFailList, selectionRank, compareRank } from './park.mjs'
import { launchAgentTask, refreshForRun } from './worker.mjs'
import { watchHumanWaits } from './wait-watch.mjs'
import { knowledgeTick } from './knowledge-scheduler.mjs'
import { dailyReportTick } from './daily-report.mjs'
export { harnessTaskStatus } from './task-store.mjs'
import { readTask, writeTask, VersionConflictError } from './task-store.mjs'
import { findCardDir } from '../../../scripts/lib/cards.mjs'
import { isApproved, activeRevision, ledgerFor } from '../../../scripts/lib/gates.mjs'
import { reconcileWorker } from './reconcile.mjs'
import { inferCardId } from '../../../scripts/lib/card-context.mjs'

export function inspectConfig(root) {
  const loaded = loadConfig(root)
  const errors = validate(loaded.config)
  if (!errors.length) {
    const doctor = runDoctor(root, loaded)
    for (const check of doctor.checks) if (!check.ok && ['core', 'worker'].includes(check.group)) errors.push(new Error(check.msg))
  }
  return { loaded, errors }
}

/** Mọi list đã cấu hình phải tồn tại trên board; worker không bao giờ tự tạo list. */
export async function checkBoardLists({ config, source }) {
  if (typeof source?.listNames !== 'function') return { ok: true, missing: [], existing: [] }
  const t = taskSourceBlock(config)
  const wanted = [...(t.poll_lists ?? []), t.done_list, t.accept_list, t.reopen_list, t.park_list, t.doing_list, t.qa_fail_list].filter((n) => typeof n === 'string' && n.trim())
  const existing = await source.listNames()
  const have = new Set(existing.map((n) => n.trim().toLowerCase()))
  const missing = [...new Set(wanted.map((n) => n.trim()))].filter((n) => !have.has(n.toLowerCase()))
  return { ok: !missing.length, missing, existing }
}

export async function runWorker({ configPath, source: injectedSource, channel: injectedChannel, processLike = process, log = (line) => process.stdout.write(line), watch = true, httpStarter = startWorkerHttp, tmux = new Tmux() } = {}) {
  const absoluteConfig = path.resolve(configPath ?? path.join(process.cwd(), 'ff.config.yaml'))
  const root = findRoot(path.dirname(absoluteConfig))
  if (!root || path.resolve(root, 'ff.config.yaml') !== absoluteConfig) throw new Error(`không tìm thấy ff.config.yaml tại ${absoluteConfig}`)
  const inspected = inspectConfig(root)
  if (inspected.errors.length) throw new Error(`doctor core/worker đỏ: ${inspected.errors.map((e) => e.message).join('; ')}`)
  const config = inspected.loaded.config
  const adapters = (injectedSource && injectedChannel) ? { source: injectedSource, channel: injectedChannel } : createAdapters({ root, config, log })
  const harness = config.worker?.driver?.enabled === true
  const harnessRunner = harness ? new TmuxClaudeRunner({ root, config, tmux }) : null
  const lockFile = verifyLockPath(root, config)
  const api = await httpStarter({
    root, port: config.worker.http.port, channel: adapters.channel, log,
    adapter: `${adapters.source.name}/${adapters.channel.name}`,
    handlers: {
      resolveTask(body) {
        const f = body?.fields ?? {}
        return inferCardId(root, config, { env: {}, cwd: f.cwd || root, sessionId: f.session_id, tmuxSession: f.tmux })
      },
      verifyLock(body) {
        if (!['acquire', 'release'].includes(body?.action) || typeof body.slug !== 'string' || !body.slug) throw Object.assign(new Error('invalid verify-lock request'), { status: 400 })
        return body.action === 'acquire' ? acquireVerifyLock(lockFile, body.slug) : releaseVerifyLock(lockFile, body.slug)
      },
      async park(body) {
        return withFileMutexRetry(path.join(root, '.ff/harness-scheduler.lock'), { operation: 'harness-park' }, () =>
          chatPark({ root, config, source: adapters.source, channel: adapters.channel, cardId: body?.cardId, comment: body?.comment, log }))
      },
      async shipRequest(body) {
        if (!body || typeof body.title !== 'string' || !body.title.trim()) throw Object.assign(new Error('invalid ship request'), { status: 400 })
        try { await adapters.channel.notify({ ...body, kind: 'ask', taskId: String(body.taskId ?? ''), title: body.title, body: String(body.body ?? '') }) }
        catch {
          log('[ff-worker] gửi thông báo ship thất bại; chưa xác nhận delivery\n')
          throw new Error('ship notification failed')
        }
        return { accepted: true }
      },
    },
  })
  const status = () => {
    try { return JSON.parse(fs.readFileSync(api.statusPath, 'utf8')) } catch { return {} }
  }
  let stopping = false
  let interval
  let watcher
  let resolveStop
  const stopped = new Promise((resolve) => { resolveStop = resolve })

  async function cycle() {
    try {
      await reconcileCycle({ root, config, source: adapters.source, tmux: harnessRunner?.tmux ?? tmux, log })
      if (harness) {
        await runHarnessCycle({ root, config, source: adapters.source, channel: adapters.channel, runner: harnessRunner })
        return
      }
      await checkCompletedTasks({ root, config, source: adapters.source, channel: adapters.channel, tmux, log })
      await closeShippedLegacyTasks({ root, config, source: adapters.source, channel: adapters.channel, tmux, log })
      await watchHumanWaits({ root, config, tmux, channel: adapters.channel, log })
      await processTasks({ root, config, source: adapters.source, channel: adapters.channel, sessionAlive: (task) => tmux.hasSession(`${config.worker.tmux.session_prefix ?? 'ff-'}${task.cardId}`, root), launchTask: (card, task, options) => launchAgentTask({ root, config, tmux, card, task, ...options }), log })
    }
    catch (e) {
      const message = harness ? (/^setup:[a-z0-9_:-]+$/.test(e.message) ? e.message : 'Harness polling failed; inspect local evidence') : e.message
      log(`[ff-worker] vòng poll lỗi (${message})\n`)
      try { await adapters.channel.notify({ kind: 'error', title: 'Worker polling lỗi', body: message }) }
      catch { log('[ff-worker] gửi thông báo lỗi poll thất bại; chưa xác nhận delivery\n') }
    }
  }
  let polling = false
  const safeCycle = async () => {
    if (polling || stopping) return
    polling = true
    try { await cycle() } finally { polling = false }
    // Dreaming (SRS 6.1): quét tín hiệu + khởi chạy tối đa một việc nền khi rảnh/quota đủ; không chặn vòng poll.
    try { await knowledgeTick({ root, config, channel: adapters.channel, log }) } catch (e) { log(`[ff-worker] knowledge lỗi (${e.message})\n`) }
    try { await adapters.channel.tick?.() } catch (e) { log(`[ff-worker] nhắc thông báo lỗi (${e.message})\n`) }
    try { await dailyReportTick({ root, config, channel: adapters.channel, log }) } catch (e) { log(`[ff-worker] báo cáo ngày lỗi (${e.message})\n`) }
  }
  const onSignal = () => { void shutdown(0) }
  processLike.once('SIGINT', onSignal)
  processLike.once('SIGTERM', onSignal)
  if (config.worker.task_source?.adapter === 'trello') {
    let lists
    try { lists = await checkBoardLists({ config, source: adapters.source }) }
    catch (e) { lists = { ok: false, error: e.message } }
    if (!lists.ok) {
      const message = lists.error
        ? `không kiểm tra được các list Trello (${lists.error}); worker không khởi động`
        : `thiếu list Trello: ${lists.missing.map((n) => `'${n}'`).join(', ')}. Các list hiện có trên board: ${lists.existing.map((n) => `'${n}'`).join(', ') || '(không có)'}. Worker không tự tạo list; hãy tạo list hoặc sửa ff.config.yaml, rồi chạy lại.`
      log(`[ff-worker] ${message}\n`)
      try { await adapters.channel.notify({ kind: 'error', title: 'Worker không khởi động: cấu hình list Trello', body: message }) }
      catch { log('[ff-worker] gửi thông báo lỗi list thất bại\n') }
      try { await api.close() } catch {}
      writeWorkerStatus(root, { ...status(), state: 'crashed', updatedAt: new Date().toISOString() })
      throw new Error(message)
    }
  }
  if (!harness) {
    await checkCompletedTasks({ root, config, source: adapters.source, channel: adapters.channel, tmux, log })
    await recoverTasks({ root, config, tmux, log, source: adapters.source, channel: adapters.channel })
  }
  await safeCycle()
  const seconds = taskSourceBlock(config).poll_interval_sec ?? (config.worker.task_source?.adapter === 'local' ? 10 : 30)
  interval = setInterval(safeCycle, Math.max(5, seconds) * 1000)
  interval.unref?.()

  async function shutdown(code = 0) {
    if (stopping) return
    stopping = true
    clearInterval(interval)
    watcher?.close()
    const current = status()
    if (current.state !== 'restarting') writeWorkerStatus(root, { ...current, state: 'stopping', updatedAt: new Date().toISOString() })
    try { await api.close() } catch (e) { log(`[ff-worker] lỗi đóng HTTP: ${e.message}\n`) }
    if (code === 0) writeWorkerStatus(root, { ...current, state: 'stopped', stoppedAt: new Date().toISOString() })
    resolveStop(code)
  }
  if (watch && config.worker.reload.watch) {
    const envFile = path.resolve(root, config.secrets.env_file)
    const lockPath = path.join(root, 'ff.config.lock.json')
    watcher = watchConfig({
      root, configFile: absoluteConfig, envFile, lockFile: lockPath, debounceMs: config.worker.reload.debounce_ms,
      initialStatus: status,
      channel: adapters.channel,
      loadCandidate: async () => {
        try {
          const next = inspectConfig(root)
          return { config: next.loaded.config, errors: next.errors }
        } catch (e) { return { errors: [e] } }
      },
      onValid: async () => shutdown(75),
      log,
    })
  }
  log(`[ff-worker] ready pid=${processLike.pid ?? process.pid} port=${api.address.port} source=${adapters.source.name} channel=${adapters.channel.name}\n`)
  return stopped
}

/** WRK-14: mỗi vòng poll, task có thẻ đã rời poll_lists được đối chiếu với cột Trello (chỉ nhả slot/đóng cục bộ; lỗi không làm hỏng vòng). */
export async function reconcileCycle({ root, config, source, tmux, log = () => {} }) {
  try {
    const polled = await source.poll()
    await reconcileWorker({ root, config, source, tmux, pollIds: new Set(polled.map((c) => String(c.id))), log })
  } catch (e) { log(`[ff-worker] reconcile lỗi (${e.message}); thử lại vòng sau\n`) }
}

export async function checkCompletedTasks({ root, config, source, channel, tmux, log = () => {} }) {
  if (config.worker?.driver?.enabled) return []
  const dir = path.join(root, '.ff', 'tasks')
  let files = []
  try { files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')) } catch { return [] }
  const completed = []
  for (const file of files) {
    const id = path.basename(file, '.json')
    const task = readTask(root, id)
    if (!task || task.stateVersion || FINISHED.includes(task.phase)) continue
    const card = findCardDir(root, config, id)
    if (!card.dir) continue
    const revision = activeRevision(card.dir)
    const reportRel = [revision, '05-verify-report.md'].filter(Boolean).join('/')
    const report = path.join(card.dir, reportRel)
    let content
    try {
      // A report approved before a QA-fail reopen must not complete the reopened task again.
      if (task.qaReopenedAt && fs.statSync(report).mtimeMs <= Date.parse(task.qaReopenedAt)) continue
      content = fs.readFileSync(report, 'utf8')
    } catch { continue }
    const ledger = ledgerFor(card.dir, revision ?? '')
    if (!isApproved(root, id, 'GATE_C', reportRel, content, ledger)) continue
    const doneList = taskSourceBlock(config).done_list
    try {
      if (!doneList) throw new Error('chưa cấu hình done_list')
      await source.moveTo(task.trelloCardId ?? id, doneList)
    } catch (e) {
      log(`[ff-worker] không chuyển được thẻ ${id} sang ${doneList ?? 'done_list'} (${e.message})\n`)
      continue
    }
    task.phase = 'completed'
    task.completedAt = new Date().toISOString()
    task.acceptance = 'accepted'
    task.acceptedAt = task.completedAt
    task.acceptedRevision = revision ?? ''
    task.shipState = 'not_shipped'
    writeTask(root, task)
    // Gate C là mốc acceptance, phiên vẫn cần cho xác nhận ship riêng của người dùng.
    try {
      await channel.notify({ taskId: id, kind: 'done', title: `Thẻ #${id} đã qua Gate C — chưa ship`,
        fields: { acceptance: 'accepted', revision: revision ?? '', shipState: 'not_shipped' },
        body: `Đã chấp nhận: ${task.slug}. Chưa ship; chờ xác nhận ship riêng trong phiên agent đang giữ lại.` })
    } catch { log(`[ff-worker] gửi thông báo Gate C thẻ ${id} thất bại; acceptance đã lưu, chưa xác nhận delivery\n`) }
    completed.push(task)
  }
  return completed
}

/**
 * Khởi động: cùng reconcile Trello như một vòng poll TRƯỚC khi chạy lại bất cứ thứ gì.
 * Chỉ thẻ đang ở list làm việc (không phải QA Fail) mới được chạy lại; thẻ QA Fail để QA pick của vòng poll xử lý
 * (một lần pull duy nhất); thẻ đã sang done/accept/reopen thì đóng; Trello lỗi → không chạy lại gì.
 */
export async function recoverTasks({ root, config, tmux, log, source, channel }) {
  const dir = path.join(root, '.ff', 'tasks')
  let files = []
  try { files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')) } catch { return }
  const stored = files.map((f) => readTask(root, path.basename(f, '.json'))).filter((task) => task && !task.stateVersion && !FINISHED.includes(task.phase))
  if (!stored.length) return
  if (!source) { log(`[ff-worker] khởi động: không có task source; không chạy lại ${stored.length} task\n`); return }
  let polled
  try { polled = await source.poll() }
  catch (e) { log(`[ff-worker] khởi động: Trello không truy cập được (${e.message}); không chạy lại task nào, thử lại vòng sau\n`); return }
  const byId = new Map(polled.map((c) => [String(c.id), c]))
  await closeShippedLegacyTasks({ root, config, source, channel, tmux, log, tasks: stored.filter((t) => !byId.has(t.cardId)) })
  const entries = []
  const outside = new Set()
  const pollOrder = (taskSourceBlock(config).poll_lists ?? []).map((l) => String(l).trim().toLowerCase())
  for (const stub of stored) {
    const task = readTask(root, stub.cardId)
    if (!task || FINISHED.includes(task.phase)) { if (task) log(`[ff-worker] khởi động: thẻ ${task.cardId} đã đóng (${task.phase}); không chạy lại\n`); continue }
    const polledCard = byId.get(task.cardId)
    if (!polledCard) { log(`[ff-worker] khởi động: thẻ ${task.cardId} không còn trong poll_lists; không chạy lại\n`); outside.add(task.cardId); continue }
    if (isQaFailList(config, polledCard.list)) { log(`[ff-worker] khởi động: thẻ ${task.cardId} ở ${polledCard.list}; để QA pick xử lý, không resume\n`); continue }
    const list = String(polledCard.list ?? '').trim().toLowerCase(), idx = pollOrder.indexOf(list)
    entries.push({ task, polledCard, rank: selectionRank(config, { list, started: true, pos: polledCard.pos, id: task.cardId, idx: idx < 0 ? Infinity : idx }) })
  }
  // WRK-14: thẻ đã rời poll_lists mà task còn giữ slot/chưa đóng → đối chiếu cột Trello (nhả slot, đóng nếu đã giao/nghiệm thu).
  if (outside.size) await reconcileWorker({ root, config, source, tmux, ids: outside, pollIds: new Set(byId.keys()), log })
  entries.sort((a, b) => compareRank(a.rank, b.rank))
  let active = entries.filter(({ task }) => taskIsActive(task)).length
  for (const { task, polledCard } of entries) {
    const wasActive = taskIsActive(task)
    if (expireTask({ root, config, task, log })) { active -= Number(wasActive); continue }
    if (!wasActive && active >= config.worker.max_concurrent_tasks) { log(`[ff-worker] khởi động: thẻ ${task.cardId} chờ slot\n`); continue }
    const card = { id: task.cardId, trelloCardId: task.trelloCardId ?? task.cardId, name: task.slug.replace(/-/g, ' ') }
    const session = `${config.worker.tmux.session_prefix ?? 'ff-'}${task.cardId}`
    log(`[ff-worker] khởi động: thẻ ${task.cardId} ở ${polledCard.list}; chạy lại\n`)
    // R1: resuming means a fresh pull first; a failed pull leaves the task waiting.
    if (task.phase !== 'running' || !tmux.hasSession(session, root)) {
      if (!await refreshForRun({ root, config, source, card, task, log })) continue
    }
    const running = await attemptTaskLaunch({ root, config, card, task, resume: true, log,
      launchTask: (nextCard, nextTask, options) => launchAgentTask({ root, config, tmux, card: nextCard, task: nextTask, ...options }) })
    active += Number(running) - Number(wasActive)
  }
}


const epochs = new WeakMap()
const defaultRunners = new WeakMap()
function epochFor(runner) {
  if (!epochs.has(runner)) epochs.set(runner, randomUUID())
  return epochs.get(runner)
}

function storedTasks(root) {
  const dir = path.join(root, '.ff/tasks')
  try { return fs.readdirSync(dir).filter(n => /^[A-Za-z0-9]+\.json$/.test(n)).sort().map(n => readTask(root, n.slice(0, -5))) }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
}

function packageRoot() {
  let current = path.dirname(fileURLToPath(import.meta.url))
  while (path.dirname(current) !== current) {
    if (fs.existsSync(path.join(current, '.claude-plugin/plugin.json'))) return current
    current = path.dirname(current)
  }
  throw new Error('setup:workflow_package_missing')
}

/** Trusted workflow/Gate/HEAD observations, never fields from the dossier. */
export function observeHarnessTask({ root, config, task }) {
  const card = findCardDir(root, config, task.cardId)
  if (!card.dir) throw new Error('setup:card_missing')
  const state = inspectCard(root, config, card.dir)
  const heads = {}
  for (const repo of config.repos ?? []) {
    const copy = repoDir(root, config.workspace.worktrees_dir, path.basename(card.dir), repo)
    if (!fs.existsSync(path.join(copy, '.git'))) continue
    const result = git(copy, ['rev-parse', 'HEAD'])
    if (result.status !== 0 || !/^[a-f0-9]{40,64}$/.test(result.stdout.trim())) throw new Error('setup:source_head_unreadable')
    heads[repo.name] = result.stdout.trim()
  }
  const lock = readVerifyLock(verifyLockPath(root, config))
  state.verifyWaitingOn = lock && lock.slug !== path.basename(card.dir) ? 'verify_lock' : null
  // Delivery views are collected asynchronously by inspectPrShip in the cycle.
  // No completion is inferred from a legacy phase or arbitrary JSON file.
  return { state, heads }
}

/** Serializes reserve-before-effect decisions across overlapping daemon cycles. */
export async function runHarnessCycle({ root, config, source, channel, runner, now = Date.now }) {
  if (config.worker?.driver?.enabled !== true) throw new Error('Harness driver is disabled')
  if (validate(config).length) throw new Error('Invalid harness configuration')
  if (!runner) {
    if (!defaultRunners.has(config)) defaultRunners.set(config, new Map())
    const runners = defaultRunners.get(config)
    if (!runners.has(root)) runners.set(root, new TmuxClaudeRunner({ root, config }))
    runner = runners.get(root)
  }
  const epoch = epochFor(runner)
  const cycle = () => withFileMutexRetry(path.join(root, '.ff/harness-scheduler.lock'), { operation: 'harness-cycle' }, async () => {
    const effects = [], discoveries = await discoverTasks({ root, config, source })
    const cards = new Map(discoveries.map(card => [card.cardId, card]))
    // Trello decides which cards are driven: tasks whose card left the poll lists are parked, not driven.
    await reconcileParking({ root, config, source, channel, tasks: storedTasks(root), polled: cards, now: () => (typeof now === 'function' ? now() : now) })
    const current = storedTasks(root)
    if (runner.tmux) await closeIdleParkedSessions({ root, config, tasks: current, tmux: runner.tmux, now: () => (typeof now === 'function' ? now() : now) })
    const ids = [...new Set([...current.filter(t => !isParked(t)).map(t => t.cardId), ...[...cards.keys()].filter(id => !isParked(readTask(root, id)))])].sort()
    const snapshots = []
    for (const id of ids) {
      let task = readTask(root, id)
      const priorWait = task?.waitingOn ?? null
      // Opt-in never migrates a legacy lifecycle snapshot implicitly.
      if (task && !task.stateVersion) throw new Error('setup:legacy_task_requires_migration')
      const discovery = cards.get(id)
      let workflow
      if (!task) {
        const pkg = packageRoot()
        workflow = prepareWorkflowSnapshot({ root, packageRoot: pkg, cliVersion: JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'))).version })
        task = { cardId: id }
      }
      const observation = observeHarnessTask({ root, config, task })
      observation.ship = await inspectPrShip(root,config,task.cardId,{github:runner.github})
      observation.pr = {repos:(observation.ship.repos??[]).filter(r=>r.pr).map(r=>({repo:r.repo,approvedSourceHead:r.approvedSourceHead,...r.pr}))}
      Object.assign(observation,observeHarnessTask({root,config,task}))
      observation.validateShip=()=>shipSourceIdentity(root,config,task.cardId)===observation.ship?.sourceIdentity
      observation.source=source;observation.channel=channel;observation.github=runner.github
      observation.doneList=taskSourceBlock(config).done_list
      observation.acceptList=taskSourceBlock(config).accept_list
      observation.reopenList=taskSourceBlock(config).reopen_list
      const observed = task.stateVersion ? await runner.inspect(task) : null
      const checkpointAt = typeof now === 'function' ? now() : now
      const verifiedWorking = observed?.status === 'working' && observed.runId === task.runId && observed.claudeSessionId === task.claudeSessionId
      task = await driveTask({ root, config, task, runner, now: checkpointAt, observation: { ...observation, discovery, workflow, allowEffects: false,
        accounting: { kind: 'checkpoint', epoch, at: new Date(checkpointAt).toISOString(), verifiedWorking },
        control: { kind: 'slot', epoch, reserved: task.workingReserved === true },
      } })
      snapshots.push({ task, observation, answered: priorWait !== null && task.waitingOn === null })
    }
    const occupies = task => !task.waitingOn && !['blocked', 'failed'].includes(task.executionStatus) && task.stage !== 'done' && (task.executionStatus === 'working' || task.workingReserved === true)
    let active = snapshots.filter(({ task }) => occupies(task)).length
    const max = config.worker.max_concurrent_tasks ?? 2
    const tasks = []
    const pollOrder = (taskSourceBlock(config).poll_lists ?? []).map(l => String(l).trim().toLowerCase())
    // Doing first (started, then pos, then id); QA Fail cards only after every Doing candidate.
    const rank = ({ task, answered }) => {
      const d = cards.get(task.cardId), list = String(d?.list ?? '').trim().toLowerCase()
      const started = Boolean(task.dispatchId || task.workingMs > 0 || task.workingSince || task.lastProgressAt || task.stage !== 'understand')
      const idx = pollOrder.indexOf(list)
      return [answered ? 0 : 1, ...selectionRank(config, { list, started, pos: d?.pos, id: task.cardId, idx: idx < 0 ? Infinity : idx })]
    }
    const cmp = (a, b) => compareRank(rank(a), rank(b))
    snapshots.sort(cmp)
    for (const entry of snapshots) {
      let { task } = entry
      const held = occupies(task)
      // Waits never dispatch; clear lock wait only when actual lock released and
      // driver has fresh valid build evidence to choose verify again.
      const waiting = task.waitingOn && task.waitingOn !== 'ship_confirm'
      if (!waiting && !['blocked', 'failed'].includes(task.executionStatus) && task.stage !== 'done' && (held || active < max)) {
        if (!held) active++ // reserve BEFORE start/resume/send
        const ship = await inspectPrShip(root,config,task.cardId,{github:runner.github})
        task = await driveTask({ root, config, task: readTask(root, task.cardId), runner, now, observation: { ...entry.observation, ship, trustDialog:t=>{try{return detectDialog(runner.tmux?.capture?.(t.tmuxSession,root,40))?.kind==='trust'}catch{return false}},setupDialog:t=>{try{return detectDialog(runner.tmux?.capture?.(t.tmuxSession,root,40))?.kind==='setup'}catch{return false}}, validateShip:()=>shipSourceIdentity(root,config,task.cardId)===ship.sourceIdentity, pr:{repos:(ship.repos??[]).filter(r=>r.pr).map(r=>({repo:r.repo,approvedSourceHead:r.approvedSourceHead,...r.pr}))}, ...observeHarnessTask({ root, config, task }),
          control: { kind: 'slot', epoch, reserved: true },
        } })
        if (!occupies(task)) active--
        effects.push({ kind: 'drive', cardId: task.cardId })
      }
      tasks.push(task)
    }
    return { tasks, effects }
  })
  try { return await cycle() }
  catch (error) {
    if (!(error instanceof VersionConflictError)) throw error
    // Reread snapshots AND all trusted evidence after CAS contention. Never
    // replay a stale observation or a previous side-effect decision.
    return cycle()
  }
}
