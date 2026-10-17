// Ledger imports are historical evidence, never CLI observations or Gate receipts.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { appendDecision, readDecisions, decisionOrigin } from './question-history.mjs'
import { readKnowledgeEvents, shadowStats, shadowPolicy, recordShadowPrediction, questionHash } from './knowledge-log.mjs'
export { appendDecision, readDecisions }
const hash = value => createHash('sha256').update(value).digest('hex')
const fields = ['decisionKey','project','repo','businessScope','policyVersion','supersedes','retractedBy']
const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(s=>s.trim().replace(/\\\|/g,'|'))
export async function importLedgerDecisions(root, config, {cardId} = {}) {
  if(cardId !== undefined && !/^[A-Za-z0-9]+$/.test(cardId))throw new TypeError('Invalid cardId')
  const base=path.resolve(root,config.workspace.cards_dir)
  let cards
  try { cards=fs.readdirSync(base,{withFileTypes:true}).filter(d=>d.isDirectory() && /^[A-Za-z0-9]+(?:-|$)/.test(d.name)) } catch(e){if(e.code==='ENOENT')return {added:0,skipped:0,ineligible:0};throw e}
  const result={added:0,skipped:0,ineligible:0}
  let found=false
  for(const card of cards.sort((a,b)=>a.name.localeCompare(b.name))){
    const id=card.name.split('-')[0]
    if(cardId && id!==cardId)continue
    found=true
    const dir=path.join(base,card.name)
    const revisions=['',...fs.readdirSync(dir,{withFileTypes:true}).filter(d=>d.isDirectory() && /^rev-[1-9]\d*$/.test(d.name)).map(d=>d.name).sort()]
    for(const revision of revisions){
      const file=path.join(dir,revision,'01b-ledger.md')
      let text
      try{text=fs.readFileSync(file,'utf8')}catch(e){if(e.code==='ENOENT')continue;throw e}
      let headers=[]
      for(const line of text.split(/\r?\n/)){
        if(!line.trim().startsWith('|')){headers=[];continue}
        const row=cells(line)
        if(!/^U-\d+$/.test(row[0])){if(!/^:?-+/.test(row[0]))headers=row;continue}
        const [ledgerId,question,answer]=row
        if(!question || !answer){result.skipped++;continue}
        const metadata={}
        for(const field of fields){const index=headers.indexOf(field);if(index>=0 && row[index])metadata[field]=row[index]}
        const originId=decisionOrigin(id,revision,ledgerId)
        // Include the immutable row so subsequent corrections retain history.
        const decisionId=hash(JSON.stringify(['ledger',originId,row]))
        const eligible=Boolean(metadata.decisionKey && metadata.businessScope && metadata.project && metadata.repo && metadata.policyVersion)
        const decision={decisionId,questionId:originId,cardId:id,revision,question,answer,...metadata,
          normalizedValue:answer.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('vi'),
          eligible,provenance:{source:'ledger',card:id,revision,ledgerId,originId},
          originalEvent:{source:'ledger',file:path.relative(root,file),ledgerId,question,answer}}
        const {stored}=await appendDecision(root,decision)
        if(stored){result.added++;if(!eligible)result.ineligible++}else result.skipped++
      }
    }
  }
  if(cardId && !found)throw new Error(`Card not found: ${cardId}`)
  return result
}

