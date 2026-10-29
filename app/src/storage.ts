// Where the plan is kept. Three ways, picked automatically:
// - "server": run with `npx openchurn`; the local server reads and writes one plan file.
// - "file": browsers that let pages write files (Chrome, Edge); you pick the file, edits save to it.
// - "browser": everywhere else; the plan stays in this browser, with Download and Open to use files by hand.
import { parsePlanFile, toPlanFile, type PlanInput } from "@openchurn/planner";

export type Mode = "server" | "file" | "browser";

export interface Loaded {
  mode: Mode;
  plan: PlanInput | null;
  /** Where the plan lives, as shown to the user. */
  where: string;
  /** In "file" mode, a file chosen on an earlier visit that needs permission again. */
  reopen?: string;
}

export class ChangedOnDisk extends Error {}

const BROWSER_KEY = "openchurn-plan";

// ---- server ---------------------------------------------------------------------------------------------------

let serverMtime: number | null = null;

async function serverLoad(): Promise<Loaded | null> {
  if (location.protocol === "file:") return null;
  // Only the local server answers /api/plan with JSON; a static host or a missing server means another mode.
  let data: { exists: boolean; path: string; display?: string; mtimeMs: number | null; text?: string };
  try {
    const res = await fetch("api/plan", { cache: "no-store" });
    if (!res.ok || !res.headers.get("content-type")?.includes("application/json")) return null;
    data = await res.json();
  } catch {
    return null;
  }
  serverMtime = data.mtimeMs;
  const where = data.display ?? data.path;
  if (!data.exists) return { mode: "server", plan: null, where };
  const parsed = parsePlanFile(data.text ?? "");
  if (!parsed.ok) throw new Error(`${where}: ${parsed.error}`);
  return { mode: "server", plan: parsed.plan, where };
}

async function serverSave(plan: PlanInput): Promise<void> {
  const res = await fetch("api/plan", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: toPlanFile(plan), baseMtimeMs: serverMtime }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 409) throw new ChangedOnDisk();
  if (!res.ok) throw new Error(data.message ?? "Couldn't save the plan file.");
  serverMtime = data.mtimeMs;
}

// ---- file (File System Access) --------------------------------------------------------------------------------

let handle: FileSystemFileHandle | null = null;
let fileModified: number | null = null;

export const canUseFiles = () => typeof window !== "undefined" && "showOpenFilePicker" in window && "showSaveFilePicker" in window;
const PICKER = { types: [{ description: "OpenChurn plan", accept: { "application/json": [".json"] } }] };

