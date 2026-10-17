import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { findRoot, loadConfig } from '../lib/config.mjs'

export const summary = 'e2e-scaffold [--dir <đường-dẫn>] [--db postgres|mysql] — dựng bộ Playwright từ template'

function inside(root, target) {
  const rel = path.relative(root, target)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
}

function templateRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [path.resolve(here, '../../templates/ff-e2e'), path.resolve(here, '../templates/ff-e2e')]
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'package.json')))
}

function parse(args) {
  const opts = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir') opts.dir = args[++i]
    else if (args[i] === '--db') opts.db = args[++i]
    else return { error: `tham số không hợp lệ: ${args[i]}` }
    if (!opts.dir && args[i - 1] === '--dir') return { error: 'thiếu giá trị cho --dir' }
    if (!opts.db && args[i - 1] === '--db') return { error: 'thiếu giá trị cho --db' }
  }
  if (opts.db && !['postgres', 'mysql'].includes(opts.db)) return { error: '--db chỉ nhận postgres|mysql' }
  return { opts }
}

function copyTemplate(template, target, withDb) {
  fs.cpSync(template, target, { recursive: true, errorOnExist: true })
  if (withDb) {
    const pkgPath = path.join(target, 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    pkg.devDependencies[withDb === 'postgres' ? 'pg' : 'mysql2'] = withDb === 'postgres' ? '^8.16.3' : '^3.15.3'
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
    fs.copyFileSync(path.join(target, 'fixtures/test-db.ts'), path.join(target, 'fixtures/test.ts'))
    fs.rmSync(path.join(target, 'fixtures/test-db.ts'))
  } else {
    for (const rel of ['helpers/db.ts', 'helpers/restore.ts', 'fixtures/test-db.ts']) {
      fs.rmSync(path.join(target, rel), { force: true })
    }
  }
}

export async function run(args, ctx) {
  const parsed = parse(args)
  if (parsed.error) {
    ctx.stderr.write(`ff e2e-scaffold: ${parsed.error}\n`)
    return 2
  }
  const root = findRoot(ctx.cwd)
  if (!root) {
    ctx.stderr.write('ff e2e-scaffold: không thấy ff.config.yaml\n')
    return 4
  }
  const config = loadConfig(root).config
  const rel = parsed.opts.dir ?? config.e2e?.dir ?? 'ff-e2e'
  const target = path.resolve(root, rel)
  if (!inside(root, target)) {
    ctx.stderr.write('ff e2e-scaffold: --dir phải nằm trong workspace\n')
    return 2
  }
  let ancestor = path.dirname(target)
  while (ancestor !== root && inside(root, ancestor)) {
    if (fs.existsSync(ancestor) && !inside(root, fs.realpathSync(ancestor))) {
      ctx.stderr.write('ff e2e-scaffold: --dir không được đi qua symlink ra ngoài workspace\n')
      return 2
    }
    ancestor = path.dirname(ancestor)
  }
  if (fs.existsSync(target) && (!fs.statSync(target).isDirectory() || fs.readdirSync(target).length)) {
    ctx.stderr.write(`ff e2e-scaffold: đích đã tồn tại và không rỗng: ${rel}\n`)
    return 1
  }
  const template = templateRoot()
  if (!template) {
    ctx.stderr.write('ff e2e-scaffold: không thấy templates/ff-e2e trong plugin\n')
    return 1
  }
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    if (!fs.existsSync(target)) copyTemplate(template, target, parsed.opts.db)
    else {
      const staging = `${target}.ff-staging-${process.pid}`
      copyTemplate(template, staging, parsed.opts.db)
      for (const name of fs.readdirSync(staging)) fs.renameSync(path.join(staging, name), path.join(target, name))
      fs.rmdirSync(staging)
    }
    const install = ctx.install
      ? await ctx.install(target)
      : spawnSync('npm', ['install'], { cwd: target, encoding: 'utf8', timeout: 120000 })
    if (install.status !== 0) {
      const detail = (install.stderr || install.stdout || install.error?.message || 'npm install lỗi').trim().split('\n')[0]
      ctx.stderr.write(`ff e2e-scaffold: npm install thất bại: ${detail}\n`)
      return 1
    }
    ctx.stdout.write(`Đã dựng e2e tại ${path.relative(root, target)}. Cài browser bằng npx playwright install chromium sau khi được người dùng đồng ý.\n`)
    return 0
  } catch (e) {
    ctx.stderr.write(`ff e2e-scaffold: ${e.message}\n`)
    return 1
  }
}
