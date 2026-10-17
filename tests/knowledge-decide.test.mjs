import {test} from 'node:test'
import assert from 'node:assert/strict'
import {decide} from '../scripts/lib/knowledge.mjs'
const request={cardId:'a',revision:'',project:'p',repo:'r',businessScope:'checkout',policyVersion:'v',decisionKey:'button',class:'copy-text',question:'Button?',options:['Save','Cancel']}
const rows=Array.from({length:3},(_,i)=>({...request,decisionId:`d${i}`,normalizedValue:'save',provenance:{source:'cli',originId:`o${i}`}}))
test('requires three exact independent human origins',()=>{
 for(let n=0;n<3;n++)assert.equal(decide({records:rows.slice(0,n),request}).verdict,'escalate')
 assert.equal(decide({records:rows,request}).verdict,'proceed')
 for(const field of ['repo','project','businessScope','policyVersion','decisionKey'])assert.equal(decide({records:rows,request:{...request,[field]:'other'}}).verdict,'escalate')
 for(const source of ['agent','shadow','precedent'])assert.equal(decide({records:rows.map(r=>({...r,provenance:{...r.provenance,source}})),request}).verdict,'escalate')
 assert.equal(decide({records:rows.map(r=>({...r,provenance:{source:'cli',originId:'same'}})),request}).verdict,'escalate')
})
test('conflicts, lifecycle, missing scope and risk always escalate',()=>{
 for(const extra of [{...rows[0],decisionId:'changed',normalizedValue:'cancel'},{...rows[0],retractedBy:'x'},{...rows[0],supersedes:'old'}])assert.equal(decide({records:[...rows,extra],request}).verdict,'escalate')
 for(const cls of ['migration','data-model','permission','new-behavior','destructive'])assert.equal(decide({records:rows,request:{...request,class:cls}}).verdict,'escalate')
 for(const question of ['change schema','delete record','role title','migration now','permission text'])assert.equal(decide({records:rows,request:{...request,question}}).verdict,'escalate')
 assert.equal(decide({records:rows,request:{...request,project:''}}).verdict,'escalate')
 assert.equal(decide({records:rows,request:{...request,gate:'GATE_A'}}).verdict,'escalate')
 assert.equal(decide({records:rows,request,policy:{high_risk:[{keywords:['Button']}]}}).verdict,'escalate')
 assert.throws(()=>decide({records:rows,request:{...request,class:'typo'}}),/class/)
})

test('explicit mapping admits only canonical values, never historical label values',()=>{
 const mapped={...request,options:['Yes','No'],normalizedOptions:{Yes:'persist',No:'page-only'}}
 const historical=rows.map(r=>({...r,normalizedValue:'yes'}))
 assert.equal(decide({records:historical,request:mapped}).verdict,'escalate')
 const canonical=rows.map(r=>({...r,normalizedValue:'persist'}))
 const advice=decide({records:canonical,request:mapped})
 assert.equal(advice.verdict,'proceed');assert.equal(advice.default,'persist')
 assert.equal(decide({records:historical,request:{...mapped,normalizedOptions:undefined}}).default,'yes')
})
test('trailing (Recommended) is stripped from precedent values and option labels',()=>{
 assert.equal(decide({records:rows,request:{...request,options:['Save (Recommended)','Cancel']}}).verdict,'proceed')
 assert.equal(decide({records:rows.map(r=>({...r,normalizedValue:'Save  (recommended) '})),request}).verdict,'proceed')
 assert.equal(decide({records:rows,request:{...request,options:['Save(RECOMMENDED)','Cancel']}}).default,'save')
})
