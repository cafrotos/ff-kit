// Bundle mọi entry ra dist/ để plugin chạy không cần npm install.
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'

const entryPoints = {
  cli: 'scripts/cli/main.mjs',
  guard: 'scripts/guard.mjs',
  'hooks/session-start': 'scripts/hooks/session-start.mjs',
  'hooks/ask-pre': 'scripts/hooks/ask-pre.mjs',
  'hooks/ask-post': 'scripts/hooks/ask-post.mjs',
  'hooks/notification': 'scripts/hooks/notification.mjs',
  'hooks/stop': 'scripts/hooks/stop.mjs',
  'hooks/user-prompt': 'scripts/hooks/user-prompt.mjs',
  'worker-supervise': 'scripts/worker-supervise.mjs',
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

const workerBuild = spawnSync(process.execPath, ['build.mjs'], { cwd: 'ff-worker', encoding: 'utf8' })
if (workerBuild.stdout) process.stdout.write(workerBuild.stdout)
if (workerBuild.stderr) process.stderr.write(workerBuild.stderr)
if (workerBuild.status !== 0) throw new Error('build ff-worker thất bại')
