import { redactHumanText } from '../../../scripts/lib/human-output.mjs'
import { createHash } from 'node:crypto'
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
/** Observations only. The driver owns all durable intents and task mutations. */
export async function observeShippedTask({task,ship,source,now=Date.now,reopenList,maxReopen=3}) {
 const events=[],at=new Date(typeof now==='function'?now():now).toISOString()
 const emit=(type,identity,payload)=>events.push({cardId:task.cardId,revision:task.revision,runId:task.runId,dispatchId:task.dispatchId,eventId:hash([task.cardId,task.revision,type,identity]),type,at,payload})
 if(!ship||ship.cardId!==task.cardId||ship.revision!==task.revision)return events
 const ready=ship.s1Complete===true&&(ship.mode==='dev_only'||ship.s2Complete===true)
 if(ship.s1Complete===true)emit('ship_observed',['s1',ship.sourceIdentity,ship.heads],{ship,milestone:'s1'})
 for(const row of ship.repos??[])if(ship.s1Complete===true&&row.pr?.number)emit('ship_observed',['pr',ship.sourceIdentity,row.repo,row.pr.number],{ship,milestone:'pr',repo:row.repo,number:row.pr.number})
 if(ready)emit('ship_observed',['ready',ship.sourceIdentity,ship.heads],{ship,milestone:'ready'})
 for(const row of ship.repos??[]){const p=row.pr;if(p?.mergeability==='conflicting')emit('ship_observed',['conflict',row.repo,p.number,p.sourceHead,p.baseHead],{reason:'pr_conflict',repo:row.repo,number:p.number,head:p.sourceHead,base:p.baseHead})}
 if(!source?.observeCard||!reopenList||!ship.s1Complete)return events
 const card=await source.observeCard(task.trelloCardId??task.cardId)
 if(card.list?.toLowerCase()!==reopenList.toLowerCase())return events
 const comments=source.readComments?await source.readComments(task.trelloCardId??task.cardId,{after:ship.shippedAt}):card.comments??[]
 const comment=comments.filter(c=>typeof c.text==='string'&&c.text.trim()&&!/^\s*\[ff\]/i.test(c.text??'')&&ship.shippedAt&&Date.parse(c.at)>Date.parse(ship.shippedAt)).sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id)).at(-1)
 if(!comment){emit('ship_observed',['reopen_feedback',ship.sourceIdentity],{reason:'reopen_feedback'});return events}
 const terminal=task.stage==='done'||ship.repos?.some(r=>r.pr?.merged||r.pr?.state==='closed'||r.s2Status==='blocked:pr_closed')
 if(!terminal&&ship.mode==='dev_and_pr'&&(ship.repos??[]).some(r=>r.requiresPr!==false&&!r.pr))return events
 const count=task.revision?Number(task.revision.slice(4)):0
 const reason=terminal||count>=maxReopen?'reopen_fix':!card.description?.trim()?'reopen_description':null
 if(reason)emit('ship_observed',[reason,comment.id],{reason})
 else emit('reopen_observed',[ship.sourceIdentity,comment.id],{commentId:comment.id,reasonText:redactHumanText(comment.text),sourceIdentity:ship.sourceIdentity})
 return events
}

// Render only the trusted observed view, never Trello text, PR prose, logs,
// commands or arbitrary receipt fields. URLs are a strict public PR allowlist.
export function renderShipMilestone(ship, milestone, repoName, number) {
 const sha=value=>/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value??'')?value:'unavailable'
 const rows=(ship.repos??[]).filter(row=>/^[a-z0-9_.-]{1,80}$/i.test(row.repo??''))
 const evidence=rows.map(row=>`${row.repo}: source ${sha(row.approvedSourceHead)}, dev ${sha(row.devHead??ship.devHashes?.[row.repo])}, checks: ${row.checksPassed===true?'passed':'unavailable'}`)
 if(milestone==='s1')return ['S1: source/task and dev push verified; deployment unverified.',...evidence].join('\n')
 if(milestone==='ready')return ['Ready: required delivery stages verified; waiting for CLI acceptance or human PR merge; deployment unverified.',...evidence].join('\n')
 if(milestone==='pr'){
  const row=rows.find(r=>r.repo===repoName&&r.pr?.number===number)
  if(!row||!Number.isSafeInteger(number)||number<1)return null
  const url=row.pr.url
  const safe=typeof url==='string'&&/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(url)&&url.endsWith(`/pull/${number}`)
  return `PR: ${row.repo} #${number}${safe?` ${url}`:''}; source ${sha(row.approvedSourceHead)}; deployment unverified.`
 }
 return null
}
