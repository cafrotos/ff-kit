// Hooks observe CLI activity. Only the worker may change task snapshots.
/**
 * @typedef {import('./harness-contracts.mjs').Scope & {claudeSessionId:string,presentationId?:string|null}} HookContext
 * @typedef {import('./harness-contracts.mjs').Scope & {claudeSessionId:string,questionId:string,toolUseId:string,index:number,header:string,presentationId:string|null,status:'open'|'answered',snapshot:Object,at:string,decision?:DecisionRecord}} QuestionRecord
 * @typedef {QuestionRecord & {decisionId:string,answer:string,normalizedValue:string,provenance:Object,decisionContext:Object,answeredAt:string}} DecisionRecord
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { assertScope } from './harness-contracts.mjs'
import { appendHarnessEvent } from './harness-events.mjs'
import { withFileMutexRetry } from './file-mutex.mjs'
import { readTask } from '../../ff-worker/src/core/task-store.mjs'
import { activeRevision, gateScope, GATES, recordGates } from './gates.mjs'
import { findCardDir } from './cards.mjs'
import { normalizeDecisionValue } from './knowledge.mjs'
import { redactHumanText } from './human-output.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const scopeOnly = value => assertScope({cardId:value.cardId,revision:value.revision,runId:value.runId,dispatchId:value.dispatchId})
const nonempty = value => typeof value === 'string' && value.length > 0
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
const runDir = (root, runId) => path.join(root, '.ff', 'runner', hash(runId))
function atomic(file, value, durable = false) {
  fs.mkdirSync(path.dirname(file), {recursive:true, mode:0o700})
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temp, JSON.stringify(value) + '\n', {mode:0o600, flag:'wx'})
    if (durable) {
      const fd = fs.openSync(temp,'r')
      try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    }
    fs.renameSync(temp, file)
    if (durable) {
      const fd = fs.openSync(path.dirname(file),'r')
      try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    }
  }
  finally { fs.rmSync(temp, {force:true}) }
}
function scopeContext(context) {
  const scope = scopeOnly(context)
  if (!nonempty(context.claudeSessionId)) throw new TypeError('Missing Claude session identity')
  return {...scope, claudeSessionId:context.claudeSessionId, presentationId:context.presentationId ?? null, ...(context.decisionPacket?{decisionPacket:redactRecord(Object.fromEntries(['scope','decisions','project','policyVersion'].map(k=>[k,context.decisionPacket[k]])))}:{}), ...(context.acceptanceBinding?{acceptanceBinding:structuredClone(context.acceptanceBinding)}:{})}
}
function currentScope(task) {
  const scope = scopeOnly(task)
  const pending = task.pendingDispatch
  if (pending && (pending.runId !== scope.runId || pending.revision !== scope.revision || pending.dispatchId !== scope.dispatchId)) throw new Error('Pending dispatch scope mismatch')
  if (!pending && scope.dispatchId && task.dispatchState !== 'finished') throw new Error('Missing pending dispatch')
  return scope
}
function launcherTask(root, env) {
  if (!/^[A-Za-z0-9]+$/.test(env.FF_CARD_ID ?? '') || !nonempty(env.FF_RUN_ID)) return null
  const task = readTask(root, env.FF_CARD_ID)
  if (!task || task.runId !== env.FF_RUN_ID) return null
  return task
}
export function readRunnerBinding(root, runId) {
  if (!nonempty(runId)) return null
  const value = read(path.join(runDir(root, runId), 'binding.json'))
  if (!value || value.version !== 1 || value.runId !== runId || !uuid(value.claudeSessionId) || !/^[A-Za-z0-9]+$/.test(value.cardId ?? '') || !['confirmed','blocked'].includes(value.status)) return null
  const blocked = read(path.join(runDir(root,runId),'blocked.json'))
  if (blocked) {
    if (blocked.cardId !== value.cardId || blocked.runId !== runId || blocked.claudeSessionId !== value.claudeSessionId || blocked.status !== 'blocked') throw new Error('Blocked session observation mismatch')
    return {...value,status:'blocked',reason:blocked.reason,confirmedAt:null}
  }
  return value
}
async function event(root, context, type, identity, payload) {
  const scope = scopeOnly(context)
  const eventId = hash(JSON.stringify([scope.cardId, scope.revision, scope.runId, scope.dispatchId, type, identity]))
  const result = await appendHarnessEvent(root, {...scope, eventId, type, at:new Date().toISOString(), payload})
  return result
}
/** SessionStart compares the launcher-owned UUID; it never creates/assigns one. */
export async function bindHookSession(root, config, input, env = process.env, {blockedReason = null} = {}) {
  if (!config.worker.driver.enabled) return null
  const task = launcherTask(root, env)
  if (!task) return null
  const scope = currentScope(task)
  let reason = !uuid(task.claudeSessionId) ? 'session_not_preallocated' : !nonempty(input.session_id) ? 'missing_session_id' : input.session_id !== task.claudeSessionId ? 'session_mismatch' : blockedReason
  let status = reason ? 'blocked' : 'confirmed'
  const file = path.join(runDir(root, scope.runId), 'binding.json')
  await withFileMutexRetry(`${file}.lock`, {operation:'session-binding'}, () => {
    const previous = read(file)
    if (previous && (previous.cardId !== scope.cardId || previous.runId !== scope.runId || previous.claudeSessionId !== task.claudeSessionId)) throw new Error('Existing session binding mismatch')
    const blocked = read(path.join(runDir(root,scope.runId),'blocked.json'))
    if(blocked){
      if(blocked.cardId!==scope.cardId || blocked.runId!==scope.runId || blocked.claudeSessionId!==task.claudeSessionId || blocked.status!=='blocked')throw new Error('Blocked session observation mismatch')
      reason=blocked.reason
      status='blocked'
    }
    // Preserve successful confirmation across a late/malformed hook. Its blocked
    // observation is still emitted for the controller and kept separately.
    const observation = {version:1,cardId:scope.cardId,runId:scope.runId,claudeSessionId:task.claudeSessionId,status,...(reason?{reason}:{}),confirmedAt:reason?null:new Date().toISOString()}
    if (!previous || !reason) atomic(file, observation)
    if (reason) atomic(path.join(runDir(root, scope.runId), 'blocked.json'), observation)
  })
  const delivery = await event(root, scope, 'session_started', status === 'confirmed' ? [status, randomUUID()] : [status,reason], {claudeSessionId:uuid(task.claudeSessionId)?task.claudeSessionId:null,status,...(reason?{reason}:{})})
  return {context:{...scope,claudeSessionId:task.claudeSessionId},status,reason,stored:delivery.stored}
}
/** Current pending dispatch is read for every pre-hook; env never pins revision. */
export function resolveHookContext(root, config, input, env = process.env) {
  if (config.worker.driver.enabled) {
    const task = launcherTask(root, env)
    if (!task || !nonempty(input.session_id) || input.session_id !== task.claudeSessionId) return null
    const binding = readRunnerBinding(root, task.runId)
    if (!binding || binding.status !== 'confirmed' || binding.cardId !== task.cardId || binding.claudeSessionId !== input.session_id) return null
    return {...currentScope(task),claudeSessionId:input.session_id}
  }
  // Standalone use has no worker dispatch. Only an explicit question card prefix
  // can identify its scope; cwd is never treated as a task/card identity.
  if (!nonempty(input.session_id)) return null
  const questions = input.tool_input?.questions
  if (!Array.isArray(questions) || !questions.length) return null
  const ids = questions.map(q=>String(q.question ?? '').match(/^\s*\[#([A-Za-z0-9]+)\]/)?.[1])
  if (!ids[0] || ids.some(id=>id !== ids[0])) return null
  const card = findCardDir(root, config, ids[0])
  if (!card.dir) return null
  return {cardId:ids[0],revision:activeRevision(card.dir) ?? '',runId:`standalone:${input.session_id}`,dispatchId:'',claudeSessionId:input.session_id}
}
function capturePath(root, context, input) {
  if (!nonempty(input.session_id) || !nonempty(input.tool_use_id) || input.session_id !== context.claudeSessionId) return null
  return path.join(runDir(root, context.runId), 'questions', `${hash(JSON.stringify([input.session_id,input.tool_use_id]))}.json`)
}
function snapshot(q, index) {
  return {header:redactHumanText(q.header || `Q${index+1}`),question:redactHumanText(q.question),options:(Array.isArray(q.options)?q.options:[]).map(o=>({label:redactHumanText(o.label),description:redactHumanText(o.description)})),multiSelect:q.multiSelect === true}
}
function decisionMetadata(context,q) {
  const packet=context.decisionPacket
  const prefix=`[#${context.cardId}]${context.revision?` [${context.revision}]`:''}${packet?.scope?` [${packet.scope}]`:''}`
  const d=packet?.decisions?.find(d=>q.question===`${prefix} ${d.question}` && JSON.stringify(q.options)===JSON.stringify(d.options) && !q.multiSelect)
  return d?.decisionContext?{explicitDecisionContext:d.decisionContext,project:packet.project,policyVersion:packet.policyVersion}:{}
}
function initialCapture(context, input) {
  const qs = Array.isArray(input.tool_input?.questions) ? input.tool_input.questions : []
  return {version:1,context,toolUseId:input.tool_use_id,questions:qs.map((q,index)=>({
    ...scopeOnly(context),claudeSessionId:context.claudeSessionId,
    questionId:hash(JSON.stringify([context.claudeSessionId,input.tool_use_id,index])),toolUseId:input.tool_use_id,index,
    header:redactHumanText(q.header || `Q${index+1}`),presentationId:context.presentationId,...decisionMetadata(context,q),...(context.acceptanceBinding?{acceptanceBinding:context.acceptanceBinding}:{}),status:'open',snapshot:snapshot(q,index),at:new Date().toISOString(),
  }))}
}
function loadCapture(file, context, input) {
  const capture = read(file)
  if (!capture) return initialCapture(context, input)
  if (capture.version !== 1 || capture.context?.cardId !== context.cardId || capture.context?.runId !== context.runId || capture.context?.claudeSessionId !== context.claudeSessionId || capture.toolUseId !== input.tool_use_id || !Array.isArray(capture.questions)) throw new Error('Question capture identity mismatch')
  scopeContext(capture.context)
  return capture
}
/** Read a persisted tool capture independently of current dispatch/revision/run. */
export function capturedQuestionContext(root, input, {cardId,runId} = {}) {
  if (!nonempty(input.session_id) || !nonempty(input.tool_use_id) || !nonempty(runId)) return null
  const file = capturePath(root, {runId,claudeSessionId:input.session_id}, input)
  const capture = read(file)
  if (!capture || capture.context?.cardId !== cardId || capture.context?.runId !== runId || capture.context?.claudeSessionId !== input.session_id || capture.toolUseId !== input.tool_use_id) return null
  return scopeContext(capture.context)
}
export async function recordQuestion(root, context, input) {
  if (!context) return []
  const safe = scopeContext(context), file = capturePath(root, safe, input)
  if (!file) return []
  const records = await withFileMutexRetry(`${file}.lock`, {operation:'question-open'}, () => {
    const capture = loadCapture(file, safe, input)
    atomic(file, capture)
    return capture.questions
  })
  for (const question of records.filter(q=>q.status === 'open')) {
    await event(root, question, 'question_opened', question.questionId, {questionId:question.questionId,toolUseId:question.toolUseId,header:question.header,presentationId:question.presentationId,status:'open',snapshot:question.snapshot,claudeSessionId:question.claudeSessionId})
  }
  return records
}
/** Canonical evidence identity requires an explicit ledger reference, never text similarity. */
export function decisionOrigin(cardId, revision, ledgerId) {
  return hash(JSON.stringify([cardId, revision ?? '', ledgerId]))
}
export function readDecisions(root) {
  const file = path.join(root, '.ff', 'decisions.jsonl')
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch(e) { if(e.code === 'ENOENT') return Object.assign([], {diagnostics:[]}); throw e }
  const lines = text.split('\n'), diagnostics = []
  const tail = lines.pop()
  if (tail) diagnostics.push({type:'partial',line:lines.length+1})
  const records = lines.filter(Boolean).map(line=>JSON.parse(line)).map(record=> {
    if(record.provenance?.source !== 'cli' || record.provenance.originId || !record.questionId || !record.cardId || typeof record.revision !== 'string' || !record.snapshot?.question)return record
    return {...record,provenance:{...record.provenance,card:record.cardId,revision:record.revision,...ledgerProvenance(record)}}
  })
  return Object.assign(records,{diagnostics})
}
function redactRecord(value) {
  if(typeof value === 'string')return redactHumanText(value)
  if(Array.isArray(value))return value.map(redactRecord)
  if(value && typeof value === 'object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redactRecord(v)]))
  return value
}
export async function appendDecision(root, record) {
  const file = path.join(root, '.ff', 'decisions.jsonl')
  if (!nonempty(record?.decisionId)) throw new TypeError('Missing decisionId')
  return withFileMutexRetry(`${file}.lock`, {operation:'decision-append'}, () => {
    fs.mkdirSync(path.dirname(file), {recursive:true,mode:0o700})
    const records = readDecisions(root)
    if(records.diagnostics.length)throw new Error('Partial decision journal tail; preserve and repair before append')
    if (records.some(d=>d.decisionId === record.decisionId)) return {stored:false,decisionId:record.decisionId}
    const fd = fs.openSync(file, 'a', 0o600)
    try { fs.writeSync(fd, JSON.stringify(redactRecord(record)) + '\n'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    return {stored:true,decisionId:record.decisionId}
  })
}
// Claude fixtures use either an answers map or question/answer rows. Reject
// null/objects/empty arrays rather than stringifying them into fake decisions.
export function cliAnswerFor(input, question) {
  for (const source of [input.tool_response,input.tool_input]) {
    const answers=source?.answers ?? source
    let value
    if(Array.isArray(answers)){
      const row=answers.find(row=>row?.question===question)
      value=row?.answer ?? row?.value
    }else if(answers && typeof answers==='object' && Object.hasOwn(answers,question))value=answers[question]
    if(Array.isArray(value)){
      if(!value.length || !value.every(v=>typeof v==='string' && v.trim()))continue
      value=value.join(', ')
    }
    if(typeof value==='string' && value.trim())return value
  }
  return null
}
function ledgerProvenance(question) {
  const ids = [...question.snapshot.question.matchAll(/\bU-\d+\b/g)].map(m=>m[0])
  if(new Set(ids).size !== 1)return {originId:question.questionId}
  const ledgerId=ids[0]
  return {ledgerId,originId:decisionOrigin(question.cardId,question.revision,ledgerId)}
}
export async function recordAnswers(root, context, input, {newOnly = false} = {}) {
  if (!context) return []
  const safe = scopeContext(context), file = capturePath(root, safe, input)
  if (!file) return []
  const freshIds = new Set()
  const decisions = await withFileMutexRetry(`${file}.lock`, {operation:'question-answer'}, async () => {
    const capture = loadCapture(file, safe, input), out = []
    for (const question of capture.questions) {
      const original = input.tool_input?.questions?.[question.index]
      // A response must identify the same original question. Never use a newer
      // tool input's positional answer against an older captured snapshot.
      if (!original || JSON.stringify(snapshot(original,question.index)) !== JSON.stringify(question.snapshot)) continue
      const answer = cliAnswerFor(input, original.question)
      if (question.status !== 'answered' && (answer === null || !answer.trim())) continue
      const value = redactHumanText(answer)
      const decision = question.decision ?? {...question,status:'answered',decisionId:hash(`decision:${question.questionId}`),answer:value,
        ...(question.explicitDecisionContext?{...question.explicitDecisionContext,project:question.project,policyVersion:question.policyVersion}:{}),
        normalizedValue:question.explicitDecisionContext ? normalizeDecisionValue(question.explicitDecisionContext.normalizedOptions[value]??value) : value.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('vi'),
        provenance:{source:'cli',card:question.cardId,revision:question.revision,claudeSessionId:question.claudeSessionId,toolUseId:question.toolUseId,...ledgerProvenance(question)},
        decisionContext:{...question.snapshot,...question.explicitDecisionContext,presentationId:question.presentationId,...(question.acceptanceBinding?{acceptanceBinding:question.acceptanceBinding}:{})},answeredAt:new Date().toISOString()}
      // Durable human history precedes both status and answer event. Retries can
      // repair a missing event without duplicating/overwriting the decision.
      if ((await appendDecision(root, decision)).stored) freshIds.add(decision.decisionId)
      question.status = 'answered'
      question.decision = decision
      out.push(decision)
    }
    atomic(file, capture)
    return out
  })
  for (const decision of decisions) await event(root, decision, 'question_answered', decision.questionId, {questionId:decision.questionId,toolUseId:decision.toolUseId,header:decision.header,presentationId:decision.presentationId,status:'answered',decisionId:decision.decisionId,normalizedValue:decision.normalizedValue,provenance:decision.provenance,decisionContext:decision.decisionContext,claudeSessionId:decision.claudeSessionId})
  // A hook interrupted after durable history must not later approve a changed
  // artifact. Default callers still receive retries for answer-event repair.
  for (const decision of decisions) if (decision.header === 'ACCEPTANCE' && decision.acceptanceBinding) await event(root,decision,'acceptance_recorded',decision.questionId,{decisionId:decision.decisionId,confirmed:decision.normalizedValue==='duyệt',...decision.acceptanceBinding})
  return newOnly ? decisions.filter(d=>freshIds.has(d.decisionId)) : decisions
}
/** Apply only validated captured answers, once across all question captures. */
export async function recordCapturedGates(root, config, context, decisions) {
  const candidates = decisions.filter(d => context &&
    ['cardId','revision','runId','dispatchId'].every(key=>d[key]===context[key]) &&
    GATES.includes(d.snapshot.header) &&
    d.snapshot.question.match(/^\s*\[#([A-Za-z0-9]+)\]/)?.[1] === d.cardId)
  if (!candidates.length) return {receipts:[],failed:0}
  const file = path.join(root,'.ff','gate-decisions.json')
  return withFileMutexRetry(`${file}.lock`, {operation:'captured-gate-answer'}, async () => {
    const claimed = read(file) ?? {version:1,decisionIds:[],latestByGate:{}}
    if (claimed.version !== 1 || !Array.isArray(claimed.decisionIds) || !claimed.decisionIds.every(id=>typeof id==='string') || !claimed.latestByGate || typeof claimed.latestByGate !== 'object' || Array.isArray(claimed.latestByGate)) throw new Error('Invalid Gate decision claims')
    const historyFile = path.join(root,'.ff','decisions.jsonl')
    // Hold the append mutex through receipt mutation: an order snapshot cannot
    // authorize an older receipt after a newer answer becomes durable. Lock
    // order is Gate -> decision; answer recording never acquires the Gate lock.
    return withFileMutexRetry(`${historyFile}.lock`, {operation:'gate-decision-order'}, () => {
      const history = readDecisions(root)
      if(history.diagnostics.length)throw new Error('Partial decision journal tail')
      const order = new Map(history.map((d,index)=>[d.decisionId,index]))
      const receipts = []
      let failed = 0
      for (const decision of candidates) {
        if (claimed.decisionIds.includes(decision.decisionId)) continue
        const index = order.get(decision.decisionId)
        if (index === undefined) throw new Error('Gate answer missing durable decision')
        const key = JSON.stringify([decision.cardId,decision.snapshot.header,gateScope(decision.snapshot.question)])
        const latest = claimed.latestByGate[key]
        if (latest !== undefined && !order.has(latest)) throw new Error('Gate decision order mismatch')
        // Different captures may finish history before reaching this mutex in
        // reverse order. Persisted append order, never hook arrival/time, wins.
        const newerPersisted = history.slice(index+1).some(d =>
          ['cardId','revision','runId','dispatchId'].every(field=>d[field]===decision[field]) &&
          d.snapshot?.header === decision.snapshot.header &&
          d.snapshot.question.match(/^\s*\[#([A-Za-z0-9]+)\]/)?.[1] === d.cardId &&
          gateScope(d.snapshot.question) === gateScope(decision.snapshot.question))
        const superseded = newerPersisted || (latest !== undefined && order.get(latest) >= index)
        // Claim before recordGates hashes live files or writes a receipt. An
        // interrupted/failed attempt stays consumed: a retry must never refresh
        // evidence against changed artifacts or undo a newer human answer.
        claimed.decisionIds.push(decision.decisionId)
        if (!superseded) claimed.latestByGate[key] = decision.decisionId
        atomic(file,claimed,true)
        if (superseded) continue
        try {
          receipts.push(...recordGates(root,config,{questions:[decision.snapshot]},
            {answers:{[decision.snapshot.question]:decision.answer}}))
        } catch { failed++ }
      }
      return {receipts,failed}
    })
  })
}
export function readQuestionHistory(root, cardId) {
  if (!/^[A-Za-z0-9]+$/.test(cardId)) throw new TypeError('Invalid cardId')
  const dir = path.join(root, '.ff', 'runner'), out = []
  let runs
  try { runs = fs.readdirSync(dir, {withFileTypes:true}) } catch(e) { if(e.code === 'ENOENT') return []; throw e }
  for (const run of runs.filter(d=>d.isDirectory() && /^[a-f0-9]{64}$/.test(d.name))) {
    const questions = path.join(dir, run.name, 'questions')
    let names
    try { names = fs.readdirSync(questions).filter(n=>n.endsWith('.json')) } catch(e) { if(e.code === 'ENOENT') continue; throw e }
    for (const name of names) { try {
      const capture = read(path.join(questions,name))
      if(capture?.version !== 1 || capture.context?.cardId !== cardId) continue
      scopeContext(capture.context)
      for (const q of capture.questions) if (q.cardId === cardId && ['open','answered'].includes(q.status)) out.push(q)
    } catch(e) { if(e instanceof SyntaxError || e instanceof TypeError) continue; throw e } }
  }
  return out.sort((a,b)=>a.at.localeCompare(b.at) || a.index-b.index || a.questionId.localeCompare(b.questionId))
}
export async function recordRunnerObservation(root, context, type, reason = '', identity = '') {
  if (!context) return {stored:false}
  if (!['runner_idle','permission_waiting','prompt_submitted'].includes(type)) throw new TypeError('Unsupported runner observation')
  return event(root, context, type, identity || reason || type, {claudeSessionId:context.claudeSessionId,...(reason?{reason}: {}),...(type==='prompt_submitted'?{source:reason}:{})})
}
export async function claimHookAttention(root, context, identity) {
  if (!context) return true
  const file = path.join(runDir(root,context.runId),'attention',`${hash(identity)}.json`)
  return withFileMutexRetry(`${file}.lock`, {operation:'attention-claim'}, () => {
    if(read(file)) return false
    atomic(file,{at:new Date().toISOString()})
    return true
  })
}
