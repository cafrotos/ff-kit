import path from 'node:path'
import fs from 'node:fs'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { findCardDir } from '../lib/cards.mjs'
import { recordAutoGate, activeRevision, validateScope } from '../lib/gates.mjs'
import { traceCheck } from '../lib/trace.mjs'
import { designCheck } from './spec-checks.mjs'

export const summary = 'gate-auto <id> [--task task-N] --reason <text> — Gate B tự qua theo hợp đồng đã duyệt'

export async function run(args, ctx) {
  try {
    const id = args[0]
    let reason = '', task = ''
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--reason') reason = args[++i] ?? ''
      else if (args[i] === '--task') task = args[++i] ?? ''
      else throw new Error('dùng: ' + summary)
    }
    if (!id || !reason.trim() || (task && !/^task-\d+(?:-[A-Za-z0-9-]+)?$/.test(task))) throw new Error('dùng: ' + summary)
    const root = findRoot(ctx.cwd)
    if (!root) throw new Error('không thấy ff.config.yaml')
    const { config } = loadConfig(root), card = findCardDir(root, config, id)
    if (card.error) throw new Error(card.error)
    const rev = activeRevision(card.dir), scope = [rev, task].filter(Boolean).join('/')
    const dir = validateScope(card.dir, scope)
    const spec = fs.readFileSync(path.join(dir, '02-spec.md'), 'utf8')
    if (!/^\s*[-*]\s+\*\*AC-/m.test(spec)) throw new Error('spec phải có AC kiểm được trước Gate B')
    const trace = traceCheck(card.dir)
    if (!trace.ok) throw new Error(trace.errors.join('; '))
    const selection = scope
    if (await designCheck.run([id, ...(selection ? [selection] : [])], ctx) !== 0) throw new Error('design-check chưa đạt')
    const rec = recordAutoGate(root, config, id, reason, task)
    ctx.stdout.write(`Gate B: AUTO_PASSED (${rec.scope || 'root'}); đây không phải user duyệt\n`)
    return 0
  } catch (e) { ctx.stderr.write(`ff gate-auto: ${e.message}\n`); return 1 }
}
