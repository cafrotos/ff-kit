import fs from 'node:fs'

export function readHookInput() {
  if (process.stdin.isTTY) return {}
  try {
    const raw = fs.readFileSync(0, 'utf8').trim()
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}
