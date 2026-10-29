import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXAMPLE_PLAN, toPlanFile } from "@openchurn/planner";
import { createPlanServer } from "../src/server.js";

let dir, planPath, port, server;
const call = (method, path, { host, origin, body } = {}) =>
  new Promise((ok, fail) => {
    const headers = { host: host ?? `127.0.0.1:${port}`, ...(origin === undefined ? {} : { origin }), ...(body ? { "content-type": "application/json" } : {}) };
    const req = request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => ok({ status: res.statusCode, text: data, json: () => JSON.parse(data) }));
    });
    req.on("error", fail);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
const own = () => `http://127.0.0.1:${port}`;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "openchurn-"));
  const appDir = join(dir, "app");
  await mkdir(appDir);
  await writeFile(join(appDir, "index.html"), "<!doctype html><title>OpenChurn</title>");
  await writeFile(join(dir, "secret.txt"), "not for websites");
  planPath = join(dir, "plans", "plan.json");
  const s = createPlanServer({ planPath, appDir });
  server = s.server;
  port = await s.listen(0);
});
after(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

test("reports a missing plan file", async () => {
  const r = await call("GET", "/api/plan");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json(), { exists: false, path: planPath, display: planPath, mtimeMs: null });
});

test("saves a plan, keeps a backup, and refuses to overwrite a file changed on disk", async () => {
  const text = toPlanFile(EXAMPLE_PLAN);
  const first = await call("PUT", "/api/plan", { origin: own(), body: { text, baseMtimeMs: null } });
  assert.equal(first.status, 200);
  assert.equal(await readFile(planPath, "utf8"), text);

  const read = (await call("GET", "/api/plan")).json();
  assert.equal(read.exists, true);
  assert.equal(read.text, text);

  const second = await call("PUT", "/api/plan", { origin: own(), body: { text, baseMtimeMs: read.mtimeMs } });
  assert.equal(second.status, 200);
  assert.ok(existsSync(`${planPath}.bak`));

  const stale = await call("PUT", "/api/plan", { origin: own(), body: { text, baseMtimeMs: read.mtimeMs } });
  assert.equal(stale.status, 409);
  assert.equal(stale.json().error, "changed_on_disk");
});

test("rejects an invalid plan without touching the file", async () => {
  const before = await readFile(planPath, "utf8");
  const r = await call("PUT", "/api/plan", { origin: own(), body: { text: '{"openchurn":1,"pay":{},"bonuses":[]}', baseMtimeMs: null } });
  assert.equal(r.status, 400);
  assert.match(r.json().message, /how often/);
  assert.equal(await readFile(planPath, "utf8"), before);
});

test("refuses requests that come from websites", async () => {
  // A site that points its own domain at 127.0.0.1 still sends its own Host.
  assert.equal((await call("GET", "/api/plan", { host: "evil.example:80" })).status, 403);
  // A site posting from the browser sends its own Origin.
  const text = toPlanFile(EXAMPLE_PLAN);
  assert.equal((await call("PUT", "/api/plan", { origin: "https://evil.example", body: { text, baseMtimeMs: null } })).status, 403);
  assert.equal((await call("PUT", "/api/plan", { body: { text, baseMtimeMs: null } })).status, 403);
});

test("serves only the app's own files", async () => {
  const page = await call("GET", "/");
  assert.equal(page.status, 200);
  assert.match(page.text, /OpenChurn/);
  const escape = await call("GET", "/%2e%2e/secret.txt");
  assert.notEqual(escape.text, "not for websites");
});
