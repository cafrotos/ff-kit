import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {detectLanded,resetLandedCache} from '../scripts/lib/merge-detect.mjs'
import {nextStage} from '../ff-worker/src/core/driver.mjs'

const g=(cwd,...a)=>{const r=spawnSync('git',['-c','user.name=t','-c','user.email=t@t','-c','commit.gpgsign=false',...a],{cwd,encoding:'utf8'});if(r.status!==0)throw new Error(a.join(' ')+r.stderr);return r.stdout.trim()}
const write=(d,f,t)=>fs.writeFileSync(path.join(d,f),t)
const commit=(d,f,t,m)=>{write(d,f,t);g(d,'add',f);g(d,'commit','-qm',m)}
const cases=[]
/** bare origin + dev clone (feature) + maintainer clone (merges onto main) */
function world(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ff-md-t-')),origin=path.join(dir,'origin.git'),dev=path.join(dir,'dev'),maint=path.join(dir,'maint')
  g(dir,'init','-q','--bare','-b','main',origin);g(dir,'clone','-q',origin,dev)
  return {dir,origin,dev,maint}
}
function setup({squash=true}={}){
  const w=world()
  g(w.dev,'checkout','-q','-B','main');commit(w.dev,'a.txt','1\n2\n3\n','base');commit(w.dev,'b.txt','b\n','base b');g(w.dev,'push','-q','origin','main')
  g(w.dir,'clone','-q',w.origin,w.maint)
  g(w.dev,'checkout','-q','-b','feat');commit(w.dev,'a.txt','1\n2\n3\nfeat1\n','f1');commit(w.dev,'c.txt','c\n','f2')
  if(squash){g(w.dev,'reset','-q','--soft','main');g(w.dev,'commit','-qm','feat squash\n\nTrello: #42')}
  g(w.dev,'push','-q','origin','feat')
  w.head=g(w.dev,'rev-parse','HEAD')
  w.detect=(extra={})=>{resetLandedCache();return detectLanded({cwd:w.dev,baseBranch:'main',sourceHead:w.head,cardId:'42',minIntervalMs:0,...extra})}
  return w
}
const upstream=(w,fn)=>{g(w.maint,'checkout','-q','main');g(w.maint,'pull','-q','--ff-only','origin','main');g(w.maint,'fetch','-q','origin');fn();g(w.maint,'push','-q','origin','main')}

test('chưa merge -> pending, base tiến lên vẫn pending',()=>{
  const w=setup();assert.equal(w.detect().state,'pending')
  upstream(w,()=>commit(w.maint,'z.txt','z\n','unrelated'));assert.equal(w.detect().state,'pending')
})
test('merge commit (không PR) -> ancestor',()=>{
  const w=setup();upstream(w,()=>g(w.maint,'merge','-q','--no-ff','origin/feat','-m','Merge feat'))
  const r=w.detect();assert.equal(r.state,'merged');assert.equal(r.via,'ancestor')
})
test('squash merge -> patch-id, kể cả khi base đi tiếp sửa cùng file',()=>{
  const w=setup();upstream(w,()=>{g(w.maint,'merge','--squash','origin/feat');g(w.maint,'commit','-qm','squash (#7)')})
  let r=w.detect();assert.equal(r.state,'merged');assert.equal(r.via,'patch-id')
  upstream(w,()=>commit(w.maint,'a.txt','0\n1\n2\n3\nfeat1\nlater\n','later edit'))
  r=w.detect();assert.equal(r.state,'merged');assert.equal(r.via,'patch-id')
})
test('squash merge không có trailer vẫn nhận (nội dung quyết định)',()=>{
  const w=setup();upstream(w,()=>{g(w.maint,'merge','--squash','origin/feat');g(w.maint,'commit','-qm','no trailer here')})
  assert.equal(w.detect().state,'merged')
})
test('rebase merge nhiều commit (không squash) -> patch-id-each',()=>{
  const w=setup({squash:false})
  upstream(w,()=>commit(w.maint,'z.txt','z\n','unrelated'))
  upstream(w,()=>{g(w.maint,'cherry-pick','origin/feat~1','origin/feat')})
  const r=w.detect();assert.equal(r.state,'merged');assert.match(r.via,/patch-id/)
})
test('cherry-pick commit squash lên base -> merged',()=>{
  const w=setup();upstream(w,()=>commit(w.maint,'z.txt','z\n','unrelated'));upstream(w,()=>g(w.maint,'cherry-pick','-x',w.head))
  assert.equal(w.detect().state,'merged')
})
test('người merge tay rồi base sửa tiếp đúng chỗ đã đổi -> patch-id vẫn nhận',()=>{
  const w=setup();upstream(w,()=>{g(w.maint,'merge','--squash','origin/feat');g(w.maint,'commit','-qm','manual')});upstream(w,()=>commit(w.maint,'c.txt','c changed\n','later'))
  assert.equal(w.detect().state,'merged')
})
test('sửa nội dung lúc merge + có trailer -> edited (không phải merged)',()=>{
  const w=setup();upstream(w,()=>{g(w.maint,'merge','--squash','origin/feat');write(w.maint,'c.txt','EDITED\n');g(w.maint,'add','.');g(w.maint,'commit','-qm','squash\n\nTrello: #42')})
  const r=w.detect();assert.equal(r.state,'edited');assert.equal(r.via,'trailer')
})
test('trailer ff-card cũng nhận; trailer thẻ khác thì không',()=>{
  const w=setup();upstream(w,()=>{commit(w.maint,'x.txt','other\n','x\n\nff-card: 42')});assert.equal(w.detect().state,'edited')
  const w2=setup();upstream(w2,()=>{commit(w2.maint,'x.txt','other\n','x\n\nTrello: #421')});assert.equal(w2.detect().state,'pending')
})
test('sửa nội dung nhưng không trailer -> pending (không đoán)',()=>{
  const w=setup();upstream(w,()=>{g(w.maint,'merge','--squash','origin/feat');write(w.maint,'c.txt','EDITED\n');g(w.maint,'add','.');g(w.maint,'commit','-qm','squash')})
  assert.equal(w.detect().state,'pending')
})
test('trailer một mình không bao giờ thành merged',()=>{
  const w=setup();upstream(w,()=>commit(w.maint,'y.txt','different\n','other work\n\nTrello: #42'))
  assert.notEqual(w.detect().state,'merged')
})
test('không đọc được git -> unknown',()=>{
  const w=setup();assert.equal(detectLanded({cwd:w.dev,baseBranch:'nope',sourceHead:w.head,cardId:'42',minIntervalMs:0}).state,'unknown')
  assert.equal(detectLanded({cwd:w.dev,baseBranch:'main',sourceHead:'bad',cardId:'42'}).state,'unknown')
})
test('throttle: trong khoảng min interval không fetch lại',()=>{
  const w=setup();resetLandedCache();let t=0;const now=()=>t
  assert.equal(detectLanded({cwd:w.dev,baseBranch:'main',sourceHead:w.head,cardId:'42',now}).state,'pending')
  upstream(w,()=>g(w.maint,'merge','-q','--no-ff','origin/feat','-m','m'))
  assert.equal(detectLanded({cwd:w.dev,baseBranch:'main',sourceHead:w.head,cardId:'42',now}).state,'pending')
  t=61000;assert.equal(detectLanded({cwd:w.dev,baseBranch:'main',sourceHead:w.head,cardId:'42',now}).state,'merged')
})

