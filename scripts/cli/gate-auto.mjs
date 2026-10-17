import path from 'node:path'
import fs from 'node:fs'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { findCardDir } from '../lib/cards.mjs'
import { recordAutoGate, recordAutoGateA, recordAutoGateC, activeRevision, validateScope, gateAPolicy, ledgerFor } from '../lib/gates.mjs'
import { traceCheck, parseLedger } from '../lib/trace.mjs'
import { readQuestionHistory } from '../lib/question-history.mjs'
import { appendKnowledgeEvent } from '../lib/knowledge-log.mjs'
import { knowledgeIds } from '../lib/wiki.mjs'
import { designCheck } from './spec-checks.mjs'
import { checkAutoGateC } from '../lib/auto-verify.mjs'
import { enforceDiffChecks } from '../lib/diff-checks.mjs'
import { readInjection, describeHits } from '../lib/injection-scan.mjs'
import { gateARepos, gateAAutoState, recordGateAPrediction } from '../lib/gate-a-auto.mjs'

export const summary = 'gate-auto <id> [--gate GATE_A|GATE_C] [--task task-N] --reason <text> — Gate B (mặc định), Gate A (cần autopilot) hoặc Gate C tự qua khi điều kiện xác định đạt'

export async function run(args, ctx) {
  try {
    const id = args[0]
    let reason = '', task = '', gate = 'GATE_B'
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--reason') reason = args[++i] ?? ''
      else if (args[i] === '--gate') gate = args[++i] ?? ''
      else if (args[i] === '--task') task = args[++i] ?? ''
      else throw new Error('dùng: ' + summary)
    }
    if (!['GATE_A', 'GATE_B', 'GATE_C'].includes(gate) || (gate === 'GATE_C' && task)) throw new Error('dùng: ' + summary)
    if (!id || !reason.trim() || (task && !/^task-\d+(?:-[A-Za-z0-9-]+)?$/.test(task))) throw new Error('dùng: ' + summary)
    const root = findRoot(ctx.cwd)
    if (!root) throw new Error('không thấy ff.config.yaml')
    const { config } = loadConfig(root), card = findCardDir(root, config, id)
    if (card.error) throw new Error(card.error)
    if (gate === 'GATE_A') {
      const reasons = [], ap = config.autopilot ?? {}
      if (ap.enabled !== true) reasons.push('autopilot.enabled chưa bật')
      if (ap.gate_a === 'off') reasons.push('autopilot.gate_a=off')
      const rev = activeRevision(card.dir) ?? '', rel = [rev, rev ? 'delta.md' : 'brief.md'].filter(Boolean).join('/')
      let brief = null
      try { brief = fs.readFileSync(path.join(card.dir, rel), 'utf8') } catch { reasons.push(`chưa có ${rel}`) }
      if (brief !== null) reasons.push(...gateAPolicy(brief).problems)
      const inj = readInjection(card.dir)
      if (inj.suspect) reasons.push(`nội dung thẻ nghi chèn lệnh cho AI (${inj.hits.length} dòng), người phải đọc: ${describeHits(inj.hits).join(' | ')}`)
      const trace = traceCheck(card.dir, { knowledge: knowledgeIds(root, config) })
      if (!trace.ok) reasons.push(...trace.errors.map((e) => `trace: ${e}`))
      try {
        for (const q of readQuestionHistory(root, String(id))) if (q.status === 'open') reasons.push(`còn câu hỏi chưa trả lời: ${q.header ?? ''} ${q.snapshot?.question ?? q.questionId}`.trim())
        const ledger = ledgerFor(card.dir, rev)
        if (ledger) for (const [code, u] of parseLedger(ledger).U) if (!String(u.answer).trim()) reasons.push(`${code} chưa có trả lời trong ledger`)
      } catch (e) { reasons.push(`không đọc được câu hỏi/ledger: ${e.message}`) }
      if (!reasons.length) {
        // Chế độ bóng (cấu hình) hoặc `on` nhưng lớp gate_a_auto đang học lại sau lần duyệt sai: ghi dự đoán "duyệt", vẫn hỏi người.
        const learning = ap.gate_a === 'on' ? gateAAutoState(root, config).filter((s) => s.status === 'learning') : []
        if (ap.gate_a === 'shadow' || learning.length) {
          try { await recordGateAPrediction(root, config, { cardId: id, revision: rev, briefContent: brief }) } catch {}
          reasons.push(ap.gate_a === 'shadow' ? 'autopilot.gate_a=shadow: chế độ bóng, ff chỉ ghi dự đoán và vẫn hỏi người duyệt Gate A'
            : `Gate A tự duyệt đang học lại sau lần duyệt sai: ${learning.map((s) => `${s.matches}/${s.minMatch}${learning.length > 1 ? ` (repo ${s.repo || 'gốc'})` : ''}`).join(', ')}; chế độ bóng, ff chỉ ghi dự đoán và vẫn hỏi người duyệt Gate A`)
        }
      }
      if (reasons.length) { ctx.stderr.write(`ff gate-auto: Gate A KHÔNG tự qua được (${reasons.length} lý do)\n${reasons.map((r) => `- ${r}`).join('\n')}\n`); return 1 }
      const rec = recordAutoGateA(root, config, id, reason)
      ctx.stdout.write(`Gate A: AUTO_PASSED (${rec.scope || 'root'}); đây không phải user duyệt\n`)
      return 0
    }
    if (gate === 'GATE_C') {
      const { failures, exemptAcs, manualAcs, infraRules } = await checkAutoGateC(root, config, card.dir)
      const diffGate = await enforceDiffChecks(root, config, card.dir, id)
      failures.push(...diffGate.messages.map((m) => `(diff) ${m}`))
      if (failures.length) { ctx.stderr.write(`ff gate-auto: Gate C KHÔNG tự qua được (${failures.length} lý do)\n${failures.map((f) => `- ${f}`).join('\n')}\n`); return 1 }
      const rec = recordAutoGateC(root, config, id, reason, { exemptAcs, manualAcs, infraRules, ...diffGate.autoChecks })
      ctx.stdout.write(`Gate C: AUTO_PASSED (${rec.scope || 'root'}); đây không phải user duyệt\n`)
      if (exemptAcs.length) ctx.stdout.write(`AC miễn do hạ tầng ngoài (UNVERIFIED[ext]): ${exemptAcs.join(', ')}\n`)
      if (manualAcs.length) ctx.stdout.write(`Cần thử tay trên dev: ${manualAcs.map((m) => `${m.id}${m.steps ? ` (${m.steps})` : ''}`).join('; ')}\n`)
      return 0
    }
    const rev = activeRevision(card.dir), scope = [rev, task].filter(Boolean).join('/')
    const dir = validateScope(card.dir, scope)
    const spec = fs.readFileSync(path.join(dir, '02-spec.md'), 'utf8')
    if (!/^\s*[-*]\s+\*\*AC-/m.test(spec)) throw new Error('spec phải có AC kiểm được trước Gate B')
    const trace = traceCheck(card.dir, { knowledge: knowledgeIds(root, config) })
    if (!trace.ok) throw new Error(trace.errors.join('; '))
    const selection = scope
    if (await designCheck.run([id, ...(selection ? [selection] : [])], ctx) !== 0) throw new Error('design-check chưa đạt')
    const rec = recordAutoGate(root, config, id, reason, task)
    ctx.stdout.write(`Gate B: AUTO_PASSED (${rec.scope || 'root'}); đây không phải user duyệt\n`)
    return 0
  } catch (e) { ctx.stderr.write(`ff gate-auto: ${e.message}\n`); return 1 }
}
