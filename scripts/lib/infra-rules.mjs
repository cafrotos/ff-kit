// Luật hạ tầng (SRS 6.4 mục 11): người trả lời một lần, áp dụng ngay cho thẻ sau. Lưu ở .ff/infra-rules.json
// (đơn giản hơn wiki: không cần anchor code). Người sửa/xóa file này để đổi ý. Chỉ ghi được khi có câu trả lời của người trong decisions.jsonl.
import fs from 'node:fs'
import path from 'node:path'
import { readDecisions } from './question-history.mjs'

export const INFRA_ANSWERS = ['manual', 'mock', 'block']
export const INFRA_NAME_RE = /^[A-Za-z0-9_.-]+$/
export const infraRulesFile = (root) => path.join(root, '.ff', 'infra-rules.json')
export const ANSWER_LABEL = { manual: 'miễn, người thử tay', mock: 'dùng giả lập', block: 'chặn thẻ' }

export function readInfraRules(root) {
  try {
    const data = JSON.parse(fs.readFileSync(infraRulesFile(root), 'utf8'))
    return data && typeof data.rules === 'object' && data.rules ? data.rules : {}
  } catch (e) { if (e.code === 'ENOENT') return {}; throw e }
}
export const getInfraRule = (root, name) => {
  const r = readInfraRules(root)[name]
  return r && INFRA_ANSWERS.includes(r.answer) ? { name, ...r } : null
}
export const listInfraRules = (root) => Object.entries(readInfraRules(root)).filter(([, r]) => INFRA_ANSWERS.includes(r?.answer)).map(([name, r]) => ({ name, ...r }))

/** Câu trả lời của người (đã ghi bởi hook): provenance cli + actor human, khớp questionId hoặc header (Q-id). */
export function findHumanAnswer(root, qid, cardId = '') {
  const hit = readDecisions(root).filter((d) => d?.provenance?.source === 'cli' && d.provenance.actor === 'human' && typeof d.answer === 'string' && d.answer.trim()
    && (d.questionId === qid || d.header === qid || d.snapshot?.header === qid) && (!cardId || String(d.cardId) === String(cardId)))
  return hit.at(-1) ?? null
}

export function setInfraRule(root, name, answer, { note = '', fromQuestion, cardId = '' } = {}) {
  if (!INFRA_NAME_RE.test(name ?? '')) throw new Error('tên hạ tầng chỉ gồm [A-Za-z0-9_.-]')
  if (!INFRA_ANSWERS.includes(answer)) throw new Error(`cách xử lý phải là ${INFRA_ANSWERS.join('|')}`)
  if (!fromQuestion) throw new Error('cần --from-question <Q-id> của câu trả lời do người đưa ra')
  const d = findHumanAnswer(root, fromQuestion, cardId)
  if (!d) throw new Error(`không thấy câu trả lời của người cho ${fromQuestion} trong .ff/decisions.jsonl; chỉ ghi được điều người đã trả lời`)
  const rule = { answer, note: String(note).trim(), fromQuestion, decisionId: d.decisionId, card: String(d.cardId ?? ''), answerText: d.answer, at: new Date().toISOString() }
  const rules = readInfraRules(root)
  fs.mkdirSync(path.dirname(infraRulesFile(root)), { recursive: true, mode: 0o700 })
  const file = infraRulesFile(root), tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, rules: { ...rules, [name]: rule } }, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(tmp, file)
  return { name, ...rule }
}
