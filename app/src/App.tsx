import { useEffect, useRef, useState } from "react";
import { EXAMPLE_PLAN, type PlanInput, todayUTC } from "@openchurn/planner";
import { Planner } from "./Planner";
import { ThemeSwitch } from "./ThemeSwitch";
import * as storage from "./storage";

// "error" is a failed save (retried on the next edit); "openError" is a file that couldn't be opened.
type Status = { kind: "idle" | "saving" | "saved" | "error" | "openError" | "conflict"; message?: string };

const clone = (p: PlanInput): PlanInput => JSON.parse(JSON.stringify(p));

export function App() {
  const [mode, setMode] = useState<storage.Mode | null>(null);
  const [plan, setPlan] = useState<PlanInput | null>(null);
  const [isExample, setIsExample] = useState(false);
  const [where, setWhere] = useState("");
  const [reopenName, setReopenName] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [loadError, setLoadError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const today = todayUTC();

  useEffect(() => {
    storage.load().then(
      (r) => {
        setMode(r.mode);
        setWhere(r.where);
        setReopenName(r.reopen ?? null);
        setPlan(r.plan ?? clone(EXAMPLE_PLAN));
        setIsExample(!r.plan);
        if (r.plan) setStatus({ kind: "saved" });
      },
      (e: Error) => {
        // The plan file exists but can't be read: show the example and say why, without touching the file.
        setMode("browser");
        setLoadError(e.message);
        setPlan(clone(EXAMPLE_PLAN));
        setIsExample(true);
      },
    );
  }, []);

  if (!mode || !plan) return <p className="hint page">Loading your plan…</p>;

  async function saveNow(next: PlanInput, write: (m: storage.Mode, p: PlanInput) => Promise<void> = storage.save) {
    setStatus({ kind: "saving" });
    try {
      await write(mode!, next);
      setStatus({ kind: "saved" });
    } catch (e) {
      if (e instanceof storage.ChangedOnDisk) setStatus({ kind: "conflict" });
      else setStatus({ kind: "error", message: (e as Error).message });
    }
  }

  // Every edit saves shortly after typing stops.
  function onChange(next: PlanInput) {
    setPlan(next);
    setIsExample(false);
    if (status.kind === "conflict") return;
    // Shown as "Saving…" from the first keystroke, so "Saved" always means it's on disk.
    setStatus({ kind: "saving" });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveNow(next), 600);
  }

  function replaceWith(next: PlanInput, from: string) {
    if (!isExample && !window.confirm(`Replace the plan on screen with ${from}?`)) return false;
    setPlan(next);
    setIsExample(false);
    return true;
  }

  async function act(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      setStatus({ kind: "openError", message: (e as Error).message });
    }
  }

  const openFile = () =>
    act(async () => {
      const r = await storage.openFile();
      if (!r) return;
      setPlan(r.plan);
      setIsExample(false);
      setWhere(r.where);
      setReopenName(null);
      setStatus({ kind: "saved" });
    });
  const newFile = () =>
    act(async () => {
      const name = await storage.newFile(plan);
      if (!name) return;
      setWhere(name);
      setReopenName(null);
      setIsExample(false);
      setStatus({ kind: "saved" });
    });
  const reopen = () =>
    act(async () => {
      const r = await storage.reopenFile();
      if (!r) return;
      setPlan(r.plan);
      setIsExample(false);
      setWhere(r.where);
      setReopenName(null);
      setStatus({ kind: "saved" });
    });
  const upload = (file: File) =>
    act(async () => {
      const next = await storage.readUpload(file);
      if (replaceWith(next, file.name)) await saveNow(next);
    });
  const reloadFromDisk = () =>
    act(async () => {
      const next = await storage.reload(mode);
      if (next) setPlan(next);
      setStatus({ kind: "saved" });
    });

  const savedText =
    mode === "server" || storage.hasFile()
      ? isExample
        ? `Example plan · your first edit saves it to ${where}`
        : status.kind === "saving"
          ? "Saving…"
          : `Saved to ${where}`
      : isExample
        ? "Example plan · edits are kept in this browser"
        : status.kind === "saving"
          ? "Saving…"
          : "Saved in this browser";

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">
            Open<span>Churn</span>
          </span>
          <nav className="nav" aria-label="Main">
            <ThemeSwitch />
          </nav>
        </div>
      </header>
      <main className="page">
        <div className="filebar">
          <span className="path" aria-live="polite">{savedText}</span>
          {mode === "file" && reopenName ? (
            <button className="btn ghost" type="button" onClick={reopen}>Reopen {reopenName}</button>
          ) : null}
          {mode === "file" ? (
            <>
              <button className="btn ghost" type="button" onClick={openFile}>Open plan file</button>
              {storage.hasFile() ? null : <button className="btn ghost" type="button" onClick={newFile}>Save to a file</button>}
            </>
          ) : null}
          {mode === "browser" ? (
            <>
              <button className="btn ghost" type="button" onClick={() => storage.downloadPlan(plan)}>Download plan</button>
              <label className="btn ghost">
                Open plan file
                <input type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
              </label>
            </>
          ) : null}
        </div>
        {mode === "browser" && !loadError ? (
          <p className="hint">This browser can&apos;t save to files directly. Download your plan to keep a copy, or use Chrome or Edge, or run <code>npx openchurn</code>.</p>
        ) : null}
        {loadError ? <p className="notice bad" role="alert">Couldn&apos;t open your plan file: {loadError} It hasn&apos;t been changed.</p> : null}
        {status.kind === "error" ? <p className="notice bad" role="alert">{status.message ?? "Couldn't save."} We&apos;ll retry on your next edit.</p> : null}
        {status.kind === "openError" ? <p className="notice bad" role="alert">Couldn&apos;t open that file. {status.message} Your plan hasn&apos;t changed.</p> : null}
        {status.kind === "conflict" ? (
          <p className="notice bad" role="alert">
            This file changed since you opened it.{" "}
            <button className="link" type="button" onClick={reloadFromDisk}>Load the file</button> or{" "}
            <button className="link" type="button" onClick={() => void saveNow(plan, storage.overwrite)}>keep yours and overwrite it</button>.
          </p>
        ) : null}

        <Planner plan={plan} onChange={onChange} today={today} isExample={isExample} />

        <footer className="site">
          OpenChurn is{" "}
          <a href="https://github.com/thetemplateblog/openchurn" target="_blank" rel="noreferrer">open source on GitHub</a> under the MIT
          license. Plans never leave your computer. For live tracking from your bank
          accounts, see <a href="https://churntracker.app" target="_blank" rel="noreferrer">ChurnTracker</a>.
        </footer>
      </main>
    </>
  );
}
