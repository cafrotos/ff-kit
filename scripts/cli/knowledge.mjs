import fs from 'node:fs'
import path from 'node:path'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { wikiStatus, undoPage, applyProposal, rebuildIndex, syncWiki } from '../lib/wiki.mjs'
import { enqueueJob } from '../lib/dream-queue.mjs'
import { runD0, dreamCfg } from '../lib/dream.mjs'
import { knowledgeTick, queueStatus, checkQuota, loadTasks, anyAgentActive } from '../../ff-worker/src/core/knowledge-scheduler.mjs'
export const summary = 'knowledge status|undo|reindex|apply|init|queue|run — quản lý wiki nghiệp vụ (ff-wiki/) và hàng chờ dreaming'
const USAGE = 'dùng: ff knowledge status [--json] | undo <trang> | reindex | apply <đề-xuất.json> [--json] | init [--repo r] [--domain d] [--now] | queue [--json] | run [--force]'
export async function run(args, ctx) {
  try {
    const [sub, ...rest] = args
    const flag = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined }
    const valued = new Set(['--repo', '--domain'])
    const json = rest.includes('--json'), pos = rest.filter((a, i) => a !== '--json' && a !== '--now' && a !== '--force' && !valued.has(a) && !valued.has(rest[i - 1]))
    const root = findRoot(ctx.cwd); if (!root) throw new Error('không thấy ff.config.yaml')
    const { config } = loadConfig(root)
    const out = (obj, text) => ctx.stdout.write(json ? JSON.stringify(obj) + '\n' : text + '\n')
    if (sub === 'status' && !pos.length) {
      const s = wikiStatus(root, config)
      out(s, [`Wiki ${s.dir}: ${s.pages.length} trang, ${s.entries} mục, ${s.stale} cần kiểm lại, ${s.locked} khóa-người, ${s.review} cần người xem; cập nhật cuối ${s.lastUpdate ?? '(chưa có)'}`,
        ...s.pages.map(p => `- ${p.domain} (${p.title}): ${p.entries} mục, ${p.stale} cũ, ${p.locked} khóa-người, cập nhật ${p.updated ?? '-'}, ${p.history} bản lịch sử`),
        ...s.problems.map(p => `! ${p}`)].join('\n'))
    } else if (sub === 'undo' && pos.length === 1) {
      const r = await undoPage(root, config, pos[0])
      out(r, r.removed ? `Đã hoàn tác: xóa trang ${r.domain} (trang do ff tạo)` : `Đã hoàn tác trang ${r.domain} về bản trước (${r.entries} mục)`)
    } else if (sub === 'reindex' && !pos.length) {
      const s = await syncWiki(root, config); const idx = rebuildIndex(root, config)
      out({ ...s, entries: Object.keys(idx.entries).length }, `Đã dựng lại chỉ mục: ${Object.keys(idx.entries).length} mục (khóa ${s.locked} mục người sửa, nhận ${s.adopted} mục người thêm)`)
    } else if (sub === 'apply' && pos.length === 1) {
      const s = await applyProposal(root, config, JSON.parse(fs.readFileSync(path.resolve(ctx.cwd, pos[0]), 'utf8')))
      out(s, s.text + s.rejected.map(r => `\n- loại ${r.id ?? r.op}: ${r.reason}`).join(''))
    } else if (sub === 'init' && !pos.length) {
      // Nạp nền tùy chọn (QĐ: mặc định nạp lười theo miền thẻ chạm). Không --now: xếp hàng chờ cửa sổ rảnh.
      const names = flag('--repo') ? [flag('--repo')] : (config.repos ?? []).map(r => r.name)
      const domain = flag('--domain') ?? null
      if (!names.length) throw new Error('chưa có repo trong cấu hình')
      const lines = []
      for (const repo of names) {
        if (!config.repos.some(r => r.name === repo)) throw new Error(`repo không có trong cấu hình: ${repo}`)
        if (rest.includes('--now')) {
          const r = await runD0(root, config, { repo, domain }, { runner: ctx.runner })
          lines.push(`D0 ${repo}/${domain ?? '*'} @${r.sha.slice(0, 10)}: ${r.sum.text}`)
        } else {
          const r = enqueueJob(root, { kind: 'D0', key: `D0:${repo}:${domain ?? '*'}`, payload: { repo, domain, files: [] } })
          lines.push(`${r.existing ? 'đã có' : 'đã xếp'} việc D0 ${repo}/${domain ?? '*'} (${r.id}); chạy trong cửa sổ rảnh khi knowledge.dream.enabled, hoặc: ff knowledge run --force`)
        }
      }
      out({ lines }, lines.join('\n'))
    } else if (sub === 'queue' && !pos.length) {
      const q = queueStatus(root), quota = checkQuota(config, { cswap: ctx.cswap })
      const busy = anyAgentActive(loadTasks(root))
      const view = { enabled: dreamCfg(config).enabled === true, busy, quota, ...q }
      out(view, [`Dreaming ${view.enabled ? 'BẬT' : 'tắt'} · agent ${busy ? 'đang làm' : 'rảnh'} · quota ${quota.ok ? 'đủ' : 'chưa đủ'} (${quota.source ?? '-'}${quota.reason ? `: ${quota.reason}` : ''}${quota.fiveHour !== undefined ? `, 5h ${quota.fiveHour}% / 7d ${quota.sevenDay}%` : ''})`,
        `Hàng chờ: ${q.queued} chờ (${q.due} đến hạn), ${q.running} đang chạy, ${q.done} xong, ${q.failed} hỏng, ${q.evidence} bằng chứng phiên`,
        ...q.jobs.map(j => `- ${j.id} ${j.kind} [${j.status}] thử ${j.attempts}${j.status === 'queued' ? `, từ ${j.notBefore}` : ''}${j.error ? ` · ${j.error}` : ''} · ${j.key}`)].join('\n'))
    } else if (sub === 'run' && !pos.length) {
      const force = rest.includes('--force')
      const t = await knowledgeTick({ root, config, channel: ctx.channel, log: s => ctx.stderr.write(s), cswap: ctx.cswap, runner: ctx.runner, force, evolveMod: ctx.evolveMod })
      const r = t.done ? await t.done : null
      out({ ...t, done: undefined, result: r }, t.status === 'started' ? `${t.job.kind} ${t.job.id}: ${r?.ok ? r.text : `lỗi ${r?.error}`}` : `Không chạy: ${t.status}${t.reason ? ` (${t.reason})` : ''}`)
    } else throw new Error(USAGE)
    return 0
  } catch (e) { ctx.stderr.write(`ff knowledge: ${e.message}\n`); return 1 }
}
