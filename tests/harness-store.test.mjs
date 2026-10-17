import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { pathToFileURL } from 'node:url'
import { makeHarnessFixture } from './helpers/harness.mjs'
import { readTask, writeTask, updateHarnessTask, VersionConflictError } from '../ff-worker/src/core/task-store.mjs'
import { withFileMutex, BusyError } from '../scripts/lib/file-mutex.mjs'
import { appendHarnessEvent, listHarnessEvents } from '../scripts/lib/harness-events.mjs'
import { normalizeRevision, assertHarnessEvent } from '../scripts/lib/harness-contracts.mjs'

const moduleUrl = (relative) => pathToFileURL(path.resolve(relative)).href
const owner = () => ({ pid: process.pid, hostname: os.hostname(), slug: 'same-task' })
function child(t, source, args = []) {
  const proc = spawn(process.execPath, ['--input-type=module', '-e', source, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(() => { if (proc.exitCode === null) proc.kill('SIGKILL') })
  let stdout = '', stderr = ''
  proc.stdout.on('data', (data) => { stdout += data })
  proc.stderr.on('data', (data) => { stderr += data })
  const done = once(proc, 'exit').then(([code, signal]) => ({ code, signal, stdout, stderr }))
  return { proc, done, output: () => stdout }
}
async function until(predicate) {
  const deadline = Date.now() + 5000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for child checkpoint')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

test('scope normalizes only root revision and rejects malformed events', (t) => {
  const w = makeHarnessFixture(t)
  assert.equal(normalizeRevision(null), '')
  assert.equal(normalizeRevision('rev-2'), 'rev-2')
  assert.throws(() => normalizeRevision('rev-0'))
  assert.equal(assertHarnessEvent(w.event({ revision: null })).revision, '')
  for (const overrides of [{ type: 'fake_approval' }, { cardId: '../123' }, { eventId: '' }, { dispatchId: null }, { at: 'yesterday' }, { payload: null }]) {
    assert.throws(() => assertHarnessEvent(w.event(overrides)))
  }
})

test('actual concurrent processes compare and swap one task version exactly once', async (t) => {
  const w = makeHarnessFixture(t)
  w.seedTask(w.task())
  const source = `import {updateHarnessTask} from ${JSON.stringify(moduleUrl('ff-worker/src/core/task-store.mjs'))};
    import fs from 'node:fs';
    while (!fs.existsSync(process.argv[2])) await new Promise(r=>setTimeout(r,2));
    try { const task=await updateHarnessTask(process.argv[1],'123',1,t=>({...t,workingMs:t.workingMs+1})); console.log(task.stateVersion) }
    catch(e) { console.log(e.name); if(e.name!=='VersionConflictError') process.exitCode=1 }`
  const start = path.join(w.root, 'start')
  const writers = Array.from({ length: 8 }, () => child(t, source, [w.root, start]))
  fs.writeFileSync(start, '')
  const results = await Promise.all(writers.map((writer) => writer.done))
  assert.ok(results.every((result) => result.code === 0), JSON.stringify(results))
  assert.equal(results.filter((result) => result.stdout.trim() === '2').length, 1)
  assert.equal(results.filter((result) => result.stdout.trim() === 'VersionConflictError').length, 7)
  assert.equal(readTask(w.root, '123').stateVersion, 2)
  assert.equal(readTask(w.root, '123').workingMs, 1)
})

test('CAS preserves legacy IO and rejects stale, asynchronous and identity-changing reducers', async (t) => {
  const w = makeHarnessFixture(t)
  writeTask(w.root, { cardId: 'legacy', custom: true })
  assert.deepEqual(readTask(w.root, 'legacy'), { cardId: 'legacy', custom: true })
  assert.equal(readTask(w.root, 'missing'), null)
  w.seedTask(w.task())
  await assert.rejects(updateHarnessTask(w.root, '123', 0, (task) => task), VersionConflictError)
  await assert.rejects(updateHarnessTask(w.root, '123', 1, async (task) => task), /synchronous/i)
  await assert.rejects(updateHarnessTask(w.root, '123', 1, (task) => ({ ...task, cardId: '456' })), /cardId/)
  await assert.rejects(updateHarnessTask(w.root, '123', 1, () => { throw new Error('reducer failed') }), /reducer failed/)
  assert.equal(readTask(w.root, '123').stateVersion, 1)
  const created = await updateHarnessTask(w.root, 'new', 0, (task) => { assert.equal(task, null); return w.task({ cardId: 'new' }) })
  assert.equal(created.stateVersion, 1)
  const changed = await updateHarnessTask(w.root, '123', 1, (task) => ({ ...task, stateVersion: 999, revision: null }))
  assert.equal(changed.stateVersion, 2)
  assert.equal(changed.revision, '')
})

test('concurrent duplicate event delivery persists once across processes and restart', async (t) => {
  const w = makeHarnessFixture(t)
  const source = `import {appendHarnessEvent} from ${JSON.stringify(moduleUrl('scripts/lib/harness-events.mjs'))};
    const result=await appendHarnessEvent(process.argv[1],JSON.parse(process.argv[2])); console.log(JSON.stringify(result))`
  const results = await Promise.all(Array.from({ length: 8 }, () => child(t, source, [w.root, JSON.stringify(w.event())]).done))
  assert.ok(results.every((result) => result.code === 0), JSON.stringify(results))
  assert.equal(results.filter((result) => JSON.parse(result.stdout).stored).length, 1)
  assert.deepEqual(await appendHarnessEvent(w.root, w.event({ payload: { ignored: true } })), { stored: false, eventId: 'e1' })
  assert.equal(listHarnessEvents(w.root, '123').filter((event) => event.eventId === 'e1').length, 1)
  assert.deepEqual(listHarnessEvents(w.root, 'missing'), [])
  assert.deepEqual(listHarnessEvents(w.root, '123')[0], w.event())
})

test('interrupted JSON and invalid final files never become valid inbox events', async (t) => {
  const w = makeHarnessFixture(t)
  await appendHarnessEvent(w.root, w.event({ revision: null }))
  const dir = path.join(w.root, '.ff/harness/inbox/123')
  fs.writeFileSync(path.join(dir, 'crashed.tmp'), '{"eventId":')
  fs.writeFileSync(path.join(dir, 'crashed.json'), '{"eventId":')
  fs.writeFileSync(path.join(dir, 'invalid.json'), JSON.stringify(w.event({ type: 'fake_approval' })))
  fs.writeFileSync(path.join(dir, 'wrong-card.json'), JSON.stringify(w.event({ cardId: '456' })))
  assert.deepEqual(listHarnessEvents(w.root, '123'), [w.event()])
  await assert.rejects(appendHarnessEvent(w.root, w.event({ type: 'fake_approval' })))
  await assert.rejects(appendHarnessEvent(w.root, w.event({ cardId: '../escape' })))
})

test('live cross-process owner with same slug stays busy, then killed owner is recovered', async (t) => {
  const w = makeHarnessFixture(t)
  const file = path.join(w.root, '.ff/locks/live.lock')
  const source = `import {withFileMutex} from ${JSON.stringify(moduleUrl('scripts/lib/file-mutex.mjs'))};
    await withFileMutex(process.argv[1],{slug:'same-task'},async()=>{console.log('held'); await new Promise(()=>{});});`
  // A timer keeps the holder alive while its action waits.
  const held = child(t, `setInterval(()=>{},1000); ${source}`, [file])
  await until(() => held.output().includes('held'))
  await assert.rejects(withFileMutex(file, owner(), () => assert.fail('must not enter')), BusyError)
  held.proc.kill('SIGKILL')
  await held.done
  assert.equal(await withFileMutex(file, owner(), () => 'recovered'), 'recovered')
  assert.equal(fs.existsSync(file), false)
})

test('caller metadata cannot replace the live mutex holder PID or hostname', async (t) => {
  const w = makeHarnessFixture(t)
  const file = path.join(w.root, '.ff/locks/identity.lock')
  const reaped = child(t, '')
  assert.equal((await reaped.done).code, 0)
  const deadPid = reaped.proc.pid
  assert.throws(() => process.kill(deadPid, 0), { code: 'ESRCH' })

  for (const hostname of [os.hostname(), `${os.hostname()}-foreign`]) {
    await withFileMutex(file, { pid: deadPid, hostname, slug: 'same-task' }, async () => {
      const record = JSON.parse(fs.readFileSync(file, 'utf8'))
      await assert.rejects(withFileMutex(file, owner(), () => assert.fail('live holder must stay exclusive')), BusyError)
      assert.equal(record.owner.pid, process.pid)
      assert.equal(record.owner.hostname, os.hostname())
      assert.equal(record.owner.slug, 'same-task')
      assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), record)
    })
    assert.equal(fs.existsSync(file), false)
  }
})

test('unknown ownership fails closed; only proven death allows recovery', async (t) => {
  const w = makeHarnessFixture(t)
  const file = w.writeArtifact('.ff/locks/unknown.lock', '{broken')
  await assert.rejects(withFileMutex(file, owner(), () => {}), BusyError)
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken')
  for (const record of ['null', '0', '"owner"', '[]', '{}']) {
    fs.writeFileSync(file, record)
    await assert.rejects(withFileMutex(file, owner(), () => {}), BusyError)
    assert.equal(fs.readFileSync(file, 'utf8'), record)
  }
  const foreign = { owner: { pid: 12345, hostname: `${os.hostname()}-foreign` }, token: 'foreign-token' }
  fs.writeFileSync(file, JSON.stringify(foreign))
  await assert.rejects(withFileMutex(file, owner(), () => {}), BusyError)
  for (const result of [undefined, null, true, 'dead']) {
    await assert.rejects(withFileMutex(file, owner(), () => {}, { isOwnerAlive: () => result }), BusyError)
  }
  await assert.rejects(withFileMutex(file, owner(), () => {}, { isOwnerAlive: () => { throw new Error('unknown') } }), BusyError)
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), foreign)
  assert.equal(await withFileMutex(file, owner(), () => 42, { isOwnerAlive: () => false }), 42)
})

