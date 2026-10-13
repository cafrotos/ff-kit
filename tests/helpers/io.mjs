export function capture(cwd = process.cwd()) {
  const buf = { out: '', err: '' }
  return {
    buf,
    ctx: {
      cwd,
      stdout: { write: (s) => { buf.out += s } },
      stderr: { write: (s) => { buf.err += s } },
    },
  }
}
