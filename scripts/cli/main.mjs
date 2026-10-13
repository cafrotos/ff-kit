// Dispatcher của CLI `ff`. Mỗi lệnh là 1 module có { summary, run(args, ctx) }.
import * as cfg from './cfg.mjs'
const VERSION = '0.1.0'

export const COMMANDS = {
  cfg,
}

const defaultCtx = () => ({ cwd: process.cwd(), stdout: process.stdout, stderr: process.stderr })

export async function main(argv, ctx = defaultCtx()) {
  const [name, ...rest] = argv
  if (!name || name === 'help' || name === '--help') {
    ctx.stdout.write(usage())
    return 0
  }
  if (name === '--version') {
    ctx.stdout.write(VERSION + '\n')
    return 0
  }
  const cmd = COMMANDS[name]
  if (!cmd) {
    ctx.stderr.write(`ff: không có lệnh '${name}'. Xem: ff help\n`)
    return 2
  }
  return cmd.run(rest, ctx)
}

function usage() {
  const lines = Object.entries(COMMANDS).map(([n, c]) => `  ${n.padEnd(14)} ${c.summary}`)
  return ['ff <lệnh> [tham số]', '', 'Lệnh:', ...lines, ''].join('\n')
}
