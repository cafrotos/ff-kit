import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { main } from '../scripts/cli/main.mjs'
import { makeWorkspace, baseConfig } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'
import { recordGates } from '../scripts/lib/gates.mjs'

test('ff state coi Gate record + hash là nguồn duyệt, không tin marker', async (t) => {
  const ws = makeWorkspace({ files: {
    'trellocards/123-sample/01-dossier.md': '# Card\nYêu cầu mẫu.\n',
    'trellocards/123-sample/01b-ledger.md': '| D-01 | Yêu cầu mẫu. | Mô tả | |\n',
    'trellocards/123-sample/brief.md': '# Brief\n> Trạng thái: ĐÃ DUYỆT\nNội dung.\n',
  } })
  t.after(ws.cleanup)
  const out = capture(ws.root)
  assert.equal(await main(['state', '123'], out.ctx), 0)
  assert.match(out.buf.out, /brief\.md: chưa duyệt/)
  const config = baseConfig()
  recordGates(ws.root, config, { questions: [{ header: 'GATE_A', question: '[#123] Duyệt Brief?' }], answers: { '[#123] Duyệt Brief?': 'Duyệt' } }, {})
  assert.equal(await main(['state', '123'], out.ctx), 0)
  assert.match(out.buf.out, /brief\.md: ĐÃ DUYỆT/)
  fs.appendFileSync(path.join(ws.root, 'trellocards/123-sample/brief.md'), 'Thay đổi sau duyệt.\n')
  assert.equal(await main(['state', '123'], out.ctx), 0)
  assert.match(out.buf.out, /brief\.md: chưa duyệt/)
})

test('ff state list không phụ thuộc thẻ cụ thể', async (t) => {
  const ws = makeWorkspace({ files: { 'trellocards/123-sample/01-dossier.md': '# Card\n' } })
  t.after(ws.cleanup)
  const { ctx, buf } = capture(ws.root)
  assert.equal(await main(['state'], ctx), 0)
  assert.match(buf.out, /123-sample/)
})
