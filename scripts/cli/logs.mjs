import fs from 'node:fs'
import path from 'node:path'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { findCardDir } from '../lib/cards.mjs'
import { parseEnvFile } from '../lib/services.mjs'
import { redactHumanText } from '../lib/human-output.mjs'
import * as worker from './worker.mjs'

export const summary = 'logs <id> [service] [--lines N] — đuôi log service/prepare của thẻ (+ dòng worker của thẻ), đã che secret'

const SECRET_KEY_RE = /PASS|SECRET|TOKEN|KEY|CREDENTIAL|DSN|URL|AUTH/i
const MAX_BYTES = 256 * 1024

function secretValues(root, config) {
  const files = [config.secrets?.env_file, config.db?.env_file].filter(Boolean)
  const values = new Set()
  for (const f of files) {
    try { for (const [k, v] of Object.entries(parseEnvFile(fs.readFileSync(path.resolve(root, f), 'utf8')))) if (v && v.length >= 4 && (SECRET_KEY_RE.test(k) || v.length >= 12)) values.add(v) } catch { /* file tùy chọn */ }
  }
  return [...values].sort((a, b) => b.length - a.length)
}
const scrub = (text, secrets) => {
  let out = text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
  for (const v of secrets) out = out.split(v).join('[REDACTED]')
  return redactHumanText(out)
}
function tail(file, n) {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size, len = Math.min(size, MAX_BYTES), buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, size - len)
    const lines = buf.toString('utf8').split('\n')
    if (size > len) lines.shift()
    return lines.filter((l, i, a) => i < a.length - 1 || l).slice(-n)
  } finally { fs.closeSync(fd) }
}

export async function run(args, ctx) {
  const pos = []
  let lines = 80
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lines' || args[i] === '-n') {
      const v = args[++i]
      if (!/^\d+$/.test(v ?? '') || Number(v) < 1 || Number(v) > 5000) { ctx.stderr.write('ff logs: --lines phải trong 1..5000\n'); return 2 }
      lines = Number(v)
    } else if (args[i].startsWith('-')) { ctx.stderr.write(`ff logs: tham số lạ ${args[i]}\n`); return 2 } else pos.push(args[i])
  }
  const [id, service, extra] = pos
  if (!id || extra || (service && !/^[A-Za-z0-9._-]+$/.test(service))) { ctx.stderr.write('dùng: ff logs <id> [service] [--lines N]\n'); return 2 }
  const root = findRoot(ctx.cwd)
  if (!root) { ctx.stderr.write('ff logs: không thấy ff.config.yaml\n'); return 4 }
  const config = loadConfig(root).config
  const card = findCardDir(root, config, id)
  if (card.error) { ctx.stderr.write(`ff logs: ${card.error}\n`); return 2 }
  const cardId = path.basename(card.dir).split('-')[0]
  const secrets = secretValues(root, config)
  const dir = path.join(root, '.ff/services', cardId)
  let names = []
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.log')).sort() } catch { /* chưa verify-up */ }
  if (service) names = names.filter((n) => n.slice(0, -4) === service || n.slice(0, -4) === `prepare-${service}`)
  const out = []
  for (const n of names) {
    let body
    try { body = tail(path.join(dir, n), lines) } catch (e) { body = [`(không đọc được: ${e.code ?? e.message})`] }
    out.push(`==> ${n} (${body.length} dòng cuối) <==`, ...body.map((l) => scrub(l, secrets)), '')
  }
  if (!names.length) out.push(service ? `(không thấy log "${service}" của thẻ ${cardId} trong .ff/services/${cardId}/)` : `(thẻ ${cardId} chưa có log service; chạy ff verify-up ${cardId} trước)`, '')
  if (!service) {
    let buf = ''
    const rc = await worker.run(['logs', '-n', '2000'], { ...ctx, stdout: { write: (s) => { buf += s } }, stderr: { write: () => {} } })
    if (rc === 0) {
      const re = new RegExp(`(?:#|\\b)${cardId}\\b`)
      const mine = buf.split('\n').filter((l) => re.test(l)).slice(-lines)
      if (mine.length) out.push(`==> worker (dòng liên quan thẻ ${cardId}) <==`, ...mine.map((l) => scrub(l, secrets)), '')
    }
  }
  ctx.stdout.write(out.join('\n'))
  return 0
}