// --- driver: nhiều repo, done_on ---
const H='a'.repeat(40),G='b'.repeat(40)
const task={cardId:'42',revision:'rev-1',stage:'acceptance',waitingOn:'acceptance',executionStatus:'idle',runId:'r',dispatchId:'d'}
const row=(repo,state,extra={})=>({repo,approvedSourceHead:repo==='web'?H:G,s1Complete:true,landed:{state},...extra})
const plan=(rows,{doneOn='base_branch',mode='dev_only',pr}={})=>nextStage({task,state:{activeRevision:'rev-1',heads:{web:H,api:G},gates:{}},ship:{cardId:'42',revision:'rev-1',heads:{web:H,api:G},s1Complete:true,s2Complete:true,mode,doneOn,repos:rows},pr})
test('driver: mọi repo đã vào base -> done',()=>{
  const p=plan([row('web','merged'),row('api','merged')]);assert.equal(p.action,'done');assert.equal(p.reason,'base_branch_landed')
})
test('driver: một repo chưa vào -> chờ và nêu tên repo',()=>{
  const p=plan([row('web','merged'),row('api','pending')]);assert.equal(p.action,'acceptance');assert.equal(p.reason,'waiting_base_merge:api')
})
test('driver: nội dung khác bản duyệt -> chờ người, không done',()=>{
  const p=plan([row('web','merged'),row('api','edited')]);assert.notEqual(p.action,'done');assert.equal(p.reason,'landed_content_differs:api')
})
test('driver: edited + người xác nhận CLI -> done',()=>{
  const t=nextStage({task:{...task,acceptance:{source:'cli',confirmed:true,revision:'rev-1',heads:{web:H,api:G}}},state:{activeRevision:'rev-1',heads:{web:H,api:G},gates:{}},ship:{cardId:'42',revision:'rev-1',heads:{web:H,api:G},s1Complete:true,s2Complete:true,mode:'dev_only',doneOn:'base_branch',repos:[row('web','merged'),row('api','edited')]}})
  assert.equal(t.action,'done')
})
test('driver: done_on=pr (mặc định) bỏ qua landed',()=>{
  const p=plan([row('web','merged'),row('api','merged')],{doneOn:'pr'});assert.notEqual(p.reason,'base_branch_landed')
})
test('driver: either + PR merged ở repo này, landed ở repo kia -> done',()=>{
  const p=plan([row('web','merged'),row('api','pending',{requiresPr:true})],{doneOn:'either',mode:'dev_and_pr',pr:{repos:[{repo:'api',merged:true,headAtMerge:G,approvedSourceHead:G}]}})
  assert.equal(p.action,'done')
})
