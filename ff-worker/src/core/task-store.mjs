import fs from 'node:fs'
import path from 'node:path'

export function taskPath(root, id) {
  if (!/^[A-Za-z0-9]+$/.test(String(id))) throw new Error(`ID thẻ không hợp lệ: ${String(id)}`)
  return path.join(root, '.ff', 'tasks', `${id}.json`)
}

export function readTask(root, id) {
  try { return JSON.parse(fs.readFileSync(taskPath(root, id), 'utf8')) } catch (e) {
    if (e.code === 'ENOENT') return null
    throw e
  }
}

export function writeTask(root, task) {
  const target = taskPath(root, task.cardId)
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
  const temp = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(task, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temp, target)
}
