// Human presentations are derived views, never approval receipts.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { projectIdentity, policyDigest } from './knowledge.mjs'
import { captureShipTargets } from './ship-approval.mjs'
import { findCardDir } from './cards.mjs'
import { activeRevision, validateScope } from './gates.mjs'

export const PHASE_SECTIONS = {
  understand: { function:'Chức năng và người dùng', current:'Hiện trạng đã xác minh', requested:'Dossier yêu cầu', target:'Hành vi sau cập nhật', impact:'Ảnh hưởng và phạm vi giữ nguyên', acceptance:'Thế nào là đúng', uncertainty:'Giới hạn và điều chưa rõ' },
  design: { realization:'Hiện thực hóa hành vi đã chốt', differences:'Khác biệt cần quyết định', impact:'Ảnh hưởng', uncertainty:'Giới hạn và điều chưa rõ' },
  build: { implemented:'Hành vi đã triển khai', checks:'Kiểm tra thực sự đã chạy', remaining:'Phần thiếu, lệch hoặc đang kẹt', readiness:'Mức sẵn sàng nghiệm thu' },
  verify: { expectedActual:'Đã hứa và kết quả thực tế', evidence:'Bằng chứng chính', regression:'Hồi quy và phần ảnh hưởng', limitations:'Chưa kiểm và không áp dụng', conclusion:'Kết luận nghiệm thu' },
  ship: { acceptedScope:'Phạm vi và version đã nghiệm thu', destination:'Repo, branch và commit', checks:'Kiểm tra trước hoặc sau ship', limitations:'Giới hạn và trạng thái ship' },
}
const GATE_PHASE = { GATE_A:'understand', GATE_B:'design', GATE_C:'verify' }
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const text = (v, field) => { if(typeof v!=='string'||!v.trim())throw new Error(`thiếu ${field}`);return v.trim() }
const inside = (base,file) => file===base || file.startsWith(base+path.sep)

