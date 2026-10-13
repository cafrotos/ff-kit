// Bundle mọi entry ra dist/ để plugin chạy không cần npm install.
import { build } from 'esbuild'

const entryPoints = {
  cli: 'scripts/cli/main.mjs',
  guard: 'scripts/guard.mjs',
}

await build({
  entryPoints,
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outExtension: { '.js': '.mjs' },
  banner: { js: "import { createRequire as __ffCreateRequire } from 'node:module'; const require = __ffCreateRequire(import.meta.url);" },
  logLevel: 'warning',
})
