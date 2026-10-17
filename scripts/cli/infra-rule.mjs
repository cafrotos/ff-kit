import { findRoot } from '../lib/config.mjs'
import { setInfraRule, getInfraRule, listInfraRules, ANSWER_LABEL, INFRA_ANSWERS } from '../lib/infra-rules.mjs'

export const summary = 'infra-rule set <tên> <manual|mock|block> --note <text> --from-question <Q-id> | get <tên> | list [--json] — luật hạ tầng do người quyết, áp dụng ngay cho thẻ sau'
const USAGE = 'dùng: ff infra-rule set <tên> <manual|mock|block> --note <text> --from-question <Q-id> [--card <id>] | get <tên> [--json] | list [--json]'
const line = (r) => `${r.name}: ${ANSWER_LABEL[r.answer]} (${r.answer})${r.note ? ` · ${r.note}` : ''} · từ câu ${r.fromQuestion}${r.card ? ` thẻ #${r.card}` : ''} lúc ${r.at}`

export async function run(args, ctx) {
  try {
    const [sub, ...rest] = args, json = rest.includes('--json')
    const opt = {}, pos = []
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--json') continue
      if (['--note', '--from-question', '--card'].includes(rest[i])) { if (rest[i + 1] === undefined || rest[i + 1].startsWith('--')) throw new Error(USAGE); opt[rest[i]] = rest[++i] }
      else if (rest[i].startsWith('--')) throw new Error(USAGE)
      else pos.push(rest[i])
    }
    const root = findRoot(ctx.cwd); if (!root) throw new Error('không thấy ff.config.yaml')
    const out = (obj, text) => ctx.stdout.write(json ? JSON.stringify(obj) + '\n' : text + '\n')
    if (sub === 'set' && pos.length === 2 && INFRA_ANSWERS.includes(pos[1])) {
      const r = setInfraRule(root, pos[0], pos[1], { note: opt['--note'], fromQuestion: opt['--from-question'], cardId: opt['--card'] })
      out(r, `Đã ghi luật hạ tầng ${line(r)}`)
    } else if (sub === 'get' && pos.length === 1) {
      const r = getInfraRule(root, pos[0])
      if (!r) { ctx.stderr.write(`ff infra-rule: chưa có luật cho "${pos[0]}"\n`); return 3 }
      out(r, line(r))
    } else if (sub === 'list' && !pos.length) {
      const rows = listInfraRules(root)
      out(rows, rows.length ? rows.map(line).join('\n') : 'Chưa có luật hạ tầng nào.')
    } else throw new Error(USAGE)
    return 0
  } catch (e) { ctx.stderr.write(`ff infra-rule: ${e.message}\n`); return 1 }
}
