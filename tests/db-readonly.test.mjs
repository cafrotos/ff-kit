import test from 'node:test'
import assert from 'node:assert/strict'
import { run, validateQuerySafety } from '../scripts/cli/db-query.mjs'
import { baseConfig, makeWorkspace } from './helpers/fixture.mjs'
import { capture } from './helpers/io.mjs'

test('rejects write, locking and session-control forms inside read-shaped queries', () => {
  for (const sql of [
    'SELECT * INTO copied_users FROM users',
    "SELECT 1 INTO OUTFILE '/tmp/output'",
    "SELECT 1 INTO DUMPFILE '/tmp/output'",
    'SELECT * FROM users FOR UPDATE',
    'SELECT * FROM users FOR NO KEY UPDATE',
    'SELECT * FROM users FOR SHARE',
    'SELECT * FROM users FOR KEY SHARE',
    'SELECT * FROM users LOCK IN SHARE MODE',
    'EXPLAIN ANALYZE INSERT INTO users VALUES (1)',
    'EXPLAIN (ANALYZE true) DELETE FROM users',
    'WITH x AS (SELECT 1) TABLE users',
    'WITH x AS (SELECT 1) VALUES (1)',
    'SELECT 1; SET TRANSACTION READ WRITE',
    'SELECT @counter := 1',
    'SELECT NEXT VALUE FOR seq',
  ]) assert.throws(() => validateQuerySafety(sql), undefined, sql)
})

test('rejects known side effect functions including qualified and quoted names', () => {
  for (const sql of [
    "SELECT nextval('seq')", "SELECT setval('seq', 42)", "SELECT pg_notify('channel', 'message')",
    "SELECT pg_catalog . nextval ('seq')", 'SELECT "pg_catalog"."nextval"(\'seq\')',
    "SELECT set_config('transaction_read_only', 'off', true)",
    'SELECT pg_advisory_lock(1)', 'SELECT pg_try_advisory_xact_lock(1)',
    'SELECT pg_terminate_backend(123)', "SELECT lo_export(1, '/tmp/file')",
    "SELECT dblink_exec('conn', 'DELETE FROM users')", "SELECT GET_LOCK('name', 1)",
    "SELECT `release_lock`('name')",
  ]) assert.throws(() => validateQuerySafety(sql), undefined, sql)
})

test('fails closed on unsupported or malformed lexical structures', () => {
  for (const sql of [
    "SELECT 'unterminated", 'SELECT "unterminated', 'SELECT `unterminated',
    'SELECT $tag$unterminated', 'SELECT 1 /* unterminated',
    'SELECT (1', 'SELECT 1)', 'SELECT', 'EXPLAIN users',
    'WITH x AS (SELECT 1)', 'WITH SELECT 1',
    'SELECT 1 /*! INTO OUTFILE \'/tmp/output\' */',
    'SELECT /*+ SET_VAR(max_execution_time=0) */ 1',
    "SELECT 'back\\slash'", 'SELECT 1 # unsupported dialect comment',
    'SELECT 1--1',
  ]) assert.throws(() => validateQuerySafety(sql), undefined, sql)
})

test('preserves safe literals, nested comments, CTEs and EXPLAIN SELECT output statements', () => {
  for (const sql of [
    "SELECT 'DELETE; INTO OUTFILE; nextval(''seq'')' AS value; SELECT 2",
    'SELECT $tag$SELECT; nextval()$tag$ AS value',
    'SELECT "update", `delete` FROM users',
    'SELECT 1 /* outer /* nested */ comment */',
    'SELECT 1 -- standard line comment\n; SELECT 2',
    'WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM x WHERE n < 3) SELECT * FROM x',
    'WITH x AS MATERIALIZED (SELECT 1), y AS NOT MATERIALIZED (SELECT * FROM x) SELECT * FROM y',
    'EXPLAIN ANALYZE SELECT 1', 'EXPLAIN (ANALYZE false, FORMAT JSON) SELECT 1',
  ]) assert.ok(validateQuerySafety(sql).length > 0, sql)
})

function databaseFixture(driver) {
  const config = baseConfig()
  config.db = { driver, env_file: 'db.env' }
  return makeWorkspace({ config, gitRepos: false, files: { 'db.env': 'DATABASE_PASSWORD=supersecret\n' } })
}

function contractClient(cap, queries, { failOn, rollbackFailure = false } = {}) {
  const events = []
  cap.ctx.connectDb = async () => ({
    connect: async () => { events.push('connect') },
    query: async (sql) => {
      events.push(sql)
      if (sql === failOn) throw new Error('database rejected supersecret')
      if (sql === 'ROLLBACK' && rollbackFailure) throw new Error('rollback rejected supersecret')
      if (queries.includes(sql)) return { rows: [{ query: sql }] }
      return { rows: [{ control: sql }] }
    },
    end: async () => { events.push('end') },
  })
  return events
}

