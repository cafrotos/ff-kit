#!/usr/bin/env node
// Hook PreToolUse. Vào: JSON hook ở stdin, hoặc --cmd/--file/--tool/--cwd. Ra: exit 0 cho qua; exit 2 + lý do ở stderr = chặn.
import fs from 'node:fs'
import path from 'node:path'
import { findRoot, loadConfigOrDefaults } from './lib/config.mjs'
import { makeGuard } from './lib/guard-rules.mjs'

function parseArgs(argv) {
  const a = { mode: 'base' }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--cmd') a.cmd = argv[++i]
    else if (k === '--file') a.file = argv[++i]
    else if (k === '--tool') a.tool = argv[++i]
    else if (k === '--cwd') a.cwd = argv[++i]
    else if (k === '--mode') a.mode = argv[++i]
    else if (k === '--format') a.format = argv[++i]
  }
  return a
}

function readStdinJson() {
  if (process.stdin.isTTY) return null
  try {
    const raw = fs.readFileSync(0, 'utf8').trim()
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const pick = (...vals) => vals.find((v) => typeof v === 'string' && v.length > 0)

function fromHookJson(j) {
  if (!j) return {}
  const tc = j.toolCall ?? {}
  const ti = j.tool_input ?? j.toolInput ?? tc.args ?? j.args ?? j.input ?? j.parameters ?? {}
  const patch = typeof ti === 'string' ? ti : pick(ti.patch, ti.patchText, ti.input)
  const files = typeof patch === 'string' ? [...patch.matchAll(/^\*\*\* (?:Update File|Add File|Delete File|Move to):\s*(.+)$/gm)].map((m) => m[1].trim()) : []
  return {
    tool: pick(j.tool_name, j.toolName, tc.name, j.tool, j.name),
    cmd: pick(ti.command, ti.cmd, ti.CommandLine, j.command),
    file: pick(ti.file_path, ti.filePath, ti.notebook_path, ti.path, ti.target_file, ti.TargetFile, ti.AbsolutePath),
    cwd: pick(j.cwd, ti.cwd, ti.workdir, ti.Cwd),
    input: ti,
    files,
  }
}

const args = parseArgs(process.argv.slice(2))
const hook = fromHookJson(readStdinJson())
const cmd = args.cmd ?? hook.cmd
const file = args.file ?? hook.file
const files = args.file ? [args.file] : [...new Set([file, ...(hook.files ?? [])].filter(Boolean))]
const tool = args.tool ?? hook.tool
const cwd = path.resolve(args.cwd ?? hook.cwd ?? process.cwd())
const root = findRoot(cwd) ?? (files[0] ? findRoot(path.dirname(path.resolve(cwd, files[0]))) : null)
if (!root) process.exit(0)

const G = makeGuard(root, loadConfigOrDefaults(root).config)
let reason = G.evaluate({ cmd, file: files[0], tool, cwd, mode: args.mode, input: hook.input ?? {} })
for (const target of files.slice(1)) {
  if (reason) break
  reason = G.evaluate({ file: target, tool, cwd, mode: args.mode, input: hook.input ?? {} })
}

if (reason) {
  const msg = `[ff-guard] ${reason}`
  if (args.format === 'agy') {
    process.stdout.write(JSON.stringify({ decision: 'deny', reason: msg, allow_tool: false, deny_reason: msg }) + '\n')
    process.exit(0)
  }
  process.stderr.write(msg + '\n')
  process.exit(2)
}
if (cmd && G.needsAsk(cmd)) {
  const reason = '[ff-guard] ship-approve/relock cần người dùng xác nhận'
  if (args.format === 'agy') process.stdout.write(JSON.stringify({ decision: 'force_ask', reason }) + '\n')
  else process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } }) + '\n')
}
process.exit(0)
