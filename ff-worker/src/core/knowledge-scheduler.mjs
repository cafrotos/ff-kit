// Lập lịch dreaming trong cửa sổ rảnh (SRS 6.1 yêu cầu 5, 6.3): mỗi vòng worker gọi knowledgeTick().
// Quét tín hiệu → xếp việc vào .ff/knowledge/queue.jsonl → chạy TỐI ĐA MỘT việc khi không thẻ nào `working` và quota đủ.
// Việc chạy nền (child process có timeout), không chặn vòng poll. Chạy được khi driver bật hoặc tắt.
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { readKnowledgeEvents } from '../../../scripts/lib/knowledge-log.mjs'
import { enqueueJob, readQueue, patchJob, dueJobs, compactQueue } from '../../../scripts/lib/dream-queue.mjs'
import { readTask } from './task-store.mjs'
import { isParked } from './park.mjs'
import * as dream from '../../../scripts/lib/dream.mjs'

const MIN = 60000
const ticking = new Set()
const inflight = new Map() // root -> Promise của việc đang chạy trong tiến trình này

// ---------- quota ----------
const cswapCache = new Map()
/** `cswap list --json` → {status:'ok', json} | {status:'missing'} | {status:'error', error}. Cache 60 giây. */
export function readCswap(bin = 'cswap', now = Date.now()) {
  const hit = cswapCache.get(bin)
  if (hit && now - hit.at < 60000) return hit.value
  const r = spawnSync(bin, ['list', '--json'], { encoding: 'utf8', timeout: 10000 })
  let value
  if (r.error?.code === 'ENOENT') value = { status: 'missing' }
  else if (r.status !== 0) value = { status: 'error', error: `cswap thoát ${r.status}` }
  else { try { value = { status: 'ok', json: JSON.parse(r.stdout) } } catch { value = { status: 'error', error: 'cswap không trả JSON' } } }
  cswapCache.set(bin, { at: now, value })
  return value
}
export const resetCswapCache = () => cswapCache.clear()

/**
 * Ánh xạ đầu ra cswap: tài khoản đang dùng (accounts[].active, hoặc number === activeAccountNumber);
 * accounts[].usage.fiveHour.pct / usage.sevenDay.pct (0-100); usageStatus phải 'ok'; usageAgeSeconds ≤ max_age_sec.
 * Thiếu/lạ → KHÔNG chạy (đóng-khi-không-chắc).
 */
export function evalCswap(json, q) {
  const accounts = Array.isArray(json?.accounts) ? json.accounts : []
  const acc = accounts.find(a => a.active === true) ?? accounts.find(a => a.number === json?.activeAccountNumber)
  if (!acc) return { ok: false, reason: 'cswap: không thấy tài khoản đang dùng' }
  if (acc.usageStatus !== 'ok') return { ok: false, reason: `cswap: usageStatus=${acc.usageStatus ?? '?'}` }
  const five = acc.usage?.fiveHour?.pct, seven = acc.usage?.sevenDay?.pct
  if (!Number.isFinite(five) || !Number.isFinite(seven)) return { ok: false, reason: 'cswap: thiếu pct 5 giờ/7 ngày' }
  if (Number.isFinite(acc.usageAgeSeconds) && acc.usageAgeSeconds > q.max_age_sec) return { ok: false, reason: `cswap: số liệu cũ ${Math.round(acc.usageAgeSeconds)} giây` }
  const info = { source: 'cswap', fiveHour: five, sevenDay: seven }
  if (five >= q.five_hour_max) return { ok: false, reason: `quota 5 giờ ${five}% ≥ ${q.five_hour_max}%`, ...info }
  if (seven >= q.seven_day_max) return { ok: false, reason: `quota 7 ngày ${seven}% ≥ ${q.seven_day_max}%`, ...info }
  return { ok: true, ...info }
}
/** "1-6" / "22-6" (qua nửa đêm) theo giờ máy. */
export function hoursOk(spec, date = new Date()) {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(spec ?? '').trim())
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])], h = date.getHours()
  return a === b ? true : a < b ? h >= a && h < b : h >= a || h < b
}
export function checkQuota(config, { cswap = readCswap, now = Date.now() } = {}) {
  const q = dream.quotaCfg(config)
  const r = cswap(q.cswap_bin, now)
  if (r.status === 'missing') return hoursOk(q.allowed_hours, new Date(now)) ? { ok: true, source: 'hours' } : { ok: false, source: 'hours', reason: `không có cswap; ngoài giờ cho phép ${q.allowed_hours}` }
  if (r.status !== 'ok') return { ok: false, reason: r.error ?? 'cswap lỗi' }
  return evalCswap(r.json, q)
}

