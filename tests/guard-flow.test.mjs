import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { makeGuard } from '../scripts/lib/guard-rules.mjs'
import { loadConfig } from '../scripts/lib/config.mjs'
import { main } from '../scripts/cli/main.mjs'
import { makeWorkspace, baseConfig } from './helpers/fixture.mjs'

const SPEC = 'worktrees/123-loc/web/t.spec.ts'

function setup(t, extra = {}) {
  const ws = makeWorkspace({ gitRepos: false, files: { [SPEC]: 'test("a",()=>{})\n', 'trellocards/123-loc/brief.md': 'x\n', 'notes.txt': 'hi\n', 'pids/a.pid': '999999\n', ...extra } })
  t.after(ws.cleanup)
  const G = makeGuard(ws.root, loadConfig(ws.root).config)
  const cwd = ws.root
  const ev = (o) => G.evaluate({ cwd, mode: 'base', ...o })
  const ff = async (...args) => {
    let out = '', err = ''
    const code = await main(args, { cwd: ws.root, stdout: { write: (s) => { out += s } }, stderr: { write: (s) => { err += s } } })
    return { code, out, err }
  }
  return { root: ws.root, ev, ff, G }
}
const lock = async (s) => assert.equal((await s.ff('lock-tests', '123-loc', SPEC)).code, 0)

test('relock --open mở cửa sổ sửa; sửa; relock băm lại và khóa', async (t) => {
  const s = setup(t); await lock(s)
  const abs = path.join(s.root, SPEC)
  assert.match(s.ev({ file: abs, tool: 'Edit' }), /relock 123-loc --open/)
  assert.match(s.ev({ cmd: `echo x >> ${SPEC}` }), /đã khóa/)
  const nothing = await s.ff('relock', '123-loc', '--reason', 'thử')
  assert.match(nothing.out, /không có file nào thay đổi.*--open/)
  assert.match(s.ev({ file: abs, tool: 'Edit' }), /đã khóa/)
  const open = await s.ff('relock', '123-loc', '--open', '--reason', 'sửa locator')
  assert.equal(open.code, 0, open.err)
  assert.equal(s.ev({ file: abs, tool: 'Edit' }), null)
  assert.equal(s.ev({ file: abs, tool: 'Write' }), null)
  assert.ok(fs.statSync(abs).mode & 0o200)
  fs.appendFileSync(abs, '// sửa\n')
  const close = await s.ff('relock', '123-loc', '--reason', 'xong')
  assert.equal(close.code, 0, close.err)
  assert.match(close.out, /1 file thay đổi/)
  assert.match(s.ev({ file: abs, tool: 'Edit' }), /đã khóa/)
  assert.equal(fs.statSync(abs).mode & 0o222, 0)
  assert.match(fs.readFileSync(path.join(s.root, 'worktrees/123-loc/.ff-test-lock.log'), 'utf8'), /mở cửa sổ sửa[\s\S]*đóng cửa sổ sửa/)
})

test('relock --open chỉ file có trong manifest; cửa sổ hết hạn thì khóa lại', async (t) => {
  const s = setup(t, { 'worktrees/123-loc/web/other.ts': '1\n' }); await lock(s)
  const bad = await s.ff('relock', '123-loc', '--open', '--reason', 'x', 'worktrees/123-loc/web/other.ts')
  assert.equal(bad.code, 1); assert.match(bad.err, /không có trong manifest/)
  assert.equal((await s.ff('relock', '123-loc', '--open', '--reason', 'x', SPEC)).code, 0)
  const win = path.join(s.root, 'worktrees/123-loc/.ff-test-unlock')
  fs.writeFileSync(win, `ts=${Math.floor(Date.now() / 1000) - 7200}\n${SPEC}\n`)
  assert.match(s.ev({ file: path.join(s.root, SPEC), tool: 'Edit' }), /đã khóa/)
})

test('guard vẫn cần người cho phép cho ff relock --open', (t) => {
  const s = setup(t)
  assert.equal(s.G.needsAsk('ff relock 123-loc --open --reason "x"'), true)
})

