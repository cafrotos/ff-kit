// scripts/hooks/ask-pre.mjs — PreToolUse(AskUserQuestion): chặn Gate sai quy ước hoặc trace-check đỏ, rồi thông báo.
import { readHookInput } from '../lib/hook-io.mjs'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { findCardDir } from '../lib/cards.mjs'
import { traceCheck } from '../lib/trace.mjs'
import { gateQuestions, validateGateQuestion } from '../lib/gates.mjs'
import { notify, makeEvent } from '../lib/notify.mjs'

const input = readHookInput()
const root = findRoot(input.cwd ?? process.cwd())
if (!root) process.exit(0)
let config
try {
  config = loadConfig(root).config
} catch {
  process.exit(0)
}

const ti = input.tool_input ?? {}
const gates = gateQuestions(ti)
for (const g of gates) {
  if (!g.cardId) {
    process.stderr.write(`[ff] Câu hỏi ${g.gate} phải bắt đầu bằng "[#<id thẻ>]", vd "[#123] Duyệt Brief?".\n`)
    process.exit(2)
  }
  const card = findCardDir(root, config, g.cardId)
  if (card.error) { process.stderr.write(`[ff] ${card.error}\n`); process.exit(2) }
  try { validateGateQuestion(card.dir, g.question) } catch (e) {
    process.stderr.write(`[ff] ${e.message}\n`)
    process.exit(2)
  }
  if (g.gate === 'GATE_A' || g.gate === 'GATE_B') {
    const r = traceCheck(card.dir)
    if (!r.ok) {
      process.stderr.write(`[ff] trace-check đỏ cho thẻ #${g.cardId} — sửa rồi trình lại ${g.gate}:\n${r.errors.map((e) => `- ${e}`).join('\n')}\n`)
      process.exit(2)
    }
  }
}

const prefix = config.worker.tmux.session_prefix
const first = Array.isArray(ti.questions) ? ti.questions[0] : null
const event = gates.length
  ? makeEvent({ kind: 'gate', taskId: gates[0].cardId, title: `${gates[0].gate} thẻ #${gates[0].cardId} chờ duyệt`, body: `Mở phiên để duyệt: tmux attach -t ${prefix}${gates[0].cardId}` })
  : makeEvent({ kind: 'ask', title: String(first?.question ?? 'Agent đang hỏi').slice(0, 120) })
await notify(root, event, { log: () => {} })
process.exit(0)
