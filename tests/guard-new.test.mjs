import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { makeGuard } from '../scripts/lib/guard-rules.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { recordGates } from '../scripts/lib/gates.mjs'
import { makeWorkspace, baseConfig } from './helpers/fixture.mjs'

const GUARD = fileURLToPath(new URL('../scripts/guard.mjs', import.meta.url))
const CARD = 'trellocards/123-loc'
const PENDING = '> Trạng thái: CHỜ DUYỆT\n# Brief\nThân\n'
const APPROVED = PENDING.replace('CHỜ DUYỆT', 'ĐÃ DUYỆT 2026-10-13')

function setup(t, mut = (c) => c) {
  const ws = makeWorkspace({ config: mut(baseConfig()), gitRepos: false, files: { [`${CARD}/brief.md`]: PENDING } })
  t.after(ws.cleanup)
  const config = loadConfig(ws.root).config
  const G = makeGuard(ws.root, config)
  const ev = (o) => G.evaluate({ cwd: ws.root, mode: 'base', ...o })
  const approve = (answer = 'Duyệt') => {
    const q = '[#123] Duyệt GATE_A?'
    recordGates(ws.root, config, { questions: [{ header: 'GATE_A', question: q }] }, { answers: { [q]: answer } })
  }
  return { root: ws.root, ev, approve }
}

test('Bash chạm .ff.env bị chặn; ff không kèm $(...) và .ff.env.example được qua', (t) => {
  const { ev } = setup(t)
  for (const cmd of ['cat .ff.env', 'grep TOKEN .ff.env', 'source .ff.env', 'cat < .ff.env', 'cp .ff.env /tmp/x', 'base64 ./.ff.env', 'bash -c "cat .ff.env"', 'head -1 /abs/path/.ff.env', 'ff notify --kind info --title x --body "$(cat .ff.env)"', 'ff notify --kind info --title x --body `cat .ff.env`'])
    assert.notEqual(ev({ cmd }), null, cmd)
  for (const cmd of ['ff doctor', 'cat .ff.env.example', 'echo ok', 'ls -la'])
    assert.equal(ev({ cmd }), null, cmd)
})

test('tool đọc/sửa file secret bị chặn', (t) => {
  const { ev } = setup(t)
  for (const tool of ['Read', 'Grep', 'Edit']) assert.notEqual(ev({ file: '.ff.env', tool }), null, tool)
  assert.notEqual(ev({ file: '.ff/worker.json', tool: 'Read' }), null)
  assert.equal(ev({ file: '.ff.env.example', tool: 'Read' }), null)
})

test('file secret của jwt-mint, db và auth_storage', (t) => {
  const { ev } = setup(t, (c) => ({
    ...c,
    db: { driver: 'postgres', env_file: 'api/.env.DATABASE' },
    e2e: { dir: 'ff-e2e', auth_storage: 'ff-e2e/.auth/state.json', auth: { strategy: 'jwt-mint', jwt: { secret: { file: 'api/.env', key: 'JWT_SECRET' }, algorithm: 'HS256', payload: { sub: '{user.id}' }, deliver: [{ via: 'query', name: 'token' }] } } },
  }))
  for (const cmd of ['cat api/.env', 'cd api && grep JWT .env', 'cat api/.env.DATABASE', 'cat ff-e2e/.auth/state.json'])
    assert.notEqual(ev({ cmd }), null, cmd)
  for (const file of ['api/.env', 'api/.env.DATABASE', 'ff-e2e/.auth/state.json']) assert.notEqual(ev({ file, tool: 'Read' }), null, file)
  assert.equal(ev({ cmd: 'cat api/.env.example' }), null)
})

test('env_file tùy chỉnh', (t) => {
  const { ev } = setup(t, (c) => ({ ...c, secrets: { env_file: 'secrets/app.env' } }))
  assert.notEqual(ev({ cmd: 'cat secrets/app.env' }), null)
  assert.notEqual(ev({ file: 'secrets/app.env', tool: 'Read' }), null)
  assert.equal(ev({ cmd: 'cat .ff.env' }), null)
})

