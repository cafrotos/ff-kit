// Mỗi giá trị trong ff.config.yaml phải có nguồn: file:<path>:<dòng>, user, hoặc default.
import fs from 'node:fs'
import path from 'node:path'
import { LOCK_FILE, DEFAULTS, getKey } from './config.mjs'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export function leafKeys(raw) {
  const out = []
  const walk = (v, key) => {
    if (Array.isArray(v)) {
      const names = v.map((x) => (isObj(x) && typeof x.name === 'string' ? x.name : null))
      if (v.length && names.every(Boolean) && new Set(names).size === names.length) {
        for (const x of v) for (const [k, vv] of Object.entries(x)) if (k !== 'name') walk(vv, `${key}.${x.name}.${k}`)
        return
      }
      if (v.length && v.every(isObj)) {
        v.forEach((x, i) => { for (const [k, vv] of Object.entries(x)) walk(vv, `${key}.${i}.${k}`) })
        return
      }
      out.push({ key, value: v })
      return
    }
    if (isObj(v)) {
      for (const [k, vv] of Object.entries(v)) walk(vv, key ? `${key}.${k}` : k)
      return
    }
    out.push({ key, value: v })
  }
  walk(raw, '')
  return out.filter((l) => l.key !== 'version')
}

export function checkLock(root, raw, envFile = '.ff.env') {
  let lock
  try {
    lock = JSON.parse(fs.readFileSync(path.join(root, LOCK_FILE), 'utf8'))
  } catch {
    return [{ ok: false, msg: `thiếu hoặc hỏng ${LOCK_FILE} — chạy lại /ff-init` }]
  }
  const sources = lock.sources ?? {}
  const checks = []
  const bad = (msg) => checks.push({ ok: false, msg })
  const secretAbs = path.resolve(root, envFile)
  for (const { key, value } of leafKeys(raw)) {
    const src = sources[key]
    if (!src) { bad(`thiếu nguồn: ${key}`); continue }
    if (src === 'user') continue
    if (src === 'default') {
      const d = getKey(DEFAULTS, key)
      if (!d.found || JSON.stringify(d.value) !== JSON.stringify(value)) bad(`${key}: ghi nguồn "default" nhưng giá trị khác mặc định`)
      continue
    }
    const m = /^file:(.+):(\d+)$/.exec(src)
    if (!m) { bad(`${key}: nguồn không hợp lệ "${src}"`); continue }
    if (path.resolve(root, m[1]) === secretAbs) { bad(`${key}: không dùng file secrets làm nguồn`); continue }
    let line
    try {
      line = fs.readFileSync(path.resolve(root, m[1]), 'utf8').split(/\r?\n/)[Number(m[2]) - 1]
    } catch {}
    if (line === undefined) { bad(`${key}: không đọc được ${m[1]}:${m[2]}`); continue }
    const want = (Array.isArray(value) ? value : [value]).map((v) => String(v).normalize('NFC'))
    const have = line.normalize('NFC')
    if (!want.every((w) => have.includes(w))) bad(`${key}: nguồn lệch — ${m[1]}:${m[2]} không còn chứa "${want.join('", "')}"`)
  }
  if (!checks.length) checks.push({ ok: true, msg: 'mọi giá trị còn khớp nguồn' })
  return checks
}
