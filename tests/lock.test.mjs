import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { leafKeys, checkLock } from '../scripts/lib/lock.mjs'
import { makeWorkspace, baseConfig, writeLock } from './helpers/fixture.mjs'

const fails = (checks) => checks.filter((c) => !c.ok).map((c) => c.msg)

test('leafKeys theo name, bỏ version và name', () => {
  const keys = leafKeys(baseConfig()).map((l) => l.key)
  assert.ok(keys.includes('repos.web.path'))
  assert.ok(keys.includes('repos.web.commands.install'))
  assert.ok(keys.includes('worker.task_source.trello.done_list'))
  assert.ok(keys.includes('worker.task_source.trello.poll_lists'))
  assert.ok(!keys.includes('version'))
  assert.ok(!keys.some((k) => k.endsWith('.name')))
})

test('leafKeys: mảng object trùng name (vd deliver) → khóa theo vị trí', () => {
  const keys = leafKeys({ e2e: { auth: { jwt: { deliver: [{ via: 'query', name: 'token' }, { via: 'local_storage', name: 'token' }] } } } }).map((l) => l.key)
  assert.deepEqual(keys, ['e2e.auth.jwt.deliver.0.via', 'e2e.auth.jwt.deliver.0.name', 'e2e.auth.jwt.deliver.1.via', 'e2e.auth.jwt.deliver.1.name'])
})

test('thiếu file lock → 1 lỗi nhắc /ff-init', (t) => {
  const ws = makeWorkspace({ lock: false })
  t.after(ws.cleanup)
  assert.match(fails(checkLock(ws.root, baseConfig())).join('\n'), /ff-init/)
})

test('mọi nguồn user → xanh', (t) => {
  const ws = makeWorkspace()
  t.after(ws.cleanup)
  assert.deepEqual(fails(checkLock(ws.root, baseConfig())), [])
})

test('thiếu nguồn 1 key → lỗi nêu key', (t) => {
  const ws = makeWorkspace({ lock: false })
  t.after(ws.cleanup)
  const s = writeLock(ws.root, baseConfig())
  delete s['repos.web.path']
  fs.writeFileSync(path.join(ws.root, 'ff.config.lock.json'), JSON.stringify({ version: 1, sources: s }))
  assert.deepEqual(fails(checkLock(ws.root, baseConfig())), ['thiếu nguồn: repos.web.path'])
})

test('default chỉ hợp lệ khi giá trị bằng mặc định', (t) => {
  const ws = makeWorkspace({ lock: false })
  t.after(ws.cleanup)
  const raw = baseConfig()
  const s = writeLock(ws.root, raw)
  s['workspace.cards_dir'] = 'default'
  fs.writeFileSync(path.join(ws.root, 'ff.config.lock.json'), JSON.stringify({ version: 1, sources: s }))
  assert.deepEqual(fails(checkLock(ws.root, raw)), [])
  raw.workspace.cards_dir = 'trellisflow'
  assert.match(fails(checkLock(ws.root, raw)).join(), /workspace\.cards_dir.*default/)
})

test('file:line khớp rồi lệch khi file đổi', (t) => {
  const ws = makeWorkspace({ lock: false, files: { 'AGENTS.md': '# Repo\nBuild: `node -v` ở web\n' } })
  t.after(ws.cleanup)
  const raw = baseConfig()
  const s = writeLock(ws.root, raw)
  s['repos.web.commands.build'] = 'file:AGENTS.md:2'
  fs.writeFileSync(path.join(ws.root, 'ff.config.lock.json'), JSON.stringify({ version: 1, sources: s }))
  assert.deepEqual(fails(checkLock(ws.root, raw)), [])
  fs.writeFileSync(path.join(ws.root, 'AGENTS.md'), '# Repo\nBuild: `yarn build`\n')
  assert.match(fails(checkLock(ws.root, raw)).join(), /nguồn lệch — AGENTS\.md:2/)
})

test('lock NFD: file NFD vẫn khớp giá trị NFC', (t) => {
  const ws = makeWorkspace({ lock: false, files: { 'AGENTS.md': 'Nhánh gốc: phát-triển\n'.normalize('NFD') } })
  t.after(ws.cleanup)
  const raw = baseConfig()
  raw.repos[0].base_branch = 'phát-triển'
  const s = writeLock(ws.root, raw)
  s['repos.web.base_branch'] = 'file:AGENTS.md:1'
  fs.writeFileSync(path.join(ws.root, 'ff.config.lock.json'), JSON.stringify({ version: 1, sources: s }))
  assert.deepEqual(fails(checkLock(ws.root, raw)), [])
})

test('không nhận file secrets làm nguồn, nguồn sai định dạng bị báo', (t) => {
  const ws = makeWorkspace({ lock: false, files: { '.ff.env': 'X=dev\n' } })
  t.after(ws.cleanup)
  const raw = baseConfig()
  const s = writeLock(ws.root, raw)
  s['repos.web.base_branch'] = 'file:.ff.env:1'
  s['repos.web.path'] = 'đoán'
  fs.writeFileSync(path.join(ws.root, 'ff.config.lock.json'), JSON.stringify({ version: 1, sources: s }))
  const msg = fails(checkLock(ws.root, raw, '.ff.env')).join('\n')
  assert.match(msg, /repos\.web\.base_branch: không dùng file secrets làm nguồn/)
  assert.match(msg, /repos\.web\.path: nguồn không hợp lệ/)
})
