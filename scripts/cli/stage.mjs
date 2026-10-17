import fs from 'node:fs'
import path from 'node:path'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { pluginRoot } from '../lib/evals.mjs'
import { preflightStage } from '../lib/doctor.mjs'
import { beginStage, blockStagePreflight, finishStage, stageContext } from '../lib/stage-receipts.mjs'

export const summary = 'stage context|begin|finish <id> | protocol | doc <path> | template <id> — scoped phase dispatch and evidence receipt'
// Plugin docs readable through the CLI even when workspace permissions deny reading the pinned workflow folder.
const DOC_ROOTS = ['skills', 'references', 'templates', 'agents', 'commands']
export function readPluginDoc(rel, base = pluginRoot()) {
  const clean = path.posix.normalize(String(rel ?? '').replaceAll('\\', '/'))
  if (!clean || clean.startsWith('../') || clean === '..' || path.posix.isAbsolute(clean) || !DOC_ROOTS.includes(clean.split('/')[0])) throw new Error(`Doc path must be inside ${DOC_ROOTS.join('|')}/ of the plugin (got ${rel})`)
  const real = fs.realpathSync(path.join(base, clean)), top = fs.realpathSync(path.join(base, clean.split('/')[0]))
  if (real !== top && !real.startsWith(top + path.sep)) throw new Error('Doc path escapes the plugin')
  if (!fs.statSync(real).isFile()) throw new Error('Doc path must be a file')
  return fs.readFileSync(real, 'utf8')
}
export function evidenceTemplate(context) {
  const w = context.workflow
  return {
    cardId: context.cardId, revision: context.revision, runId: context.runId, dispatchId: context.dispatchId,
    workflow: w ? { digest: w.digest, cliVersion: w.cliVersion } : '<from ff stage context>',
    heads: { '<repo.name>': '<git rev-parse HEAD in each repo copy>' },
    artifactHashes: { '<path relative to workspace root>': '<sha256 of file bytes, 64 hex>' },
    testLockHash: context.testLock ? `<sha256 of ${context.testLock}; null if no test lock yet>` : null,
    checks: [], reviewRefs: [], acMatrixRef: null,
    _hint: `Save as ${context.activeDir ?? '<activeDir>'}/evidence/${context.dispatchId}/stage-evidence.json (path relative to workspace root, inside it). Remove this _hint. Full rules: ff stage protocol`,
  }
}

export async function run(args, ctx) {
  try {
    if (args[0] === 'protocol' || args[0] === 'doc') {
      const text = args[0] === 'protocol' ? readPluginDoc('references/stage-protocol.md') : readPluginDoc(args[1])
      if (args[0] === 'doc' && args.length !== 2) throw new Error('Usage: ff stage doc <skills|references|templates|agents|commands>/<file>')
      ctx.stdout.write(text.endsWith('\n') ? text : text + '\n')
      return 0
    }
    const [action, cardId, ...options] = args
    if (action === 'template') {
      const root = findRoot(ctx.cwd)
      if (!root || !cardId) throw new Error('Usage: ff stage template <id>')
      const { config } = loadConfig(root)
      ctx.stdout.write(JSON.stringify(evidenceTemplate(stageContext(root, config, cardId)), null, 2) + '\n')
      return 0
    }
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
  } catch (error) {
    const hint = args[0] === 'finish' ? `\nff stage: evidence schema and path rules: run \`ff stage protocol\`; prefilled skeleton: \`ff stage template ${args[1] ?? '<id>'}\`; other plugin docs: \`ff stage doc <path>\`` : ''
    ctx.stderr.write(`ff stage: ${error.message}${hint}\n`); return 1
  }
}