function context(root,config,id,scope='') {
  const card=findCardDir(root,config,String(id));if(card.error)throw new Error(card.error)
  const revision=activeRevision(card.dir)
  if(scope&&!/^task-\d+(?:-[A-Za-z0-9-]+)?$/.test(scope))throw new Error('scope presentation không hợp lệ')
  const fullScope=[revision,scope].filter(Boolean).join('/')
  const dir=validateScope(card.dir,fullScope)
  return {cardDir:card.dir,revision,scope,fullScope,dir,taskId:String(id)}
}
function sources(ctx,phase) {
  const rel = name => [ctx.fullScope,name].filter(Boolean).join('/')
  const rootBrief=[ctx.revision,ctx.revision?'delta.md':'brief.md'].filter(Boolean).join('/')
  const ownBrief=ctx.scope&&!ctx.revision?rel('brief.md'):rootBrief
  const names=[phase==='understand'?ownBrief:rootBrief]
  const parentRel=name=>[ctx.revision,name].filter(Boolean).join('/')
  const children=ctx.scope?[]:fs.readdirSync(ctx.dir,{withFileTypes:true}).filter(e=>e.isDirectory()&&/^task-\d+(?:-[A-Za-z0-9-]+)?$/.test(e.name)).map(e=>e.name).sort()
  const addOptional=p=>{if(fs.existsSync(path.join(ctx.cardDir,p)))names.push(p)}
  const required=phase==='understand'?[]:phase==='design'?['02-spec.md','03-design.md']:phase==='build'?['02-spec.md','03-design.md','04-plan.md']:['02-spec.md','03-design.md','05-verify-report.md']
  for(const name of required){
    if(children.length){
      if(name==='05-verify-report.md'&&fs.existsSync(path.join(ctx.dir,name))){names.push(rel(name));for(const child of children)addOptional(rel(`${child}/${name}`))}
      else {for(const child of children)names.push(rel(`${child}/${name}`));addOptional(rel(name))}
    } else names.push(rel(name))
  }
  if(ctx.scope){addOptional(rel('brief.md'));addOptional(rel('01b-ledger.md'));addOptional(parentRel('03-design.md'));addOptional(parentRel('02-spec.md'))}
  for(const child of children){addOptional(rel(`${child}/brief.md`));addOptional(rel(`${child}/01b-ledger.md`))}
  addOptional(parentRel('00-subtasks.md'))
  addOptional(parentRel('01b-ledger.md'))
  for(const optional of ['01-dossier.md','01b-ledger.md'])if(fs.existsSync(path.join(ctx.cardDir,optional)))names.push(optional)
  return [...new Set(names)]
}
function sourceHashes(ctx,phase) {
  const out={};for(const rel of sources(ctx,phase)){
    const file=path.join(ctx.cardDir,rel);let real
    try{real=fs.realpathSync(file)}catch{throw new Error(`thiếu artifact hiện tại: ${rel}`)}
    if(!inside(fs.realpathSync(ctx.cardDir),real)||!fs.statSync(real).isFile())throw new Error(`artifact không hợp lệ: ${rel}`)
    out[rel]=hash(fs.readFileSync(real))
  }return out
}
function recordPath(root,id,phase,scope='',purpose) {return path.join(root,'.ff','presentations',`${id}.${phase}.${purpose==='acceptance'?'acceptance.':''}${scope||'root'}.json`)}
export function preparePresentation(root,config,id,input,{gate}={}) {
  if(input?.version!==1||!Object.hasOwn(PHASE_SECTIONS,input?.phase))throw new Error('presentation cần version 1 và phase vận hành hợp lệ')
  const ctx=context(root,config,id,input.scope??'')
  if(input.taskId!==undefined&&String(input.taskId)!==ctx.taskId)throw new Error('taskId không khớp')
  if(input.revision!==undefined&&input.revision!==ctx.revision)throw new Error('revision không hiện hành')
  if(gate&&GATE_PHASE[gate]!==input.phase)throw new Error('Gate không khớp phase')
  const sections={};for(const key of Object.keys(PHASE_SECTIONS[input.phase]))sections[key]=text(input.sections?.[key],`sections.${key}`)
  if(!Array.isArray(input.decisions))throw new Error('decisions phải là mảng (rỗng khi không cần quyết)')
  if(input.decisions.length>4)throw new Error('một lượt tối đa 4 quyết định độc lập')
  const ids=new Set();const decisions=input.decisions.map(d=>{
    if(!/^Q\d+$/.test(d.id)||ids.has(d.id))throw new Error('decision id phải là Q<n> và không trùng');ids.add(d.id)
    if(!Array.isArray(d.options)||d.options.length<2||d.options.length>4)throw new Error(`${d.id} cần 2–4 phương án`)
    const labels=new Set();const options=d.options.map(o=>{const label=text(o.label,'option.label');if(labels.has(label))throw new Error('option label trùng');labels.add(label);return {label,description:text(o.description,'option.description')}})
    let decisionContext
    if(d.decisionContext){
      const c=d.decisionContext
      decisionContext=Object.fromEntries(['repo','businessScope','decisionKey','class'].map(k=>[k,text(c[k],`decisionContext.${k}`)]))
      if(!c.normalizedOptions||Array.isArray(c.normalizedOptions)||typeof c.normalizedOptions!=='object'||options.some(o=>typeof c.normalizedOptions[o.label]!=='string'||!c.normalizedOptions[o.label].trim()))throw new Error('normalizedOptions must map each label to value')
      decisionContext.normalizedOptions=Object.fromEntries(options.map(o=>[o.label,c.normalizedOptions[o.label].normalize('NFC')]))
    }
    return {...(decisionContext?{decisionContext}:{}),id:d.id,question:text(d.question,'decision.question'),options,recommendation:text(d.recommendation,'decision.recommendation')}
  })
  const packet={project:projectIdentity(root),policyVersion:policyDigest(config.knowledge),version:1,taskId:ctx.taskId,revision:ctx.revision,scope:ctx.scope,phase:input.phase,gate:gate??null,headline:text(input.headline,'headline'),sections,decisions,nextAction:text(input.nextAction,'nextAction'),sourceHashes:sourceHashes(ctx,input.phase),createdAt:new Date().toISOString()}
  if(input.phase==='ship'){packet.targets=captureShipTargets(root,config,id);if(input.targets&&JSON.stringify(input.targets)!==JSON.stringify(packet.targets))throw new Error('ship targets changed')}
  if(input.purpose!==undefined){if(input.phase!=='ship'||input.purpose!=='acceptance')throw new Error('invalid presentation purpose');packet.purpose='acceptance'}
  packet.presentationId=hash(JSON.stringify({...packet,createdAt:undefined})).slice(0,24)
  if(Buffer.byteLength(JSON.stringify(packet))>32*1024)throw new Error('tổng hợp vượt 32 KiB; rút gọn nội dung, không cắt câu hỏi')
  return packet
}
export function savePresentation(root,packet) {
  const file=recordPath(root,packet.taskId,packet.phase,packet.scope,packet.purpose);fs.mkdirSync(path.dirname(file),{recursive:true})
  if(!inside(fs.realpathSync(root),fs.realpathSync(path.dirname(file))))throw new Error('presentation metadata ngoài workspace')
  if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw new Error('presentation metadata không được là symlink')
  fs.writeFileSync(file,JSON.stringify(packet,null,2)+'\n',{mode:0o600});return file
}
export function readPresentation(root,config,id,{gate,scope='',phase,purpose}={}) {
  const phases=phase?[phase]:gate?[GATE_PHASE[gate]]:Object.keys(PHASE_SECTIONS)
  const ctx=context(root,config,id,scope),found=[]
  for(const p of phases){try{
    const packet=JSON.parse(fs.readFileSync(recordPath(root,String(id),p,scope,purpose),'utf8'))
    if(packet.taskId!==String(id)||packet.revision!==ctx.revision||packet.scope!==scope||packet.phase!==p)continue
    if(gate&&packet.gate!==gate)continue
    if(typeof packet.createdAt!=='string'||!Number.isFinite(Date.parse(packet.createdAt)))continue
    const validated=preparePresentation(root,config,id,packet,{gate:packet.gate})
    if(validated.presentationId!==packet.presentationId)continue
    const current=sourceHashes(ctx,p)
    if(JSON.stringify(current)!==JSON.stringify(packet.sourceHashes))continue
    found.push(packet)
  }catch{}}
  return found.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))[0]??null
}
export function renderPresentation(packet) {
  const lines=[`[#${packet.taskId}] [${packet.revision??'gốc'}]${packet.scope?` [${packet.scope}]`:''} — ${packet.headline}`,`Pha: ${packet.phase}${packet.gate?` · ${packet.gate}`:''}`]
  for(const [key,label] of Object.entries(PHASE_SECTIONS[packet.phase]))lines.push('',label,packet.sections[key])
  if(packet.targets)for(const t of packet.targets)lines.push('',`Repo: ${t.repo} · HEAD: ${t.sourceHead}`,`Origin: ${redactHumanText(t.origin)}`,`Ship branch: ${t.shipBranch} · Task branch: ${t.taskBranch}`)
  if(packet.decisions.length)lines.push('','Cần bạn chốt')
  const prefix=`[#${packet.taskId}]${packet.revision?` [${packet.revision}]`:''}${packet.scope?` [${packet.scope}]`:''}`
  for(const d of packet.decisions){lines.push(`${d.id}. ${prefix} ${d.question}`,...d.options.map(o=>`- ${o.label}: ${o.description}`),`Khuyến nghị: ${d.recommendation}`)}
  lines.push('',`Bước tiếp theo: ${packet.nextAction}`,'Quyết định/duyệt thực hiện tại CLI; channel chỉ thông báo.')
  return lines.join('\n')
}
export function presentationEvent(packet) {
  return {kind:packet.gate?'gate':'info',taskId:packet.taskId,title:packet.headline,fields:{revision:packet.revision??'gốc',phase:packet.phase,scope:packet.scope||'toàn thẻ',presentation:packet.presentationId},body:renderPresentation(packet)}
}
export function formatQuestions(questions) {
  return questions.map((q,i)=>[`${q.header||`Q${i+1}`}. ${q.question??''}`,...(q.options??[]).map(o=>`- ${o.label??''}${o.description?`: ${o.description}`:''}`),q.multiSelect?'Có thể chọn nhiều phương án.':''].filter(Boolean).join('\n')).join('\n\n')
}

// Persist/notify only a credential-scrubbed human view, never raw hook payloads.
export function redactHumanText(value) {
  return String(value ?? '')
    .replace(/\b(?:Bearer\s+)[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b((?:[\w.-]*(?:token|secret|password|passwd|credential|api[_-]?key)[\w.-]*)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/\b(?:sk-|gh[pousr]_|xox[baprs]-)[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/(\b[A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/\"'<>]+@/g, '$1[REDACTED]@')
}