// ---------- agent đang làm? ----------
export function loadTasks(root) {
  const dir = path.join(root, '.ff', 'tasks')
  try { return fs.readdirSync(dir).filter(n => /^[A-Za-z0-9]+\.json$/.test(n)).sort().map(n => readTask(root, n.slice(0, -5))).filter(Boolean) } catch { return [] }
}
const FINISHED = ['done', 'completed', 'failed']
/** Thẻ có agent đang chạy: driver → executionStatus working/đã giữ chỗ; bản cũ → phase running/received (không tính chờ người/park). */
export function agentActive(task) {
  if (isParked(task)) return false
  if (task.stateVersion) return !task.waitingOn && task.stage !== 'done' && (task.executionStatus === 'working' || task.workingReserved === true)
  return ['received', 'running'].includes(task.phase) && task.attention?.who !== 'human'
}
export const anyAgentActive = tasks => tasks.some(agentActive)

// ---------- quét tín hiệu ----------
async function loadEvolve() {
  try { const m = await import('../../../scripts/lib/evolve.mjs'); return typeof m.evolveJobs === 'function' ? m : null } catch { return null }
}
async function fetchAsync(root, repo, ms = 60000) {
  return new Promise(resolve => {
    const b = repo.base_branch
    const c = spawn('git', ['fetch', '--no-tags', 'origin', `+refs/heads/${b}:refs/remotes/origin/${b}`], { cwd: path.resolve(root, repo.path), stdio: 'ignore' })
    const t = setTimeout(() => { try { c.kill('SIGKILL') } catch { /* xong */ } resolve(false) }, ms)
    c.on('error', () => { clearTimeout(t); resolve(false) })
    c.on('close', code => { clearTimeout(t); resolve(code === 0) })
  })
}

export async function scanSignals({ root, config, tasks, now = Date.now(), fetchFn = fetchAsync, evolveMod, log = () => {} }) {
  const added = []
  const add = (kind, key, payload) => { const r = enqueueJob(root, { kind, key, payload }, now); if (!r.existing) added.push(`${kind}:${key}`) }
  let st = dream.readDreamState(root)
  if (!st.sinceAt) st = dream.writeDreamState(root, { sinceAt: new Date(now).toISOString() })
  // D1: thẻ đã vào base_branch / xong (KNW-05) sau khi bật dreaming.
  for (const e of readKnowledgeEvents(root, { type: 'outcome_recorded' })) {
    if (!['merged', 'done'].includes(e.outcome) || Date.parse(e.at) < Date.parse(st.sinceAt)) continue
    add('D1', `D1:${e.cardId}:${e.revision ?? ''}`, { cardId: e.cardId, revision: e.revision ?? '' })
  }
  // D0 lười: miền thẻ đang làm chạm tới mà chưa có trang.
  let lazy = 0
  for (const t of tasks) {
    if (lazy >= 3) break
    if (FINISHED.includes(t.stage ?? t.phase) || isParked(t)) continue
    let miss = []
    try { miss = dream.uncoveredDomains(root, config, t.cardId) } catch { /* thẻ chưa có design */ }
    for (const m of miss.slice(0, 3 - lazy)) { add('D0', `D0:${m.repo}:${m.domain}`, m); lazy++ }
  }
  // D0': base_branch đổi (fetch tối đa mỗi fetch_interval_min phút, chỉ repo đã lập wiki).
  const cfg = dream.dreamCfg(config)
  const fetchedAt = { ...st.fetchedAt }
  for (const repo of config.repos ?? []) {
    if (!st.repos[repo.name]) continue
    if (now - (fetchedAt[repo.name] ?? 0) >= cfg.fetch_interval_min * MIN) {
      fetchedAt[repo.name] = now
      try { await fetchFn(root, repo) } catch (e) { log(`[ff-worker] knowledge: fetch ${repo.name} lỗi (${e.message})\n`) }
    }
    const mv = dream.detectBaseMove(root, config, repo.name)
    if (mv) add('D0p', `D0p:${repo.name}:${mv.to.slice(0, 10)}`, { repo: repo.name, to: mv.to })
  }
  dream.writeDreamState(root, { fetchedAt })
  // D2
  if (dream.d2Due(root, config, now)) add('D2', `D2:${dream.readDreamState(root).lastD2At ?? 'first'}`, {})
  // Mức 5: tín hiệu tiến hóa (nếu module có).
  const ev = evolveMod === undefined ? await loadEvolve() : evolveMod
  if (ev) {
    let jobs = []
    try { jobs = ev.evolveJobs(root, config) } catch (e) { log(`[ff-worker] knowledge: evolveJobs lỗi (${e.message})\n`) }
    for (const j of jobs) add('evolve', `evolve:${j.skill}:${j.route}:${[...(j.cards ?? [])].sort().join(',')}`, { skill: j.skill, route: j.route, cards: j.cards ?? [] })
  }
  return added
}

// ---------- chạy việc ----------
const backoffMs = (cfg, attempts) => cfg.backoff_min * MIN * 4 ** Math.max(0, attempts - 1)