export const HARD_CLASSES = ['migration','data-model','permission','new-behavior','destructive']
export const SOFT_CLASSES = ['naming','default-value','copy-text','ui-layout','validation-rule','error-handling','test-scope','other']
export const normalizeDecisionValue = value => String(value).normalize('NFC').trim().replace(/\s*\(recommended\)\s*$/i,'').replace(/\s+/g,' ').trim().toLocaleLowerCase('vi')
export const policyDigest = policy => hash(JSON.stringify({min_precedents:policy?.min_precedents??3,high_risk:policy?.high_risk??[]}))
export const projectIdentity = root => hash(fs.realpathSync(root))
const scopeFields = ['project','repo','businessScope','policyVersion','decisionKey']
// KNW-09: mục wiki loại người cùng repo+phạm vi+decisionKey. Chỉ là căn cứ khi có `giá-trị` nằm trong lựa chọn hiện tại.
// "authoritative" = người tự viết (nguồn "người") hoặc người đã sửa/khóa: một chỉ dẫn mới nhất, đủ thay ngưỡng tiền lệ.
// Mục máy ghi từ U-xx (chưa khóa) chỉ làm dự đoán cho chế độ bóng, không làm bằng chứng tự quyết (U-xx đã nằm sẵn trong sổ, tránh đếm đôi).
function wikiAnswer(wiki,request,values) {
  const rows=(wiki??[]).filter(e=>e?.type==='người'&&e.decisionKey&&e.value&&!e.review&&e.repo===request.repo&&e.scope===request.businessScope&&e.decisionKey===request.decisionKey)
  if(!rows.length)return null
  if(new Set(rows.map(e=>normalizeDecisionValue(e.value))).size>1)return {conflict:true}
  const value=normalizeDecisionValue(rows[0].value)
  if(!values.includes(value))return null
  const entries=rows.filter(e=>e.source==='người'||e.locked)
  return {value,entry:(entries[0]??rows[0]),authoritative:entries.length>0}
}
export function decide({records=[],request,policy={},wiki=[]}) {
  const no = reason => ({verdict:'escalate',default:null,evidence:[],reason})
  if(request?.gate)return no('Gate/SHIP requires human approval (shadow)')
  if(![...HARD_CLASSES,...SOFT_CLASSES].includes(request?.class))throw new TypeError('Unknown decision class')
  if(HARD_CLASSES.includes(request.class))return no('Hard decision class')
  if(scopeFields.some(k=>typeof request[k]!=='string'||!request[k].trim()))return no('Missing explicit decision scope/context')
  const hay=[request.question,...(request.touchedPaths??[])].join(' ').toLowerCase()
  if(/migration|schema|delete|role|permission/.test(hay))return no('Risk keyword')
  for(const risk of policy.high_risk??[]) {
    if(risk.repo && risk.repo!==request.repo)continue
    if((risk.paths?.length && !Array.isArray(request.touchedPaths)) || (risk.keywords??[]).some(k=>hay.includes(k.toLowerCase())) || (risk.paths??[]).some(p=>(request.touchedPaths??[]).some(t=>t.includes(p.replace(/\*.*$/,'')))))return no('Configured high risk')
  }
  const matching=records.filter(r=>['cli','ledger','human'].includes(r.provenance?.source)&&scopeFields.every(k=>(r[k]??r.decisionContext?.[k])===request[k]))
  const values=(request.normalizedOptions !== undefined
    ? Object.values(request.normalizedOptions??{})
    : (request.options??[]).map(o=>typeof o==='string'?o:o.label)).map(normalizeDecisionValue)
  // Dự đoán chế độ bóng: giá trị đa số theo nguồn gốc độc lập (hòa/xung đột/ngoài lựa chọn → null = "không biết").
  const votes=new Map()
  for(const r of matching){
    if(!r.provenance?.originId||typeof r.normalizedValue!=='string'||!r.normalizedValue.trim())continue
    votes.set(r.provenance.originId,normalizeDecisionValue(r.normalizedValue))
  }
  const tally=new Map();for(const v of votes.values())tally.set(v,(tally.get(v)??0)+1)
  const ranked=[...tally].sort((a,b)=>b[1]-a[1])
  const basePred=ranked.length&&(ranked.length===1||ranked[0][1]>ranked[1][1])&&values.includes(ranked[0][0])?ranked[0][0]:null
  const wk=wikiAnswer(wiki,request,values)
  const prediction=wk?.conflict||(basePred&&wk?.value&&basePred!==wk.value)?null:(basePred??wk?.value??null)
  const late=reason=>({...no(reason),shadowable:true,prediction})
  const ids=new Set(matching.map(r=>r.decisionId))
  if(records.some(r=>['cli','ledger','human'].includes(r.provenance?.source) && [r.supersedes,r.retractedBy,r.supersededBy].flat().some(id=>ids.has(id))))return late('Linked reversal/retraction/supersession requires review')
  if(matching.some(r=>r.supersedes||r.retractedBy||r.retracted||r.supersededBy))return late('Reversal/retraction/supersession requires review')
  const origins=new Map()
  for(const r of matching){
    if(!r.provenance.originId || typeof r.normalizedValue!=='string'||!r.normalizedValue.trim())continue
    const v=normalizeDecisionValue(r.normalizedValue)
    if(origins.has(r.provenance.originId)&&origins.get(r.provenance.originId).value!==v)return late('Conflicting origin history')
    origins.set(r.provenance.originId,{value:v,id:r.decisionId,originId:r.provenance.originId})
  }
  const evidence=[...origins.values()]
  if(new Set(evidence.map(r=>r.value)).size>1)return late('Conflicting human precedents')
  if(wk?.conflict)return late('Các mục wiki loại người mâu thuẫn nhau')
  if(wk?.value&&evidence.length&&evidence[0].value!==wk.value)return late('Wiki mâu thuẫn tiền lệ của người')
  if(evidence.length<Math.max(3,policy.min_precedents??3)){
    if(!(wk?.authoritative&&!evidence.length))return late('Insufficient independent human precedents')
    return {verdict:'proceed',default:wk.value,evidence:[{value:wk.value,id:wk.entry.id,originId:`wiki:${wk.entry.id}`,source:'wiki'}],reason:'Mục wiki loại người cùng phạm vi (chỉ dẫn của người)',shadowable:true,prediction}
  }
  const value=evidence[0].value
  if(!values.includes(value))return late('Precedent value absent from current explicit options')
  return {verdict:'proceed',default:value,evidence,reason:'Matching scoped independent human precedents',shadowable:true,prediction}
}
const PHASES=['understand','design','build','verify']
export async function decideForTask(root,config,request) {
  if(!request.gate && ![...HARD_CLASSES,...SOFT_CLASSES].includes(request.class))throw new TypeError('Unknown decision class')
  const {readPresentation}=await import('./human-output.mjs')
  const policy=config.knowledge??{}
  let packet=null,d
  for(const phase of PHASES){
    const p=readPresentation(root,config,request.cardId,{phase,scope:request.scope??''})
    const found=p?.decisions.find(x=>x.decisionContext?.decisionKey===request.decisionKey && x.question===request.question && x.decisionContext.repo===request.repo && x.decisionContext.class===request.class)
    if(found){packet=p;d=found;break}
    packet??=p
  }
  const context=d?.decisionContext
  const scoped={...request,...context,project:projectIdentity(root),policyVersion:policyDigest(policy),revision:packet?.revision,options:d?.options??request.options}
  const records=readDecisions(root)
  let wiki=[]
  try{wiki=(await import('./wiki.mjs')).wikiEntries(root,config)}catch{/* wiki hỏng: bỏ qua, vẫn hỏi người */}
  let result=request.gate?decide({records,request:scoped,policy,wiki}):!context||records.diagnostics.length?{verdict:'escalate',default:null,evidence:[],reason:'Missing current explicit packet context or incomplete history'}:decide({records,request:scoped,policy,wiki})
  let shadow
  if(result.shadowable){
    const stats=shadowStats(readKnowledgeEvents(root),policy).get(request.class,request.repo)
    const {shadowable:_s,...rest}=result;result=rest
    shadow={trusted:stats.trusted,window:`${stats.windowMatches}/${stats.windowSize}`,needs:`${shadowPolicy(policy).window} lần dự đoán gần nhất, ≥${shadowPolicy(policy).minMatch} khớp`}
    if(result.verdict==='proceed'&&!stats.trusted)result={verdict:'escalate',default:null,evidence:result.evidence,prediction:result.prediction,reason:`Chế độ bóng: lớp ${request.class}/${request.repo} chưa đủ độ khớp (${shadow.window}); vẫn hỏi người`}
    await recordShadowPrediction(root,{cardId:request.cardId,revision:packet?.revision??'',class:request.class,decisionKey:request.decisionKey,repo:request.repo,businessScope:context.businessScope,questionHash:questionHash(request.question),predicted:result.prediction??null,auto:result.verdict==='proceed',trusted:stats.trusted})
    result={...result,prediction:result.prediction??null,shadow}
  }
  await appendDecision(root,{decisionId:hash(JSON.stringify([scoped,result,new Date().toISOString()])),...scoped,...result,provenance:{source:request.gate?'shadow':'agent'}})
  return result
}
export function shadowReport(root,config,{class:cls,repo}={}) {
  const policy=config.knowledge??{}
  const stats=shadowStats(readKnowledgeEvents(root),policy)
  const rows=stats.all.filter(s=>(!cls||s.class===cls)&&(!repo||s.repo===repo)).map(({recent:_r,...s})=>s)
  return {window:stats.window,minMatch:stats.minMatch,classes:rows.sort((a,b)=>a.class.localeCompare(b.class)||a.repo.localeCompare(b.repo))}
}
