import fs from 'node:fs'
import path from 'node:path'

// realpath của tổ tiên gần nhất còn tồn tại, nối phần đuôi chưa tồn tại (file sắp tạo).
export function realish(p) {
  const tail = []
  let cur = path.resolve(p)
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...tail)
    } catch {}
    const up = path.dirname(cur)
    if (up === cur) return path.resolve(p)
    tail.unshift(path.basename(cur))
    cur = up
  }
}