async function execute({ root, config, job, runJobFn, channel, log, now, evolveMod, runner }) {
  const cfg = dream.dreamCfg(config)
  const t0 = typeof now === 'function' ? now() : now
  try {
    const opts = { runner, evolve: evolveMod?.proposeEvolution ? j => evolveMod.proposeEvolution(root, config, { skill: j.payload.skill, route: j.payload.route }) : undefined }
    const res = await runJobFn(root, config, job, opts)
    patchJob(root, job.id, { status: 'done', finishedAt: new Date().toISOString(), result: String(res?.text ?? '').slice(0, 500), error: null })
    log(`[ff-worker] knowledge: ${job.kind} ${job.id} xong: ${res?.text ?? ''}\n`)
    if (res?.text && !/Wiki không đổi\.?$/.test(res.text)) {
      try { await channel?.notify({ taskId: String(job.payload?.cardId ?? ''), kind: 'info', title: `Wiki dự án: ${job.kind}`, body: res.text }) } catch { log('[ff-worker] knowledge: gửi tóm tắt thất bại\n') }
    }
    return { ok: true, text: res?.text }
  } catch (e) {
    const attempts = job.attempts // đã tăng khi bắt đầu
    const final = attempts >= cfg.max_attempts
    const msg = String(e.message ?? e).slice(0, 300)
    patchJob(root, job.id, final ? { status: 'failed', failedAt: new Date().toISOString(), error: msg } : { status: 'queued', notBefore: new Date(t0 + backoffMs(cfg, attempts)).toISOString(), error: msg })
    log(`[ff-worker] knowledge: ${job.kind} ${job.id} lỗi lần ${attempts}/${cfg.max_attempts} (${msg})${final ? '; bỏ' : '; thử lại sau'}\n`)
    if (final) { try { await channel?.notify({ kind: 'error', title: `Wiki dự án: ${job.kind} thất bại`, body: `${msg} (sau ${attempts} lần)` }) } catch { /* không chặn */ } }
    return { ok: false, error: msg }
  }
}

/**
 * Một nhịp lập lịch. Trả {status, reason?, job?, done?}: `done` resolve khi việc vừa khởi chạy kết thúc (runtime không await).
 * force: bỏ cổng enabled/busy/quota (ff knowledge run --force).
 */
export async function knowledgeTick(opts) {
  const root = opts.root
  if (ticking.has(root)) return { status: 'ticking' }
  ticking.add(root)
  try { return await tickOnce(opts) } finally { ticking.delete(root) }
}
async function tickOnce({ root, config, channel, log = () => {}, now = Date.now, tasks, cswap = readCswap, runJobFn = dream.runJob, fetchFn, evolveMod, runner, force = false }) {
  const cfg = dream.dreamCfg(config)
  if (!force && !cfg.enabled) return { status: 'disabled' }
  const at = typeof now === 'function' ? now() : now
  tasks ??= loadTasks(root)
  if (inflight.has(root)) return { status: 'inflight' }
  const ev = evolveMod === undefined ? await loadEvolve() : evolveMod
  if (!force) { try { await scanSignals({ root, config, tasks, now: at, fetchFn, evolveMod: ev, log }) } catch (e) { log(`[ff-worker] knowledge: quét lỗi (${e.message})\n`) } }
  try { await compactQueue(root) } catch { /* không quan trọng */ }
  let q = readQueue(root)
  // Việc "running" quá hạn timeout mà tiến trình này không giữ = worker từng chết giữa chừng: xếp lại (lần thử đã tính).
  const orphans = q.jobs.filter(j => j.status === 'running' && Date.parse(j.startedAt) < at - dream.timeoutMs(config, j.kind) - 120000)
  for (const j of orphans) patchJob(root, j.id, { status: 'queued', error: 'worker khởi động lại giữa chừng' })
  if (orphans.length) q = readQueue(root)
  const due = dueJobs(q.jobs, at)
  if (!due.length) return { status: 'idle' }
  if (!force) {
    if (anyAgentActive(tasks)) return { status: 'busy', reason: 'có thẻ đang working', queued: due.length }
    const quota = checkQuota(config, { cswap, now: at })
    if (!quota.ok) return { status: 'quota', reason: quota.reason, queued: due.length }
  }
  const job = { ...due[0], attempts: due[0].attempts + 1 }
  patchJob(root, job.id, { status: 'running', attempts: job.attempts, startedAt: new Date(at).toISOString() }, at)
  const done = execute({ root, config, job, runJobFn, channel, log, now: at, evolveMod: ev, runner }).finally(() => inflight.delete(root))
  inflight.set(root, done)
  return { status: 'started', job: { id: job.id, kind: job.kind, key: job.key }, done }
}

/** Cho `ff knowledge queue` và doctor. */
export function queueStatus(root, now = Date.now()) {
  const { jobs, evidence } = readQueue(root)
  const count = s => jobs.filter(j => j.status === s).length
  return { queued: count('queued'), running: count('running'), done: count('done'), failed: count('failed'), evidence: evidence.length, jobs: jobs.filter(j => ['queued', 'running', 'failed'].includes(j.status)), recent: jobs.filter(j => j.status === 'done').slice(-5), due: dueJobs(jobs, now).length }
}
