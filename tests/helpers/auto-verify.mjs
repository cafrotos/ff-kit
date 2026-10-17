import fs from 'node:fs'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import YAML from 'yaml'
import {git} from './fixture.mjs'
import {recordGates} from '../../scripts/lib/gates.mjs'
import {beginStage,finishStage} from '../../scripts/lib/stage-receipts.mjs'
import {writeTask} from '../../ff-worker/src/core/task-store.mjs'
import {prepareShipTest} from '../../scripts/lib/ship.mjs'
const hash=x=>createHash('sha256').update(x).digest('hex')
export const LEDGER='| ID | Trích | Ở đâu | Ghi chú |\n|---|---|---|---|\n| D-01 | keep | dossier | |\n'
export const SPEC='- **AC-01** Keep — D-01\n- **AC-02** Other — D-01\n'
export function report({ac2='PASS',reg='Đạt',skip=[]}={}){
 const row=(id,v)=>skip.includes(id)?'':`| ${id} | ui | db | net | console | ${v} |\n`
 return `# Báo cáo verify — 123\n\n## 1. Ma trận AC\n\n| AC | UI State | DB | Network | Console | Verdict |\n|---|---|---|---|---|---|\n${row('AC-01','PASS')}${row('AC-02',ac2)}\n## 2. Neighborhood Sweep\n| Tính năng | Hành vi | Trạng thái hồi quy (Đạt / Gãy) |\n|---|---|---|\n| Tab liền kề | ok | ${reg} |\n`
}
/** Gate A/B approved + build receipt + test lock + ship-test + verify report, ready for `ff gate-auto --gate GATE_C`. */
export async function autoVerifyFixture(f,{reportText=report(),ledger=LEDGER,plan='Implement\n'}={}){
 await prepareShipTest({root:f.root,config:f.config,cardId:'123'})
 const {root,config,cardDir,copies}=f
 config.worker.driver={enabled:true};config.repos[0].commands={build:'node -v',test:'node -v'};config.e2e={...config.e2e,dir:'e2e',tests_dir:'e2e',up_cmd:'true',down_cmd:'true'}
 fs.writeFileSync(path.join(root,'ff.config.yaml'),YAML.stringify(config))
 const write=(rel,s)=>{const p=path.join(root,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);return p}
 const card=path.relative(root,cardDir),report='05-verify-report.md'
 const files={[`${card}/01b-ledger.md`]:ledger,[`${card}/brief.md`]:'Keep D-01\n',[`${card}/02-spec.md`]:SPEC,[`${card}/03-design.md`]:'Keep D-01\n',[`${card}/04-plan.md`]:plan,'e2e/123/keep.spec.ts':"test('AC-01',()=>{})\ntest('AC-02',()=>{})\n"}
 for(const [p,s] of Object.entries(files))write(p,s)
 for(const gate of ['GATE_A','GATE_B'])recordGates(root,config,{questions:[{header:gate,question:'[#123] Approve?'}]},{answers:{'[#123] Approve?':'Duyệt'}})
 const lock='worktrees/123/.ff-test-lock';write(lock,`${hash(files['e2e/123/keep.spec.ts'])}  e2e/123/keep.spec.ts\n`)
 const manifest=JSON.stringify({version:1,cliVersion:'0.1.0',files:{'bin/ff':hash('#!/bin/sh\nexit 0\n'),'dist/cli.mjs':hash('// cli\n')}}),digest=hash(manifest),snap=`.ff/workflows/${digest}`
 write(`${snap}/manifest.json`,manifest);fs.chmodSync(write(`${snap}/bin/ff`,'#!/bin/sh\nexit 0\n'),0o755);write(`${snap}/dist/cli.mjs`,'// cli\n')
 const workflow={digest,path:snap,binDir:`${snap}/bin`,cliPath:`${snap}/bin/ff`,pluginPath:snap,cliVersion:'0.1.0'},heads={web:git(copies.web,'rev-parse','HEAD')}
 const log=`${card}/evidence/check.log`,review=`${card}/evidence/review.json`,matrix=`${card}/evidence/ac.json`
 write(log,'checks pass\n');write(review,JSON.stringify({status:'pass',revision:'',heads,findings:[]}))
 write(matrix,JSON.stringify({revision:'',heads,criteria:['AC-01','AC-02'].map(id=>({id,status:'pass',evidence:[log]}))}))
 const stageRun=async(stage,extra)=>{
  const artifactHashes=Object.fromEntries([`${card}/01-dossier.md`,...Object.keys(files).filter(p=>p.startsWith(card)),log,review,matrix,'.ff/ship-test/123/root.json',...extra].map(p=>[p,hash(fs.readFileSync(path.join(root,p)))]))
  const dispatchId=stage+randomUUID(),task={cardId:'123',revision:'',runId:'run',dispatchId,stage,pendingDispatch:{revision:'',runId:'run',dispatchId,stage},workflow};writeTask(root,task)
  const evidence={cardId:'123',revision:'',runId:'run',dispatchId,heads,workflow:{digest,cliVersion:'0.1.0'},artifactHashes,testLockHash:hash(fs.readFileSync(path.join(root,lock))),checks:[{command:'node -v',cwd:'worktrees/123/web',exitCode:0,logPath:log,logHash:hash(fs.readFileSync(path.join(root,log)))}],reviewRefs:[review],acMatrixRef:matrix}
  await beginStage(root,config,{cardId:'123',dispatchId});await finishStage(root,config,{cardId:'123',dispatchId,outcome:'pass',evidenceFile:write(`${card}/evidence/input.json`,JSON.stringify(evidence))})
 }
 await stageRun('build',[])
 write(`${card}/${report}`,reportText)
 return {card,lock,write,finishVerify:()=>stageRun('verify',[`${card}/${report}`])}
}
