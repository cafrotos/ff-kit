import { findRoot, loadConfig } from '../lib/config.mjs'
import { preflightStage } from '../lib/doctor.mjs'
import { beginStage, blockStagePreflight, finishStage, stageContext } from '../lib/stage-receipts.mjs'

export const summary = 'stage context|begin|finish <id> — scoped phase dispatch and evidence receipt'
export async function run(args, ctx) {
  try {
    const [action, cardId, ...options] = args
    if (!['context', 'begin', 'finish'].includes(action) || !cardId) throw new Error('Usage: ff ' + summary)
    const values = {}
    const allowed = action === 'context' ? ['--json'] : action === 'begin' ? ['--dispatch'] : ['--dispatch', '--outcome', '--evidence']
    for (let i = 0; i < options.length; i++) {
      const name = options[i]
      if (!allowed.includes(name) || Object.hasOwn(values, name)) throw new Error('Invalid stage option')
      if (name === '--json') values[name] = true
      else {
        if (!options[i + 1] || options[i + 1].startsWith('--')) throw new Error('Missing stage option value')
        values[name] = options[++i]
      }
    }
    if (action !== 'context' && allowed.some(name => !values[name])) throw new Error('Missing stage options')
    const root = findRoot(ctx.cwd)
    if (!root) throw new Error('No ff.config.yaml')
    const { config } = loadConfig(root)
    if (action === 'begin') {
      const context = stageContext(root, config, cardId)
      if (context.stage === 'verify') {
        const preflight = preflightStage(root, config, { stage: 'verify', runCommand: ctx.preflightRunCommand })
        if (!preflight.ok) {
          const receipt = await blockStagePreflight(root, config, { cardId, dispatchId: values['--dispatch'], preflight })
          ctx.stdout.write(JSON.stringify({ ok: false, reason: preflight.reason, receipt }) + '\n')
          throw new Error(preflight.reason)
        }
      }
    }
    const result = action === 'context' ? stageContext(root, config, cardId)
      : action === 'begin' ? await beginStage(root, config, { cardId, dispatchId: values['--dispatch'] })
        : await finishStage(root, config, { cardId, dispatchId: values['--dispatch'], outcome: values['--outcome'], evidenceFile: values['--evidence'] })
    ctx.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return 0
  } catch (error) { ctx.stderr.write(`ff stage: ${error.message}\n`); return 1 }
}