test('release waits for contender ownership check without replaying the action', async (t) => {
  const w = makeHarnessFixture(t)
  const file = path.join(w.root, '.ff/locks/release.lock')
  let finishAction, finishCheck, checks = 0, actions = 0
  const held = withFileMutex(file, owner(), () => { actions++; return new Promise((resolve) => { finishAction = resolve }) })
  await until(() => Boolean(finishAction))
  const contender = withFileMutex(file, owner(), () => assert.fail('live owner must stay blocked'), {
    isOwnerAlive: () => { checks++; return new Promise((resolve) => { finishCheck = resolve }) },
  })
  const rejected = assert.rejects(contender, BusyError)
  await until(() => Boolean(finishCheck))
  finishAction('completed')
  // Hold the acquisition guard while the live holder reaches its release.
  await new Promise((resolve) => setTimeout(resolve, 20))
  finishCheck(true)
  await rejected
  assert.equal(await held, 'completed')
  assert.equal(actions, 1)
  assert.equal(checks, 1)
  assert.equal(fs.existsSync(file), false)
})

test('task CAS contention is bounded and leaves the live owner unchanged', async (t) => {
  const w = makeHarnessFixture(t)
  w.seedTask(w.task())
  const file = path.join(w.root, '.ff/tasks/123.json.lock')
  await withFileMutex(file, owner(), async () => {
    const started = Date.now()
    await assert.rejects(updateHarnessTask(w.root, '123', 1, (task) => task), BusyError)
    assert.ok(Date.now() - started < 4000)
    assert.equal(readTask(w.root, '123').stateVersion, 1)
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).owner.pid, process.pid)
  })
})

