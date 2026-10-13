// Dispatcher của CLI `ff`. Mỗi lệnh là 1 module có { summary, run(args, ctx) }.
import * as cfg from './cfg.mjs'
import * as envExample from './env-example.mjs'
import * as doctor from './doctor.mjs'
import * as traceCheck from './trace-check.mjs'
import * as notifyCmd from './notify.mjs'
import * as mcpAuth from './mcp-auth.mjs'
import * as e2eAuthCheck from './e2e-auth-check.mjs'
import * as e2eScaffold from './e2e-scaffold.mjs'
import * as state from './state.mjs'
import * as sync from './sync.mjs'
import * as copy from './copy.mjs'
import * as squashCheck from './squash-check.mjs'
import * as verifyUp from './verify-up.mjs'
import * as verifyDown from './verify-down.mjs'
import { shipApprove, allow, lockTests, relock, probeSlice } from './gate-tools.mjs'
import * as e2eLint from './e2e-lint.mjs'
import * as dbQuery from './db-query.mjs'
import { acMatrix, designCheck } from './spec-checks.mjs'
import * as worker from './worker.mjs'
import * as verifyLock from './verify-lock.mjs'
import * as shipRequest from './ship-request.mjs'
const VERSION = '0.1.0'

export const COMMANDS = {
  cfg,
  'env-example': envExample,
  doctor,
  'trace-check': traceCheck,
  notify: notifyCmd,
  'mcp-auth': mcpAuth,
  'e2e-auth-check': e2eAuthCheck,
  'e2e-scaffold': e2eScaffold,
  state,
  sync,
  copy,
  'squash-check': squashCheck,
  'verify-up': verifyUp,
  'verify-down': verifyDown,
  'ship-approve': shipApprove,
  allow,
  'lock-tests': lockTests,
  relock,
  'probe-slice': probeSlice,
  'e2e-lint': e2eLint,
  'db-query': dbQuery,
  'ac-matrix': acMatrix,
  'design-check': designCheck,
  worker,
  'verify-lock': verifyLock,
  'ship-request': shipRequest,
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
