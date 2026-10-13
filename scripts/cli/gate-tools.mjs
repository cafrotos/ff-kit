import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { findRoot, loadConfig } from '../lib/config.mjs'

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex')
const inside = (base, target) => { const rel = path.relative(base, target); return rel && !rel.startsWith('..') && !path.isAbsolute(rel) }
function canonicalTarget(target) {
  const abs = path.resolve(target)
  if (fs.existsSync(abs)) return fs.realpathSync(abs)
  const tail = []
  let parent = abs
  while (!fs.existsSync(parent)) { tail.unshift(path.basename(parent)); const up = path.dirname(parent); if (up === parent) throw new Error(`không xác định được đường dẫn: ${target}`); parent = up }
  return path.resolve(fs.realpathSync(parent), ...tail)
}
function assertLocalTarget(base, target) {
  if (!inside(fs.realpathSync(base), canonicalTarget(target))) throw new Error(`đường dẫn vượt khỏi workspace: ${target}`)
}
function setup(ctx, slug) {
  const root = findRoot(ctx.cwd)
  if (!root) throw new Error('không thấy ff.config.yaml')
  const { config } = loadConfig(root)
  if (slug.includes('/') || slug.includes('\\') || slug === '.' || slug === '..') throw new Error('slug không hợp lệ')
  const worktrees = path.resolve(root, config.workspace.worktrees_dir)
  const wt = path.resolve(worktrees, slug)
  if (!inside(worktrees, wt) || !fs.statSync(wt).isDirectory() || !inside(fs.realpathSync(worktrees), fs.realpathSync(wt))) throw new Error(`worktree không hợp lệ hoặc không thấy: ${slug}`)
  return { root, config, wt }
}
export const shipApprove = {
  summary: 'ship-approve <slug> — ghi nhận cho phép ship trong 2 giờ',
  async run(args, ctx) {
    try {
      const slug = args[0]; if (!slug) throw new Error('dùng: ff ship-approve <slug>')
      const { wt } = setup(ctx, slug)
      const marker = path.join(wt, '.ff-ship-approved'); assertLocalTarget(wt, marker)
      fs.writeFileSync(marker, `${Math.floor(Date.now()/1000)}\n${process.env.USER || 'user'}\n${new Date().toISOString()}\n`, { mode: 0o600 })
      ctx.stdout.write(`Đã ghi nhận cho phép ship ${slug} (hạn 2 giờ).\n`); return 0
    } catch (e) { ctx.stderr.write(`ff ship-approve: ${e.message}\n`); return 1 }
  },
}
export const allow = {
  summary: 'allow <slug> <file…>|--clear — giới hạn file sửa trong 4 giờ',
  async run(args, ctx) {
    try {
      const [slug, ...files] = args; if (!slug) throw new Error('dùng: ff allow <slug> <file…>|--clear')
      const { wt } = setup(ctx, slug); const file = path.join(wt, '.ff-allow'); assertLocalTarget(wt, file)
      if (files[0] === '--clear') { fs.rmSync(file, { force: true }); ctx.stdout.write(`Đã xóa allowlist ${slug}\n`); return 0 }
      if (!files.length) throw new Error('cần ít nhất một file hoặc --clear')
      const rels = [...new Set(files.map((f) => {
        const abs = path.resolve(wt, f.replace(new RegExp(`^(?:\\./)?${configPathEscape(path.basename(wt))}/`), ''))
        const rel = path.relative(wt, abs); if (!inside(wt, abs) || !inside(fs.realpathSync(wt), canonicalTarget(abs))) throw new Error(`file ngoài worktree: ${f}`); return rel.split(path.sep).join('/')
      }))]
      fs.writeFileSync(file, `ts=${Math.floor(Date.now()/1000)}\n${rels.join('\n')}\n`, { mode: 0o600 })
      ctx.stdout.write(`Allowlist ${slug}: ${rels.length} file, hiệu lực 4 giờ\n`); rels.forEach((x) => ctx.stdout.write(`  ${x}\n`)); return 0
    } catch (e) { ctx.stderr.write(`ff allow: ${e.message}\n`); return 1 }
  },
}
function configPathEscape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
export const lockTests = {
  summary: 'lock-tests <slug> [file…] — khóa test theo SHA-256',
  async run(args, ctx) {
    try {
      const [slug, ...files] = args; if (!slug) throw new Error('dùng: ff lock-tests <slug> [file…]')
      const { root, config, wt } = setup(ctx, slug); const manifest = path.join(wt, '.ff-test-lock')
      assertLocalTarget(wt, manifest)
      if (fs.existsSync(manifest)) throw new Error('đã khóa; dùng ff relock <slug> --reason "…"')
      const testsDir = config.e2e?.tests_dir ? path.resolve(root, config.e2e.tests_dir, slug) : null
      const selected = files.length ? files : testsDir && fs.existsSync(testsDir) ? fs.readdirSync(testsDir).filter((n) => n.endsWith('.spec.ts')).sort().map((n) => path.join(testsDir, n)) : []
      if (!selected.length) throw new Error('không có file test để khóa; cấu hình e2e.tests_dir hoặc truyền file')
      const entries = selected.map((f) => { const abs = path.resolve(root, f); if (!inside(root, abs) || !inside(fs.realpathSync(root), fs.realpathSync(abs)) || !fs.statSync(abs).isFile()) throw new Error(`file không tồn tại trong workspace: ${f}`); return { abs, rel: path.relative(root, abs).split(path.sep).join('/'), hash: sha(fs.readFileSync(abs)) } })
      const body = entries.map((e) => `${e.hash}  ${e.rel}\n`).join(''); fs.writeFileSync(manifest, body, { mode: 0o444 });
      for (const e of entries) fs.chmodSync(e.abs, fs.statSync(e.abs).mode & ~0o222)
      ctx.stdout.write(`Đã khóa ${entries.length} file test; manifest ${sha(body).slice(0,8)}\n`); return 0
    } catch (e) { ctx.stderr.write(`ff lock-tests: ${e.message}\n`); return 1 }
  },
}
export const relock = {
  summary: 'relock <slug> --reason <lý do> — cập nhật hash test đã khóa',
  async run(args, ctx) {
    try {
      const slug = args[0], ix = args.indexOf('--reason'), reason = ix >= 0 ? args[ix+1]?.trim() : ''
      if (!slug || !reason) throw new Error('dùng: ff relock <slug> --reason "lý do"')
      const { root, wt } = setup(ctx, slug); const manifest = path.join(wt, '.ff-test-lock')
      const log = path.join(wt, '.ff-test-lock.log'); assertLocalTarget(wt, manifest); assertLocalTarget(wt, log)
      if (!fs.existsSync(manifest)) throw new Error('chưa khóa; dùng ff lock-tests trước')
      const old = fs.readFileSync(manifest)
      const entries = old.toString().split(/\r?\n/).filter(Boolean).map((line) => {
        const match = line.match(/^([a-f0-9]{64})  (.+)$/)
        if (!match) throw new Error('manifest hỏng')
        return { hash: match[1], rel: match[2], abs: path.resolve(root, match[2]) }
      })
      for (const entry of entries) {
        if (!inside(root, entry.abs) || !fs.existsSync(entry.abs) || !inside(fs.realpathSync(root), fs.realpathSync(entry.abs)))
          throw new Error(`file khóa không tồn tại trong workspace: ${entry.rel}`)
      }
      const changes = []
      let body
      try {
        for (const entry of entries) {
          fs.chmodSync(entry.abs, fs.statSync(entry.abs).mode | 0o200)
          const nextHash = sha(fs.readFileSync(entry.abs))
          if (nextHash !== entry.hash) changes.push(entry.rel)
          entry.hash = nextHash
        }
        body = entries.map((entry) => `${entry.hash}  ${entry.rel}\n`).join('')
        fs.chmodSync(manifest, fs.statSync(manifest).mode | 0o200)
        fs.writeFileSync(manifest, body, { mode: 0o600 })
        fs.chmodSync(manifest, 0o444)
      } finally {
        for (const entry of entries) {
          try { fs.chmodSync(entry.abs, fs.statSync(entry.abs).mode & ~0o222) } catch {}
        }
      }
      fs.appendFileSync(log, `${new Date().toISOString()} | ${reason} | ${changes.join(', ') || 'không đổi'} | ${sha(old).slice(0, 8)}→${sha(body).slice(0, 8)}\n`)
      ctx.stdout.write(`Relock xong: ${changes.length} file thay đổi\n`); return 0
    } catch(e){ctx.stderr.write(`ff relock: ${e.message}\n`);return 1}
  },
}
export const probeSlice = {
  summary: 'probe-slice <slug> [task] [--json] — so thay đổi với allowlist',
  async run(args,ctx){
    try{
      const slug=args[0], json=args.includes('--json'), root=findRoot(ctx.cwd); if(!root||!slug)throw new Error('dùng: ff probe-slice <slug> [task] [--json]')
      const {config}=loadConfig(root);if(slug.includes('/')||slug.includes('\\')||slug==='.'||slug==='..')throw new Error('slug không hợp lệ');const worktrees=path.resolve(root,config.workspace.worktrees_dir),wt=path.resolve(worktrees,slug);if(!inside(worktrees,wt)||!fs.existsSync(wt)||!inside(fs.realpathSync(worktrees),fs.realpathSync(wt)))throw new Error(`không thấy worktree hợp lệ ${slug}`)
      const allowedFile=path.join(wt,'.ff-allow'), lines=fs.existsSync(allowedFile)?fs.readFileSync(allowedFile,'utf8').split(/\r?\n/):[];const ts=Number(lines[0]?.match(/^ts=(\d+)$/)?.[1]);const expired=!ts||Date.now()/1000-ts>14400;const allowed=new Set((expired?[]:lines.slice(1)).filter(Boolean))
      const changed=[]
      const {spawnSync}=await import('node:child_process')
      const gitRun=(dir,gitArgs)=>ctx.git?ctx.git(dir,gitArgs):spawnSync('git',gitArgs,{cwd:dir,encoding:'utf8'})
      const ignored=(p)=>p.endsWith('.env.example')?false:/(^|\/)\.env(?:$|\.)|(^|\/)tsconfig\.tsbuildinfo$|(^|\/)CLAUDE\.md$|(^|\/)\.dev-logs\/|(^|\/)\.run-dev\.|(^|\/)\.ff-|\.DS_Store$|(^|\/)node_modules\/|(^|\/)(?:dist|build|coverage)\//.test(p)
      const add=(repoName,p)=>{p=p.replace(/^"|"$/g,'');const relative=`${repoName}/${p}`;if(p&&!ignored(relative))changed.push(relative)}
      for(const repo of config.repos){const dir=path.join(wt,path.basename(repo.path));if(!fs.existsSync(path.join(dir,'.git')))continue
        const repoName=path.basename(repo.path),st=gitRun(dir,['status','--porcelain','-uall'])
        if(st.status!==0)throw new Error(`git status thất bại trong ${repoName}`)
        for(const l of st.stdout.split(/\r?\n/)){if(!l.trim())continue;add(repoName,l.slice(3).trim().split(' -> ').at(-1))}
        const branch=gitRun(dir,['rev-parse','--abbrev-ref','HEAD']).stdout?.trim()||''
        const candidates=branch&&branch!=='HEAD'&&branch!==repo.base_branch?[`origin/${branch}`,`origin/${repo.base_branch}`,repo.base_branch]:[`origin/${repo.base_branch}`,repo.base_branch]
        let base=null
        for(const ref of candidates){if(gitRun(dir,['rev-parse','--verify',ref]).status===0){base=ref;break}}
        if(base){const merge=gitRun(dir,['merge-base','HEAD',base]);if(merge.status===0&&merge.stdout.trim()){const diff=gitRun(dir,['diff','--name-only',`${merge.stdout.trim()}..HEAD`]);if(diff.status===0)for(const p of diff.stdout.split(/\r?\n/))add(repoName,p.trim())}}
      }
      const unique=[...new Set(changed)].sort(), violations=unique.filter(f=>!allowed.has(f)), status=!unique.length?'NO_CHANGES':violations.length?'ALLOWLIST_VIOLATION':'DRIFT_CLEAN';const out={status,slug,task:args.find(a=>a!==slug&&!a.startsWith('--'))??null,allowlist:{exists:fs.existsSync(allowedFile),expired,files:[...allowed]},changedFiles:unique,violations,isClean:status!=='ALLOWLIST_VIOLATION'}
      ctx.stdout.write(json?JSON.stringify(out,null,2)+'\n':`${status}: ${unique.length} file thay đổi${violations.length?`; ngoài allowlist: ${violations.join(', ')}`:''}\n`);return out.isClean?0:1
    }catch(e){ctx.stderr.write(`ff probe-slice: ${e.message}\n`);return 1}
  },
}
