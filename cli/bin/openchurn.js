#!/usr/bin/env node
// `npx openchurn [plan file]`: runs the OpenChurn planner on this computer, saving to a plan file.
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPlanServer } from "../src/server.js";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: openchurn [plan file] [--port 4580]

Runs the OpenChurn planner at http://127.0.0.1 and saves your plan to a file.
The plan file defaults to ~/OpenChurn/plan.json.`);
  process.exit(0);
}
const portArg = args.indexOf("--port");
const firstPort = portArg >= 0 ? Number(args[portArg + 1]) : 4580;
const fileArg = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--port");
const planPath = resolve(fileArg ?? join(homedir(), "OpenChurn", "plan.json"));
const appDir = join(dirname(fileURLToPath(import.meta.url)), "..", "app");

const { listen } = createPlanServer({ planPath, appDir });
let port;
for (let p = firstPort; p < firstPort + 20 && !port; p++) {
  try {
    port = await listen(p);
  } catch (e) {
    if (e.code !== "EADDRINUSE") throw e;
  }
}
if (!port) {
  console.error(`No free port from ${firstPort} to ${firstPort + 19}. Try --port.`);
  process.exit(1);
}

const url = `http://127.0.0.1:${port}`;
const shown = planPath.startsWith(homedir()) ? "~" + planPath.slice(homedir().length) : planPath;
// No browser is launched for you: that would mean running a system command. Most terminals make the link clickable.
console.log(`OpenChurn is running. Open this in your browser:\n\n  ${url}\n\nPlan file: ${shown}\nPress Ctrl+C to stop.`);