// The chosen file's handle is kept in IndexedDB so the next visit can reopen it (after the browser asks again).
function idb<T>(op: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode): Promise<T> {
  return new Promise((ok, fail) => {
    const open = indexedDB.open("openchurn", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("handles");
    open.onerror = () => fail(open.error);
    open.onsuccess = () => {
      const req = op(open.result.transaction("handles", mode).objectStore("handles"));
      req.onsuccess = () => ok(req.result);
      req.onerror = () => fail(req.error);
    };
  });
}
const rememberHandle = (h: FileSystemFileHandle) => idb((s) => s.put(h, "plan"), "readwrite").catch(() => undefined);
const recalledHandle = () => idb<FileSystemFileHandle | undefined>((s) => s.get("plan"), "readonly").catch(() => undefined);

async function readHandle(h: FileSystemFileHandle): Promise<PlanInput> {
  const file = await h.getFile();
  const parsed = parsePlanFile(await file.text());
  if (!parsed.ok) throw new Error(`${file.name}: ${parsed.error}`);
  handle = h;
  fileModified = file.lastModified;
  await rememberHandle(h);
  return parsed.plan;
}

async function fileLoad(): Promise<Loaded> {
  const saved = await recalledHandle();
  const local = browserRead();
  if (saved) {
    // Permission isn't kept between visits; asking needs a click, so offer to reopen it.
    const state = await saved.queryPermission({ mode: "readwrite" });
    if (state === "granted") return { mode: "file", plan: await readHandle(saved), where: saved.name };
    return { mode: "file", plan: local, where: "this browser", reopen: saved.name };
  }
  return { mode: "file", plan: local, where: "this browser" };
}

/** After a click: asks the browser for the file chosen on an earlier visit again. */
export async function reopenFile(): Promise<{ plan: PlanInput; where: string } | null> {
  const saved = await recalledHandle();
  if (!saved || (await saved.requestPermission({ mode: "readwrite" })) !== "granted") return null;
  return { plan: await readHandle(saved), where: saved.name };
}

/** Open plan file: pick a .json plan; edits save to it from then on. */
export async function openFile(): Promise<{ plan: PlanInput; where: string } | null> {
  try {
    const [h] = await window.showOpenFilePicker(PICKER);
    return { plan: await readHandle(h), where: h.name };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
}

/** New plan file: save the current plan to a new file, and keep saving to it. */
export async function newFile(plan: PlanInput): Promise<string | null> {
  try {
    const h = await window.showSaveFilePicker({ ...PICKER, suggestedName: "plan.json" });
    handle = h;
    fileModified = null;
    await writeHandle(plan);
    await rememberHandle(h);
    return h.name;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
}

async function writeHandle(plan: PlanInput) {
  if (!handle) return;
  const before = await handle.getFile();
  if (fileModified !== null && before.lastModified !== fileModified) throw new ChangedOnDisk();
  const w = await handle.createWritable();
  await w.write(toPlanFile(plan));
  await w.close();
  fileModified = (await handle.getFile()).lastModified;
}

// ---- browser --------------------------------------------------------------------------------------------------

function browserRead(): PlanInput | null {
  try {
    const raw = localStorage.getItem(BROWSER_KEY);
    if (!raw) return null;
    const parsed = parsePlanFile(raw);
    return parsed.ok ? parsed.plan : null;
  } catch {
    return null;
  }
}

function browserWrite(plan: PlanInput) {
  try {
    localStorage.setItem(BROWSER_KEY, toPlanFile(plan));
  } catch {
    /* storage unavailable: the plan still works for this visit */
  }
}

/** Download plan: the plan as a .json file. */
export function downloadPlan(plan: PlanInput) {
  const url = URL.createObjectURL(new Blob([toPlanFile(plan)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "plan.json" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Open plan file without file access: reads an uploaded file. */
export async function readUpload(file: File): Promise<PlanInput> {
  const parsed = parsePlanFile(await file.text());
  if (!parsed.ok) throw new Error(`${file.name}: ${parsed.error}`);
  return parsed.plan;
}

// ---- one interface --------------------------------------------------------------------------------------------

export async function load(): Promise<Loaded> {
  const server = await serverLoad();
  if (server) return server;
  if (canUseFiles()) return fileLoad();
  return { mode: "browser", plan: browserRead(), where: "this browser" };
}

/** Saves wherever the plan lives now. The browser copy is always kept too, so nothing is lost before a file is chosen. */
export async function save(mode: Mode, plan: PlanInput): Promise<void> {
  if (mode === "server") return serverSave(plan);
  browserWrite(plan);
  if (mode === "file" && handle) await writeHandle(plan);
}

/** Re-reads the plan from where it lives, after it changed on disk. */
export async function reload(mode: Mode): Promise<PlanInput | null> {
  if (mode === "server") return (await serverLoad())?.plan ?? null;
  if (mode === "file" && handle) return readHandle(handle);
  return browserRead();
}

export const hasFile = () => handle !== null;

/** After "changed on disk": keep this version anyway and overwrite the file. */
export async function overwrite(mode: Mode, plan: PlanInput): Promise<void> {
  if (mode === "server") {
    const res = await fetch("api/plan", { cache: "no-store" });
    serverMtime = (await res.json()).mtimeMs;
  } else {
    fileModified = null;
  }
  return save(mode, plan);
}
