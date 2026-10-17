import path from 'node:path'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { buildFixture, runVariant, evalPair, gradeRuns, readGrade, renderReport, appendSuiteResults, pluginRoot, defaultRunner, defaultGrader, listCases } from '../lib/evals.mjs'

export const summary = 'eval fixture <thẻ> [--revision rev-N] | run <suite> --variant <dir> [--baseline <dir>] [--repeat N] [--cases a,b] | grade <run-a> <run-b> | report <pair-id> — fixture từ thẻ thật, chạy và chấm mù A/B'
const USAGE = 'dùng: ff ' + summary
// deps tiêm được cho test: ctx.evalDeps = { runner, grader, random, now }
export async function run(args, ctx) {
  try {
    const [sub, ...rest] = args, pos = [], opt = {}
    for (let i = 0; i < rest.length; i++) {
      if (/^--(revision|variant|baseline|repeat|cases|suite|name)$/.test(rest[i])) { if (rest[i + 1] === undefined) throw new Error(USAGE); opt[rest[i].slice(2)] = rest[++i] }
      else if (rest[i] === '--write') opt.write = true
      else if (rest[i].startsWith('--')) throw new Error(USAGE)
      else pos.push(rest[i])
    }
    const root = findRoot(ctx.cwd); if (!root) throw new Error('không thấy ff.config.yaml')
    const { config } = loadConfig(root), deps = ctx.evalDeps ?? {}
    const out = s => ctx.stdout.write(s + '\n')
    if (sub === 'fixture') {
      if (pos.length !== 1) throw new Error(USAGE)
      const f = buildFixture(root, config, { cardId: pos[0], revision: opt.revision ?? '', suite: opt.suite ?? '', caseName: opt.name ?? '', now: deps.now })
      out(`Đã dựng ca ${f.suite}/${f.case} (skill ${f.skill}, ngả ${f.route}) tại ${path.relative(root, f.dir)}; ${f.repos.filter(r => !(r.baseSha || r.featureSha)).length ? 'CẢNH BÁO: có repo thiếu sha, ca chưa chạy được' : 'đủ sha các repo'}. Dữ liệu dự án chỉ ở workspace, không vào plugin.`)
      return 0
    }
    if (sub === 'run') {
      if (pos.length !== 1 || !opt.variant) throw new Error(USAGE)
      const cases = opt.cases ? opt.cases.split(',').filter(Boolean) : undefined, repeat = opt.repeat ? Number(opt.repeat) : undefined
      if (repeat !== undefined && !(Number.isInteger(repeat) && repeat >= 1)) throw new Error('--repeat phải là số nguyên ≥ 1')
      const variant = path.resolve(ctx.cwd, opt.variant)
      if (opt.baseline) {
        const [r] = await evalPair(root, config, { suite: pos[0], baseline: { dir: path.resolve(ctx.cwd, opt.baseline) }, variants: [{ key: 'variant', dir: variant }], cases, repeat, runner: deps.runner ?? defaultRunner, grader: deps.grader ?? defaultGrader, random: deps.random, now: deps.now })
        const md = renderReport(r.grade); out(md); out(`Kết quả chấm: ${r.grade.pairId}`)
        if (opt.write) appendSuiteResults(root, pos[0], md)
        return r.grade.cases.some(c => c.label === 'tệ đi') ? 1 : 0
      }
      const m = await runVariant(root, config, { suite: pos[0], variant, cases, repeat, runner: deps.runner ?? defaultRunner, now: deps.now })
      out(`Run ${m.runId}: ${m.cases.length} ca × ${m.repeat} lần${m.dropped.length ? `; bỏ ${m.dropped.join(', ')} (vượt trần evolve.max_cases)` : ''}. Chấm: ff eval grade <run-a> <run-b>`)
      return 0
    }
    if (sub === 'grade') {
      if (pos.length !== 2) throw new Error(USAGE)
      const g = await gradeRuns(root, config, { runA: pos[0], runB: pos[1], grader: deps.grader ?? defaultGrader, random: deps.random, now: deps.now })
      out(`Đã chấm ${g.cases.length} ca: ${g.pairId}`); out(renderReport(g))
      return g.stoppedEarly ? 1 : 0
    }
    if (sub === 'report') {
      if (pos.length !== 1 && pos.length !== 2) throw new Error(USAGE)
      const g = readGrade(root, pos.length === 2 ? `${pos[0]}__${pos[1]}` : pos[0])
      const md = renderReport(g); out(md)
      if (opt.write) appendSuiteResults(root, g.suite, md)
      return 0
    }
    if (sub === 'cases') { // tiện: liệt kê ca của suite
      for (const c of listCases(root, pos[0] ?? '')) out(`${c.case}\tthẻ #${c.cardId}\t${c.skill}\tngả ${c.route}`)
      return 0
    }
    throw new Error(USAGE)
  } catch (e) { ctx.stderr.write(`ff eval: ${e.message}\n`); return e.message.startsWith('dùng:') ? 2 : 1 }
}
