// Ledger imports are historical evidence, never CLI observations or Gate receipts.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { appendDecision, readDecisions, decisionOrigin } from './question-history.mjs'
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
export function decide({records=[],request,policy={}}) {
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
  const ids=new Set(matching.map(r=>r.decisionId))
  if(records.some(r=>['cli','ledger','human'].includes(r.provenance?.source) && [r.supersedes,r.retractedBy,r.supersededBy].flat().some(id=>ids.has(id))))return no('Linked reversal/retraction/supersession requires review')
  if(matching.some(r=>r.supersedes||r.retractedBy||r.retracted||r.supersededBy))return no('Reversal/retraction/supersession requires review')
  const origins=new Map()
  for(const r of matching){
    if(!r.provenance.originId || typeof r.normalizedValue!=='string'||!r.normalizedValue.trim())continue
    const v=normalizeDecisionValue(r.normalizedValue)
    if(origins.has(r.provenance.originId)&&origins.get(r.provenance.originId).value!==v)return no('Conflicting origin history')
    origins.set(r.provenance.originId,{value:v,id:r.decisionId,originId:r.provenance.originId})
  }
  const evidence=[...origins.values()]
  if(new Set(evidence.map(r=>r.value)).size>1)return no('Conflicting human precedents')
  if(evidence.length<Math.max(3,policy.min_precedents??3))return no('Insufficient independent human precedents')
  const value=evidence[0].value
  const values=(request.normalizedOptions !== undefined
    ? Object.values(request.normalizedOptions??{})
    : (request.options??[]).map(o=>typeof o==='string'?o:o.label)).map(normalizeDecisionValue)
  if(!values.includes(value))return no('Precedent value absent from current explicit options')
  return {verdict:'proceed',default:value,evidence,reason:'Matching scoped independent human precedents'}
}
export async function decideForTask(root,config,request) {
  if(!request.gate && ![...HARD_CLASSES,...SOFT_CLASSES].includes(request.class))throw new TypeError('Unknown decision class')
  const {readPresentation}=await import('./human-output.mjs')
  const policy=config.knowledge??{}
  const packet=readPresentation(root,config,request.cardId,{phase:'understand',scope:request.scope??''})
  const d=packet?.decisions.find(d=>d.decisionContext?.decisionKey===request.decisionKey && d.question===request.question && d.decisionContext.repo===request.repo && d.decisionContext.class===request.class)
  const context=d?.decisionContext
  const scoped={...request,...context,project:projectIdentity(root),policyVersion:policyDigest(policy),revision:packet?.revision,options:d?.options??request.options}
  const records=readDecisions(root)
  const result=request.gate?decide({records,request:scoped,policy}):!context||records.diagnostics.length?{verdict:'escalate',default:null,evidence:[],reason:'Missing current explicit packet context or incomplete history'}:decide({records,request:scoped,policy})
  await appendDecision(root,{decisionId:hash(JSON.stringify([scoped,result,new Date().toISOString()])),...scoped,...result,provenance:{source:request.gate?'shadow':'agent'}})
  return result
}
