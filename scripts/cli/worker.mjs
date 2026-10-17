import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { readTask, harnessTaskStatus } from '../../ff-worker/src/core/task-store.mjs'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { runDoctor, whichInPath } from '../lib/doctor.mjs'
import { appendHarnessEvent } from '../lib/harness-events.mjs'
import { redactHumanText } from '../lib/human-output.mjs'
import { inferCardId as inferCard } from '../lib/card-context.mjs'
import { workerRequest } from '../lib/worker-client.mjs'
import { cardRows, formatRows } from '../lib/card-status.mjs'
import { appendResolutionRecord, blockFingerprint, classifyBlock } from '../lib/human-resolution.mjs'

export const summary = 'worker <start|stop|status|logs|resolve|park> — quản lý worker trong tmux; resolve <id> --reason "…" gỡ chặn needs_human sau khi bạn đã xử lý; park [<id>] [--comment-file <path>] tạm dừng thẻ'

const REFUSALS = {
  not_blocked: 'thẻ không ở trạng thái blocked; không có gì để gỡ.',
  repair_limit: 'đã hết 3 vòng sửa; không có vòng sửa thứ 4. Mở lại (ff reopen) hoặc tạo thẻ Fix mới.',
  pr_closed_use_fix: 'PR đã đóng; dùng thẻ Fix mới thay vì gỡ chặn.',
  integrity: 'đây là chặn toàn vẹn (danh tính phiên/workflow pin/gửi lệnh). Danh tính và việc gửi lệnh phải được chứng minh, không thể bỏ qua bằng ghi chú; xử lý nguyên nhân rồi để worker tự kiểm tra lại.',
  unsupported: 'loại chặn này không gỡ được bằng resolve; xem ff worker status.',
}

async function resolveBlock(args, ctx) {
  const [id, ...opts] = args
  let reason = null
  if (!id || !/^[A-Za-z0-9]+$/.test(id) || opts.length !== 2 || opts[0] !== '--reason') reason = undefined
  else reason = opts[1].trim()
  if (!reason) { ctx.stderr.write('dùng: ff worker resolve <id> --reason "<lý do không rỗng>" (bắt buộc --reason)\n'); return 2 }
  const root = findRoot(ctx.cwd)
  if (!root) return missingRoot(ctx)
  const config = loadConfig(root).config
  if (!config.worker?.driver?.enabled) { ctx.stderr.write('ff worker resolve: harness driver chưa bật\n'); return 4 }
  const task = readTask(root, id)
  if (!task) { ctx.stderr.write(`ff worker resolve: không có task ${id}\n`); return 1 }
  const verdict = classifyBlock(task)
  if (!verdict.ok) { ctx.stderr.write(`ff worker resolve: ${REFUSALS[verdict.code]}\n`); return 1 }
  const at = new Date(typeof ctx.now === 'function' ? ctx.now() : ctx.now ?? Date.now()).toISOString()
  const fingerprint = blockFingerprint(task)
  const record = { at, reason: redactHumanText(reason), cardId: task.cardId, revision: task.revision ?? '', runId: task.runId, stage: task.stage,
    blockReason: task.blockReason ?? null, waitingOn: task.waitingOn, stateVersion: task.stateVersion, fingerprint }
  await appendResolutionRecord(root, record)
  // The driver is the only task writer: it applies this scoped event on its next cycle if the block is still the same.
  await appendHarnessEvent(root, { eventId: `human_resolved:${fingerprint}:${at}`, cardId: task.cardId, revision: record.revision, runId: task.runId, dispatchId: task.dispatchId ?? '',
    type: 'human_resolved', at, payload: { stage: task.stage, blockReason: record.blockReason, waitingOn: task.waitingOn, stateVersion: task.stateVersion, fingerprint, reason: record.reason } })
  ctx.stdout.write(`ff worker resolve: đã ghi xác nhận cho thẻ ${id} (${task.blockReason ?? task.waitingOn}); worker sẽ áp dụng ở vòng kế tiếp. Số vòng sửa không bị reset.\n`)
  return 0
}

