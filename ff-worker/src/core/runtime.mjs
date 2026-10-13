import fs from 'node:fs'
import path from 'node:path'
import { findRoot, loadConfig } from '../../../scripts/lib/config.mjs'
import { validate } from '../../../scripts/lib/schema.mjs'
import { runDoctor } from '../../../scripts/lib/doctor.mjs'
import { acquireVerifyLock, releaseVerifyLock, verifyLockPath } from '../../../scripts/lib/verify-lock.mjs'
import { createAdapters } from '../adapters/index.mjs'
import { processTasks } from './worker.mjs'
import { startWorkerHttp } from './http.mjs'
import { watchConfig } from './reload.mjs'
import { writeWorkerStatus } from './status.mjs'
import { Tmux } from './tmux.mjs'
import { launchAgentTask } from './worker.mjs'
import { readTask, writeTask } from './task-store.mjs'
import { findCardDir } from '../../../scripts/lib/cards.mjs'
import { isApproved } from '../../../scripts/lib/gates.mjs'

export function inspectConfig(root) {
  const loaded = loadConfig(root)
  const errors = validate(loaded.config)
  if (!errors.length) {
    const doctor = runDoctor(root, loaded)
    for (const check of doctor.checks) if (!check.ok && ['core', 'worker'].includes(check.group)) errors.push(new Error(check.msg))
  }
  return { loaded, errors }
}

export async function runWorker({ configPath, source: injectedSource, channel: injectedChannel, processLike = process, log = (line) => process.stdout.write(line), watch = true, httpStarter = startWorkerHttp, tmux = new Tmux() } = {}) {
  const absoluteConfig = path.resolve(configPath ?? path.join(process.cwd(), 'ff.config.yaml'))
  const root = findRoot(path.dirname(absoluteConfig))
  if (!root || path.resolve(root, 'ff.config.yaml') !== absoluteConfig) throw new Error(`không tìm thấy ff.config.yaml tại ${absoluteConfig}`)
  const inspected = inspectConfig(root)
  if (inspected.errors.length) throw new Error(`doctor core/worker đỏ: ${inspected.errors.map((e) => e.message).join('; ')}`)
  const config = inspected.loaded.config
  const adapters = (injectedSource && injectedChannel) ? { source: injectedSource, channel: injectedChannel } : createAdapters({ root, config })
  const lockFile = verifyLockPath(root, config)
  const api = await httpStarter({
    root, port: config.worker.http.port, channel: adapters.channel,
    adapter: `${adapters.source.name}/${adapters.channel.name}`,
    handlers: {
      verifyLock(body) {
        if (!['acquire', 'release'].includes(body?.action) || typeof body.slug !== 'string' || !body.slug) throw Object.assign(new Error('invalid verify-lock request'), { status: 400 })
        return body.action === 'acquire' ? acquireVerifyLock(lockFile, body.slug) : releaseVerifyLock(lockFile, body.slug)
      },
      async shipRequest(body) {
        if (!body || typeof body.title !== 'string' || !body.title.trim()) throw Object.assign(new Error('invalid ship request'), { status: 400 })
        await adapters.channel.notify({ kind: 'ask', taskId: String(body.taskId ?? ''), title: body.title, body: String(body.body ?? '') })
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
      await checkCompletedTasks({ root, config, source: adapters.source, channel: adapters.channel, tmux, log })
      await processTasks({ root, config, source: adapters.source, channel: adapters.channel, launchTask: (card, task, options) => launchAgentTask({ root, config, tmux, card, task, ...options }), log })
    }
    catch (e) {
      log(`[ff-worker] vòng poll lỗi (${e.message})\n`)
      try { await adapters.channel.notify({ kind: 'error', title: 'Worker polling lỗi', body: e.message }) } catch {}
    }
  }
  let polling = false
  const safeCycle = async () => {
    if (polling || stopping) return
    polling = true
    try { await cycle() } finally { polling = false }
  }
  const onSignal = () => { void shutdown(0) }
  processLike.once('SIGINT', onSignal)
  processLike.once('SIGTERM', onSignal)
  await checkCompletedTasks({ root, config, source: adapters.source, channel: adapters.channel, tmux, log })
  await recoverTasks(root, config, tmux, log)
  await safeCycle()
  const seconds = config.worker.task_source?.trello?.poll_interval_sec ?? 30
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

export async function checkCompletedTasks({ root, config, source, channel, tmux, log = () => {} }) {
  const dir = path.join(root, '.ff', 'tasks')
  let files = []
  try { files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')) } catch { return [] }
  const completed = []
  for (const file of files) {
    const id = path.basename(file, '.json')
    const task = readTask(root, id)
    if (!task || ['completed', 'failed'].includes(task.phase)) continue
    const card = findCardDir(root, config, id)
    if (!card.dir) continue
    const report = path.join(card.dir, '05-verify-report.md')
    let content
    try { content = fs.readFileSync(report, 'utf8') } catch { continue }
    const ledgerPath = path.join(card.dir, '01b-ledger.md')
    let ledger = null
    try { ledger = fs.readFileSync(ledgerPath, 'utf8') } catch {}
    if (!isApproved(root, id, 'GATE_C', '05-verify-report.md', content, ledger)) continue
    const doneList = config.worker.task_source?.trello?.done_list
    try {
      if (!doneList) throw new Error('chưa cấu hình done_list')
      await source.moveTo(task.trelloCardId ?? id, doneList)
    } catch (e) {
      log(`[ff-worker] không chuyển được thẻ ${id} sang ${doneList ?? 'done_list'} (${e.message})\n`)
      continue
    }
    task.phase = 'completed'
    task.completedAt = new Date().toISOString()
    writeTask(root, task)
    const session = task.session ?? `${config.worker.tmux.session_prefix ?? 'ff-'}${id}`
    if (config.worker.tmux.cleanup_on_success) tmux?.killSession(session, root)
    try { await channel.notify({ taskId: id, kind: 'done', title: `Thẻ #${id} đã qua Gate C`, body: `Đã hoàn tất: ${task.slug}` }) } catch {}
    completed.push(task)
  }
  return completed
}

async function recoverTasks(root, config, tmux, log) {
  const dir = path.join(root, '.ff', 'tasks')
  let files = []
  try { files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')) } catch { return }
  for (const file of files) {
    const id = path.basename(file, '.json')
    const task = readTask(root, id)
    if (!task || ['completed', 'failed'].includes(task.phase)) continue
    const card = { id, trelloCardId: task.trelloCardId ?? id, name: task.slug.replace(/-/g, ' ') }
    try {
      const resumed = await launchAgentTask({ root, config, tmux, card, task, resume: true })
      task.phase = 'running'
      task.session = resumed.session
      task.updatedAt = new Date().toISOString()
      writeTask(root, task)
    } catch (e) { log(`[ff-worker] không khôi phục được thẻ ${id} (${e.message})\n`) }
  }
}
