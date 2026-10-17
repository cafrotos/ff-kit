import { findRoot, loadConfig } from '../lib/config.mjs'
import { importLedgerDecisions } from '../lib/knowledge.mjs'
export const summary = 'learn [id] — nhập quyết định người từ ledger'
export async function run(args,ctx) {
  try {
    if(args.length>1 || (args.length && !/^[A-Za-z0-9]+$/.test(args[0])))throw new Error('dùng: ff learn [id]')
    const root=findRoot(ctx.cwd)
    if(!root)throw new Error('không thấy ff.config.yaml')
    const {config}=loadConfig(root)
    const result=await importLedgerDecisions(root,config,{cardId:args[0]})
    ctx.stdout.write(JSON.stringify(result)+'\n')
    return 0
  }catch(e){ctx.stderr.write(`ff learn: ${e.message}\n`);return 1}
}
