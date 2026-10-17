// Báo cáo ngày (autopilot.daily_report_at): gửi `ff report --today` qua kênh thông báo, mỗi ngày một lần.
import fs from 'node:fs'
import path from 'node:path'
import { buildReport, renderReport } from '../../../scripts/lib/report.mjs'

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export async function dailyReportTick({ root, config, channel, now = Date.now, log = () => {} }) {
  const ap = config.autopilot ?? {}
  if (ap.enabled !== true || !/^([01]\d|2[0-3]):[0-5]\d$/.test(ap.daily_report_at ?? '')) return { status: 'disabled' }
  const at = new Date(typeof now === 'function' ? now() : now)
  const [h, m] = ap.daily_report_at.split(':').map(Number)
  if (at.getHours() * 60 + at.getMinutes() < h * 60 + m) return { status: 'early' }
  const file = path.join(root, '.ff', 'daily-report.json'), key = dayKey(at)
  let last = null
  try { last = JSON.parse(fs.readFileSync(file, 'utf8')).date } catch {}
  if (last === key) return { status: 'sent' }
  const body = renderReport(buildReport(root, config, { today: true, now: +at }))
  try { await channel.notify({ kind: 'info', title: `Báo cáo ff ${key}`, body }) }
  catch (e) { log(`[ff-worker] gửi báo cáo ngày thất bại (${e.message})\n`); return { status: 'failed' } }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ date: key, at: at.toISOString() }) + '\n')
  return { status: 'sent-now' }
}
