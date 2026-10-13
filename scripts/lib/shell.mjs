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
export function stripPrefix(tokens) {
  let i = 0
  while (i < tokens.length && (['sudo', 'command', 'exec', 'time', 'nohup', 'env'].includes(tokens[i]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]))) i++
  return tokens.slice(i)
}

// Token của 1 đoạn lệnh, bỏ `(`/`{` mở và `)`/`}` đóng subshell, bỏ tiền tố.
export const headTokens = (seg) => stripPrefix(tokenize(seg.replace(/^[({]\s*/, '').replace(/\s*[)}]+\s*$/, '')))

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
