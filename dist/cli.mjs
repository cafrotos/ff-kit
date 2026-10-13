import { createRequire as __ffCreateRequire } from 'node:module'; const require = __ffCreateRequire(import.meta.url);

// scripts/cli/main.mjs
var VERSION = "0.1.0";
var COMMANDS = {};
var defaultCtx = () => ({ cwd: process.cwd(), stdout: process.stdout, stderr: process.stderr });
async function main(argv, ctx = defaultCtx()) {
  const [name, ...rest] = argv;
  if (!name || name === "help" || name === "--help") {
    ctx.stdout.write(usage());
    return 0;
  }
  if (name === "--version") {
    ctx.stdout.write(VERSION + "\n");
    return 0;
  }
  const cmd = COMMANDS[name];
  if (!cmd) {
    ctx.stderr.write(`ff: kh\xF4ng c\xF3 l\u1EC7nh '${name}'. Xem: ff help
`);
    return 2;
  }
  return cmd.run(rest, ctx);
}
function usage() {
  const lines = Object.entries(COMMANDS).map(([n, c]) => `  ${n.padEnd(14)} ${c.summary}`);
  return ["ff <l\u1EC7nh> [tham s\u1ED1]", "", "L\u1EC7nh:", ...lines, ""].join("\n");
}
export {
  COMMANDS,
  main
};
