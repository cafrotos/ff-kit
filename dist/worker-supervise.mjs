#!/usr/bin/env node
import { createRequire as __ffCreateRequire } from 'node:module'; const require = __ffCreateRequire(import.meta.url);

// scripts/worker-supervise.mjs
import { spawn } from "node:child_process";
import path2 from "node:path";
import fs2 from "node:fs";
import { pathToFileURL } from "node:url";

// ff-worker/src/core/supervisor.mjs
async function supervise({ launch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now, onCrash = () => {
} }) {
  const failures = [];
  for (; ; ) {
    const result = await launch();
    const code = result?.code ?? 1;
    if (code === 0) return { code: 0 };
    if (code === 75) continue;
    const time = now();
    failures.push(time);
    while (failures.length && time - failures[0] > 10 * 60 * 1e3) failures.shift();
    if (failures.length > 5) {
      const reason = `worker l\u1ED7i ${failures.length} l\u1EA7n trong 10 ph\xFAt; supervisor \u0111\xE3 d\u1EEBng`;
      onCrash(reason);
      return { code: 1, reason };
    }
    await sleep(5e3);
  }
}

// ff-worker/src/core/status.mjs
import fs from "node:fs";
import path from "node:path";
function writeWorkerStatus(root, status) {
  const target = path.join(root, ".ff", "worker.json");
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 448 });
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(status, null, 2)}
`, { mode: 384 });
  fs.renameSync(temp, target);
  return target;
}

// scripts/worker-supervise.mjs
function options(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--config" && argv[i + 1]) out.config = path2.resolve(argv[++i]);
    else if (argv[i] === "--package" && argv[i + 1]) out.pkg = argv[++i];
    else throw new Error(`tham s\u1ED1 kh\xF4ng h\u1EE3p l\u1EC7: ${argv[i]}`);
  }
  if (!out.config || !out.pkg) throw new Error("c\u1EA7n --config v\xE0 --package");
  return out;
}
async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = options(argv);
  } catch (e) {
    process.stderr.write(`ff-worker-supervise: ${e.message}
`);
    return 2;
  }
  const root = path2.dirname(opts.config);
  const result = await supervise({
    launch: () => new Promise((resolve) => {
      const child = spawn("npx", ["--yes", opts.pkg, "--config", opts.config], { cwd: root, stdio: "inherit", env: process.env });
      child.once("error", () => resolve({ code: 1 }));
      child.once("exit", (code) => resolve({ code: code ?? 1 }));
    }),
    onCrash(reason) {
      let status = {};
      try {
        status = JSON.parse(fs2.readFileSync(path2.join(root, ".ff/worker.json"), "utf8"));
      } catch {
      }
      writeWorkerStatus(root, { ...status, state: "crashed", error: reason, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
      process.stderr.write(`[ff-worker-supervise] ${reason}
`);
    }
  });
  return result.code;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path2.resolve(process.argv[1])).href) process.exitCode = await main();
export {
  main
};
