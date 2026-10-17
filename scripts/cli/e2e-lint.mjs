import fs from 'node:fs'
import path from 'node:path'

export const summary = 'e2e-lint <file|dir> [--strict] — tìm dấu hiệu test e2e yếu'
const checks = [
  ['force: true', /\bforce\s*:\s*true\b/],
  ['dispatchEvent(', /\bdispatchEvent\(/],
  ['.catch(() => rỗng/hằng)', /\.catch\(\s*\(\)\s*=>\s*(?:\{\s*\}|\(\{\}\)|null|undefined|\[\]|false|true|0|''|"")\s*\)/],
  ['waitForTimeout(', /\bwaitForTimeout\(/],
  ['.first()', /\.first\(\)/],
  ['.nth(', /\.nth\(/],
]

export async function run(args, ctx) {
  try {
    const target = args.find((arg) => !arg.startsWith('--'))
    if (!target) throw new Error('dùng: ff e2e-lint <file|dir> [--strict]')
    const abs = path.resolve(ctx.cwd, target)
    if (!fs.existsSync(abs)) throw new Error(`không thấy ${target}`)
    const walk = (file) => fs.statSync(file).isFile()
      ? [file]
      : fs.readdirSync(file, { withFileTypes: true })
        .filter((entry) => entry.name !== 'node_modules')
        .flatMap((entry) => walk(path.join(file, entry.name)))
        .filter((item) => /\.(?:ts|tsx|js|mjs)$/.test(item))
    const counts = Object.fromEntries([...checks.map(([label]) => label), 'test.skip cấp file/describe', 'test.skip trong thân test'].map((key) => [key, 0]))
    const rows = []
    for (const file of walk(abs).sort()) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
      let testIndent = null
      lines.forEach((line, index) => {
        if (/^\s*\/\//.test(line)) return
        const test = line.match(/^(\s*)test(?:\.(?:only|fixme))?\(\s*['"`]/)
        if (test) testIndent = test[1].length
        if (/^\s*test\.describe/.test(line)) testIndent = null
        for (const [label, pattern] of checks) {
          if (pattern.test(line)) { counts[label]++; rows.push([label, file, index + 1]) }
        }
        if (/\btest\.skip\(/.test(line)) {
          const isTitleSkip = /^\s*test\.skip\(\s*['"`]/.test(line)
          const indent = line.match(/^(\s*)/)?.[1].length ?? 0
          const key = !isTitleSkip && testIndent !== null && indent > testIndent
            ? 'test.skip trong thân test'
            : 'test.skip cấp file/describe'
          counts[key]++; rows.push([key, file, index + 1])
        }
      })
    }
    for (const [label, file, line] of rows) ctx.stdout.write(`${label}: ${path.relative(ctx.cwd, file)}:${line}\n`)
    for (const [label, count] of Object.entries(counts)) ctx.stdout.write(`${label}: ${count}\n`)
    ctx.stdout.write(`Tổng dấu hiệu: ${rows.length}\n`)
    return args.includes('--strict') && rows.length ? 1 : 0
  } catch (error) { ctx.stderr.write(`ff e2e-lint: ${error.message}\n`); return 1 }
}
