#!/usr/bin/env node
// Ghi payload hook ra .ff-spike/<tên>.jsonl. SPIKE_BLOCK=<tên> → exit 2 để thử chặn.
import fs from 'node:fs'
import path from 'node:path'

const name = process.argv[2] ?? 'hook'
const raw = fs.readFileSync(0, 'utf8')
const dir = path.join(process.cwd(), '.ff-spike')
fs.mkdirSync(dir, { recursive: true })
fs.appendFileSync(path.join(dir, `${name}.jsonl`), raw.trim() + '\n')
if (process.env.SPIKE_BLOCK === name) {
  process.stderr.write('[spike] chặn thử\n')
  process.exit(2)
}
