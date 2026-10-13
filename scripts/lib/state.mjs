import fs from 'node:fs'
import path from 'node:path'
import { CONFIG_FILE, LOCK_FILE } from './config.mjs'

export const ffDir = (root) => path.join(root, '.ff')

function configMtime(root) {
  return Math.max(...[CONFIG_FILE, LOCK_FILE].map((f) => {
    try {
      return fs.statSync(path.join(root, f)).mtimeMs
    } catch {
      return 0
    }
  }))
}

export function writeDoctorState(root, ok, groups = { core: ok, worker: ok, e2e: ok }) {
  fs.mkdirSync(ffDir(root), { recursive: true })
  const state = { ok, groups, at: new Date().toISOString(), configMtimeMs: configMtime(root) }
  fs.writeFileSync(path.join(ffDir(root), 'doctor.json'), JSON.stringify(state) + '\n')
}

export function doctorStatus(root, group = 'core') {
  let s
  try {
    s = JSON.parse(fs.readFileSync(path.join(ffDir(root), 'doctor.json'), 'utf8'))
  } catch {
    return 'missing'
  }
  if (s.configMtimeMs !== configMtime(root)) return 'stale'
  return (s.groups?.[group] ?? s.ok) ? 'green' : 'red'
}
