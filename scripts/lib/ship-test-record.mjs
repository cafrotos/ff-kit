// Evidence of the ship-branch test checkout prepared before verify. Required by default; ship.verify_on_ship_branch:false is an escape hatch for legacy repos without a ship branch.
import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
const SHA=/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const git=(cwd,args)=>spawnSync('git',args,{cwd,encoding:'utf8'})
export const shipTestRel=(cardId,revision)=>`.ff/ship-test/${cardId}/${revision||'root'}.json`
export const shipTestRequired=config=>config?.ship?.verify_on_ship_branch!==false
export function readShipTest(root,cardId,revision=''){
 try{const r=JSON.parse(fs.readFileSync(path.join(root,shipTestRel(cardId,revision)),'utf8'));return r?.version===1&&r.cardId===cardId&&(r.revision??'')===(revision||'')?r:null}catch(e){if(e.code==='ENOENT'||e instanceof SyntaxError)return null;throw e}
}
/** The record is current only while the feature commit and the test checkout still match all three SHAs. */
export function validateShipTest(record,heads){
 if(!record?.repos||typeof record.repos!=='object')return {valid:false,reason:'ship-test record missing'}
 const names=Object.keys(heads??{})
 for(const name of names){
  const e=record.repos[name]
  if(e?.noChange&&e.featureSha===heads[name])continue // nothing to ship in this repo
  if(!e||![e.featureSha,e.baseSha,e.testSha].every(s=>SHA.test(s??'')))return {valid:false,reason:`ship-test missing for ${name}`}
  if(e.featureSha!==heads[name])return {valid:false,reason:`ship-test stale feature commit for ${name}`}
  const head=git(e.checkout,['rev-parse','HEAD']),parent=git(e.checkout,['rev-parse','HEAD^']),branch=git(e.checkout,['rev-parse',`refs/heads/${e.testBranch}`])
  if(head.stdout?.trim()!==e.testSha||branch.stdout?.trim()!==e.testSha||parent.stdout?.trim()!==e.baseSha)return {valid:false,reason:`ship-test checkout changed for ${name}`}
 }
 return {valid:true}
}
/** Test commit reusable by S1 only if built from exactly this feature commit on exactly this ship-branch tip. */
export function testedCommit(root,cardId,revision,repoName,featureSha,baseSha){
 const record=readShipTest(root,cardId,revision),e=record?.repos?.[repoName]
 if(!e||e.noChange||e.featureSha!==featureSha||e.baseSha!==baseSha)return null
 return validateShipTest(record,{[repoName]:featureSha}).valid?e:null
}