const controls = {
  postgres: ['BEGIN READ ONLY', "SET LOCAL statement_timeout = '15000ms'", "SET LOCAL lock_timeout = '5000ms'"],
  mysql: ['SET SESSION max_execution_time = 15000', 'SET SESSION innodb_lock_wait_timeout = 5', 'START TRANSACTION READ ONLY'],
}

for (const driver of Object.keys(controls)) {
  test(`${driver} runs only query rows inside a read-only transaction and rolls back before closing`, async () => {
    const ws = databaseFixture(driver)
    try {
      const cap = capture(ws.root)
      const queries = ['SELECT 1', 'SELECT 2']
      const events = contractClient(cap, queries)
      assert.equal(await run(['--sql', queries.join('; '), '--json'], cap.ctx), 0)
      assert.deepEqual(events, ['connect', ...controls[driver], ...queries, 'ROLLBACK', 'end'])
      assert.deepEqual(JSON.parse(cap.buf.out), queries.map(query => ({ query })))
      assert.equal(cap.buf.err, '')
    } finally { ws.cleanup() }
  })

  test(`${driver} rolls back and closes on query failure, redacting secrets`, async () => {
    const ws = databaseFixture(driver)
    try {
      const cap = capture(ws.root)
      const events = contractClient(cap, ['SELECT 1'], { failOn: 'SELECT 1', rollbackFailure: true })
      assert.equal(await run(['--sql', 'SELECT 1'], cap.ctx), 1)
      assert.deepEqual(events, ['connect', ...controls[driver], 'SELECT 1', 'ROLLBACK', 'end'])
      assert.equal(cap.buf.out, '')
      assert.match(cap.buf.err, /database rejected \[redacted\]/)
      assert.doesNotMatch(cap.buf.err, /supersecret/)
    } finally { ws.cleanup() }
  })

  test(`${driver} fails before user SQL if transaction protections cannot be applied`, async () => {
    const ws = databaseFixture(driver)
    try {
      const cap = capture(ws.root)
      const events = contractClient(cap, ['SELECT 1'], { failOn: controls[driver][1] })
      assert.equal(await run(['--sql', 'SELECT 1'], cap.ctx), 1)
      assert.deepEqual(events, ['connect', ...controls[driver].slice(0, 2), 'ROLLBACK', 'end'])
      assert.equal(cap.buf.out, '')
    } finally { ws.cleanup() }
  })
}

test('rollback failure after successful reads fails the command before output', async () => {
  const ws = databaseFixture('postgres')
  try {
    const cap = capture(ws.root)
    const events = contractClient(cap, ['SELECT 1'], { rollbackFailure: true })
    assert.equal(await run(['--sql', 'SELECT 1'], cap.ctx), 1)
    assert.equal(cap.buf.out, '')
    assert.equal(events.at(-1), 'end')
    assert.match(cap.buf.err, /rollback rejected \[redacted\]/)
  } finally { ws.cleanup() }
})

test('unsafe SQL is rejected before connecting and explains the least privilege requirement', async () => {
  const ws = databaseFixture('postgres')
  try {
    const cap = capture(ws.root)
    let connected = false
    cap.ctx.connectDb = async () => { connected = true }
    assert.equal(await run(['--sql', "SELECT nextval('seq')"], cap.ctx), 1)
    assert.equal(connected, false)
    assert.match(cap.buf.err, /least.privilege/i)
  } finally { ws.cleanup() }
})

test('redacts short passwords and overlapping env values without revealing suffixes', async () => {
  for (const [env, message] of [
    ['DATABASE_PASSWORD=x!\n', 'credential x!'],
    ['DATABASE_USERNAME=super\nDATABASE_PASSWORD=supersecret\n', 'credential supersecret'],
  ]) {
    const config = baseConfig()
    config.db = { driver: 'postgres', env_file: 'db.env' }
    const ws = makeWorkspace({ config, gitRepos: false, files: { 'db.env': env } })
    try {
      const cap = capture(ws.root)
      cap.ctx.connectDb = async () => ({ connect: async () => { throw new Error(message) }, end: async () => {} })
      assert.equal(await run(['--sql', 'SELECT 1'], cap.ctx), 1)
      assert.match(cap.buf.err, /credential \[redacted\]\n/)
    } finally { ws.cleanup() }
  }
})