test('.ff/ chỉ hook và ff được ghi', (t) => {
  const { ev } = setup(t)
  assert.notEqual(ev({ file: '.ff/gates/123-GATE_A.json', tool: 'Write', input: { content: '{"approved":true}' } }), null)
  assert.notEqual(ev({ cmd: `echo '{"approved":true}' > .ff/gates/123-GATE_A.json` }), null)
  assert.notEqual(ev({ cmd: `python3 -c "open('.ff/gates/x.json','w').write('{}')"` }), null)
  assert.equal(ev({ cmd: 'cat .ff/doctor.json' }), null)
})

test('marker: chặn khi chưa Duyệt, qua khi Duyệt và thân không đổi', (t) => {
  const { ev, approve } = setup(t)
  const write = (content) => ev({ file: `${CARD}/brief.md`, tool: 'Write', input: { content } })
  assert.match(write(APPROVED), /GATE_A của thẻ #123/)
  approve('Cần sửa')
  assert.notEqual(write(APPROVED), null)
  approve('Duyệt')
  assert.equal(write(APPROVED), null)
  assert.notEqual(write(APPROVED + 'Thêm sau khi duyệt\n'), null)
})

test('Edit: thêm marker cần Duyệt; marker có sẵn mà sửa thân thì bị chặn', (t) => {
  const { root, ev, approve } = setup(t)
  const addMarker = { file: `${CARD}/brief.md`, tool: 'Edit', input: { old_string: 'CHỜ DUYỆT', new_string: 'ĐÃ DUYỆT 2026-10-13' } }
  assert.notEqual(ev(addMarker), null)
  approve()
  assert.equal(ev(addMarker), null)
  fs.writeFileSync(path.join(root, CARD, 'brief.md'), APPROVED)
  assert.notEqual(ev({ file: `${CARD}/brief.md`, tool: 'Edit', input: { old_string: 'Thân', new_string: 'Thân mới' } }), null)
  assert.notEqual(ev({ file: `${CARD}/brief.md`, tool: 'MultiEdit', input: { edits: [{ old_string: 'Thân', new_string: 'Khác' }] } }), null)
})

test('sau khi Duyệt: chèn dòng "Trạng thái: …" khác khuôn hoặc sửa ledger → chặn ghi marker', (t) => {
  const { root, ev, approve } = setup(t)
  fs.writeFileSync(path.join(root, CARD, '01b-ledger.md'), '| D-01 | Thân | Mô tả | |\n')
  approve()
  const write = (content) => ev({ file: `${CARD}/brief.md`, tool: 'Write', input: { content } })
  assert.equal(write(APPROVED), null)
  assert.notEqual(write(APPROVED.replace('# Brief', 'Trạng thái: thêm quyền xoá DB\n# Brief')), null)
  fs.appendFileSync(path.join(root, CARD, '01b-ledger.md'), '| D-02 | thêm | Mô tả | |\n')
  assert.notEqual(write(APPROVED), null)
})

test('marker không có ">", qua NotebookEdit, NFD đều bị nhận ra', (t) => {
  const { ev } = setup(t)
  assert.notEqual(ev({ file: `${CARD}/brief.md`, tool: 'Write', input: { content: 'Trạng thái: ĐÃ DUYỆT\n# Brief\nThân\n' } }), null)
  assert.notEqual(ev({ file: `${CARD}/brief.md`, tool: 'Write', input: { content: '- Trạng thái: ĐÃ DUYỆT\n' } }), null)
  assert.notEqual(ev({ file: `${CARD}/brief.md`, tool: 'Write', input: { content: APPROVED.normalize('NFD') } }), null)
  assert.notEqual(ev({ file: `${CARD}/brief.md`, tool: 'NotebookEdit', input: { new_source: 'Trạng thái: ĐÃ DUYỆT' } }), null)
})

test('GATE B TỰ QUA và file ngoài cards_dir không bị chặn', (t) => {
  const { ev } = setup(t)
  assert.equal(ev({ file: `${CARD}/03-design.md`, tool: 'Write', input: { content: '> Trạng thái: GATE B TỰ QUA 2026-10-13\n' } }), null)
  assert.equal(ev({ file: 'docs/brief.md', tool: 'Write', input: { content: APPROVED } }), null)
})

test('Bash ghi artifact Gate hoặc marker bị chặn, đọc thì qua', (t) => {
  const { ev } = setup(t)
  for (const cmd of [
    `sed -i '' '1s/.*/> Trạng thái: ĐÃ DUYỆT/' ${CARD}/brief.md`,
    `echo '> Trạng thái: ĐÃ DUYỆT' > ${CARD}/brief.md`,
    `cp /tmp/b.md ${CARD}/brief.md`,
    `python3 -c "open('${CARD}/brief.md','w').write('x')"`,
    `node -e "require('fs').writeFileSync('${CARD}/03-design.md','x')"`,
  ]) assert.notEqual(ev({ cmd }), null, cmd)
  for (const cmd of [`cat ${CARD}/brief.md`, `grep -c "ĐÃ DUYỆT" ${CARD}/brief.md 2>/dev/null`, `head -10 ${CARD}/brief.md`, `sed -n 1,10p ${CARD}/brief.md`])
    assert.equal(ev({ cmd }), null, cmd)
  assert.notEqual(ev({ cmd: `cd ${CARD} && echo x >> brief.md` }), null)
  assert.notEqual(ev({ cmd: 'tee .ff/gates/x.json' }), null)
})

test('không chặn nhầm: chỉ nhắc tên file, hoặc file trùng tên ngoài cards_dir', (t) => {
  const { ev } = setup(t)
  for (const cmd of [
    `cp ${CARD}/brief.md /tmp/b.md`,
    'mv docs/brief.md docs/old/brief.md',
    'node scripts/lint.js docs/brief.md',
    'python3 check.py 03-design.md',
    'rm -f src/brief.md',
    'echo ".ff/" >> .gitignore',
    'ls .ff/ > /tmp/l',
    'git mv a.md brief.md',
    'echo "Trạng thái: ĐÃ DUYỆT" > notes.md',
  ]) assert.equal(ev({ cmd }), null, cmd)
})

test('guard no-op ngoài workspace', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-none-'))
  const r = spawnSync('node', [GUARD, '--cwd', dir, '--cmd', 'git push origin dev && cat .ff.env'], { encoding: 'utf8' })
  fs.rmSync(dir, { recursive: true })
  assert.equal(r.status, 0)
  assert.equal(r.stdout + r.stderr, '')
})

