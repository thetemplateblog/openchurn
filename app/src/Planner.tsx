import { useMemo, useState } from "react";
import {
  DAY,
  type BonusInput,
  type Day,
  type DepositRule,
  type PaySettings,
  type Plan,
  type PlanInput,
  completedByYear,
  computePlan,
  fmtLong,
  fmtShort,
  isCompleted,
  money,
  newBonus,
  offerLink,
  onTrackByYear,
  parseDay,
  toISODay,
} from "@openchurn/planner";

const RULE_LABEL: Record<DepositRule, string> = { payroll: "Paycheck only", ach: "Any ACH counts", none: "No direct deposit" };
const uuid = () => crypto.randomUUID();

/**
 * The paycheck rotation: your paycheck, the payroll queue with mini timelines, bonuses alongside it, completed ones by
 * year, and the payday-by-payday ledger. `onChange` gets every edit; the app decides where it's saved.
 */
export function Planner({ plan, onChange, today, isExample }: { plan: PlanInput; onChange: (next: PlanInput) => void; today: Day; isExample: boolean }) {
  // Bonus cards start collapsed to a one-line summary; expand one to edit it.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [payOpen, setPayOpen] = useState(false);
  const [tab, setTab] = useState<"queue" | "paychecks">("queue");
  const computed = useMemo(() => computePlan(plan, today), [plan, today]);

  const update = (fn: (p: PlanInput) => void) => {
    const next: PlanInput = JSON.parse(JSON.stringify(plan));
    fn(next);
    onChange(next);
  };
  const setBonus = (id: string, patch: Partial<BonusInput>) =>
    update((p) => {
      const b = p.bonuses.find((x) => x.id === id);
      if (b) Object.assign(b, patch);
    });
  const move = (i: number, dir: -1 | 1) =>
    update((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.bonuses.length) return;
      [p.bonuses[i], p.bonuses[j]] = [p.bonuses[j], p.bonuses[i]];
    });
  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const addBonus = () => {
    const id = uuid();
    update((p) => void p.bonuses.push(newBonus(id)));
    setExpanded((s) => new Set(s).add(id));
    setTab("queue");
  };

  const scale = makeScale(computed, today);
  const flagText = new Map(computed.flags.map((f) => [f.bonusId, f.text]));
  const rotationById = new Map(computed.rotation.map((r) => [r.bonus.id, r]));
  const sideById = new Map(computed.side.map((s) => [s.bonus.id, s]));
  const indexOf = new Map(plan.bonuses.map((b, i) => [b.id, i]));
  const active = plan.bonuses.filter((b) => !isCompleted(b));
  const queue = active.filter((b) => b.rule !== "none");
  const alongside = active.filter((b) => b.rule === "none");
  const completed = completedByYear(plan.bonuses);
  const shortNames = computed.rotation.filter((r) => r.status !== "met").map((r) => r.bonus.name);
  const onTrackCount = computed.rotation.filter((r) => r.status === "met").length + computed.side.filter((s) => !s.expired).length;
  const onTrackYears = onTrackByYear(computed, today);
  const pay = plan.pay;

  const rowProps = (b: BonusInput, first: boolean) => {
    const i = indexOf.get(b.id)!;
    return {
      b,
      first,
      open: expanded.has(b.id),
      message: (flagText.get(b.id) ?? "").replace(new RegExp(`^${escapeRe(b.name)}: `), ""),
      isFirst: i === 0,
      isLast: i === plan.bonuses.length - 1,
      onToggle: () => toggle(b.id),
      onChange: (patch: Partial<BonusInput>) => setBonus(b.id, patch),
      onMove: (dir: -1 | 1) => move(i, dir),
      onRemove: () => update((p) => void p.bonuses.splice(i, 1)),
      scale,
    };
  };

  return (
    <>
      <header className="page-head">
        <div className="section" style={{ gap: 6 }}>
          {isExample ? <span className="chip">Example plan</span> : null}
          <h1>Paycheck rotation</h1>
        </div>
      </header>

      <div className="strip">
        <div className="strip-cell">
          <span className="label">On track</span>
          <span className="strip-v">
            {money(computed.onTrackTotal)} <span className="strip-s">· {onTrackCount} account{onTrackCount === 1 ? "" : "s"}</span>
          </span>
          {onTrackYears.length > 1 ? (
            <span className="strip-s mono" title="Year each bonus is met (not paid)">
              {onTrackYears.map((y, i) => (
                <span key={y.year} style={{ whiteSpace: "nowrap" }}>
                  {i ? " · " : ""}
                  {y.year} {money(y.total)}
                </span>
              ))}
            </span>
          ) : null}
        </div>
        <div className="strip-cell">
          <span className="label">Paycheck back home</span>
          <span className="strip-v">{computed.payrollHome ? fmtLong(computed.payrollHome) : "—"}</span>
        </div>
        <div className={`strip-cell${computed.shortfalls ? " bad" : ""}`}>
          <span className="label">Shortfalls</span>
          <span className="strip-v">
            {computed.shortfalls} {shortNames.length ? <span className="strip-s">· {shortNames.join(", ")}</span> : null}
          </span>
        </div>
        <button className={`strip-cell pay-cell${payOpen ? " open" : ""}`} type="button" aria-expanded={payOpen} aria-controls="pay-editor" onClick={() => setPayOpen((o) => !o)}>
          <span className="row between">
            <span className="label">Your paycheck</span>
            <span className="pay-edit">{payOpen ? "Done" : "Edit"}</span>
          </span>
          <span className="strip-v">
            {money(pay.amount)} <span className="strip-s">· {pay.freqDays === 7 ? "weekly" : "2 wks"}</span>
          </span>
          <span className="strip-s mono">
            next {parseDay(pay.nextPayday) !== null ? fmtShort(parseDay(pay.nextPayday)!) : "—"} · switch{" "}
            {pay.switchLead === 0 ? "next paycheck" : `${pay.switchLead} paycheck${pay.switchLead > 1 ? "s" : ""} later`}
          </span>
        </button>
      </div>

      {payOpen ? (
        <section className="panel" id="pay-editor" aria-label="Your paycheck">
          <PayFields pay={pay} onChange={(patch) => update((p) => void Object.assign(p.pay, patch))} />
          <p className="hint">&quot;One paycheck later&quot;: the paycheck right after you submit the change still goes to the old bank.</p>
        </section>
      ) : null}

      <div className="tabs-bar">
        <div className="tabs" role="tablist" aria-label="Plan views">
          <button className={`tab${tab === "queue" ? " on" : ""}`} type="button" role="tab" aria-selected={tab === "queue"} onClick={() => setTab("queue")}>Queue</button>
          <button className={`tab${tab === "paychecks" ? " on" : ""}`} type="button" role="tab" aria-selected={tab === "paychecks"} onClick={() => setTab("paychecks")}>Paychecks</button>
        </div>
        <button className="btn ghost" type="button" onClick={addBonus}>Add bonus</button>
      </div>

      {tab === "queue" ? (
        <>
          <section className="qbox" aria-label="Payroll queue">
            <div className="qrow qhead" aria-hidden="true">
              <span className="label">Step</span>
              <span className="label">Bonus</span>
              <div className="qmonths">
                {scale.months.map((m) => (
                  <span key={m.at} style={{ left: scale.pos(m.at) }}>{m.label}</span>
                ))}
              </div>
              <span className="label">Status</span>
              <span className="label">Act by</span>
              <span />
            </div>
            {queue.length ? (
              queue.map((b, k) => <QueueRow key={b.id} {...rowProps(b, k === 0)} item={rotationById.get(b.id) ?? null} today={today} />)
            ) : (
              <p className="hint qempty">No payroll bonuses yet. Use Add bonus to start the queue.</p>
            )}
          </section>

          {alongside.length ? (
            <section className="section" aria-label="Alongside">
              <h2>Alongside <span className="hint" style={{ fontWeight: 400 }}>· no paycheck needed</span></h2>
              <div className="qbox">
                {alongside.map((b, k) => (
                  <SideRow key={b.id} {...rowProps(b, k === 0)} item={sideById.get(b.id) ?? null} today={today} />
                ))}
              </div>
            </section>
          ) : null}

          {completed.length ? (
            <section className="section" aria-label="Completed">
              <h2>Completed <span className="hint" style={{ fontWeight: 400 }}>· bonuses received</span></h2>
              {completed.map((y) => (
                <div key={y.year} className="section" style={{ gap: 6 }}>
                  <div className="row between year-head">
                    <h3>{y.year}</h3>
                    <span className="mono">
                      {money(y.total)} <span className="hint">· {y.bonuses.length} bonus{y.bonuses.length === 1 ? "" : "es"}</span>
                    </span>
                  </div>
                  <div className="qbox">
                    {y.bonuses.map((b, k) => (
                      <CompletedRow key={b.id} {...rowProps(b, k === 0)} today={today} />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ) : null}
        </>
      ) : (
        <Ledger ledger={computed.ledger} plan={plan} />
      )}

      <footer className="site">
        This plan assumes you open each account and submit the payroll change on the same day, each paycheck posts on payday,
        and the deposit window starts the day you open the account. Confirm every requirement on the bank&apos;s own offer page.
      </footer>
    </>
  );
}

/** "Offer ↗" linking to the bonus's offer page, when it has a valid one. */
function OfferLink({ url }: { url: string }) {
  const link = offerLink(url);
  if (!link) return null;
  return (
    <>
      {" · "}
      <a href={link} target="_blank" rel="noopener noreferrer" className="offer-link">Offer ↗</a>
    </>
  );
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Scale {
  pos: (t: Day) => string;
  wid: (a: Day, b: Day) => string;
  months: { at: Day; label: string }[];
  todayLeft: string;
}

/** One month scale shared by every row so the mini timelines line up. */
function makeScale(computed: Plan, today: Day): Scale {
  const pts: Day[] = [today];
  for (const r of computed.rotation) {
    if (r.openOn !== null) pts.push(r.openOn);
    if (r.windowEnd !== null) pts.push(r.windowEnd);
    const ob = parseDay(r.bonus.openBy);
    if (ob !== null) pts.push(ob);
  }
  for (const s of computed.side) {
    if (s.openedOn !== null) pts.push(s.openedOn);
    if (s.openBy !== null) pts.push(s.openBy);
  }
  const start = Math.min(...pts) - 3 * DAY;
  const end = Math.max(...pts) + 10 * DAY;
  const pos = (t: Day) => `${(((t - start) / (end - start)) * 100).toFixed(2)}%`;
  const wid = (a: Day, b: Day) => `${(((b - a) / (end - start)) * 100).toFixed(2)}%`;
  const months: { at: Day; label: string }[] = [];
  const s0 = new Date(start);
  for (let m = Date.UTC(s0.getUTCFullYear(), s0.getUTCMonth() + 1, 1); m < end; ) {
    const d = new Date(m);
    months.push({
      at: m,
      label: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) + (d.getUTCMonth() === 0 ? ` ’${String(d.getUTCFullYear()).slice(2)}` : ""),
    });
    m = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  return { pos, wid, months, todayLeft: pos(today) };
}

interface RowProps {
  b: BonusInput;
  first: boolean;
  open: boolean;
  message: string;
  isFirst: boolean;
  isLast: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<BonusInput>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  scale: Scale;
  today: Day;
}

function QueueRow(props: RowProps & { item: Plan["rotation"][number] | null }) {
  const { b, item, scale, open } = props;
  const off = !b.included || !item;
  let pill = "pill good";
  let status = "On track";
  if (off) {
    pill = "pill quiet";
    status = "Not in plan";
  } else if (item.status === "expired") {
    pill = "pill bad";
    status = "Expired";
  } else if (item.status === "no_window") {
    pill = "pill bad";
    status = "No paychecks fit";
  } else if (item.status === "short") {
    pill = "pill bad";
    status = `${money(item.short)} short`;
  }
  const actBy = off || item.status === "expired" ? "—" : item.alreadyOpen ? "Opened" : item.openOn !== null ? fmtShort(item.openOn) : "—";
  const ob = parseDay(b.openBy);
  const n = item?.deposits.length ?? 0;
  return (
    <div className={`qitem${props.first ? "" : " divided"}${open ? " open" : ""}${b.included ? "" : " off"}`}>
      <div className="qrow">
        <span className="qstep mono">{off ? "–" : item.step}</span>
        <div className="qname">
          <b>{b.name || "Untitled bonus"}</b>
          <span className="sub">
            {money(b.bonusAmount)}
            <OfferLink url={b.offerUrl} />
            {` · ${RULE_LABEL[b.rule]}`}
            {off ? "" : ` · ${n} paycheck${n === 1 ? "" : "s"}`}
          </span>
        </div>
        <div className="qtrack">
          <span className="tl-today" style={{ left: scale.todayLeft }} />
          {!off && item.openOn !== null && item.windowEnd !== null ? (
            <span className={`tl-win${item.status === "met" ? "" : " short"}`} style={{ left: scale.pos(item.openOn), width: scale.wid(item.openOn, item.windowEnd) }}
              title={`Window ${fmtShort(item.openOn)} to ${fmtShort(item.windowEnd)}`} />
          ) : null}
          {!off
            ? item.deposits.map((d, i) => (
                <span key={d} className={`tl-dep${item.status === "met" && i === item.deposits.length - 1 ? " done" : ""}`} style={{ left: scale.pos(d) }}
                  data-tip={`Paycheck ${fmtShort(d)}`} />
              ))
            : null}
          {!off && ob !== null ? <span className="tl-dl" style={{ left: scale.pos(ob) }} title={`Open by ${fmtShort(ob)}`} /> : null}
        </div>
        <span className={`${pill} qstatus`}>{status}</span>
        <span className={`qact mono${actBy === "Opened" || actBy === "—" ? " quiet" : ""}`}>{actBy}</span>
        <button className="icon-btn qtoggle" type="button" aria-expanded={open} aria-label={`${open ? "Collapse" : "Edit"} ${b.name || "bonus"}`} onClick={props.onToggle}>
          {open ? "⌄" : "›"}
        </button>
      </div>
      {open ? <RowEditor {...props} /> : null}
    </div>
  );
}

function SideRow(props: RowProps & { item: Plan["side"][number] | null }) {
  const { b, item, scale, open, today } = props;
  const off = !b.included || !item;
  let pill = "pill quiet";
  let status = "Open by";
  if (off) status = "Not in plan";
  else if (item.expired) {
    pill = "pill bad";
    status = "Expired";
  } else if (item.openedOn !== null) status = "Running";
  else if (item.daysLeft !== null && item.daysLeft <= 14) {
    pill = "pill warn";
    status = "Soon";
  }
  const opened = parseDay(b.openedOn);
  const openBy = parseDay(b.openBy);
  const from = opened ?? today;
  const to = openBy ?? from;
  const actBy = opened !== null ? "Opened" : openBy !== null ? fmtShort(openBy) : "—";
  return (
    <div className={`qitem${props.first ? "" : " divided"}${open ? " open" : ""}${b.included ? "" : " off"}`}>
      <div className="qrow">
        <span className="pill quiet qstep-side">side</span>
        <div className="qname">
          <b>{b.name || "Untitled bonus"}</b>
          <span className="sub">
            {money(b.bonusAmount)}
            <OfferLink url={b.offerUrl} />
            {b.note ? ` · ${b.note}` : ""}
          </span>
        </div>
        <div className="qtrack">
          <span className="tl-today" style={{ left: scale.todayLeft }} />
          {to > from ? <span className="tl-win side" style={{ left: scale.pos(from), width: scale.wid(from, to) }} /> : null}
          {openBy !== null ? <span className="tl-dl" style={{ left: scale.pos(openBy) }} title={`Open by ${fmtShort(openBy)}`} /> : null}
        </div>
        <span className={`${pill} qstatus`}>{status}</span>
        <span className={`qact mono${actBy === "Opened" || actBy === "—" ? " quiet" : ""}`}>{actBy}</span>
        <button className="icon-btn qtoggle" type="button" aria-expanded={open} aria-label={`${open ? "Collapse" : "Edit"} ${b.name || "bonus"}`} onClick={props.onToggle}>
          {open ? "⌄" : "›"}
        </button>
      </div>
      {open ? <RowEditor {...props} /> : null}
    </div>
  );
}

function CompletedRow(props: RowProps) {
  const { b, open } = props;
  const received = parseDay(b.completedOn);
  return (
    <div className={`qitem done${props.first ? "" : " divided"}${open ? " open" : ""}`}>
      <div className="qrow">
        <span className="pill good qstep-side" aria-hidden="true">✓</span>
        <div className="qname">
          <b>{b.name || "Untitled bonus"}</b>
          <span className="sub">
            {money(b.bonusAmount)}
            <OfferLink url={b.offerUrl} />
            {` · ${RULE_LABEL[b.rule]}`}
          </span>
        </div>
        <span className="pill good qstatus">Received</span>
        <span className="qact mono">{received !== null ? fmtShort(received) : "—"}</span>
        <button className="icon-btn qtoggle" type="button" aria-expanded={open} aria-label={`${open ? "Collapse" : "Edit"} ${b.name || "bonus"}`} onClick={props.onToggle}>
          {open ? "⌄" : "›"}
        </button>
      </div>
      {open ? <RowEditor {...props} /> : null}
    </div>
  );
}

function RowEditor({ b, message, isFirst, isLast, onChange, onMove, onRemove, today }: RowProps) {
  const done = isCompleted(b);
  return (
    <div className="qedit" id={`b-${b.id}-body`}>
      {message ? <p className="qmsg">{message}</p> : null}
      <div className="fields four">
        <label className="f span2">
          Bank name
          <input id={`b-${b.id}-name`} value={b.name} onChange={(e) => onChange({ name: e.target.value })} />
        </label>
        <NumField id={`b-${b.id}-bonus`} label="Bonus ($)" value={b.bonusAmount} onChange={(v) => onChange({ bonusAmount: v })} />
        <label className="f">
          Deposit rule
          <select id={`b-${b.id}-rule`} value={b.rule} onChange={(e) => onChange({ rule: e.target.value as DepositRule })}>
            {(Object.keys(RULE_LABEL) as DepositRule[]).map((r) => (
              <option key={r} value={r}>{RULE_LABEL[r]}</option>
            ))}
          </select>
        </label>
        {b.rule !== "none" ? (
          <>
            <NumField id={`b-${b.id}-target`} label="Deposits needed ($)" value={b.target} onChange={(v) => onChange({ target: v })} />
            <NumField id={`b-${b.id}-min`} label="Minimum deposits" value={b.minDeposits} onChange={(v) => onChange({ minDeposits: v })} />
          </>
        ) : null}
        <NumField id={`b-${b.id}-window`} label="Window (days)" value={b.windowDays} onChange={(v) => onChange({ windowDays: v })} />
        <label className="f">
          Opened on
          <input id={`b-${b.id}-opened`} type="date" value={b.openedOn} onChange={(e) => onChange({ openedOn: e.target.value })} />
        </label>
        <label className="f">
          Open by
          <input id={`b-${b.id}-openby`} type="date" value={b.openBy} onChange={(e) => onChange({ openBy: e.target.value })} />
        </label>
        <label className="f span2">
          Notes
          <input id={`b-${b.id}-note`} value={b.note} onChange={(e) => onChange({ note: e.target.value })} />
        </label>
        <label className="f">
          Bonus received
          <input id={`b-${b.id}-received`} type="date" value={b.completedOn} onChange={(e) => onChange({ completedOn: e.target.value })} />
        </label>
        <label className="f full">
          Offer URL
          <input
            id={`b-${b.id}-offer`}
            type="url"
            inputMode="url"
            placeholder="The bank's offer page"
            value={b.offerUrl}
            onChange={(e) => onChange({ offerUrl: e.target.value })}
          />
          {b.offerUrl.trim() && !offerLink(b.offerUrl) ? <span className="hint warn">Not a web address.</span> : null}
        </label>
      </div>
      <details className="more">
        <summary>Debit and balance requirements</summary>
        <div className="fields four">
          <NumField id={`b-${b.id}-debit`} label="Debit purchases needed" value={b.debitRequired} onChange={(v) => onChange({ debitRequired: v })} />
          <NumField id={`b-${b.id}-debitmin`} label="Each at least ($)" value={b.debitMinAmount} onChange={(v) => onChange({ debitMinAmount: v })} />
          <NumField id={`b-${b.id}-bal`} label="Balance to hold ($)" value={b.balanceRequired} onChange={(v) => onChange({ balanceRequired: v })} />
          <NumField id={`b-${b.id}-hold`} label="Hold for (days)" value={b.holdDays} onChange={(v) => onChange({ holdDays: v })} />
        </div>
      </details>
      <div className="qactions">
        <label className="check">
          <input id={`b-${b.id}-on`} type="checkbox" checked={b.included} onChange={(e) => onChange({ included: e.target.checked })} />
          Include in plan
        </label>
        <button className="linkbtn" type="button" onClick={() => onChange({ completedOn: done ? "" : toISODay(today) })}>
          {done ? "Not received yet" : "Mark received"}
        </button>
        <button className="linkbtn" type="button" disabled={isFirst} onClick={() => onMove(-1)}>Move up</button>
        <button className="linkbtn" type="button" disabled={isLast} onClick={() => onMove(1)}>Move down</button>
        <button className="linkbtn" type="button" onClick={onRemove}>Remove</button>
      </div>
    </div>
  );
}

/** The paycheck's fields. */
function PayFields({ pay, onChange }: { pay: PaySettings; onChange: (patch: Partial<PaySettings>) => void }) {
  return (
    <div className="fields four">
      <label className="f">
        Amount you can move ($)
        <input id="pay-amount" type="number" min={0} step={50} value={pay.amount} onChange={(e) => onChange({ amount: Number(e.target.value) || 0 })} />
      </label>
      <label className="f">
        How often
        <select id="pay-freq" value={pay.freqDays} onChange={(e) => onChange({ freqDays: Number(e.target.value) === 7 ? 7 : 14 })}>
          <option value={7}>Weekly</option>
          <option value={14}>Every two weeks</option>
        </select>
      </label>
      <label className="f">
        Next payday
        <input id="pay-next" type="date" value={pay.nextPayday} onChange={(e) => onChange({ nextPayday: e.target.value })} />
      </label>
      <label className="f">
        Switch takes effect
        <select id="pay-lead" value={pay.switchLead} onChange={(e) => onChange({ switchLead: Number(e.target.value) as 0 | 1 | 2 })}>
          <option value={0}>Next paycheck</option>
          <option value={1}>One paycheck later</option>
          <option value={2}>Two paychecks later</option>
        </select>
      </label>
    </div>
  );
}

function NumField({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="f">
      {label}
      <input id={id} type="number" min={0} value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} />
    </label>
  );
}

function Ledger({ ledger, plan }: { ledger: Plan["ledger"]; plan: PlanInput }) {
  const byId = new Map(plan.bonuses.map((b) => [b.id, b]));
  return (
    <section className="scroller" aria-label="Where each paycheck goes">
      <table>
        <thead>
          <tr>
            <th>Payday</th>
            <th>Deposit to</th>
            <th>Progress toward target</th>
          </tr>
        </thead>
        <tbody>
          {ledger.map((row) => {
            const b = row.bonusId ? byId.get(row.bonusId) : null;
            if (!b) {
              return (
                <tr key={row.payday}>
                  <td className="mono">{fmtLong(row.payday)}</td>
                  <td className="home">Your main account</td>
                  <td className="home">—</td>
                </tr>
              );
            }
            const pct = Math.min(100, (row.running / (row.target || 1)) * 100);
            return (
              <tr key={row.payday}>
                <td className="mono">{fmtLong(row.payday)}</td>
                <td><b>{b.name}</b></td>
                <td className="mono">
                  {money(row.running)} of {money(row.target)}
                  {row.completes ? " ✓" : ""}
                  <span className="bar"><i className={row.completes ? "full" : ""} style={{ width: `${pct}%` }} /></span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
