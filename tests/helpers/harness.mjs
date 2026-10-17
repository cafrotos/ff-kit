import fs from 'node:fs'
import path from 'node:path'
import { baseConfig, makeWorkspace } from './fixture.mjs'
import { loadConfig } from '../../scripts/lib/config.mjs'
import { validate } from '../../scripts/lib/schema.mjs'
import { writeTask } from '../../ff-worker/src/core/task-store.mjs'

export function makeHarnessFixture(t) {
  const raw = baseConfig()
  raw.worker.driver = { enabled: true }
  raw.ship = { ...raw.ship, verify_on_ship_branch: false } // generic harness fixtures have no origin/ship branch; real S1 flows run ff ship-test (ship-*.test.mjs)
  raw.worker.task_source.trello.accept_list = 'Acceptance'
  raw.worker.task_source.trello.reopen_list = 'Reopened'
  const workspace = makeWorkspace({ config: raw, gitRepos: false })
  t.after(workspace.cleanup)
  const { root, cleanup } = workspace
  const { config } = loadConfig(root)
  if (validate(config).length) throw new Error('Invalid harness fixture configuration')
  const cardDir = path.join(root, config.workspace.cards_dir, '123-harness')
  fs.mkdirSync(cardDir, { mode: 0o700 })
  let time = Date.parse('2026-10-15T00:00:00Z')
  const clock = { now: () => time, advance: (ms) => { time += ms; return time } }
  const task = (overrides = {}) => ({
    cardId: '123', stateVersion: 1, stage: 'understand', waitingOn: null,
    executionStatus: 'idle', revision: '', runId: 'run-1', dispatchId: '',
    pendingDispatch: null, tmuxSession: null, claudeSessionId: null,
    workflow: {}, questions: [], handledEventIds: [], stageRetries: {}, repairCycles: {},
    workingMs: 0, workingSince: null, lastProgressAt: null, history: [], pendingEffects: [],
    ...overrides,
  })
  const event = (overrides = {}) => ({
    eventId: 'e1', cardId: '123', revision: '', runId: 'run-1', dispatchId: '',
    type: 'runner_idle', at: new Date(clock.now()).toISOString(), payload: {}, ...overrides,
  })
  const writeArtifact = (relativePath, text) => {
    const target = path.resolve(root, relativePath)
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error('Artifact escapes workspace')
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
    fs.writeFileSync(target, text, { mode: 0o600 })
    return target
  }
  return { root, config, cardDir, task, event, seedTask: (value) => writeTask(root, value), writeArtifact, clock, cleanup }
}