test('process crash before task rename preserves old state and recovery increments once', async (t) => {
  const w = makeHarnessFixture(t)
  w.seedTask(w.task())
  const source = `import fs from 'node:fs'; import {updateHarnessTask} from ${JSON.stringify(moduleUrl('ff-worker/src/core/task-store.mjs'))};
    const rename=fs.renameSync; fs.renameSync=(from,to)=>{if(to.endsWith('/123.json')) process.kill(process.pid,'SIGKILL'); return rename(from,to)};
    await updateHarnessTask(process.argv[1],'123',1,task=>({...task,workingMs:999}));`
  const result = await child(t, source, [w.root]).done
  assert.equal(result.signal, 'SIGKILL')
  assert.equal(readTask(w.root, '123').stateVersion, 1)
  assert.equal(readTask(w.root, '123').workingMs, 0)
  assert.equal((await updateHarnessTask(w.root, '123', 1, (task) => task)).stateVersion, 2)
})

test('process crash before inbox rename exposes no event and redelivery recovers once', async (t) => {
  const w = makeHarnessFixture(t)
  const source = `import fs from 'node:fs'; import {appendHarnessEvent} from ${JSON.stringify(moduleUrl('scripts/lib/harness-events.mjs'))};
    const rename=fs.renameSync; fs.renameSync=(from,to)=>{if(to.endsWith('.json')) process.kill(process.pid,'SIGKILL'); return rename(from,to)};
    await appendHarnessEvent(process.argv[1],JSON.parse(process.argv[2]));`
  const result = await child(t, source, [w.root, JSON.stringify(w.event({ type: 'stage_finished' }))]).done
  assert.equal(result.signal, 'SIGKILL')
  assert.deepEqual(listHarnessEvents(w.root, '123'), [])
  assert.equal((await appendHarnessEvent(w.root, w.event({ type: 'stage_finished' }))).stored, true)
  assert.equal((await appendHarnessEvent(w.root, w.event({ type: 'stage_finished' }))).stored, false)
  assert.equal(listHarnessEvents(w.root, '123').length, 1)
})

