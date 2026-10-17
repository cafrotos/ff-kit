import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

function findRoot(start: string): string {
  let dir = path.resolve(start)
  while (true) {
    const file = path.join(dir, 'ff.config.yaml')
    if (fs.existsSync(file)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error('Không thấy ff.config.yaml từ thư mục e2e.')
    dir = parent
  }
}

export const root = findRoot(path.dirname(fileURLToPath(import.meta.url)))
const parsed = YAML.parse(fs.readFileSync(path.join(root, 'ff.config.yaml'), 'utf8')) ?? {}
if (!parsed.e2e) throw new Error('Thiếu khối e2e trong ff.config.yaml.')
export const ffConfig = { ...parsed, root }
export const e2e = parsed.e2e
export const db = parsed.db

export function readEnvFile(file: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (/^(?:".*"|'.*')$/.test(value)) value = value.slice(1, -1)
    else value = value.replace(/\s+#.*$/, '').replace(/^#.*$/, '')
    values[match[1]] = value
  }
  return values
}

export function requiredEnv(key: string): string {
  const value = process.env[key]
  if (!value) throw new Error(`Thiếu biến ${key} trong process.`)
  return value
}

export const e2eUser = () => process.env.E2E_USER
export const e2ePassword = () => process.env.E2E_PASSWORD
