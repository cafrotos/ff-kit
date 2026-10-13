// scripts/hooks/ask-post.mjs — PostToolUse(AskUserQuestion): ghi câu trả lời Gate vào .ff/gates/.
import { readHookInput } from '../lib/hook-io.mjs'
import { findRoot, loadConfigOrDefaults } from '../lib/config.mjs'
import { recordGates } from '../lib/gates.mjs'

const input = readHookInput()
const root = findRoot(input.cwd ?? process.cwd())
if (!root) process.exit(0)
recordGates(root, loadConfigOrDefaults(root).config, input.tool_input ?? {}, input.tool_response ?? null)
process.exit(0)