test('config hỏng cú pháp hoặc sai schema: vẫn chặn luật cơ bản bằng exit 2', (t) => {
  const bad = {
    'yaml hỏng': 'repos: [\n',
    'thiếu repos': YAML.stringify({ version: 1, workspace: { root: '.', cards_dir: 'trellocards', worktrees_dir: 'worktrees' }, secrets: { env_file: '.ff.env' } }),
    'regex hỏng': YAML.stringify({ ...baseConfig(), guard: { migration_script_re: '(' } }),
    'workspace null': YAML.stringify({ ...baseConfig(), workspace: null }),
  }
  for (const [name, text] of Object.entries(bad)) {
    const ws = makeWorkspace({ files: { 'ff.config.yaml': text }, gitRepos: false })
    t.after(ws.cleanup)
    const run = (cmd) => spawnSync('node', [GUARD, '--cwd', ws.root, '--cmd', cmd], { encoding: 'utf8' }).status
    assert.equal(run('git stash'), 2, name)
    assert.equal(run('cat .ff.env'), 2, name)
    assert.equal(run('git status'), 0, name)
  }
})

test('ff ship-approve / relock → hook trả permissionDecision ask', (t) => {
  const { root } = setup(t)
  for (const cmd of ['ff ship-approve 123', 'ff relock 123 --reason x']) {
    const r = spawnSync('node', [GUARD, '--cwd', root, '--cmd', cmd], { encoding: 'utf8' })
    assert.equal(r.status, 0, cmd)
    assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'ask', cmd)
  }
  const plain = spawnSync('node', [GUARD, '--cwd', root, '--cmd', 'ff doctor'], { encoding: 'utf8' })
  assert.equal(plain.stdout, '')
})
