#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runRepoVistaPlugin } from "./src/runtime.js";

export * from "./src/runtime.js";
export * from "./src/repovista.js";
export * from "./src/reports.js";
export * from "./src/render-panel.js";
export * from "./src/format.js";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRepoVistaPlugin().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.stdout.write(`${JSON.stringify({ ok: false, stderr: message })}\n`);
    process.exitCode = 1;
  });
}