async function parkTask(args, ctx) {
  const usage = 'dùng: ff worker park [<cardId>] [--comment-file <path>]\n'
  let cardId = null, commentFile = null
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--comment-file' && args[i + 1] && !commentFile) commentFile = args[++i]
    else if (!args[i].startsWith('--') && !cardId && /^[A-Za-z0-9]+$/.test(args[i])) cardId = args[i]
    else { ctx.stderr.write(usage); return 2 }
  }
  const root = findRoot(ctx.cwd)
  if (!root) return missingRoot(ctx)
  const config = loadConfig(root).config
  const env = ctx.env ?? process.env
  if (cardId && /^[A-Za-z0-9]+$/.test(env.FF_CARD_ID ?? '') && cardId !== env.FF_CARD_ID) {
    ctx.stderr.write(`ff worker park: phiên này chỉ tạm dừng được thẻ #${env.FF_CARD_ID}\n`); return 1
  }
  cardId ??= inferCard(root, config, { env: ctx.env ?? process.env, cwd: ctx.cwd }) || null
  if (!cardId) { ctx.stderr.write('ff worker park: không suy ra được thẻ từ thư mục hiện tại; truyền <cardId>\n'); return 2 }
  if (!readTask(root, cardId)) { ctx.stderr.write(`ff worker park: không có task ${cardId}\n`); return 1 }
  let comment = ''
  if (commentFile) {
    try { comment = fs.readFileSync(path.resolve(ctx.cwd, commentFile), 'utf8').trim() }
    catch { ctx.stderr.write(`ff worker park: không đọc được ${commentFile}\n`); return 1 }
  }
  let result
  try { result = await workerRequest(root, '/park', { cardId, comment }, ctx.fetch) }
  catch (e) {
    ctx.stderr.write(`ff worker park: worker không chạy hoặc không phản hồi (${e.message}); chưa thay đổi gì. Chạy /ff-worker start rồi thử lại.\n`)
    return 1
  }
  ctx.stdout.write(`ff worker park: đã tạm dừng thẻ ${cardId}${result.alreadyParked ? ' (đã tạm dừng từ trước)' : ''}\n`)
  if (result.errors?.length) {
    for (const e of result.errors) ctx.stderr.write(`ff worker park: ${e}\n`)
    ctx.stderr.write('Thẻ vẫn ở trạng thái tạm dừng; xử lý phần lỗi thủ công trên Trello.\n')
    return 1
  }
  return 0
}

function tmux(args, root, ctx) {
  if (ctx.runTmux) return ctx.runTmux(args, root)
  return spawnSync('tmux', args, { cwd: root, encoding: 'utf8', timeout: 10000 })
}

function readStatus(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, '.ff/worker.json'), 'utf8')) } catch { return null }
}

function session(config) { return config.worker.tmux.session_name ?? 'ff-worker' }
function exactTarget(config) { return `=${session(config)}` }

