import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const phases = {
  understand: ['function', 'current', 'requested', 'target', 'impact', 'acceptance', 'uncertainty'],
  design: ['realization', 'differences', 'impact', 'uncertainty'],
  build: ['implemented', 'checks', 'remaining', 'readiness'],
  verify: ['expectedActual', 'evidence', 'regression', 'limitations', 'conclusion'],
  ship: ['acceptedScope', 'destination', 'checks', 'limitations'],
}

// Content checks enforce wiring/schema, not whether a Claude reader understands
// or whether a summary faithfully represents a fixture. Those require replay.
test('shared human recipe owns all packet section contracts and one valid example', () => {
  const recipe = read('references/human-output.md')
  for (const [phase, fields] of Object.entries(phases)) {
    const row = recipe.split('\n').find((line) => line.startsWith(`| ${phase} |`))
    assert.ok(row, phase)
    assert.deepEqual([...row.matchAll(/`([A-Za-z]+)`/g)].map((m) => m[1]), fields, phase)
  }
  const examples = [...recipe.matchAll(/```json\n([\s\S]*?)\n```/g)]
  assert.equal(examples.length, 1)
  const packet = JSON.parse(examples[0][1])
  assert.equal(packet.version, 1)
  assert.equal(packet.phase, 'understand')
  assert.equal(packet.scope, '')
  assert.deepEqual(Object.keys(packet.sections), phases.understand)
  for (const value of Object.values(packet.sections)) assert.equal(typeof value, 'string')
  assert.equal(packet.decisions[0].id, 'Q1')
  assert.ok(packet.decisions[0].options.length >= 2)
  for (const option of packet.decisions[0].options) {
    assert.equal(typeof option.label, 'string')
    assert.equal(typeof option.description, 'string')
  }
  assert.ok(packet.headline && packet.nextAction && packet.decisions[0].recommendation)
  assert.doesNotMatch(recipe, /"(?:sourceHashes|approval|approved)"\s*:/)
})

test('operating consumers explicitly use present and share the recipe', () => {
  for (const file of ['skills/ff-understand/SKILL.md', 'skills/ff-build/SKILL.md', 'skills/ff-verify/SKILL.md', 'commands/ship-to-dev.md']) {
    const content = read(file)
    assert.match(content, /references\/human-output\.md/, file)
    assert.match(content, /ff present <id> --file <activeDir>\/human-output\.json/, file)
    assert.match(content.split('---')[1], /Bash\(ff present \*\)/, file)
    assert.doesNotMatch(content.split('---')[1], /Bash\(ff \*\)/, file)
  }
  assert.match(read('skills/ff-understand/SKILL.md'), /--gate GATE_A/)
  assert.match(read('skills/ff-understand/SKILL.md'), /--gate GATE_B/)
  assert.match(read('skills/ff-verify/SKILL.md'), /--gate GATE_C/)
  assert.doesNotMatch(read('skills/ff-build/SKILL.md'), /--gate GATE_/)
})

test('fresh gate reader consumes the rendered presentation and has phase criteria', () => {
  const brief = read('skills/ff-understand/briefs/gate-reader.md')
  const agent = read('agents/ff-gate-reader.md')
  for (const phase of ['understand', 'design', 'verify']) assert.match(brief, new RegExp(`\\| ${phase} \\|`))
  assert.match(brief, /stdout.*ff present|ff present.*stdout/)
  assert.match(agent, /dossier.*phụ lục|phụ lục.*dossier/)
  assert.doesNotMatch(brief, /khớp Brief/)
})

test('complex and reopened work retain the complete human context', () => {
  const complex = read('skills/ff-understand/references/big-task.md')
  assert.doesNotMatch(complex, /Trang 1 Brief thẻ chỉ có/)
  assert.match(complex, /toàn chức năng/)
  assert.match(complex, /nghiệp vụ/)
  const reopen = read('skills/ff-understand/references/reopen.md')
  assert.match(reopen, /human-output\.md/)
  assert.match(reopen, /human-output\.json/)
  assert.match(reopen, /đã ship/)
})

test('verification never uses UX observations or unmeasured signals as success', () => {
  const report = read('skills/ff-verify/references/report.md')
  assert.doesNotMatch(report, /PASS` \(hoặc `OBSERVATION`/)
  for (const file of ['skills/ff-verify/references/report.md', 'skills/ff-verify/references/proof-discipline.md', 'agents/ff-verifier.md']) {
    assert.match(read(file), /N\/A/, file)
    assert.match(read(file), /UNVERIFIED/, file)
  }
  assert.doesNotMatch(read('agents/ff-verifier.md'), /UNVERIFIED` hoặc `OBSERVATION/)
})

test('notification is optional for ship and presentation never grants approval', () => {
  const command = read('commands/ship-to-dev.md')
  assert.match(command, /worker.*(?:không|vắng)|(?:không|vắng).*worker/i)
  assert.match(command, /AskUserQuestion/)
  assert.match(command, /remote.*commit|commit.*remote/)
  assert.match(read('skills/ff-understand/rules.md'), /ff present/)
})
