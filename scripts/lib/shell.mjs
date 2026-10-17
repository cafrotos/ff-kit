// Tách lệnh shell đơn giản cho guard và doctor. Không mở rộng biến.

export function tokenize(seg) {
  const out = []
  let cur = ''
  let has = false
  let q = null
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]
    if (q) {
      if (c === q) q = null
      else if (q === '"' && c === '\\' && i + 1 < seg.length) cur += seg[++i]
      else cur += c
      continue
    }
    if (c === '"' || c === "'") {
      q = c
      has = true
      continue
    }
    if (c === '\\' && i + 1 < seg.length) {
      cur += seg[++i]
      has = true
      continue
    }
    if (/\s/.test(c)) {
      if (has) out.push(cur)
      cur = ''
      has = false
      continue
    }
    cur += c
    has = true
  }
  if (has) out.push(cur)
  return out
}

// Bỏ thân heredoc (<<EOF … EOF): đó là dữ liệu, không phải lệnh.
export function stripHeredocs(cmd) {
  const out = []
  let delim = null
  for (const line of cmd.split('\n')) {
    if (delim) {
      if (line.trim() === delim) delim = null
      continue
    }
    out.push(line)
    const m = line.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/)
    if (m) delim = m[2]
  }
  return out.join('\n')
}

// Tách theo ; | & xuống dòng (ngoài nháy). `&` thuộc redirect (`2>&1`, `&>`, `>&`) không tách.
export function segments(cmd) {
  const src = stripHeredocs(cmd)
  const segs = []
  let cur = ''
  let q = null
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (q) {
      cur += c
      if (c === q) q = null
      continue
    }
    if (c === '"' || c === "'") {
      q = c
      cur += c
      continue
    }
    if (c === '&' && (src[i - 1] === '>' || src[i - 1] === '<' || src[i + 1] === '>')) {
      cur += c
      continue
    }
    if (c === ';' || c === '\n' || c === '|' || c === '&') {
      if (cur.trim()) segs.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  if (cur.trim()) segs.push(cur.trim())
  return segs
}

// Bỏ tiền tố `env`, `A=b`, `sudo`, `command`, `exec`, `time`, `nohup`.
export function stripPrefix(tokens, onDirectory = () => {}) {
  tokens = [...tokens]
  let i = 0
  const operands = {
    sudo: new Set(['-u', '--user', '-g', '--group', '-h', '--host', '-p', '--prompt', '-C', '--close-from', '-T', '--command-timeout', '-R', '--chroot', '-D', '--chdir']),
    env: new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string']),
    time: new Set(['-f', '--format', '-o', '--output']),
    timeout: new Set(['-s', '--signal', '-k', '--kill-after']),
  }
  while (i < tokens.length) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) { i++; continue }
    const wrapper = tokens[i].split('/').at(-1)
    if (!['sudo', 'command', 'exec', 'time', 'nohup', 'env', 'timeout'].includes(wrapper)) break
    i++
    while (i < tokens.length && tokens[i].startsWith('-')) {
      const flag = tokens[i++]
      if (flag === '--') break
      if (wrapper === 'env' && ['-S', '--split-string'].includes(flag)) {
        tokens.splice(i, 1, ...tokenize(tokens[i] ?? ''))
        break
      }
      if (wrapper === 'env' && flag.startsWith('--split-string=')) {
        tokens.splice(i, 0, ...tokenize(flag.slice('--split-string='.length)))
        break
      }
      if ((wrapper === 'env' && ['-C', '--chdir'].includes(flag)) || (wrapper === 'sudo' && ['-D', '--chdir'].includes(flag)))
        onDirectory(tokens[i] ?? '.')
      if (['env', 'sudo'].includes(wrapper) && flag.startsWith('--chdir=')) onDirectory(flag.slice('--chdir='.length))
      if (operands[wrapper]?.has(flag)) i++
    }
    if (wrapper === 'timeout') i++ // duration follows timeout's options
  }
  return tokens.slice(i)
}

// Only unquoted redirections are shell writes; quoted interpreter code is data here.
// This is deliberately a small shell parser, not an execution sandbox.
export function redirections(seg) {
  const out = []
  let q = null
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]
    if (c === '\\' && q !== "'") { i++; continue }
    if (q) { if (c === q) q = null; continue }
    if (c === '"' || c === "'") { q = c; continue }
    if (c !== '>' && c !== '<') continue
    const start = i
    const write = c === '>'
    if (seg[i + 1] === c) i++
    if (seg[i + 1] === '&') { i++; while (/\d|-/.test(seg[i + 1] ?? '') && i + 1 < seg.length) i++; continue }
    while (/\s/.test(seg[i + 1] ?? '') && i + 1 < seg.length) i++
    const targetStart = i + 1
    let targetQ = null
    while (i + 1 < seg.length) {
      const next = seg[i + 1]
      if (next === '\\' && targetQ !== "'") { i += 2; continue }
      if (targetQ) { i++; if (next === targetQ) targetQ = null; continue }
      if (next === '"' || next === "'") { targetQ = next; i++; continue }
      if (/\s|[;&|<>]/.test(next)) break
      i++
    }
    const target = tokenize(seg.slice(targetStart, i + 1))[0]
    if (target) out.push({ target, write, start, end: i + 1 })
  }
  return out
}

// Token của 1 đoạn lệnh, bỏ `(`/`{` mở và `)`/`}` đóng subshell, bỏ tiền tố.
export const headTokens = (seg, onDirectory) => stripPrefix(tokenize(seg.replace(/^[({]\s*/, '').replace(/\s*[)}]+\s*$/, '')), onDirectory)

const BUILTINS = new Set(['cd', 'export', 'set', 'unset', 'source', '.', 'pushd', 'popd', 'true', 'false', ':', 'exit', 'trap', 'test', '[', '[[', '!', 'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'in'])

export function commandBinaries(cmd) {
  const bins = []
  for (const seg of segments(cmd)) {
    let toks = headTokens(seg).filter((t) => !/^\d*[<>]/.test(t))
    while (['if', 'then', 'else', 'elif', 'do', '!', 'while', 'until'].includes(toks[0])) toks = toks.slice(1)
    const head = (toks[0] ?? '').replace(/\)+$/, '')
    if (head && !BUILTINS.has(head)) bins.push(head)
  }
  return [...new Set(bins)]
}
