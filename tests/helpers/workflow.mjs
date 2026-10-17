import fs from 'node:fs'
import path from 'node:path'

export function workflowPackage(dir, version = '0.1.0') {
  const write = (name, text, mode = 0o600) => {
    const file = path.join(dir, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text, { mode })
  }
  write('bin/ff', "#!/usr/bin/env node\nimport { main } from '../dist/cli.mjs'\nprocess.exitCode = await main(process.argv.slice(2))\n", 0o755)
  write('dist/cli.mjs', `export async function main(args) { if(args[0] !== '--version') return 2; console.log(${JSON.stringify(version)}); return 0 }\n`)
  write('ff-worker/dist/index.mjs', '// worker\n')
  write('ff-worker/package.json', JSON.stringify({ version }))
  write('package.json', JSON.stringify({ version, type: 'module' }))
  write('.claude-plugin/plugin.json', JSON.stringify({ name: 'ff-kit', version }))
  write('hooks/hooks.json', '{}')
  for (const name of ['skills/example/SKILL.md', 'agents/example.md', 'commands/example.md', 'references/example.md']) write(name, 'original workflow\n')
  return { write }
}
