#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runWorker } from './core/runtime.mjs'

export function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true }
  let config
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' && argv[i + 1]) config = argv[++i]
    else throw new Error(`tham số không hợp lệ: ${argv[i]}`)
  }
  if (!config) throw new Error('thiếu --config <ff.config.yaml>')
  return { config: path.resolve(config) }
}

export async function main(argv = process.argv.slice(2)) {
  let args
  try { args = parseArgs(argv) } catch (e) {
    process.stderr.write(`ff-worker: ${e.message}\nDùng: ff-worker --config <ff.config.yaml>\n`)
    return 2
  }
  if (args.help) {
    process.stdout.write('Dùng: ff-worker --config <ff.config.yaml>\n')
    return 0
  }
  try { return await runWorker({ configPath: args.config }) }
  catch (e) { process.stderr.write(`ff-worker: ${e.message}\n`); return 1 }
}

if (process.argv[1]) {
  try {
    if (fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
      process.exitCode = await main()
    }
  } catch {}
}
