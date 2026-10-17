import fs from 'node:fs'
import path from 'node:path'

export function writeWorkerStatus(root, status) {
  const target = path.join(root, '.ff', 'worker.json')
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
  const temp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temp, target)
  return target
}