const ALLOWED = [
  'git log --oneline -5; ls -la',
  'cd web && grep -rn foo $(find . -name "*.ts")',
  'for f in $(ls); do grep -n x "$f"; done',
  'python3 -c "import os; print(sorted(os.listdir(\'.\')))"',
  'python3 -c "print(open(\'t.spec.ts\').read())"',
  "node -e \"console.log(require('fs').readFileSync('t.spec.ts','utf8').length)\"",
  'python3 - <<EOF\nimport json\nprint(json.dumps({"a":1}))\nEOF',
  'git commit -m "$(cat <<\'EOF\'\nmsg\nEOF\n)"',
  'bash -c "grep -rn foo ."',
  'cat notes.txt | xargs grep -n a',
  'ls -la .env* ; ls .ff.env',
  'find . -maxdepth 1 -name ".ff.env*"',
]
const BLOCKED = [
  'python3 -c "open(\'x\',\'w\').write(\'1\')"',
  `python3 -c "open('${SPEC}','a').write('x')"`,
  "node -e \"require('fs').writeFileSync('a.txt','1')\"",
  'python3 script.py',
  'echo hi > a.txt; python3 -c "print(1)" > worktrees/123-loc/web/t.spec.ts',
  `sed -i s/a/b/ ${SPEC}`,
  `bash -c "echo x > ${SPEC}"`,
  'echo $(echo hi) > worktrees/123-loc/web/t.spec.ts',
  `rm $(echo ${SPEC})`,
  'xargs rm < notes.txt',
  'cat .ff.env',
  'ls $(cat .ff.env)',
  'python3 -c "print(open(\'.ff.env\').read())"',
  'eval "echo x"',
]
test('khóa test: lệnh chỉ đọc được qua, ghi thật vẫn bị chặn', async (t) => {
  const s = setup(t); await lock(s)
  for (const cmd of ALLOWED) assert.equal(s.ev({ cmd }), null, cmd)
  for (const cmd of BLOCKED) assert.notEqual(s.ev({ cmd }), null, cmd)
})

test('thông báo ghi artifact Gate nêu rõ công cụ', (t) => {
  const s = setup(t)
  const r = s.ev({ cmd: 'echo x > trellocards/123-loc/brief.md' })
  assert.match(r, /Edit hoặc Write.*trellocards\/123-loc\/brief\.md/)
})

test('kill theo PID số của tiến trình không thuộc ff được qua; pkill, PID bảo vệ thì không', async (t) => {
  const child = spawn('sleep', ['30'], { stdio: 'ignore' })
  t.after(() => child.kill())
  const s = setup(t, { 'pids/b.pid': `${child.pid}\n` })
  assert.equal(s.ev({ cmd: `kill ${child.pid}` }), null)
  assert.equal(s.ev({ cmd: `kill -9 ${child.pid}` }), null)
  assert.equal(s.ev({ cmd: `kill $(cat ${s.root}/pids/b.pid)` }), null)
  assert.equal(s.ev({ cmd: `kill \`cat ${s.root}/pids/b.pid\`` }), null)
  assert.match(s.ev({ cmd: 'pkill node' }), /pkill/)
  assert.match(s.ev({ cmd: 'killall node' }), /pkill/)
  assert.match(s.ev({ cmd: `kill ${process.pid}` }), /không kill/)
  assert.match(s.ev({ cmd: `kill ${process.ppid}` }), /không kill/)
  assert.match(s.ev({ cmd: 'kill 1' }), /không kill/)
  assert.match(s.ev({ cmd: 'kill -9 -1' }), /pkill|kill/)
  assert.notEqual(s.ev({ cmd: 'kill $(cat .ff/worker.json)' }), null)
})

test('ff logs: đuôi log service đã che secret, không in .ff.env', async (t) => {
  const s = setup(t, { '.ff.env': 'API_TOKEN=supersecretvalue123\n', '.ff/services/123/api.log': 'start\nAuthorization: Bearer abc.def\nuse supersecretvalue123 here\nready\n', '.ff/services/123/prepare-web.log': 'prep ok\n' })
  const all = await s.ff('logs', '123', '--lines', '3')
  assert.equal(all.code, 0, all.err)
  assert.match(all.out, /==> api\.log/); assert.match(all.out, /==> prepare-web\.log/)
  assert.doesNotMatch(all.out, /supersecretvalue123|abc\.def/)
  assert.match(all.out, /\[REDACTED\]/)
  const one = await s.ff('logs', '123', 'api')
  assert.doesNotMatch(one.out, /prepare-web/)
  assert.equal((await s.ff('logs')).code, 2)
  assert.equal((await s.ff('logs', '999')).code, 2)
})

test('thông dịch viên đọc-thuần không được lách secret qua heredoc/chuỗi trích', async (t) => {
  const s = setup(t); await lock(s)
  for (const cmd of ['python3 - <<EOF\nprint(open(".ff.env").read())\nEOF', 'node -e "console.log(require(\'fs\').readFileSync(\'.ff.env\',\'utf8\'))"'])
    assert.equal(s.ev({ cmd }), 'Không đọc, sửa hay chép file secret (.ff.env, .ff/worker.json). Cần biết key có hay chưa → `ff doctor`.', cmd)
})
