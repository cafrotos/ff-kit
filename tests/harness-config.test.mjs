import { test } from 'node:test'
import assert from 'node:assert/strict'
import YAML from 'yaml'
import { parseConfigText } from '../scripts/lib/config.mjs'
import { validate } from '../scripts/lib/schema.mjs'
import { baseConfig } from './helpers/fixture.mjs'

const legacyYaml = YAML.stringify(baseConfig())
const parsed = (config) => parseConfigText(YAML.stringify(config)).config

test('legacy config receives opt-in harness defaults before validation', () => {
  assert.equal(parseConfigText(legacyYaml).config.worker.driver.enabled, false)
  const noConcurrency = baseConfig()
  delete noConcurrency.worker.max_concurrent_tasks
  assert.equal(parseConfigText(YAML.stringify(noConcurrency)).config.worker.max_concurrent_tasks, 2)
  assert.equal(parseConfigText(legacyYaml).config.worker.driver.max_repair_cycles, 3)
  assert.equal(parseConfigText(legacyYaml).config.ship.mode, 'dev_only')
  assert.equal(parseConfigText(legacyYaml).config.knowledge.min_precedents, 3)
  assert.deepEqual(parseConfigText(legacyYaml).config.worker.driver, {
    enabled: false, stuck_after_minutes: 90, max_stage_retries: 3, max_repair_cycles: 3, remote_control: true,
  })
  assert.deepEqual(parseConfigText(legacyYaml).config.ship, { mode: 'dev_only', max_reopen: 3 })
  assert.deepEqual(parseConfigText(legacyYaml).config.knowledge.high_risk, [])
  assert.deepEqual(validate(parseConfigText(legacyYaml).config), [])
})

test('nested harness overrides retain defaults and leave raw config unchanged', () => {
  const c = baseConfig()
  c.worker.max_concurrent_tasks = 5
  c.worker.driver = { max_repair_cycles: 1 }
  c.ship = { mode: 'dev_and_pr' }
  c.knowledge = { high_risk: [{ repo: 'web', keywords: ['payment'], paths: ['src/billing/**'] }] }
  const { config, raw } = parseConfigText(YAML.stringify(c))
  assert.equal(config.worker.max_concurrent_tasks, 5)
  assert.equal(config.worker.driver.enabled, false)
  assert.equal(config.worker.driver.max_stage_retries, 3)
  assert.equal(config.worker.driver.max_repair_cycles, 1)
  assert.equal(config.ship.max_reopen, 3)
  assert.equal(config.knowledge.min_precedents, 3)
  assert.deepEqual(raw, c)
  assert.deepEqual(validate(config), [])
})

test('disabled driver permits legacy and standalone configurations without acceptance lists', () => {
  const c = baseConfig()
  c.worker.driver = { enabled: false }
  assert.deepEqual(validate(parsed(c)), [])
  delete c.worker.task_source
  assert.deepEqual(validate(parsed(c)), [])
})

test('enabled driver requires both acceptance and reopen lists from Trello', () => {
  const c = baseConfig()
  c.worker.driver = { enabled: true }
  assert.ok(validate(parsed(c)).some((e) => /accept_list/.test(e)))
  assert.ok(validate(parsed(c)).some((e) => /reopen_list/.test(e)))
  c.worker.task_source.trello.accept_list = 'Acceptance'
  assert.ok(validate(parsed(c)).some((e) => /reopen_list/.test(e)))
  c.worker.task_source.trello.reopen_list = 'Reopened'
  assert.deepEqual(validate(parsed(c)), [])
  c.worker.task_source.trello.accept_list = ''
  assert.ok(validate(parsed(c)).some((e) => /accept_list/.test(e)))
  c.worker.task_source.trello.accept_list = '  '
  assert.ok(validate(parsed(c)).some((e) => /accept_list/.test(e)))
  delete c.worker.task_source
  assert.ok(validate(parsed(c)).some((e) => /task_source/.test(e)))
})

for (const [section, key, values] of [
  ['driver', 'enabled', ['true']],
  ['driver', 'stuck_after_minutes', [-1, 0]],
  ['driver', 'max_stage_retries', [-1, 0, 1.5]],
  ['driver', 'max_repair_cycles', [-1, 0, 4, 1.5]],
  ['ship', 'max_reopen', [-1, 0, 1.5]],
  ['ship', 'mode', ['unknown']],
  ['knowledge', 'min_precedents', [-1, 0, 1.5]],
]) {
  for (const value of values) test(`rejects ${section}.${key}=${JSON.stringify(value)}`, () => {
    const c = baseConfig()
    if (section === 'driver') c.worker.driver = { [key]: value }
    else c[section] = { [key]: value }
    assert.ok(validate(parsed(c)).some((e) => e.includes(key)))
  })
}

test('high-risk rules accept only repo, keywords and paths', () => {
  const c = baseConfig()
  c.knowledge = { high_risk: [{ repo: 'web', keywords: ['payment'], paths: ['billing/**'] }] }
  assert.deepEqual(validate(parsed(c)), [])
  c.knowledge.high_risk[0].deploy_command = 'deploy'
  assert.ok(validate(parsed(c)).some((e) => /deploy_command/.test(e)))
  delete c.knowledge.high_risk[0].deploy_command
  c.knowledge.high_risk[0].keywords = 'payment'
  assert.ok(validate(parsed(c)).some((e) => /keywords/.test(e)))
})

test('each parsed config has independent harness defaults', () => {
  const first = parseConfigText(legacyYaml).config
  first.worker.driver.enabled = true
  first.knowledge.high_risk.push({ repo: 'web', paths: ['billing/**'] })
  const second = parseConfigText(legacyYaml).config
  assert.equal(second.worker.driver.enabled, false)
  assert.deepEqual(second.knowledge.high_risk, [])
})

test('high-risk rules allow workspace-wide matching and require a nonblank matcher', () => {
  const c = baseConfig()
  for (const rule of [{ keywords: ['payment'] }, { paths: ['billing/**'] }, { repo: 'web', keywords: [], paths: ['billing/**'] }]) {
    c.knowledge = { high_risk: [rule] }
    assert.deepEqual(validate(parsed(c)), [])
  }
  for (const rule of [{}, { repo: 'web' }, { keywords: [], paths: [] }, { keywords: [' '] }, { paths: [''] }, { repo: ' ', keywords: ['payment'] }]) {
    c.knowledge = { high_risk: [rule] }
    assert.ok(validate(parsed(c)).length > 0, JSON.stringify(rule))
  }
})
test('e2e.done_tests_dir mặc định <tests_dir>/task-done, tôn trọng giá trị đã đặt',()=>{
  assert.equal(parseConfigText('e2e: {tests_dir: e2e/tests}\n').config.e2e.done_tests_dir, 'e2e/tests/task-done')
  assert.equal(parseConfigText('e2e: {tests_dir: e2e/tests, done_tests_dir: e2e/ok}\n').config.e2e.done_tests_dir, 'e2e/ok')
  assert.equal(parseConfigText('worker: {}\n').config.e2e, undefined)
})
