import './helpers/hermetic-home.mjs'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {baseConfig,makeWorkspace} from './helpers/fixture.mjs'
import {capture} from './helpers/io.mjs'
import {main} from '../scripts/cli/main.mjs'
import {readTask,updateHarnessTask} from '../ff-worker/src/core/task-store.mjs'
import {adoptLegacyRepairCycles} from '../scripts/lib/repair-cycles.mjs'
import {parseConfigText} from '../scripts/lib/config.mjs'

const setup=(t,max)=>{const config=baseConfig();if(max)config.worker.driver={max_repair_cycles:max};const w=makeWorkspace({config});t.after(w.cleanup);fs.mkdirSync(path.join(w.root,'trellocards/123'),{recursive:true});return w}
const run=async(w,...a)=>{const c=capture(w.root);return {code:await main(a,c.ctx),...c.buf}}
const seedTask=(w,repairCycles)=>updateHarnessTask(w.root,'123',0,()=>({cardId:'123',revision:'',runId:'r',dispatchId:'',stage:'verify',waitingOn:null,executionStatus:'idle',pendingDispatch:null,history:[],repairCycles}))

test('legacy (chưa có task): đếm, bền qua restart, từ chối ở vòng thứ 4 (exit 3)',async t=>{
 const w=setup(t)
 assert.match((await run(w,'fix-round','123')).out,/0\/3/)
 for(let i=1;i<=3;i++){const r=await run(w,'fix-round','123','next','--reason',`lỗi ${i}`);assert.equal(r.code,0,r.err);assert.match(r.out,new RegExp(`${i}/3`))}
 const r=await run(w,'fix-round','123','next','--reason','lại');assert.equal(r.code,3);assert.match(r.err,/đã hết 3 vòng sửa — escalate cho người/)
 assert.deepEqual(adoptLegacyRepairCycles(w.root,'123'),{'':3})
 assert.deepEqual(JSON.parse((await run(w,'fix-round','123','--json')).out),{cardId:'123',revision:null,count:3,max:3})
 assert.equal(readTask(w.root,'123'),null,'legacy không tạo task harness')
})
test('một bộ đếm: có task harness thì fix-round dùng task.repairCycles và worker.driver.max_repair_cycles',async t=>{
 const w=setup(t,2);await seedTask(w,{'':1})
 assert.match((await run(w,'fix-round','123')).out,/1\/2/)
 assert.equal((await run(w,'fix-round','123','next','--reason','a')).code,0)
 const task=readTask(w.root,'123');assert.equal(task.repairCycles[''],2);assert.match(task.history.at(-1).reason,/fix_round: a/)
 assert.equal((await run(w,'fix-round','123','next','--reason','b')).code,3)
 assert.equal(readTask(w.root,'123').repairCycles[''],2)
 assert.equal(fs.existsSync(path.join(w.root,'.ff/repair-cycles')),false,'không ghi bộ đếm thứ hai')
})
test('đếm theo revision',async t=>{
 const w=setup(t,1)
 assert.equal((await run(w,'fix-round','123','next','--reason','a')).code,0)
 assert.equal((await run(w,'fix-round','123','next','--reason','b')).code,3)
 fs.mkdirSync(path.join(w.root,'trellocards/123/rev-1'))
 assert.equal((await run(w,'fix-round','123','next','--reason','rev mới')).code,0,'revision mới có bộ đếm riêng')
})
test('fix-round thiếu --reason thì lỗi',async t=>{const w=setup(t);assert.equal((await run(w,'fix-round','123','next')).code,1)})
test('schema không còn ship.max_fix_rounds; max_repair_cycles mặc định 3',()=>{
 assert.equal(parseConfigText('worker: {}\n').config.worker.driver.max_repair_cycles,3)
})
