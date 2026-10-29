// The local server behind `npx openchurn`: serves the app and reads and writes one plan file. It listens on
// 127.0.0.1 only and refuses requests that don't come from its own address, so websites can't reach it.
import { createServer } from "node:http";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { parsePlanFile } from "@openchurn/planner";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".json": "application/json",
};
const MAX_BODY = 1_000_000;

/**
 * @param {{ planPath: string, appDir: string }} options  planPath is fixed here and never taken from a request.
 * @returns {{ server: import("node:http").Server, listen: (port: number) => Promise<number> }}
 */
export function createPlanServer({ planPath, appDir }) {
  let port = 0;
  const allowedHosts = () => [`127.0.0.1:${port}`, `localhost:${port}`];
  const allowedOrigins = () => allowedHosts().map((h) => `http://${h}`);

  const server = createServer(async (req, res) => {
    // DNS rebinding: a website can point its own name at 127.0.0.1, but its requests still carry its Host.
    if (!allowedHosts().includes(req.headers.host ?? "")) return send(res, 403, { error: "forbidden" });
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    try {
      if (url.pathname === "/api/plan") {
        if (req.method === "GET") return send(res, 200, await readPlan(planPath));
        if (req.method === "PUT") {
          // Writes only from this app's own pages.
          if (!allowedOrigins().includes(req.headers.origin ?? "")) return send(res, 403, { error: "forbidden" });
          return await writePlan(req, res, planPath);
        }
        return send(res, 405, { error: "method_not_allowed" });
      }
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "method_not_allowed" });
      return await serveFile(res, appDir, url.pathname);
    } catch (e) {
      console.error(e);
      return send(res, 500, { error: "server_error" });
    }
  });

  return {
    server,
    listen: (wanted) =>
      new Promise((ok, fail) => {
        server.once("error", fail);
        server.listen(wanted, "127.0.0.1", () => {
          port = server.address().port;
          ok(port);
        });
      }),
  };
}

/** The path as people read it: ~/OpenChurn/plan.json rather than the full home folder. */
const display = (path) => (path.startsWith(homedir() + sep) ? "~" + path.slice(homedir().length) : path);

async function readPlan(planPath) {
  try {
    const [text, info] = await Promise.all([readFile(planPath, "utf8"), stat(planPath)]);
    return { exists: true, path: planPath, display: display(planPath), mtimeMs: info.mtimeMs, text };
  } catch (e) {
    if (e.code === "ENOENT") return { exists: false, path: planPath, display: display(planPath), mtimeMs: null };
    throw e;
  }
}

/** Saves `{ text, baseMtimeMs }`: rejects invalid plans, and plans changed on disk since the page read them (409). */
async function writePlan(req, res, planPath) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY) return send(res, 413, { error: "too_large" });
  }
  let input;
  try {
    input = JSON.parse(body);
  } catch {
    return send(res, 400, { error: "bad_request" });
  }
  if (typeof input?.text !== "string") return send(res, 400, { error: "bad_request" });
  const parsed = parsePlanFile(input.text);
  if (!parsed.ok) return send(res, 400, { error: "invalid_plan", message: parsed.error });

  const current = await readPlan(planPath);
  if (current.exists && current.mtimeMs !== input.baseMtimeMs) return send(res, 409, { error: "changed_on_disk", mtimeMs: current.mtimeMs });

  await mkdir(dirname(planPath), { recursive: true });
  if (current.exists) await copyFile(planPath, `${planPath}.bak`);
  // Write beside the plan, then rename over it, so a crash never leaves half a file.
  const tmp = `${planPath}.${process.pid}.tmp`;
  await writeFile(tmp, input.text, "utf8");
  await rename(tmp, planPath);
  return send(res, 200, { mtimeMs: (await stat(planPath)).mtimeMs });
}

async function serveFile(res, appDir, pathname) {
  const root = resolve(appDir);
  let file = resolve(join(root, decodeURIComponent(pathname)));
  if (file !== root && !file.startsWith(root + sep)) return send(res, 403, { error: "forbidden" });
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
  } catch {
    file = join(root, "index.html");
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    return res.end(data);
  } catch {
    return send(res, 404, { error: "not_found" });
  }
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