export async function run(args, ctx) {
  const [action, ...rest] = args
  if (action === 'park') return parkTask(rest, ctx)
  if (action === 'resolve' && !(rest.length === 1 && ['--help', '-h'].includes(rest[0]))) return resolveBlock(rest, ctx)
  if (action === 'resolve') { ctx.stdout.write('dùng: ff worker resolve <id> --reason "<lý do>" — người dùng xác nhận đã xử lý chặn needs_human/setup; không gỡ được repair_limit hoặc chặn toàn vẹn\n'); return 0 }
  if (!['start', 'stop', 'status', 'logs'].includes(action) || (action !== 'logs' && action !== 'status' && rest.length) || (action === 'status' && rest.some((a) => !['--json', '--verbose'].includes(a)))) {
    ctx.stderr.write('dùng: ff worker <start|stop|status [--json|--verbose]|logs [-n 100]|resolve <id> --reason "…"|park [<id>] [--comment-file <path>]>\n')
    return 2
  }
  if (action === 'logs') {
    let count = 100
    if (rest.length) {
      if (rest.length !== 2 || rest[0] !== '-n' || !/^\d+$/.test(rest[1]) || Number(rest[1]) < 1 || Number(rest[1]) > 5000) {
        ctx.stderr.write('dùng: ff worker logs [-n 1..5000]\n')
        return 2
      }
      count = Number(rest[1])
    }
    const root = findRoot(ctx.cwd)
    if (!root) return missingRoot(ctx)
    const config = loadConfig(root).config
    const r = tmux(['capture-pane', '-p', '-t', `${exactTarget(config)}:`, '-S', `-${count}`], root, ctx)
    if (r.status !== 0) { ctx.stderr.write('ff worker logs: không đọc được tmux session\n'); return 1 }
    ctx.stdout.write(r.stdout ?? '')
    return 0
  }
  const root = findRoot(ctx.cwd)
  if (!root) return missingRoot(ctx)
  const loaded = loadConfig(root)
  const config = loaded.config
  const target = exactTarget(config)
  const status = readStatus(root)

  if (action === 'status') {
    const exists = tmux(['has-session', '-t', target], root, ctx).status === 0
    const asJson = rest.includes('--json')
    if (!asJson) ctx.stdout.write(`ff worker: ${exists ? (status?.state ?? 'đang chạy, chưa có status') : (status?.state === 'crashed' ? 'crashed' : 'không chạy')}\n`)
    if (!asJson && exists && status) ctx.stdout.write(`adapter: ${status.adapter ?? 'đang khởi động'} · pid: ${status.pid ?? '—'} · port: ${status.port ?? '—'}\n`)
    const dir = path.join(root, '.ff/tasks')
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => /^[A-Za-z0-9]+\.json$/.test(n)).sort() : []
    const rows = cardRows(files.map(f => readTask(root, f.slice(0, -5))).filter(Boolean), { now: typeof ctx.now === 'function' ? ctx.now() : ctx.now ?? Date.now() })
    if (asJson) ctx.stdout.write(`${JSON.stringify(rows)}\n`)
    else if (rows.length) ctx.stdout.write(`${formatRows(rows)}\n`)
    if (!asJson) {
      let waiting = {}
      try { waiting = JSON.parse(fs.readFileSync(path.join(root, '.ff/waiting.json'), 'utf8')) } catch {}
      for (const [id, deps] of Object.entries(waiting)) if (/^[A-Za-z0-9]+$/.test(id) && Array.isArray(deps)) ctx.stdout.write(`thẻ #${id}: chờ thẻ ${deps.map((d) => `#${String(d).replace(/[^A-Za-z0-9]/g, '')}`).join(', ')}\n`)
    }
    if (config.worker?.driver?.enabled && !asJson) {
      for (const file of files) {
        const raw = readTask(root, file.slice(0, -5))
        const task = harnessTaskStatus(raw)
        if (rest.includes('--verbose')) ctx.stdout.write(`card=${task.cardId} stage=${task.stage} waitingOn=${task.waitingOn ?? '—'} since=${task.since ?? '—'} revision=${task.revision || 'root'} PR=${JSON.stringify(task.pr)} dev=${task.devHashes.join(',') || '—'} attention_pending=${task.attention.pending} attention_unknown=${task.attention.unknown} state=${raw.parked ? 'PARKED' : 'ACTIVE'}\n`)
        if (raw.parked && rest.includes('--verbose')) ctx.stdout.write(`  PARKED reason=${raw.parked.reason === 'chat' ? 'chat' : 'trello'} since=${raw.parked.at ?? '—'}${raw.parked.list ? ` list=${raw.parked.list}` : ''}\n`)
        if (raw.executionStatus === 'blocked') {
          const safe = value => /^[a-z0-9_:-]{1,80}$/i.test(value ?? '') ? value : '—'
          ctx.stdout.write(`  chặn: ${safe(raw.blockReason ?? raw.waitingOn)}${classifyBlock(raw).ok ? ` · sau khi xử lý xong: ff worker resolve ${task.cardId} --reason "…"` : ''}\n`)
        }
      }
    }
    return status?.state === 'crashed' ? 1 : 0
  }
  if (action === 'stop') {
    const pid = Number.isInteger(status?.pid) && status.pid > 0 ? status.pid : null
    const wait = ctx.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    const exists = tmux(['has-session', '-t', target], root, ctx).status === 0
    // send-keys là lệnh pane: tmux cần `=name:` (có dấu hai chấm), khác với lệnh session.
    const sent = exists && tmux(['send-keys', '-t', `${target}:`, 'C-c'], root, ctx).status === 0
    if (sent && !pid) { ctx.stdout.write('ff worker: đã yêu cầu dừng êm (C-c)\n'); return 0 }
    if (sent) {
      for (let i = 0; i < 40 && pidAlive(pid); i++) await wait(250)
      if (!pidAlive(pid)) { ctx.stdout.write('ff worker: đã dừng êm (C-c)\n'); return 0 }
    }
    if (pid && pidAlive(pid)) {
      try { process.kill(pid, 'SIGTERM') } catch { ctx.stderr.write(`ff worker stop: không gửi được SIGTERM tới pid ${pid}\n`); return 1 }
      ctx.stdout.write(`ff worker: ${sent ? 'C-c không dừng được sau 10 giây' : 'không dùng được tmux'}; đã gửi SIGTERM tới pid ${pid}\n`)
      return 0
    }
    if (!exists) { ctx.stdout.write('ff worker: không chạy\n'); return 0 }
    ctx.stderr.write('ff worker stop: không gửi được tín hiệu dừng\n')
    return 1
  }

  const doctor = runDoctor(root, loaded)
  if (!doctor.groups.core || !doctor.groups.worker) {
    const errors = doctor.checks.filter((c) => !c.ok && ['core', 'worker'].includes(c.group)).map((c) => c.msg)
    ctx.stderr.write(`ff worker start: doctor core/worker đỏ; ${errors.join('; ')}\n`)
    return 4
  }
  if (!(ctx.which ?? whichInPath)('tmux', root)) { ctx.stderr.write('ff worker start: không tìm thấy tmux trong PATH\n'); return 4 }
  const exists = tmux(['has-session', '-t', target], root, ctx).status === 0
  if (exists) {
    if (status?.state === 'ready') { ctx.stdout.write(`ff worker: đang chạy trong tmux session ${session(config)}\n`); return 0 }
    ctx.stderr.write(`ff worker: tmux session ${session(config)} đã tồn tại; kiểm tra bằng ff worker status trước khi tạo phiên khác\n`)
    return 1
  }
  const pluginRoot = ctx.pluginRoot ?? inferPluginRoot()
  const supervisor = path.join(pluginRoot, 'dist', 'worker-supervise.mjs')
  const workerEntry = path.join(pluginRoot, 'ff-worker/dist/index.mjs')
  if (!fs.existsSync(workerEntry)) { ctx.stderr.write(`ff worker start: thiếu ${workerEntry}; chạy npm run build\n`); return 4 }
  const command = tmux(['new-session', '-d', '-s', session(config), '-c', root, process.execPath, supervisor, '--config', path.join(root, 'ff.config.yaml'), '--worker', workerEntry], root, ctx)
  if (command.status !== 0) { ctx.stderr.write('ff worker start: tmux không tạo được session\n'); return 1 }
  for (let i = 0; i < 30; i++) {
    const wait = ctx.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    await wait(1000)
    const current = readStatus(root)
    if (current?.state === 'ready') {
      ctx.stdout.write([
        `Đang chạy: worker trong tmux session ${session(config)}, TaskSource ${config.worker.task_source.adapter}, thông báo qua ${config.worker.channel.adapter}.`,
        `Xem thế nào: tmux a -t ${session(config)} (thoát phiên bằng Ctrl-b rồi d).`,
        `Duyệt Gate: mở phiên Remote Control 'ff-<id> <slug>' (Claude app/claude.ai/code) hoặc tmux a -t ${config.worker.tmux.session_prefix ?? 'ff-'}<id> (cần cho lệnh ! như ff worker resolve).`,
        'Dừng/khởi động lại: /ff-worker stop / /ff-worker start; sửa config hoặc .ff.env sẽ nạp lại.',
        'Còn thiếu: không.',
        '',
      ].join('\n'))
      return 0
    }
    if (current?.state === 'crashed') break
  }
  ctx.stderr.write('ff worker start: worker chưa ready sau 30 giây; xem ff worker logs\n')
  return 1
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

function missingRoot(ctx) { ctx.stderr.write('ff worker: không thấy ff.config.yaml\n'); return 4 }

export function inferPluginRoot(argv1 = process.argv[1]) {
  let entry
  try { entry = fs.realpathSync(path.resolve(argv1 ?? process.cwd())) } catch { entry = path.resolve(argv1 ?? process.cwd()) }
  const dir = path.dirname(entry)
  return ['bin', 'dist'].includes(path.basename(dir)) ? path.dirname(dir) : process.cwd()
}
