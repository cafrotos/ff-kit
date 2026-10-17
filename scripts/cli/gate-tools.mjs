import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { findRoot, loadConfig } from '../lib/config.mjs'
import { createShipApproval, createAutoShipApproval, createLegacyShipApproval } from '../lib/ship-approval.mjs'
import { shipBlockers } from '../lib/ship.mjs'
import { findCardDir } from '../lib/cards.mjs'
import { activeRevision } from '../lib/gates.mjs'
import { enforceDiffChecks, recordAllowHistory } from '../lib/diff-checks.mjs'
import { readRevisionBase } from './repo-common.mjs'
import { isTestDirName } from '../lib/code-dir.mjs'
import { readUnlock, unlockName, UNLOCK_TTL_S } from '../lib/test-unlock.mjs'

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
function setup(ctx, slug, { allowTest = false } = {}) {
  const root = findRoot(ctx.cwd)
  if (!root) throw new Error('không thấy ff.config.yaml')
  const { config } = loadConfig(root)
  if (slug.includes('/') || slug.includes('\\') || slug === '.' || slug === '..' || (!allowTest && isTestDirName(slug))) throw new Error('slug không hợp lệ')
  const worktrees = path.resolve(root, config.workspace.worktrees_dir)
  const wt = path.resolve(worktrees, slug)
  if (!inside(worktrees, wt) || !fs.statSync(wt).isDirectory() || !inside(fs.realpathSync(worktrees), fs.realpathSync(wt))) throw new Error(`worktree không hợp lệ hoặc không thấy: ${slug}`)
  return { root, config, wt }
}
function revisionOptions(args) {
  const out = []
  let revision = ''
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--revision') {
      if (revision || !/^rev-[1-9]\d*$/.test(args[i + 1] ?? '')) throw new Error('revision phải dạng rev-N')
      revision = args[++i]
    } else out.push(args[i])
  }
  return { args: out, revision, suffix: revision ? `.${revision}` : '' }
}
export const shipApprove = {
  summary: 'ship-approve <slug> [--auto] — ghi nhận cho phép ship trong 2 giờ (--auto: chỉ khi Gate C auto_passed, gắn Gate C/HEAD/ship_branch)',
  async run(args, ctx) {
    try {
      const slug = args[0]; if (!slug) throw new Error('dùng: ff ship-approve <slug>[.test]')
      // `<slug>.test` = checkout verify do `ff ship-test` dựng: nơi guard cho phép push kết quả đã test (marker nằm đúng thư mục đó).
      const onTest = isTestDirName(slug), card = onTest ? slug.slice(0, -'.test'.length) : slug
      const { root, wt, config } = setup(ctx, slug, { allowTest: true })
      const cardId = card.split('-')[0]
      for (const repo of config.repos) {
        const dir = path.join(wt, path.basename(repo.path))
        if (fs.existsSync(path.join(dir, '.git')) && spawnSync('git', ['config', '--bool', 'ff.localOnly'], { cwd: dir, encoding: 'utf8' }).stdout.trim() === 'true') throw new Error(`${repo.name} chưa có upstream origin; không được ship bản copy local-only`)
      }
      const auto = args.includes('--auto')
      if (auto && (args.length !== 2 || args.includes('--question-id'))) throw new Error('dùng: ff ship-approve <slug> --auto')
      const legacy = !config.worker?.driver?.enabled
      // Duyệt `.test` = cho push đúng commit đã test: bắt buộc có ship-test khớp SHA. Các thiếu sót khác chỉ cảnh báo (ff ship sẽ chặn và nêu lại).
      const missing = auto ? [] : shipBlockers(root, config, cardId, Date.now, { approval: false }).blockers
      const hard = onTest ? missing.filter((b) => b.code === 'ship_test' || b.code === 'card' || b.code === 'targets') : []
      if (hard.length) throw new Error(`chưa thể duyệt push từ ${slug}, còn thiếu:\n${hard.map((b) => `  - [${b.code}] ${b.fix}`).join('\n')}`)
      const writeMarker = (extra = '') => { const marker = path.join(wt, '.ff-ship-approved'); assertLocalTarget(wt, marker); fs.writeFileSync(marker, `${Math.floor(Date.now()/1000)}\n${process.env.USER || 'user'}\n${new Date().toISOString()}\n${extra}`, { mode: 0o600 }) }
      if (auto) {
        // CLI tự kiểm: Gate C phải auto_passed còn hash khớp; guard không hỏi người cho dạng --auto.
        if (config.autopilot?.enabled === true && config.autopilot.ship === false) throw new Error('autopilot.ship=false: không tự ship; người xác nhận ship (ff ship-approve --question-id …)')
        const diffGate = await enforceDiffChecks(root, config, findCardDir(root, config, cardId).dir, cardId)
        if (!diffGate.ok) throw new Error(`autopilot không tự ship được, cần người xác nhận:\n${diffGate.messages.map((m) => `  - ${m}`).join('\n')}`)
        const receipt = createAutoShipApproval(root, config, { cardId })
        if (legacy) writeMarker(`${JSON.stringify(receipt.binding)}\n`)
      } else if (!legacy) {
        const i = args.indexOf('--question-id'); if (i < 0 || !args[i + 1]) throw new Error('cần --question-id của câu hỏi SHIP đã được người trả lời')
        createShipApproval(root, config, { cardId, questionId: args[i + 1] })
      } else {
        try { createLegacyShipApproval(root, config, { cardId }) } catch {} // `ff ship` đọc biên nhận này (thiếu đích thì ff ship tự nêu); marker cho guard khi push tay
        writeMarker()
      }
      ctx.stdout.write(`Đã ghi nhận cho phép ship ${slug} (hạn 2 giờ).\n`)
      if (missing.length) ctx.stdout.write(`Lưu ý: \`ff ship ${cardId}\` vẫn còn thiếu:\n${missing.map((b) => `  - [${b.code}] ${b.fix}`).join('\n')}\n`)
      return 0
    } catch (e) { ctx.stderr.write(`ff ship-approve: ${e.message}\n`); return 1 }
  },
}
export const allow = {
  summary: 'allow <slug> <file…>|--clear — giới hạn file sửa trong 4 giờ',
  async run(args, ctx) {
    try {
      const [slug, ...files] = args; if (!slug) throw new Error('dùng: ff allow <slug> <file…>|--clear')
      const { root, config, wt } = setup(ctx, slug); const file = path.join(wt, '.ff-allow'); assertLocalTarget(wt, file)
      if (files[0] === '--clear') { fs.rmSync(file, { force: true }); ctx.stdout.write(`Đã xóa allowlist ${slug}\n`); return 0 }
      if (!files.length) throw new Error('cần ít nhất một file hoặc --clear')
      const rels = [...new Set(files.map((f) => {
        const abs = path.resolve(wt, f.replace(new RegExp(`^(?:\\./)?${configPathEscape(path.basename(wt))}/`), ''))
        const rel = path.relative(wt, abs); if (!inside(wt, abs) || !inside(fs.realpathSync(wt), canonicalTarget(abs))) throw new Error(`file ngoài worktree: ${f}`); return rel.split(path.sep).join('/')
      }))]
      { const id = slug.match(/^[A-Za-z0-9]+/)[0], card = findCardDir(root, config, id); recordAllowHistory(root, id, { revision: card.error ? '' : (activeRevision(card.dir) ?? ''), slug, files: rels }) }
      fs.writeFileSync(file, `ts=${Math.floor(Date.now()/1000)}\n${rels.join('\n')}\n`, { mode: 0o600 })
      ctx.stdout.write(`Allowlist ${slug}: ${rels.length} file, hiệu lực 4 giờ\n`); rels.forEach((x) => ctx.stdout.write(`  ${x}\n`)); return 0
    } catch (e) { ctx.stderr.write(`ff allow: ${e.message}\n`); return 1 }
  },
}
// A repo-relative path names the card's worktree copy; the base checkout is never locked or chmod'ed.
function testFile(root, config, wt, f) {
  const copy = path.resolve(wt, f)
  const abs = !path.isAbsolute(f) && fs.existsSync(copy) ? copy : path.resolve(root, f)
  if (!inside(wt, abs) && config.repos.some((repo) => inside(path.resolve(root, repo.path), abs))) throw new Error(`file thuộc repo gốc, không phải bản copy của thẻ: ${f}`)
  return abs
}
function configPathEscape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
export const lockTests = {
  summary: 'lock-tests <slug> [--revision rev-N] [file…] — khóa test theo SHA-256',
  async run(args, ctx) {
    try {
      const options = revisionOptions(args), [slug, ...files] = options.args; if (!slug) throw new Error('dùng: ff lock-tests <slug> [--revision rev-N] [file…]')
      const { root, config, wt } = setup(ctx, slug); const manifest = path.join(wt, '.ff-test-lock' + options.suffix)
      assertLocalTarget(wt, manifest)
      if (fs.existsSync(manifest)) throw new Error('đã khóa; dùng ff relock <slug> --reason "…"')
      const testsDir = config.e2e?.tests_dir ? path.resolve(root, config.e2e.tests_dir, slug) : null
      if (options.revision && !files.length) throw new Error('revision cần danh sách file test rõ ràng')
      const selected = files.length ? files : testsDir && fs.existsSync(testsDir) ? fs.readdirSync(testsDir).filter((n) => n.endsWith('.spec.ts')).sort().map((n) => path.join(testsDir, n)) : []
      if (!selected.length) throw new Error('không có file test để khóa; cấu hình e2e.tests_dir hoặc truyền file')
      const entries = selected.map((f) => { const abs = testFile(root, config, wt, f); if (!inside(root, abs) || !inside(fs.realpathSync(root), fs.realpathSync(abs)) || !fs.statSync(abs).isFile()) throw new Error(`file không tồn tại trong workspace: ${f}`); return { abs, rel: path.relative(root, abs).split(path.sep).join('/'), hash: sha(fs.readFileSync(abs)) } })
      const body = entries.map((e) => `${e.hash}  ${e.rel}\n`).join(''); fs.writeFileSync(manifest, body, { mode: 0o444 });
      for (const e of entries) fs.chmodSync(e.abs, fs.statSync(e.abs).mode & ~0o222)
      ctx.stdout.write(`Đã khóa ${entries.length} file test; manifest ${sha(body).slice(0,8)}\n`); return 0
    } catch (e) { ctx.stderr.write(`ff lock-tests: ${e.message}\n`); return 1 }
  },
}
export const relock = {
  summary: 'relock <slug> [--revision rev-N] --reason <lý do> [--open [file…]|--add <files…>] — --open mở cửa sổ sửa 60 phút cho file test đã khóa; không --open: băm lại và khóa (cả hai cần user cho phép)',
  async run(args, ctx) {
    try {
      const options = revisionOptions(args)
      args = options.args
      const slug = args[0], ix = args.indexOf('--reason'), reason = ix >= 0 ? args[ix+1]?.trim() : ''
      if (!slug || !reason) throw new Error('dùng: ff relock <slug> --reason "lý do"')
      const { root, config, wt } = setup(ctx, slug); const manifest = path.join(wt, '.ff-test-lock' + options.suffix)
      const log = manifest + '.log'; assertLocalTarget(wt, manifest); assertLocalTarget(wt, log)
      if (!fs.existsSync(manifest)) throw new Error('chưa khóa; dùng ff lock-tests trước')
      const old = fs.readFileSync(manifest)
      const entries = old.toString().split(/\r?\n/).filter(Boolean).map((line) => {
        const match = line.match(/^([a-f0-9]{64})  (.+)$/)
        if (!match) throw new Error('manifest hỏng')
        return { hash: match[1], rel: match[2], abs: path.resolve(root, match[2]) }
      })
      if (args.includes('--open')) {
        if (args.includes('--add')) throw new Error('--open không đi cùng --add')
        const named = args.slice(1).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--reason')
        const targets = named.length ? named.map((f) => testFile(root, config, wt, f)) : entries.map((e) => e.abs)
        const picked = targets.map((abs) => entries.find((e) => e.abs === abs) ?? (() => { throw new Error(`không có trong manifest: ${path.relative(root, abs)}; file mới thì thêm bằng ff relock <slug> --reason "…" --add <file>`) })())
        const win = path.join(wt, unlockName(options.suffix)); assertLocalTarget(wt, win)
        fs.writeFileSync(win, `ts=${Math.floor(Date.now() / 1000)}\n${picked.map((e) => e.rel).join('\n')}\n`, { mode: 0o600 })
        for (const e of picked) fs.chmodSync(e.abs, fs.statSync(e.abs).mode | 0o200)
        fs.appendFileSync(log, `${new Date().toISOString()} | ${reason} | mở cửa sổ sửa: ${picked.map((e) => e.rel).join(', ')} | ${sha(old).slice(0, 8)}\n`)
        ctx.stdout.write(`Đã mở cửa sổ sửa ${picked.length} file test trong ${UNLOCK_TTL_S / 60} phút:\n${picked.map((e) => `  ${e.rel}\n`).join('')}Sửa bằng Edit/Write rồi chạy: ff relock ${slug}${options.revision ? ` --revision ${options.revision}` : ''} --reason "…" để băm lại và khóa.\n`)
        return 0
      }
      const addIndex = args.indexOf('--add')
      const added = addIndex < 0 ? [] : args.slice(addIndex + 1).filter((arg, i, all) => !arg.startsWith('--') && !all.slice(0, i).some((a) => a.startsWith('--')))
      if (addIndex >= 0 && !added.length) throw new Error('--add cần danh sách file mới')
      if (addIndex >= 0) {
        // Positionals after the --add list (e.g. after --reason "…") would otherwise be dropped silently.
        const tail = args.slice(addIndex + 1 + added.length)
        const stray = tail.filter((arg, i) => !arg.startsWith('--') && tail[i - 1] !== '--reason')
        if (stray.length) throw new Error(`--add: không hiểu tham số ${stray.join(', ')}; đặt mọi file ngay sau --add (trước các cờ khác)`)
      }
      const e2eRoots = [config.e2e?.dir, config.e2e?.tests_dir].filter((v) => typeof v === 'string' && v).map((v) => path.resolve(root, v))
      for (const entry of entries) {
        if (!inside(root, entry.abs) || !fs.existsSync(entry.abs) || !inside(fs.realpathSync(root), fs.realpathSync(entry.abs)))
          throw new Error(`file khóa không tồn tại trong workspace: ${entry.rel}`)
        if (added.length && sha(fs.readFileSync(entry.abs)) !== entry.hash) throw new Error(`--add không được cập nhật hash test cũ đã đổi: ${entry.rel}`)
      }
      const changes = [], notes = []
      for (const file of added) {
        const abs = testFile(root, config, wt, file)
        if (!inside(root, abs) || !fs.existsSync(abs) || !inside(fs.realpathSync(root), fs.realpathSync(abs)) || !fs.statSync(abs).isFile()) throw new Error(`file mới không hợp lệ: ${file}`)
        if (e2eRoots.length && !inside(wt, abs) && !e2eRoots.some((dir) => inside(dir, abs))) throw new Error(`--add từ chối ${file}: nằm ngoài worktree của thẻ và thư mục e2e; không thêm vào manifest`)
        if (entries.some((entry) => entry.abs === abs)) { notes.push(`đã có trong manifest, bỏ qua: ${path.relative(root, abs).split(path.sep).join('/')}`); continue }
        const rel = path.relative(root, abs).split(path.sep).join('/')
        entries.push({ abs, rel, hash: sha(fs.readFileSync(abs)) })
        changes.push(`thêm ${rel}`)
      }
      let body
      try {
        for (const entry of entries) {
          fs.chmodSync(entry.abs, fs.statSync(entry.abs).mode | 0o200)
          const nextHash = sha(fs.readFileSync(entry.abs))
          if (nextHash !== entry.hash) changes.push(`cập nhật ${entry.rel}`)
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
      const openWindow = readUnlock(wt, options.suffix)
      if (openWindow) fs.rmSync(path.join(wt, unlockName(options.suffix)), { force: true })
      fs.appendFileSync(log, `${new Date().toISOString()} | ${reason} | ${changes.join(', ') || 'không đổi'}${openWindow ? ' | đóng cửa sổ sửa' : ''} | ${sha(old).slice(0, 8)}→${sha(body).slice(0, 8)}\n`)
      for (const note of notes) ctx.stdout.write(`${note}\n`)
      if (!changes.length) ctx.stdout.write(`Relock xong: không có file nào thay đổi; manifest giữ nguyên${openWindow ? '; đã đóng cửa sổ sửa' : `. Muốn sửa test đã khóa: ff relock ${slug} --open --reason "…" [file…] (user cho phép) → sửa bằng Edit/Write → ff relock lại`}\n`)
      else ctx.stdout.write(`Relock xong: ${changes.length} file thay đổi (${changes.join(', ')})\n`)
      return 0
    } catch(e){ctx.stderr.write(`ff relock: ${e.message}\n`);return 1}
  },
}
export const probeSlice = {
  summary: 'probe-slice <slug> [task] [--json] — so thay đổi với allowlist',
  async run(args,ctx){
    try{
      const slug=args[0], json=args.includes('--json'), root=findRoot(ctx.cwd); if(!root||!slug)throw new Error('dùng: ff probe-slice <slug> [task] [--json]')
      const {config}=loadConfig(root);if(slug.includes('/')||slug.includes('\\')||slug==='.'||slug==='..'||isTestDirName(slug))throw new Error('slug không hợp lệ');const worktrees=path.resolve(root,config.workspace.worktrees_dir),wt=path.resolve(worktrees,slug);if(!inside(worktrees,wt)||!fs.existsSync(wt)||!inside(fs.realpathSync(worktrees),fs.realpathSync(wt)))throw new Error(`không thấy worktree hợp lệ ${slug}`)
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
        const candidates=branch&&branch!=='HEAD'&&branch!==repo.base_branch?[`ff-local/${branch}`,`origin/${branch}`,`ff-local/${repo.base_branch}`,`origin/${repo.base_branch}`,repo.base_branch]:[`ff-local/${repo.base_branch}`,`origin/${repo.base_branch}`,repo.base_branch]
        const cardDir=path.resolve(root,config.workspace.cards_dir,slug)
        const revisionBase=fs.existsSync(cardDir)?readRevisionBase(cardDir,repo.name,dir):null
        let base=revisionBase?.sha??null
        if(!base){
        for(const ref of candidates){if(gitRun(dir,['rev-parse','--verify',ref]).status===0){base=ref;break}}
        }
        if(!base)throw new Error(`không xác định được baseline của ${repoName}`)
        const merge=gitRun(dir,['merge-base','HEAD',base]);if(merge.status!==0||!merge.stdout.trim())throw new Error(`merge-base lỗi trong ${repoName}`)
        const diff=gitRun(dir,['diff','--name-only',`${merge.stdout.trim()}..HEAD`]);if(diff.status!==0)throw new Error(`git diff lỗi trong ${repoName}`);for(const p of diff.stdout.split(/\r?\n/))add(repoName,p.trim())
      }
      const unique=[...new Set(changed)].sort(), violations=unique.filter(f=>!allowed.has(f)), status=!unique.length?'NO_CHANGES':violations.length?'ALLOWLIST_VIOLATION':'DRIFT_CLEAN';const out={status,slug,task:args.find(a=>a!==slug&&!a.startsWith('--'))??null,allowlist:{exists:fs.existsSync(allowedFile),expired,files:[...allowed]},changedFiles:unique,violations,isClean:status!=='ALLOWLIST_VIOLATION'}
      ctx.stdout.write(json?JSON.stringify(out,null,2)+'\n':`${status}: ${unique.length} file thay đổi${violations.length?`; ngoài allowlist: ${violations.join(', ')}`:''}\n`);return out.isClean?0:1
    }catch(e){ctx.stderr.write(`ff probe-slice: ${e.message}\n`);return 1}
  },
}