test('simultaneous cross-process reclaimers never remove the new live holder', async (t) => {
  const w = makeHarnessFixture(t)
  const file = path.join(w.root, '.ff/locks/reclaim.lock')
  const doomed = child(t, `import {withFileMutex} from ${JSON.stringify(moduleUrl('scripts/lib/file-mutex.mjs'))};
    setInterval(()=>{},1000); await withFileMutex(process.argv[1],{},async()=>{console.log('held');await new Promise(()=>{})})`, [file])
  await until(() => doomed.output().includes('held'))
  doomed.proc.kill('SIGKILL')
  await doomed.done
  const release = path.join(w.root, 'release')
  const source = `import {withFileMutex} from ${JSON.stringify(moduleUrl('scripts/lib/file-mutex.mjs'))}; import fs from 'node:fs';
    try {await withFileMutex(process.argv[1],{},async()=>{console.log('held'); while(!fs.existsSync(process.argv[2])) await new Promise(r=>setTimeout(r,5))})}
    catch(e){console.log(e.name);if(e.name!=='BusyError')process.exitCode=1}`
  const contenders = Array.from({ length: 8 }, () => child(t, source, [file, release]))
  await until(() => contenders.every((proc) => /held|BusyError/.test(proc.output())))
  assert.equal(contenders.filter((proc) => proc.output().includes('held')).length, 1)
  assert.equal(fs.existsSync(file), true)
  fs.writeFileSync(release, '')
  const results = await Promise.all(contenders.map((proc) => proc.done))
  assert.ok(results.every((result) => result.code === 0), JSON.stringify(results))
  assert.equal(fs.existsSync(file), false)
})

test('release checks acquisition token and never deletes a successor lock', async (t) => {
  const w = makeHarnessFixture(t)
  const file = path.join(w.root, '.ff/locks/token.lock')
  let replacement
  await withFileMutex(file, owner(), () => {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'))
    replacement = { ...record, token: 'successor-token' }
    fs.writeFileSync(file, JSON.stringify(replacement))
  })
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), replacement)
})

test('failed action releases its own mutex and persistence paths are private', async (t) => {
  const w = makeHarnessFixture(t)
  const file = path.join(w.root, '.ff/locks/private.lock')
  await assert.rejects(withFileMutex(file, owner(), () => { throw new Error('action failed') }), /action failed/)
  assert.equal(fs.existsSync(file), false)
  await withFileMutex(file, owner(), () => assert.equal(fs.statSync(file).mode & 0o777, 0o600))
  w.seedTask(w.task())
  await updateHarnessTask(w.root, '123', 1, (task) => task)
  await appendHarnessEvent(w.root, w.event())
  function check(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name)
      assert.equal(fs.statSync(target).mode & 0o777, entry.isDirectory() ? 0o700 : 0o600, target)
      if (entry.isDirectory()) check(target)
    }
  }
  check(path.join(w.root, '.ff'))
})
