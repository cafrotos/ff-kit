// Luật chặn dùng chung cho Claude Code, OpenCode, agy. Đọc repo/worktree/e2e từ ff.config.yaml.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { stripHeredocs, segments, headTokens, redirections, tokenize } from './shell.mjs'
import { realish } from './paths.mjs'
import { ARTIFACT_GATE, hasMarker, isApproved, ledgerFor } from './gates.mjs'
import { isTestDirName } from './code-dir.mjs'
import { validateAutoBinding } from './auto-ship.mjs'
import { readUnlock, UNLOCK_NAME_RE } from './test-unlock.mjs'
import { readVerifyLock, verifyLockPath } from './verify-lock.mjs'

const SHIP_MARKER_TTL_S = 2 * 60 * 60
const ALLOW_TTL_S = 4 * 60 * 60
export const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'edit', 'write', 'patch', 'apply_patch', 'edit_file', 'write_file', 'multiedit', 'replace_file_content', 'multi_replace_file_content', 'write_to_file']
const WRAPPER_RE = /\b(?:ba|z)?sh\s+-\w*c\b|\beval\b|\$\(|`|\bxargs\b/
// `ff reopen … --supersede` bỏ một revision chưa xong: cũng luôn hỏi người.
const FF_ASK_RE = /(?:^|[\s/])ff\s+(?:ship-approve|relock|worker\s+resolve|evolve\s+apply|reopen\b[^|;&\n]*\s--supersede)\b/
// `ff ship-approve <slug> --auto` không hỏi người: CLI tự kiểm Gate C auto_passed + ràng buộc HEAD/ship_branch.
const FF_AUTO_APPROVE_RE = /(?:^|[\s/])ff\s+ship-approve\s+[A-Za-z0-9._-]+\s+--auto\s*$/
const FF_HELP_RE = /(?:^|[\s/])ff\s+(?:ship-approve|relock|worker\s+resolve|evolve\s+apply)\s+(?:--help|-h)\s*$/
const INTERPRETERS = new Set(['python', 'python3', 'node', 'perl', 'ruby', 'deno', 'bun', 'bash', 'sh', 'zsh', 'eval', 'source', '.'])
const SUBST_RE = /\$\(|`|<\(/
const COPY_LIKE = new Set(['cp', 'mv', 'install', 'rsync', 'ln'])
const EDIT_LIKE = new Set(['tee', 'truncate', 'rm', 'chmod', 'chflags', 'touch'])
const INPLACE = new Set(['sed', 'perl'])
const normalizedTokens = (seg, onDirectory) => {
  const tokens = headTokens(seg, onDirectory)
  if (tokens.length) tokens[0] = path.basename(tokens[0])
  return tokens
}
const isFfCall = (seg) => {
  const head = headTokens(seg)[0] ?? ''
  return (head === 'ff' || head.endsWith('/ff')) && !SUBST_RE.test(seg)
}

// Đường dẫn mà 1 đoạn lệnh GHI vào (ước lượng): đích redirect, đích cp/mv, đối số tee/rm/…, file của sed -i/perl -i,
// và các đường dẫn tường minh trong lệnh thông dịch chưa được cấu hình. Lệnh đọc thông thường không tính là ghi.
function writeTargets(seg, tokens, inferOpaque = true) {
  const redirects = redirections(seg)
  const out = redirects.filter((r) => r.write).map((r) => ({ target: r.target, shell: true }))
  let command = seg
  for (const r of [...redirects].reverse()) command = command.slice(0, r.start) + command.slice(r.end)
  const [head, ...rest] = normalizedTokens(command)
  const args = rest.filter((t) => !t.startsWith('-'))
  if (COPY_LIKE.has(head) && args.length) {
    const targetFlag = rest.findIndex((t) => t === '-t' || t === '--target-directory')
    out.push(targetFlag >= 0 ? rest[targetFlag + 1] : rest.find((t) => t.startsWith('--target-directory='))?.split('=').slice(1).join('=') ?? args[args.length - 1])
    if (head === 'mv') out.push(...args) // Moving a locked source also changes it.
  }
  if (EDIT_LIKE.has(head)) out.push(...args)
  if (INPLACE.has(head) && rest.some((t) => /^-\w*i/.test(t) || t.startsWith('--in-place'))) out.push(...args)
  if (inferOpaque && INTERPRETERS.has(tokens[0])) {
    out.push(...args, ...[...seg.matchAll(/(['"])([^'"\n]+)\1/g)].map((m) => m[2]))
  }
  return out.filter(Boolean).map((target) => typeof target === 'string' ? { target, shell: false } : target)
}

// Read substitution boundaries without treating quoted separators/parentheses as
// shell syntax. Bodies are checked recursively by the ordinary command policy.
function commandSubstitutions(src) {
  const bodies = [], spans = []
  let complete = true
  function scan(start, close = null, level = 0) {
    if(level > 16){complete=false;return src.length}
    let quote = null, parens = 0
    for(let i=start;i<src.length;i++){
      const c=src[i]
      if(c==='\\' && quote!=="'"){i++;continue}
      if(quote==="'"){if(c==="'")quote=null;continue}
      if(close==='`' && c==='`' && !quote)return i
      if((c==='$' && src[i+1]==='(') || c==='`'){
        const offset=c==='`'?1:2, ending=c==='`'?'`':')'
        const end=scan(i+offset,ending,level+1)
        if(!close){bodies.push(src.slice(i+offset,end));spans.push([i,Math.min(end+1,src.length)])}
        i=end;continue
      }
      if(quote==='"'){if(c==='"')quote=null;continue}
      if(c==='"'||c==="'"){quote=c;continue}
      if(close===')'){
        if(c==='(')parens++
        if(c===')'){if(!parens)return i;parens--}
      }
    }
    if(close)complete=false
    return src.length
  }
  scan(0)
  return {bodies,spans,complete}
}

// Thay `$(…)`/`…` ở cấp ngoài bằng placeholder để tách đoạn lệnh đúng; thân được kiểm riêng (đệ quy).
const SUBST_PH = '__ffsubst__'
function maskSubst(cmd) {
  const src = stripHeredocs(cmd)
  const { bodies, spans, complete } = commandSubstitutions(src)
  if (!complete || !bodies.length) return { text: src, bodies: [], complete }
  let text = '', at = 0
  for (const [a, b] of spans) { text += src.slice(at, a) + SUBST_PH; at = b }
  return { text: text + src.slice(at), bodies, complete }
}
// Mã nội tuyến của thông dịch viên có dấu hiệu ghi/chạy lệnh/mạng? (tĩnh, không phải sandbox)
const WRITEY_RE = /\w*(?:write|appendFile)\w*|\b(?:unlink|rmdir|rmtree|rmSync|rm|remove\w*|rename\w*|truncate|ftruncate|chmod|chown|mkdir\w*|makedirs|symlink\w*|link|utime\w*|touch|copyFile\w*|cpSync|shutil|popen|spawn\w*|fork|exec\w*|system|subprocess|child_process|eval|__import__|importlib|getattr|setattr|ctypes|socket|urllib|requests|fetch|http|https|net|pickle|sqlite3|tempfile|kill|Function)\b|\b(?:os|fs|io)\.(?:open|replace)\b|\bopen\s*\([^)]*,\s*['"`][^'"`]*[wax+]/
const codeLooksReadOnly = (code) => !!code && !WRITEY_RE.test(code.replace(/\b(?:sys|process)\.std(?:out|err)\.write\b/g, ''))
const heredocBodies = (cmd) => {
  const out = []
  let delim = null, cur = []
  for (const line of cmd.split('\n')) {
    if (delim) { if (line.trim() === delim) { out.push(cur.join('\n')); delim = null; cur = [] } else cur.push(line); continue }
    const m = line.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/)
    if (m) delim = m[2]
  }
  return out.join('\n')
}
const INLINE_FLAG = { python: /^-c$/, python3: /^-c$/, node: /^(?:-e|-p|-pe|--eval|--print)$/, perl: /^-[A-Za-z]*[eE]$/, ruby: /^-e$/ }
const XARGS_READ = new Set(['grep', 'egrep', 'fgrep', 'rg', 'cat', 'ls', 'head', 'tail', 'wc', 'file', 'stat', 'sort', 'uniq', 'diff', 'cut', 'basename', 'dirname', 'echo', 'printf', 'realpath'])
// ls/find/stat… chỉ liệt kê tên, không đọc nội dung file.
const NAME_ONLY = new Set(['ls', 'dir', 'tree', 'stat', 'test', '[', '[['])
const nameOnly = (tokens) => NAME_ONLY.has(tokens[0]) || (tokens[0] === 'find' && !tokens.some((t) => /^-(?:exec|execdir|ok|okdir|delete|fprint0?|fprintf|fls)$/.test(t)))
const xargsReadOnly = (tokens) => {
  let i = 1
  while (i < tokens.length && tokens[i].startsWith('-')) i += /^-[INPLdsEa]$/.test(tokens[i]) ? 2 : 1
  return XARGS_READ.has(path.basename(tokens[i] ?? ''))
}
const KILL_RE = /^(?:\S*\/)?kill\s+(?:-(?:\d+|[A-Z][A-Z0-9]*)\s+|-s\s+\S+\s+)?((?:(?:\d+|\$\(\s*cat\s+(?:"[^"$`]+"|'[^'$`]+'|[^\s"'$`()|;&<>]+)\s*\)|`\s*cat\s+[^\s`$]+\s*`)\s*)+)$/
const PROTECTED_PROC_RE = /ff-worker|ff-kit|\bff\s|\/ff\s|dist\/(?:cli|guard)\.mjs|\bclaude\b|\btmux\b/
const tokenizeFirst = (x) => tokenize(x)[0] ?? ''
const procParent = (pid) => { try { return Number(fs.readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\)\s+/, '').split(' ')[1]) } catch { return 0 } }

const under = (p, dir) => (p + path.sep).startsWith(dir + path.sep)
const expandHome = (p) => (p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p)
const unanchor = (s) => s.replace(/^\^/, '').replace(/\$$/, '')
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function makeGuard(rootIn, config, env = process.env) {
  const root = realish(rootIn)
  const g = config.guard
  const relWt = config.workspace.worktrees_dir
  const worktrees = realish(path.resolve(root, relWt))
  const repoRoots = [...config.repos.map((r) => r.path), ...(g.protected_paths ?? [])].map((p) => realish(path.resolve(root, p)))
  const str = (v) => (typeof v === 'string' && v ? v : null)
  const e2eDir = str(config.e2e?.dir) ? path.resolve(root, config.e2e.dir) : null
  const e2eTests = str(config.e2e?.tests_dir) ? path.resolve(root, config.e2e.tests_dir) : null
  const testsRel = e2eDir && e2eTests ? path.relative(e2eDir, e2eTests).split(path.sep).join('/') : null
  const migRe = new RegExp(g.migration_script_re)
  const prodRe = new RegExp(g.forbidden_script_re)
  const allowedBash = (g.allowed_bash ?? []).map((s) => new RegExp(s))
  const forbiddenRes = [
    /\bgit\s+(?:-C\s+\S+\s+)?push\b/,
    ...(config.worker?.driver?.enabled ? [/\bgh\s+[^;|&\n]*?\bpr\s+(?:create|merge)\b/] : []),
    /\bgit\s+(?:-C\s+\S+\s+)?stash\b/,
    /\bgit\s+(?:-C\s+\S+\s+)?add\s+(?:-A|--all|\.)(?=\s|$|["'`)])/,
    /\bcommit\s+(?:-a\w*|--all)(?=\s|$|["'`)])/,
    /(?:^|[\s;&|`("'])(?:kill|pkill|killall)(?=\s|$|["'`)])/,
    new RegExp(unanchor(g.migration_script_re)),
    new RegExp(unanchor(g.forbidden_script_re) + '\\b'),
  ]

  const resolveDir = (base, p) => realish(path.resolve(base, expandHome(p)))
  const inRootRepo = (p) => repoRoots.some((r) => under(p, r))
  const inWorktree = (p) => under(p, worktrees)
  const slugOf = (p) => {
    if (inWorktree(p)) return path.relative(worktrees, p).split(path.sep)[0] || null
    if (e2eTests && under(p, e2eTests)) {
      const parts = path.relative(e2eTests, p).split(path.sep)
      return parts.length > 1 && /^[A-Za-z0-9]+-.+$/.test(parts[0]) ? parts[0] : null
    }
    return null
  }
  const isEdit = (tool) => !tool || EDIT_TOOLS.includes(tool)

  const lockEntriesOf = (slug) => {
    let manifests = []
    try {
      manifests = fs.readdirSync(path.join(worktrees, slug)).filter((name) => /^\.ff-test-lock(?:\.rev-\d+)?$/.test(name))
    } catch {}
    return manifests.flatMap((name) => {
      const suffix = name.match(/(\.rev-\d+)$/)?.[1] ?? ''
      const win = readUnlock(path.join(worktrees, slug), suffix)
      const open = new Set(win?.active ? win.files.map((f) => realish(path.join(root, f))) : [])
      try { return fs.readFileSync(path.join(worktrees, slug, name), 'utf8').split('\n')
        .map((l) => l.match(/^[0-9a-f]{64}\s{2}(.+)$/)).filter(Boolean).map((m) => ({ file: realish(path.join(root, m[1])), revision: suffix.slice(1) }))
        .filter((e) => !open.has(e.file))
      } catch { return [] }
    })
  }
  // File test đang trong cửa sổ sửa (đã được user duyệt qua `ff relock <slug> --open`).
  const inUnlockWindow = (abs) => {
    const slug = slugOf(abs)
    if (!slug) return false
    let names = []
    try { names = fs.readdirSync(path.join(worktrees, slug)).filter((n) => UNLOCK_NAME_RE.test(n)) } catch {}
    return names.some((n) => {
      const win = readUnlock(path.join(worktrees, slug), n.replace('.ff-test-unlock', ''))
      return win?.active && win.files.some((f) => realish(path.join(root, f)) === abs)
    })
  }
  const lockedOf = (slug) => lockEntriesOf(slug).map((entry) => entry.file)
  const allLocked = () => {
    let slugs = []
    try { slugs = fs.readdirSync(worktrees).filter((name) => !isTestDirName(name)) } catch {}
    return slugs.flatMap(lockedOf)
  }
  const lockMsg = (slug, abs) => {
    const revision = slug ? lockEntriesOf(slug).find((entry) => entry.file === abs)?.revision : ''
    const s = `${slug ?? '<slug>'}${revision ? ` --revision ${revision}` : ''}`
    return `file test đã khóa. Muốn sửa: xin user cho phép \`ff relock ${s} --open --reason "…" [file…]\` (mở cửa sổ sửa 60 phút cho đúng file đó), sửa bằng Edit/Write, rồi \`ff relock ${s} --reason "…"\` để băm lại và khóa. Chạy \`ff relock\` không có --open trước khi sửa sẽ không mở khóa gì.`
  }

  const cardsDir = realish(path.resolve(root, config.workspace.cards_dir))
  const ffDirAbs = realish(path.join(root, '.ff'))
  const secretFiles = [config.secrets.env_file, config.db?.env_file, config.e2e?.auth?.jwt?.secret?.file, config.e2e?.auth_storage, '.ff/worker.json'].filter(Boolean)
  const secretAbs = new Set(secretFiles.map((f) => realish(path.resolve(root, f))))
  const secretRes = secretFiles.map((f) => new RegExp(`(^|[\\s<>='"/])${escapeRe(path.basename(f))}(?![\\w.-])`))
  const secretMsg = `Không đọc, sửa hay chép file secret (${secretFiles.join(', ')}). Cần biết key có hay chưa → \`ff doctor\`.`

  const metadataMessage = '`.ff/` và metadata `.ff-*` do hook và lệnh `ff` ghi; agent không sửa trực tiếp.'
  const protectedMetadata = (abs) => under(abs, ffDirAbs) || (inWorktree(abs) && path.basename(abs).startsWith('.ff-'))

  // Config is written by /ff-init (an interactive session). A worker-launched card session (FF_CARD_ID/FF_RUN_ID)
  // never runs /ff-init, so there the agent may not hand-edit it; the hook cannot tell skills apart otherwise.
  const configAbs = new Set(['ff.config.yaml', 'ff.config.lock.json'].map((f) => realish(path.join(root, f))))
  const workerSession = /^[A-Za-z0-9]+$/.test(env?.FF_CARD_ID ?? '') && !!env?.FF_RUN_ID
  const configMessage = 'Agent không sửa `ff.config.yaml` / `ff.config.lock.json` trực tiếp (schema sẽ từ chối bản sửa tay); thay đổi cấu hình do người dùng chạy /ff-kit:ff-init.'
  const protectedConfig = (abs, mode) => mode === 'feature-flow' && workerSession && configAbs.has(abs)

  function permittedConfigured(seg, dir) {
    // Trust only the exact configured build/test command in its configured directory.
    // A matching prefix must never exempt added redirects or follow-up mutations.
    if (config.repos.some((repo) => {
      const slug = slugOf(dir)
      const target = slug ? realish(path.join(worktrees, slug, path.basename(repo.path))) : null
      return target === dir && ['build', 'test', 'lint', 'typecheck'].some((key) => repo.commands?.[key]?.trim() === seg.trim())
    })) return true
    return dir === e2eDir && config.e2e?.test_cmd?.trim() === seg.trim()
  }

  // PID do ff quản (worker, service verify), tổ tiên của hook, hoặc tiến trình ff/claude/tmux: không được kill từ agent.
  function protectedPids() {
    const set = new Set([1, process.pid])
    for (let p = process.ppid, n = 0; p > 1 && n < 32; p = procParent(p), n++) set.add(p)
    try { const w = JSON.parse(fs.readFileSync(path.join(root, '.ff/worker.json'), 'utf8')); if (Number.isInteger(w?.pid)) set.add(w.pid) } catch {}
    const lock = readVerifyLock(verifyLockPath(root, config))
    for (const pid of [lock?.pid, ...(lock?.services ?? []).map((x) => x?.pid)]) if (Number.isInteger(pid)) set.add(pid)
    return set
  }
  const KILL_HELP = 'Service của ff tắt bằng `ff verify-down <id>`; tiến trình khác của repo gốc/task khác → báo user.'
  // undefined: không phải dạng `kill [-SIG] <pid|$(cat pidfile)>`; null: cho qua; string: lý do chặn.
  function killVerdict(seg, dir) {
    const m = seg.match(KILL_RE)
    if (!m) return undefined
    const pids = []
    for (const item of m[1].match(/\d+(?![^()`]*[)`])|\$\(\s*cat\s+[^)]+\)|`[^`]+`/g) ?? []) {
      if (/^\d+$/.test(item)) { pids.push(Number(item)); continue }
      const file = tokenizeFirst(item.replace(/^\$\(\s*cat\s+|^`\s*cat\s+|\)$|`$/g, '').trim())
      const abs = resolveDir(dir, file)
      if (secretAbs.has(abs) || under(abs, ffDirAbs)) return `Không đọc pidfile trong .ff/ hoặc file secret để kill. ${KILL_HELP}`
      let text
      try { text = fs.readFileSync(abs, 'utf8') } catch { return `Không đọc được pidfile ${file}; kill theo PID số, hoặc ${KILL_HELP}` }
      const found = text.split(/\s+/).filter(Boolean)
      if (!found.length || found.length > 8 || !found.every((x) => /^\d+$/.test(x))) return `Pidfile ${file} không phải danh sách PID số; ${KILL_HELP}`
      pids.push(...found.map(Number))
    }
    if (!pids.length) return `Không kill nếu không có PID số rõ ràng. ${KILL_HELP}`
    const prot = protectedPids()
    for (const pid of pids) {
      if (pid <= 1 || prot.has(pid)) return `PID ${pid} thuộc worker/ff/phiên hiện tại — không kill. ${KILL_HELP}`
      let cmdline = ''
      try { cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ') } catch {}
      if (PROTECTED_PROC_RE.test(cmdline)) return `PID ${pid} là tiến trình ff/claude/tmux — không kill. ${KILL_HELP}`
    }
    return null
  }

  function checkBashNew(cmd, cwd, mode, depth = 0) {
    const locked = allLocked()
    const configuredCommand = permittedConfigured(cmd, cwd)
    const masked = maskSubst(cmd)
    const useMask = masked.complete && masked.bodies.length > 0 && depth < 8
    if (useMask) for (const inner of masked.bodies) {
      const reason = checkBashNew(inner, cwd, mode, depth + 1)
      if (reason) return reason
    }
    let dir = cwd
    for (const seg of segments(useMask ? masked.text : cmd)) {
      let execDir = dir
      const tokens = normalizedTokens(seg, (p) => { execDir = resolveDir(execDir, p) })
      const ff = isFfCall(seg)
      const configured = configuredCommand || permittedConfigured(seg, execDir)
      const listing = nameOnly(tokens)
      if (!ff && (!listing && (secretRes.some((re) => re.test(seg)) || tokens.slice(1).some((t) => secretAbs.has(resolveDir(execDir, t)))) || redirections(seg).some((r) => secretAbs.has(resolveDir(dir, r.target))))) return secretMsg
      // Thông dịch viên đọc-thuần (mã nội tuyến/heredoc không có dấu hiệu ghi) và `bash -c` (thân kiểm đệ quy) không còn mờ đục.
      const inlineAt = INLINE_FLAG[tokens[0]] ? tokens.findIndex((t, k) => k > 0 && INLINE_FLAG[tokens[0]].test(t)) : -1
      const bareStdin = INLINE_FLAG[tokens[0]] && inlineAt < 0 && tokens.slice(1).every((t) => t.startsWith('-') || /^\d*[<>]/.test(t)) && /<</.test(seg)
      const code = inlineAt >= 0 ? tokens[inlineAt + 1] : bareStdin ? heredocBodies(cmd) : null
      const inplace = tokens[0] === 'perl' && tokens.some((t) => /^-\w*i/.test(t))
      const readOnlyInterp = !inplace && codeLooksReadOnly(code)
      if (!ff && INTERPRETERS.has(tokens[0]) && code) {
        const strings = [...code.matchAll(/(['"`])([^'"`\n]+)\1/g)].map((m) => m[2])
        if (secretRes.some((re) => re.test(code)) || strings.some((q) => secretAbs.has(resolveDir(execDir, q)))) return secretMsg
      }
      const shellAt = ['bash', 'sh', 'zsh'].includes(tokens[0]) ? tokens.findIndex((t, k) => k > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(t)) : -1
      if (shellAt >= 0 && tokens[shellAt + 1] && depth < 8) {
        const reason = checkBashNew(tokens[shellAt + 1], execDir, mode, depth + 1)
        if (reason) return reason
      }
      const innerShell = shellAt >= 0 && !!tokens[shellAt + 1] && depth < 8
      for (const t of writeTargets(seg, tokens, !configured && !readOnlyInterp && !innerShell)) {
        const abs = resolveDir(t.shell ? dir : execDir, t.target)
        if (secretAbs.has(abs)) return secretMsg
        if (protectedMetadata(abs)) return metadataMessage
        if (protectedConfig(abs, mode)) return configMessage
        const hit = locked.find((l) => under(l, abs))
        if (hit) return lockMsg(slugOf(hit), hit)
        const allowReason = checkAllowlist('Write', abs)
        if (allowReason) return allowReason
        if (under(abs, cardsDir) && ARTIFACT_GATE[path.basename(abs)])
          return `Không ghi ${path.basename(abs)} bằng Bash (sed/tee/echo >/python…). Dùng công cụ Edit hoặc Write trên đúng file ${path.relative(root, abs)} để hook kiểm Gate.`
        if (mode === 'feature-flow' && !INTERPRETERS.has(tokens[0])) {
          const mirrorReason = checkMirrorFile('Write', abs)
          if (mirrorReason) return mirrorReason
        }
      }
      const substHead = tokens[0]?.includes(SUBST_PH) || writeTargets(seg, tokens, false).some((t) => t.target.includes(SUBST_PH))
      const rawSubst = SUBST_RE.test(seg)
      const opaque = (INTERPRETERS.has(tokens[0]) && !readOnlyInterp && !innerShell) || rawSubst || substHead || (tokens[0] === 'xargs' && !xargsReadOnly(tokens))
      const versionOnly = INTERPRETERS.has(tokens[0]) && tokens.length === 2 && ['-v', '-V', '--version'].includes(tokens[1])
      // Hooks see shell text, not runtime filesystem effects. With active constraints,
      // opaque code must use exact configured checks or the trusted ff CLI instead.
      if (!ff && opaque && !versionOnly && !configured && (locked.length || activeAllowlist(execDir)))
        return 'Lệnh thông dịch/bọc không xác định được file ghi khi test đã khóa hoặc allowlist còn hiệu lực; dùng Edit/Write, lệnh build/test đã cấu hình, hoặc `ff`. Lệnh chỉ đọc (grep/ls/cat/git log, `python3 -c`/`node -e` không ghi file, `$(…)` chứa lệnh đọc) vẫn được qua; script file thì chạy qua lệnh build/test đã cấu hình.'
      if (tokens[0] === 'cd') dir = resolveDir(execDir, tokens[1] ?? os.homedir())
    }
    return null
  }

  function resultingContent(tool, input, abs) {
    let old = ''
    try { old = fs.readFileSync(abs, 'utf8') } catch {}
    if (['Write', 'write', 'write_file', 'write_to_file'].includes(tool)) return { old, next: String(input.content ?? input.CodeContent ?? '') }
    if (tool === 'NotebookEdit') return { old, next: String(input.new_source ?? '') + '\n' + old }
    let next = old
    const edits = input.edits ?? input.ReplacementChunks
    for (const e of Array.isArray(edits) ? edits : [input]) {
      const o = String(e?.old_string ?? e?.oldString ?? e?.TargetContent ?? '')
      const n = String(e?.new_string ?? e?.newString ?? e?.ReplacementContent ?? '')
      if (!o) next = n + next
      else next = e?.replace_all ? next.split(o).join(n) : next.replace(o, () => n)
    }
    return { old, next }
  }

  function checkFileNew(tool, input, abs) {
    if (secretAbs.has(abs)) return secretMsg
    if (!isEdit(tool)) return null
    if (protectedMetadata(abs)) return metadataMessage
    if (!under(abs, cardsDir)) return null
    const gate = ARTIFACT_GATE[path.basename(abs)]
    if (!gate) return null
    const rel = path.relative(cardsDir, abs).split(path.sep)
    if (path.basename(abs) === 'delta.md' && !/^rev-\d+$/.test(rel[1] ?? '')) return null
    if (['patch', 'apply_patch'].includes(tool))
      return 'Sửa artifact Gate bằng Edit/Write để hook kiểm nội dung marker và biên nhận duyệt.'
    const { next } = resultingContent(tool, input, abs)
    if (!hasMarker(next)) return null
    const cardId = rel[0].split('-')[0]
    const scope = rel.slice(1, -1).join('/')
    let ledger = null
    try { ledger = ledgerFor(path.join(cardsDir, rel[0]), scope) } catch {}
    if (isApproved(root, cardId, gate, rel.slice(1).join('/'), next, ledger)) return null
    const scopeTags = scope ? ' ' + scope.split('/').map((part) => `[${part}]`).join(' ') : ''
    return `Chưa có câu trả lời "Duyệt" cho ${gate} của thẻ #${cardId} khớp nội dung hiện tại. Trình Gate bằng AskUserQuestion (header ${gate}, câu hỏi bắt đầu "[#${cardId}]${scopeTags}", lựa chọn "Duyệt"/"Cần sửa") rồi mới ghi marker ĐÃ DUYỆT; sửa nội dung sau khi duyệt thì phải bỏ marker và trình lại.`
  }

  function checkLockedFile(tool, abs) {
    if (!isEdit(tool)) return null
    const slug = slugOf(abs)
    if (!slug) return null
    return lockedOf(slug).includes(abs) ? lockMsg(slug, abs) : null
  }

  function activeAllowlist(abs) {
    if (!inWorktree(abs)) return null
    const slug = slugOf(abs)
    if (!slug) return null
    let lines
    try { lines = fs.readFileSync(path.join(worktrees, slug, '.ff-allow'), 'utf8').split('\n') } catch { return null }
    const ts = Number((lines[0] ?? '').match(/^ts=(\d+)$/)?.[1])
    if (!Number.isFinite(ts) || Date.now() / 1000 - ts > ALLOW_TTL_S) return null
    return { slug, files: lines.slice(1).map((l) => l.trim()).filter(Boolean) }
  }

  function checkAllowlist(tool, abs) {
    if (!isEdit(tool)) return null
    if (inWorktree(abs) && isTestDirName(slugOf(abs) ?? '')) return 'checkout verify (<slug>.test) do `ff ship-test` dựng; không sửa trực tiếp — sửa trong bản copy của thẻ rồi chạy lại ff ship-test'
    const allow = activeAllowlist(abs)
    if (!allow || inUnlockWindow(abs)) return null
    const { slug, files } = allow
    const rel = path.relative(path.join(worktrees, slug), abs).split(path.sep).join('/')
    if (files.includes(rel)) return null
    return `file ngoài allowlist của đợt; thêm qua: ff allow ${slug} <file>`
  }

  function parseGit(tokens, dir) {
    let gitDir = dir
    let i = 1
    while (i < tokens.length && tokens[i].startsWith('-')) {
      const flag = tokens[i]
      if (flag === '-C') gitDir = resolveDir(gitDir, tokens[++i] ?? '.')
      else if (flag.startsWith('-C') && flag.length > 2) gitDir = resolveDir(gitDir, flag.slice(2))
      else if (flag === '--work-tree' || flag.startsWith('--work-tree='))
        gitDir = resolveDir(dir, flag === '--work-tree' ? tokens[++i] ?? '.' : flag.slice('--work-tree='.length))
      else if (flag === '--git-dir' || flag.startsWith('--git-dir=')) {
        const gitPath = resolveDir(dir, flag === '--git-dir' ? tokens[++i] ?? '.' : flag.slice('--git-dir='.length))
        gitDir = path.basename(gitPath) === '.git' ? path.dirname(gitPath) : gitPath
      }
      else if (flag === '-c' || flag === '--namespace') i++
      i++
    }
    return { sub: tokens[i], args: tokens.slice(i + 1), gitDir }
  }

  function localOnly(dir) {
    const localOnly = spawnSync('git', ['-C', dir, 'config', '--local', '--bool', '--get', 'ff.localOnly'], { encoding: 'utf8', timeout: 2000 })
    return localOnly.status === 0 && localOnly.stdout.trim() === 'true'
  }

  function shipApproved(dir) {
    if (localOnly(dir))
      return { ok: false, why: 'bản copy quan sát local-only (ff.localOnly=true)' }
    const slug = slugOf(dir)
    if (!slug || !inWorktree(dir)) return { ok: false, why: `lệnh không chạy trong ${relWt}/<id>-<slug>/` }
    const marker = path.join(worktrees, slug, '.ff-ship-approved')
    if (!fs.existsSync(marker)) return { ok: false, why: `chưa có ${path.relative(root, marker)}`, slug }
    const ts = Number(fs.readFileSync(marker, 'utf8').trim().split(/\s+/)[0])
    const age = Date.now() / 1000 - ts
    if (!Number.isFinite(age) || age < 0 || age > SHIP_MARKER_TTL_S) return { ok: false, why: 'marker ship đã quá 2 giờ', slug }
    // Marker auto (dòng JSON thứ 4) chỉ có giá trị khi Gate C, HEAD và ship_branch còn đúng như lúc ghi.
    const bound = fs.readFileSync(marker, 'utf8').split(/\r?\n/).find((l) => l.startsWith('{'))
    if (bound) {
      let binding = null
      try { binding = JSON.parse(bound) } catch {}
      const v = validateAutoBinding(root, config, binding)
      if (!v.valid) return { ok: false, why: `marker ship auto không còn khớp: ${v.reasons[0]}`, slug }
    }
    return { ok: true }
  }

  function checkWrapped(cmd, cwd, mode, depth) {
    const body = stripHeredocs(cmd)
    if(config.worker?.driver?.enabled){
      const substitutions=commandSubstitutions(body)
      if(!substitutions.complete)return 'Harness: không xác định được lệnh thay thế; chạy lệnh trực tiếp.'
      if(substitutions.bodies.length && depth>=16)return 'Lệnh bọc quá sâu; chạy lệnh trực tiếp.'
      for(const inner of substitutions.bodies){
        const reason=checkBashNew(inner,cwd,mode) ?? checkBash(inner,cwd,mode,depth+1)
        if(reason)return reason
      }
    }
    let dir = cwd
    for (const seg of segments(body)) {
      let execDir = dir
      const tokens = normalizedTokens(seg, (p) => { execDir = resolveDir(execDir, p) })
      if (tokens[0] === 'cd') { dir = resolveDir(execDir, tokens[1] ?? os.homedir()); continue }
      const commandFlag = ['bash', 'sh', 'zsh'].includes(tokens[0]) ? tokens.findIndex((t, i) => i > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(t)) : -1
      const inner = commandFlag >= 0 ? tokens[commandFlag + 1] : tokens[0] === 'eval' ? tokens.slice(1).join(' ') : null
      if (inner) {
        if (depth >= 16) return 'Lệnh bọc quá sâu; chạy lệnh trực tiếp.'
        const reason = checkBashNew(inner, execDir, mode) ?? checkBash(inner, execDir, mode, depth + 1)
        if (reason) return reason
      }
    }
    if (!WRAPPER_RE.test(body)) return null
    // `kill <pid>` / `kill $(cat pidfile)` của tiến trình không thuộc ff đã được killVerdict cho phép ở checkBash.
    const forbiddenBody = segments(body).filter((x) => killVerdict(x, dir) !== null).join('\n')
    if (!forbiddenRes.some((re) => re.test(forbiddenBody))) return null
    return 'chạy lệnh trực tiếp, không bọc trong bash -c/eval/$(…)'
  }

  function checkBash(cmd, cwd, mode, depth = 0) {
    const wrapped = checkWrapped(cmd, cwd, mode, depth)
    if (wrapped) return wrapped
    let dir = cwd
    for (const seg of segments(cmd)) {
      let execDir = dir
      const tokens = normalizedTokens(seg, (p) => { execDir = resolveDir(execDir, p) })
      if (!tokens.length) continue
      const [head] = tokens
      if (head === 'cd') {
        dir = resolveDir(execDir, tokens[1] ?? os.homedir())
        continue
      }
      // `ff worker park` từ phiên thẻ chỉ được tạm dừng CHÍNH thẻ của phiên (FF_CARD_ID).
      if (workerSession && (head === 'ff' || head.endsWith('/ff')) && tokens[1] === 'worker' && tokens[2] === 'park') {
        const rest = tokens.slice(3)
        const ids = rest.filter((t, i) => !t.startsWith('--') && rest[i - 1] !== '--comment-file')
        if (ids.some((id) => id !== env.FF_CARD_ID)) return `ff worker park chỉ tạm dừng được thẻ của phiên này (#${env.FF_CARD_ID}), không phải thẻ khác.`
        continue
      }
      // Harness mutation boundaries precede every configurable allowlist.
      if(config.worker?.driver?.enabled){
        if(head==='git' && parseGit(tokens,execDir).sub==='push')return 'Harness: git push chỉ qua ff ship với receipt hiện hành.'
        if(head==='gh' && tokens.includes('pr') && tokens.some(t=>['create','merge'].includes(t)))return 'Harness: PR create chỉ qua ff ship; PR merge chỉ dành cho người.'
      }
      if (allowedBash.some((re) => re.test(seg))) {
        if (head === 'git') {
          const { sub, gitDir } = parseGit(tokens, execDir)
          if (sub === 'push' && localOnly(gitDir)) return 'Cấm git push từ bản copy quan sát local-only (ff.localOnly=true).'
        }
        continue
      }

      {
        const killAt = tokens.findIndex((t, i) => ['kill', 'pkill', 'killall'].includes(path.basename(t)) && (i === 0 || tokens[0] === 'xargs'))
        if (killAt >= 0 && !(tokens[killAt] === 'kill' && tokens[killAt + 1] === '-0')) {
          const verdict = killAt === 0 && tokens[0] === 'kill' ? killVerdict(seg, execDir) : undefined
          if (verdict !== null) return verdict ?? `pkill/killall/kill theo tên hoặc dạng lạ bị chặn. Dùng \`kill <pid số>\` (hoặc \`kill $(cat <pidfile>)\`) cho tiến trình bạn tự chạy; ${KILL_HELP}`
        }

        const runsScript = ['yarn', 'npm', 'npx', 'pnpm', 'typeorm', 'ts-node'].includes(head)
        const migTok = runsScript && tokens.find((t) => migRe.test(t.replace(prodRe, '')))
        if (migTok) {
          if (prodRe.test(migTok)) return `Cấm chạy ${migTok} từ agent.`
          const cwdFlag = tokens.indexOf('--cwd')
          const target = cwdFlag >= 0 ? resolveDir(execDir, tokens[cwdFlag + 1] ?? '.') : execDir
          if (!inWorktree(target))
            return `${migTok} chỉ được chạy trong ${relWt}/<id>-<slug>/<repo> (DB dùng chung). Dùng \`ff verify-up <id> <app>\`.`
        }

        if (e2eDir && testsRel) {
          const pwAt = tokens.findIndex((t, i) => /(^|\/)playwright$/.test(t) && tokens[i + 1] === 'test')
          const bareTest = execDir === e2eDir && ['yarn', 'npm', 'pnpm'].includes(head) && (tokens[1] === 'test' || (tokens[1] === 'run' && tokens[2] === 'test'))
          if (pwAt >= 0 || bareTest) {
            const rest = pwAt >= 0 ? tokens.slice(pwAt + 2) : tokens.slice(2)
            const pathRe = new RegExp(`(^|/)${escapeRe(testsRel)}/[^/\\s]+`)
            if (!rest.some((t) => pathRe.test(t)))
              return `Chạy Playwright phải kèm path: \`npx playwright test ${testsRel}/<id>-<slug>/\`. Lệnh trần quét cả thẻ cũ và fail trên dữ liệu cũ.`
          }
        }
      }

      if (head !== 'git') continue
      const { sub, args, gitDir } = parseGit(tokens, execDir)

      {
        if (sub === 'push') {
          const s = shipApproved(gitDir)
          if (!s.ok)
            return `Cấm git push (${s.why}). Chỉ push qua /ship-to-dev SAU KHI user xác nhận, rồi chạy \`ff ship-approve ${s.slug ?? '<slug>'}\` (user sẽ được hỏi). "Chạy/ok/verify PASS" không phải lệnh push.`
        }
        if (sub === 'add' && args.some((t) => ['-A', '--all', '.', ':/', '-u', '--update'].includes(t)))
          return 'Cấm `git add -A/./-u` — chỉ add đúng từng file của task (tránh cuốn .env, file build, file task khác).'
        if (sub === 'commit' && args.some((t) => t === '--all' || /^-[A-Za-z]*a[A-Za-z]*$/.test(t)))
          return 'Cấm `git commit -a` — add đúng từng file của task rồi commit.'
        if (sub === 'stash' && !['list', 'show'].includes(args[0]))
          return 'Cấm `git stash` — stash ẩn việc dở của user. Cây bẩn thì dừng và báo user.'
      }

      if (mode === 'feature-flow' && inRootRepo(gitDir) && !inWorktree(gitDir)) {
        const writes = ['commit', 'reset', 'rebase', 'merge', 'cherry-pick', 'am', 'apply', 'revert']
        const newBranch = (sub === 'checkout' && args.some((t) => t === '-b' || t === '-B')) || (sub === 'switch' && args.some((t) => t === '-c' || t === '-C'))
        if (writes.includes(sub) || newBranch)
          return `Repo gốc ${path.relative(root, gitDir) || '.'} chỉ là bản gương — không \`git ${sub}\` ở đây. Làm trong ${relWt}/<id>-<slug>/ (\`ff copy <id>\`).`
      }
    }
    return null
  }

  function checkMirrorFile(tool, abs) {
    if (!isEdit(tool)) return null
    if (!inRootRepo(abs) || inWorktree(abs)) return null
    if (['CLAUDE.md', 'AGENTS.md'].includes(path.basename(abs))) return null
    return `Repo gốc là bản gương — không sửa ${path.relative(root, abs)}. Sửa bản trong ${relWt}/<id>-<slug>/${path.relative(root, abs)}.`
  }

  function evaluate({ cmd, file, tool, cwd, mode = 'base', input = {} }) {
    const c = realish(cwd)
    const abs = file ? realish(path.resolve(c, expandHome(file))) : null
    let reason = null
    if (cmd) reason = checkBashNew(cmd, c, mode) ?? checkBash(cmd, c, mode)
    if (!reason && abs) reason = checkFileNew(tool, input ?? {}, abs) ?? checkLockedFile(tool, abs) ?? checkAllowlist(tool, abs)
    if (!reason && abs && isEdit(tool) && protectedConfig(abs, mode)) reason = configMessage
    if (!reason && mode === 'feature-flow' && abs) reason = checkMirrorFile(tool, abs)
    return reason
  }

  const needsAsk = (cmd) => segments(cmd).some((s) => FF_ASK_RE.test(s) && !FF_HELP_RE.test(s) && !FF_AUTO_APPROVE_RE.test(s))

  return { root, evaluate, needsAsk }
}
