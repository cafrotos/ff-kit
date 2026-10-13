// Bundle mọi entry ra dist/ để plugin chạy không cần npm install.
import { build } from 'esbuild'

const entryPoints = {
  cli: 'scripts/cli/main.mjs',
  guard: 'scripts/guard.mjs',
  'hooks/session-start': 'scripts/hooks/session-start.mjs',
  'hooks/ask-pre': 'scripts/hooks/ask-pre.mjs',
  'hooks/ask-post': 'scripts/hooks/ask-post.mjs',
  'hooks/notification': 'scripts/hooks/notification.mjs',
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
