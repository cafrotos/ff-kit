import { findRoot, loadConfig } from '../lib/config.mjs'
import { detectRepeats, proposeEvolution, readProposals, readProposal, rejectProposal, applyProposal } from '../lib/evolve.mjs'
import fs from 'node:fs'
import path from 'node:path'

export const summary = 'evolve detect | propose <skill> --route A|B|C|D [--force] | list | show <id> | apply <id> --plugin-repo <ff-kit> [--only skill|wiki] (chỉ người) | reject <id> --reason <text> — máy đề xuất vá skill/tri thức, người duyệt'
const USAGE = 'dùng: ff ' + summary
// deps tiêm được cho test: ctx.evolveDeps = { llm, runner, grader, notify, random, now, pluginDir, applyWiki }
export async function run(args, ctx) {
  try {
    const [sub, ...rest] = args, pos = [], opt = {}
    for (let i = 0; i < rest.length; i++) {
      if (/^--(route|reason|plugin-repo|only)$/.test(rest[i])) { if (rest[i + 1] === undefined) throw new Error(USAGE); opt[rest[i].slice(2)] = rest[++i] }
      else if (rest[i] === '--force') opt.force = true
      else if (rest[i].startsWith('--')) throw new Error(USAGE)
      else pos.push(rest[i])
    }
    const root = findRoot(ctx.cwd); if (!root) throw new Error('không thấy ff.config.yaml')
    const { config } = loadConfig(root), deps = ctx.evolveDeps ?? {}
    const out = s => ctx.stdout.write(s + '\n')
    if (sub === 'detect') {
      const d = detectRepeats(root, config, { now: deps.now })
      for (const c of d.candidates) out(`ĐỦ NGƯỠNG  ${c.skill} ngả ${c.route}: thẻ ${c.cards.map(x => '#' + x).join(', ')} (Gate "Cần sửa": ${c.context.gateFixes.length}, QA fail: ${c.context.qaFails.length}) → ff evolve propose ${c.skill} --route ${c.route}`)
      for (const c of d.skipped) out(`chưa  ${c.skill} ngả ${c.route}: ${c.reason}`)
      if (!d.candidates.length && !d.skipped.length) out('Chưa có phiếu "vì sao lọt" nào được xác nhận.')
      return 0
    }
    if (sub === 'propose') {
      if (pos.length !== 1 || !opt.route) throw new Error(USAGE)
      const s = await proposeEvolution(root, config, { skill: pos[0], route: opt.route, force: !!opt.force }, deps)
      out(`Đề xuất ${s.id}: ${s.decision}. Bó: .ff/evolve/${s.id}/ (xem: ff evolve show ${s.id}). Chưa áp dụng gì; người duyệt bằng ff evolve apply/reject.`)
      return 0
    }
    if (sub === 'list') {
      const all = readProposals(root)
      if (!all.length) out('Chưa có đề xuất nào.')
      for (const p of all) out(`${p.id}\t${p.status}\t${p.decision ?? '-'}\t${p.skill} ngả ${p.route}\tthẻ ${p.cards.map(x => '#' + x).join(',')}`)
      return 0
    }
    if (sub === 'show') {
      if (pos.length !== 1) throw new Error(USAGE)
      const s = readProposal(root, pos[0]), dir = path.join(root, '.ff/evolve', s.id)
      out(`# ${s.id} — ${s.status} (${s.decision ?? '-'})`)
      for (const [k, c] of Object.entries(s.candidates ?? {})) out(`- ${k}: ${c.decision ?? '?'}${c.reasons ? ' — ' + c.reasons.join('; ') : ''}`)
      for (const f of ['explanation.md', 'pair-table.md', 'skill.diff', 'wiki-proposal.json', 'experience-draft.md', 'evidence.md']) {
        const p = path.join(dir, f)
        if (fs.existsSync(p)) out(`\n## ${f}\n${fs.readFileSync(p, 'utf8').trimEnd()}`)
      }
      out(`\n${s.pinnedNote}`)
      return 0
    }
    if (sub === 'apply') {
      if (pos.length !== 1) throw new Error(USAGE)
      const r = await applyProposal(root, pos[0], config, { pluginRepo: opt['plugin-repo'], only: opt.only, applyWiki: deps.applyWiki, now: deps.now })
      for (const a of r.applied) out(`Đã áp dụng: ${a}`)
      for (const n of r.notes) out(`Lưu ý: ${n}`)
      return 0
    }
    if (sub === 'reject') {
      if (pos.length !== 1) throw new Error(USAGE)
      rejectProposal(root, pos[0], opt.reason, deps.now)
      out(`Đã từ chối ${pos[0]}.`)
      return 0
    }
    throw new Error(USAGE)
  } catch (e) { ctx.stderr.write(`ff evolve: ${e.message}\n`); return e.message.startsWith('dùng:') ? 2 : 1 }
}
