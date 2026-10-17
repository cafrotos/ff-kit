import pkg from '../../package.json' with { type: 'json' }
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
import * as stage from './stage.mjs'
import * as ship from './ship.mjs'
import * as shipTest from './ship-test.mjs'
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
import * as gateAuto from './gate-auto.mjs'
import * as reopen from './reopen.mjs'
import * as present from './present.mjs'
import * as learn from './learn.mjs'
import * as decide from './decide.mjs'
import * as knowledge from './knowledge.mjs'
import * as recall from './recall.mjs'
import * as escape from './escape.mjs'
import * as fixRound from './fix-round.mjs'
import * as logs from './logs.mjs'
import * as task from './task.mjs'
import * as evalCmd from './eval.mjs'
import * as evolve from './evolve.mjs'
const VERSION = pkg.version

export const COMMANDS = {
  cfg,
  learn,
  decide,
  knowledge,
  recall,
  escape,
  eval: evalCmd,
  evolve,
  'env-example': envExample,
  doctor,
  'trace-check': traceCheck,
  notify: notifyCmd,
  'mcp-auth': mcpAuth,
  'e2e-auth-check': e2eAuthCheck,
  'e2e-scaffold': e2eScaffold,
  state,
  stage,
  ship,
  'ship-test': shipTest,
  'gate-auto': gateAuto,
  'fix-round': fixRound,
  reopen,
  present,
  sync,
  copy,
  'squash-check': squashCheck,
  'verify-up': verifyUp,
  'verify-down': verifyDown,
  logs,
  task,
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
