import { findRoot } from '../lib/config.mjs'
import { notify, makeEvent } from '../lib/notify.mjs'

export const summary = 'notify --kind <kind> --title <t> [--task <id>] [--body <b>] — gửi thông báo 1 chiều qua worker'

export async function run(args, ctx) {
  const opt = {}
  for (let i = 0; i < args.length; i++) {
    const m = /^--(kind|title|task|body)$/.exec(args[i])
    if (m) opt[m[1]] = args[++i]
  }
  let event
  try {
    event = makeEvent({ kind: opt.kind, title: opt.title, taskId: opt.task ?? '', body: opt.body ?? '' })
  } catch (e) {
    ctx.stderr.write(`ff notify: ${e.message}\n`)
    return 2
  }
  const root = findRoot(ctx.cwd)
  if (!root) {
    ctx.stderr.write('[ff notify] không thấy ff.config.yaml — bỏ qua\n')
    return 0
  }
  const r = await notify(root, event, { log: (s) => ctx.stderr.write(s) })
  if (r.delivered) ctx.stdout.write('đã gửi\n')
  return 0
}
