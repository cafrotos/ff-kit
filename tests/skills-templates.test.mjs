import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import schema from '../schema/ff.config.schema.mjs'
import { validate } from '../scripts/lib/schema.mjs'
import { parseTables, traceCheck } from '../scripts/lib/trace.mjs'
import { acMatrix } from '../scripts/cli/spec-checks.mjs'
import { makeWorkspace, baseConfig } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const blocks = (file, language) => [...read(file).matchAll(new RegExp('```' + language + '\\n([\\s\\S]*?)```', 'g'))].map((m) => m[1])

test('design auto-gate template uses typed eligibility metadata', () => {
  const metadata = blocks('skills/ff-understand/references/design.md', 'yaml').map((block) => YAML.parse(block.replace(/^---\n/, '').replace(/\n---\s*$/, ''))).find((value) => value?.gate_b)
  assert.ok(metadata)
  assert.deepEqual(metadata.gate_b, { new_behavior: false, precedent_deviation: false, open_decisions: false })
})

test('published spec and behavior templates are recognized by ac-matrix with custom paths and task-N', async (t) => {
  const spec = blocks('skills/ff-understand/references/design.md', 'markdown').find((block) => block.startsWith('# Spec'))
  assert.ok(spec, 'publish a runnable spec example, not table-only ACs')
  const behavior = blocks('skills/ff-build/references/test-first.md', 'ts').find((block) => block.includes("test('AC-01:"))
  assert.ok(behavior)
  const config = baseConfig()
  config.workspace = { root: '.', cards_dir: 'cases', worktrees_dir: 'sandboxes' }
  config.e2e = { dir: 'qa', tests_dir: 'qa/specs' }
  assert.deepEqual(validate(config), [])
  const card = 'cases/123-filter'
  const ws = makeWorkspace({ config, gitRepos: false, files: {
    [`${card}/01-dossier.md`]: '# Thẻ 123\n## Branch\nfeature/filter\n',
    [`${card}/task-1/02-spec.md`]: spec,
    'qa/specs/123-filter/task-1-behavior.spec.ts': behavior,
  } })
  t.after(ws.cleanup)
  const io = capture(ws.root)
  assert.equal(await acMatrix.run(['123', 'task-1'], io.ctx), 0, io.buf.out + io.buf.err)
  assert.match(io.buf.out, /AC-01: COVERED/)
  assert.match(io.buf.out, /COVERED 1, SKIP 0, MISSING 0, ORPHAN 0/)
})

test('ledger example and source-bearing artifacts remain trace-check compatible', (t) => {
  const ledger = blocks('skills/ff-understand/references/brief.md', 'markdown').find((block) => block.startsWith('# Ledger'))
  const spec = blocks('skills/ff-understand/references/design.md', 'markdown').find((block) => block.startsWith('# Spec'))
  assert.ok(ledger && spec)
  const tables = parseTables(ledger)
  const sourceRows = tables[0].rows.filter((row) => !row.cells[3].startsWith('bỏ:'))
  const dossier = '# Thẻ 123\n## Mô tả\n' + sourceRows.map((row) => row.cells[1]).join('\n') + '\n## Comments\n🔄 Sync từ sheet row 77\n'
  const covered = [...sourceRows.map((row) => row.cells[0]), 'U-01'].join(', ')
  const ws = makeWorkspace({ gitRepos: false, files: {
    'trellocards/123-filter/01-dossier.md': dossier,
    'trellocards/123-filter/01b-ledger.md': ledger,
    'trellocards/123-filter/brief.md': `# Brief\n| Mục | Nguồn |\n|---|---|\n| Giữ bộ lọc | ${covered} |\n`,
    'trellocards/123-filter/02-spec.md': spec,
  } })
  t.after(ws.cleanup)
  assert.deepEqual(traceCheck(path.join(ws.root, 'trellocards/123-filter')).errors, [])
})

test('planner and implementer briefs share bounded file contracts; Haiku stays one file', () => {
  for (const file of ['skills/ff-build/references/plan-slice.md', 'skills/ff-build/briefs/planner.md', 'skills/ff-build/briefs/implement-micro.md']) {
    assert.match(read(file), /Files/, file)
    assert.match(read(file), /Haiku.*một file|Haiku.*1 file/, file)
  }
  assert.match(read('agents/ff-implementer.md'), /danh sách file hữu hạn/)
  assert.match(read('agents/ff-implementer-haiku.md'), /đúng một file/)
})

test('revision test locks preserve earlier tests and use the active manifest from state', () => {
  for (const file of ['skills/ff-build/SKILL.md', 'skills/ff-verify/SKILL.md']) {
    assert.match(read(file), /testLock/, file)
  }
  const locking = read('skills/ff-build/references/test-first.md')
  assert.match(locking, /ff lock-tests <slug> --revision rev-N/)
  assert.match(locking, /ff relock <slug> --revision rev-N/)
  assert.match(locking, /hồi quy/)
  assert.doesNotMatch(read('skills/ff-understand/references/reopen.md'), /placeholder.*đã.*duyệt/)
})

test('all design example tables have traceable source columns', () => {
  const tables = parseTables(read('skills/ff-understand/references/design.md'))
  assert.ok(tables.length >= 2)
  for (const table of tables.filter((table) => !table.inAppendix)) {
    assert.ok(table.header.includes('Nguồn'), `design table at line ${table.line} must survive trace-check`)
  }
})

test('configured e2e paths named by skills exist in the config schema', () => {
  const directories = ['skills', 'agents', 'references']
  const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : entry.name.endsWith('.md') ? [path.join(dir, entry.name)] : [])
  for (const file of directories.flatMap(walk)) {
    for (const match of read(file).matchAll(/e2e\.([A-Za-z_]+)/g)) {
      assert.ok(Object.hasOwn(schema.properties.e2e.properties, match[1]), `${file}: e2e.${match[1]} is not configured`)
    }
  }
})
