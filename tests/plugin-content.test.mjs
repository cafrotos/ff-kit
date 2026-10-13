import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const filesUnder = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name)
  return entry.isDirectory() ? filesUnder(full) : full.endsWith('.md') ? [full] : []
})

test('plugin content has no workspace-specific paths or names', () => {
  const files = ['skills', 'agents', 'commands', 'references'].flatMap(filesUnder)
  const banned = /tiniweb|trellisflow|oe-hrm|system-service|\/Users\/[^\s`]+|\/home\/[^\s`]+|origin\/(?:prod|dev)/i
  for (const file of files) assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), banned, file)
})

test('agents declare model and effort, and skills do not grant protected commands', () => {
  for (const file of filesUnder('agents')) {
    const text = fs.readFileSync(path.join(root, file), 'utf8')
    assert.match(text, /^model:\s*\S+/m, file)
    assert.match(text, /^effort:\s*(?:low|medium|high)/m, file)
  }
  for (const file of filesUnder('skills')) {
    const text = fs.readFileSync(path.join(root, file), 'utf8')
    const header = text.split('---')[1] ?? ''
    assert.doesNotMatch(header, /Bash\(ff (?:ship-approve|relock)\b/, file)
  }
})

test('plugin docs state secret and worker boundaries', () => {
  const init = fs.readFileSync(path.join(root, 'skills/ff-init/SKILL.md'), 'utf8')
  assert.match(init, /Không đọc `\.ff\.env`/)
  assert.match(init, /Không gọi `\/ff-worker start`/)
  const install = fs.readFileSync(path.join(root, 'INSTALL.md'), 'utf8')
  assert.match(install, /Không đọc hoặc in/)
})
