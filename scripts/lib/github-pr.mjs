import fs from 'node:fs'
import {spawnSync} from 'node:child_process'
export const defaultRunGh=(args,cwd)=>spawnSync('gh',args,{cwd,encoding:'utf8',timeout:120000})
export function normalizeRepoIdentity(origin){
 const match=String(origin).match(/^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)?([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/)
 if(!match)throw Error('pr_repo');return match[1]
}
const fields='number,url,state,headRefOid,headRefName,baseRefName,headRepository,baseRefOid,mergedAt,mergeable,comments'
export class GitHubPrClient{
 constructor({runGh=defaultRunGh,beforeMutation=()=>{},afterMutation=()=>{}}={}){Object.assign(this,{runGh,beforeMutation,afterMutation})}
 async call(args,cwd){let r;try{r=await this.runGh(args,cwd)}catch{throw Error('gh_unknown')}if(r?.status!==0)throw Error('gh');return r.stdout??''}
 async inspectPullRequest({cwd,repoIdentity,number,approvedSourceHead,taskBranch,baseBranch}){
  const repo=normalizeRepoIdentity(repoIdentity),raw=JSON.parse(await this.call(['pr','view',String(number),'--repo',repo,'--json',fields],cwd))
  if(raw.headRepository?.nameWithOwner?.toLowerCase()!==repo.toLowerCase()||(taskBranch&&raw.headRefName!==taskBranch)||(baseBranch&&raw.baseRefName!==baseBranch))throw Error('pr_identity')
  if(raw.headRefOid!==approvedSourceHead)throw Error('pr_head')
  if(raw.state==='CLOSED')throw Error('pr_closed')
  const observation={number:raw.number??number,url:raw.url,repoIdentity:repo,taskBranch:raw.headRefName,baseBranch:raw.baseRefName,sourceHead:raw.headRefOid,merged:raw.state==='MERGED'&&!!raw.mergedAt,headAtMerge:raw.state==='MERGED'?raw.headRefOid:null,baseHead:raw.baseRefOid??null,mergeability:raw.mergeable==='MERGEABLE'?'mergeable':raw.mergeable==='CONFLICTING'?'conflicting':'unknown'}
  Object.defineProperty(observation,'comments',{value:raw.comments??[],enumerable:false});return observation
 }
 async ensurePullRequest(input){
  const {cwd,taskBranch,baseBranch,sourceHead,title,bodyFile,revision,cardId='unknown'}=input,repo=normalizeRepoIdentity(input.repoIdentity)
  const marker=`<!-- ff-ship:${cardId}:${revision}:${sourceHead} -->`
  const note='\n[Report truncated to fit GitHub.]\n',suffix='\n'+marker;let body=fs.readFileSync(bodyFile,'utf8')
  if(body.length+suffix.length>60000)body=body.slice(0,60000-suffix.length-note.length)+note
  body+=suffix;fs.writeFileSync(bodyFile,body,{mode:0o600})
  const list=async()=>JSON.parse(await this.call(['pr','list','--repo',repo,'--head',taskBranch,'--base',baseBranch,'--state','all','--json','number'],cwd))
  let found=await list();if(found.length>1)throw Error('pr_ambiguous')
  const mutate=async(args)=>{await this.beforeMutation();let error;try{await this.call(args,cwd)}catch(e){error=e}await this.afterMutation(error);return error}
  if(!found.length){await mutate(['pr','create','--repo',repo,'--head',taskBranch,'--base',baseBranch,'--title',title,'--body-file',bodyFile]);found=await list();if(found.length!==1)throw Error('pr_create_unknown')}
  const observe=()=>this.inspectPullRequest({cwd,repoIdentity:repo,number:found[0].number,approvedSourceHead:sourceHead,taskBranch,baseBranch})
  let view=await observe()
  // A merged PR belongs to its exact approved source, never reopen it.
  if(revision&&!view.merged&&!view.comments.some(c=>c.body?.includes(marker))){
   await mutate(['pr','comment',String(view.number),'--repo',repo,'--body-file',bodyFile]);view=await observe();if(!view.comments.some(c=>c.body?.includes(marker)))throw Error('pr_comment_unknown')
  }
  return view
 }
}
