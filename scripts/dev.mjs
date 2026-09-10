// Single command to run the panel + worker together in development.
// Usage: pnpm dev
import { spawn } from "node:child_process";

const procs = [];
let shuttingDown = false;

function run(name, args) {
  const p = spawn("pnpm", args, { stdio: "inherit", env: process.env });
  p.on("exit", (code) => {
    console.log(`[${name}] encerrou (código ${code ?? "?"})`);
    shutdown();
  });
  procs.push(p);
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of procs) {
    try {
      p.kill("SIGINT");
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => process.exit(0), 300);
}

console.log("instaleads: iniciando painel (Next.js) + worker...");
run("web", ["dev:web"]);
run("worker", ["dev:worker"]);

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
