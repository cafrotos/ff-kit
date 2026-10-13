#!/usr/bin/env node
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { supervise } from '../ff-worker/src/core/supervisor.mjs'
import { writeWorkerStatus } from '../ff-worker/src/core/status.mjs'

function options(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' && argv[i + 1]) out.config = path.resolve(argv[++i])
    else if (argv[i] === '--package' && argv[i + 1]) out.pkg = argv[++i]
    else throw new Error(`tham số không hợp lệ: ${argv[i]}`)
  }
  if (!out.config || !out.pkg) throw new Error('cần --config và --package')
  return out
}

export async function main(argv = process.argv.slice(2)) {
  let opts
  try { opts = options(argv) } catch (e) { process.stderr.write(`ff-worker-supervise: ${e.message}\n`); return 2 }
  const root = path.dirname(opts.config)
  const result = await supervise({
    launch: () => new Promise((resolve) => {
      const child = spawn('npx', ['--yes', opts.pkg, '--config', opts.config], { cwd: root, stdio: 'inherit', env: process.env })
      child.once('error', () => resolve({ code: 1 }))
      child.once('exit', (code) => resolve({ code: code ?? 1 }))
    }),
    onCrash(reason) {
      let status = {}
      try { status = JSON.parse(fs.readFileSync(path.join(root, '.ff/worker.json'), 'utf8')) } catch {}
      writeWorkerStatus(root, { ...status, state: 'crashed', error: reason, updatedAt: new Date().toISOString() })
      process.stderr.write(`[ff-worker-supervise] ${reason}\n`)
    },
  })
  return result.code
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main()
