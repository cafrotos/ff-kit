import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { runDoctor, whichInPath } from '../lib/doctor.mjs'

export const summary = 'worker <start|stop|status|logs> — quản lý worker trong tmux'

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
  if (!['start', 'stop', 'status', 'logs'].includes(action) || (action !== 'logs' && rest.length)) {
    ctx.stderr.write('dùng: ff worker <start|stop|status|logs [-n 100]>\n')
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
    const r = tmux(['capture-pane', '-p', '-t', exactTarget(config), '-S', `-${count}`], root, ctx)
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
    ctx.stdout.write(`ff worker: ${exists ? (status?.state ?? 'đang chạy, chưa có status') : (status?.state === 'crashed' ? 'crashed' : 'không chạy')}\n`)
    if (exists && status) ctx.stdout.write(`adapter: ${status.adapter ?? 'đang khởi động'} · pid: ${status.pid ?? '—'} · port: ${status.port ?? '—'}\n`)
    return status?.state === 'crashed' ? 1 : 0
  }
  if (action === 'stop') {
    const exists = tmux(['has-session', '-t', target], root, ctx).status === 0
    if (!exists) { ctx.stdout.write('ff worker: không chạy\n'); return 0 }
    const stopped = tmux(['send-keys', '-t', target, 'C-c'], root, ctx)
    if (stopped.status !== 0) { ctx.stderr.write('ff worker stop: không gửi được tín hiệu dừng\n'); return 1 }
    ctx.stdout.write('ff worker: đã yêu cầu dừng êm\n')
    return 0
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
  const pkg = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'ff-worker/package.json'), 'utf8'))
  const command = tmux(['new-session', '-d', '-s', session(config), '-c', root, process.execPath, supervisor, '--config', path.join(root, 'ff.config.yaml'), '--package', `ff-worker@${pkg.version}`], root, ctx)
  if (command.status !== 0) { ctx.stderr.write('ff worker start: tmux không tạo được session\n'); return 1 }
  for (let i = 0; i < 30; i++) {
    const wait = ctx.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    await wait(1000)
    const current = readStatus(root)
    if (current?.state === 'ready') {
      ctx.stdout.write([
        `Đang chạy: worker trong tmux session ${session(config)}, TaskSource ${config.worker.task_source.adapter}, thông báo qua ${config.worker.channel.adapter}.`,
        `Xem thế nào: tmux attach -t =${session(config)} (thoát phiên bằng Ctrl-b rồi d).`,
        `Duyệt Gate: khi có thông báo Gate, attach phiên tmux ${config.worker.tmux.session_prefix ?? 'ff-'}<id> trong thông báo.`,
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

function missingRoot(ctx) { ctx.stderr.write('ff worker: không thấy ff.config.yaml\n'); return 4 }

function inferPluginRoot() {
  const entry = path.resolve(process.argv[1] ?? process.cwd())
  const dir = path.dirname(entry)
  return ['bin', 'dist'].includes(path.basename(dir)) ? path.dirname(dir) : process.cwd()
}
