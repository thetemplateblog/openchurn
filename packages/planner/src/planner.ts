// The paycheck rotation planner: given one paycheck and bonuses in order, when to open each account, which paychecks go
// where, and which bonuses fall short. Pure functions of the plan and today's date.
import { isCompleted } from "./completed.js";
import { DAY, type Day, fmtShort, money, parseDay } from "./dates.js";
import type { BonusInput, PaySettings, PlanInput } from "./types.js";

export type RotationStatus = "met" | "short" | "expired" | "no_window";

export interface RotationItem {
  bonus: BonusInput;
  step: number;
  status: RotationStatus;
  openOn: Day | null;
  windowEnd: Day | null;
  deposits: Day[];
  sum: number;
  short: number;
  alreadyOpen: boolean;
}

export interface SideItem {
  bonus: BonusInput;
  openedOn: Day | null;
  openBy: Day | null;
  expired: boolean;
  daysLeft: number | null;
}

export interface Flag {
  level: "good" | "warn" | "bad" | "info";
  label: string;
  bonusId: string;
  text: string;
}

export interface LedgerRow {
  payday: Day;
  bonusId: string | null;
  running: number;
  target: number;
  completes: boolean;
}

export interface Plan {
  paydays: Day[];
  rotation: RotationItem[];
  side: SideItem[];
  payrollHome: Day | null;
  ledger: LedgerRow[];
  flags: Flag[];
  onTrackTotal: number;
  shortfalls: number;
}

const MAX_PAYDAYS = 80;

export function paydaySchedule(nextPayday: string, freqDays: number, today: Day): Day[] {
  const step = (freqDays || 14) * DAY;
  let p = parseDay(nextPayday) ?? today;
  while (p < today) p += step;
  return Array.from({ length: MAX_PAYDAYS }, (_, i) => p + i * step);
}

/** Bonuses that need no paycheck (rule "none"), with how long is left to open them. */
export function sideItems(bonuses: BonusInput[], today: Day): SideItem[] {
  const side: SideItem[] = [];
  for (const bonus of bonuses) {
    // Received bonuses are done.
    if (!bonus.included || isCompleted(bonus) || bonus.rule !== "none") continue;
    const openBy = parseDay(bonus.openBy);
    const opened = parseDay(bonus.openedOn);
    side.push({
      bonus,
      openedOn: opened,
      openBy,
      expired: opened === null && openBy !== null && openBy < today,
      daysLeft: opened === null && openBy !== null ? Math.round((openBy - today) / DAY) : null,
    });
  }
  return side;
}

/** The whole plan for one paycheck: the queue, the bonuses alongside it, flags and totals. */
export function computePlan(input: PlanInput, today: Day): Plan {
  const { paydays, rotation, payrollHome, ledger } = planQueue(input.pay, input.bonuses, today);
  const side = sideItems(input.bonuses, today);
  const flags = buildFlags(rotation, side);
  const onTrackTotal =
    rotation.filter((r) => r.status === "met").reduce((s, r) => s + r.bonus.bonusAmount, 0) +
    side.filter((s) => !s.expired).reduce((s, x) => s + x.bonus.bonusAmount, 0);
  const shortfalls = rotation.filter((r) => r.status !== "met").length;
  return { paydays, rotation, side, payrollHome, ledger, flags, onTrackTotal, shortfalls };
}

/**
 * One paycheck's queue: its bonuses in order, each taking the next paychecks that fit its window. Received,
 * excluded and no-deposit bonuses are skipped.
 */
export function planQueue(pay: PaySettings, bonuses: BonusInput[], today: Day): { paydays: Day[]; rotation: RotationItem[]; payrollHome: Day | null; ledger: LedgerRow[] } {
  const amount = Math.max(0, Number(pay.amount) || 0);
  const stepMs = (pay.freqDays || 14) * DAY;
  const lead = pay.switchLead ?? 1;
  const paydays = paydaySchedule(pay.nextPayday, pay.freqDays, today);

  const rotation: RotationItem[] = [];
  let cursor = 0;
  let step = 0;

  for (const bonus of bonuses) {
    if (!bonus.included || isCompleted(bonus) || bonus.rule === "none") continue;
    const openBy = parseDay(bonus.openBy);
    const opened = parseDay(bonus.openedOn);

    step++;
    if (opened === null && openBy !== null && openBy < today) {
      rotation.push({ bonus, step, status: "expired", openOn: null, windowEnd: null, deposits: [], sum: 0, short: bonus.target, alreadyOpen: false });
      continue;
    }

    let openOn: Day;
    if (opened !== null) {
      openOn = opened;
    } else {
      // Open one day before the payday that is `lead` periods ahead of the next free paycheck.
      openOn = Math.max(today, paydays[cursor] - lead * stepMs - DAY);
      if (openBy !== null && openOn > openBy) openOn = openBy;
    }

    const windowEnd = openOn + Math.max(0, bonus.windowDays) * DAY;
    const firstEligible = openOn + Math.max(0, lead * stepMs - DAY);
    const minDeposits = Math.max(1, bonus.minDeposits || 0);

    let i = cursor;
    while (i < paydays.length && paydays[i] < firstEligible) i++;

    const deposits: Day[] = [];
    let sum = 0;
    if (amount > 0) {
      while (i < paydays.length && paydays[i] <= windowEnd && (sum < bonus.target || deposits.length < minDeposits)) {
        deposits.push(paydays[i]);
        sum += amount;
        i++;
      }
    }
    if (deposits.length) cursor = i;

    const met = deposits.length > 0 && sum >= bonus.target && deposits.length >= minDeposits;
    rotation.push({
      bonus,
      step,
      status: met ? "met" : deposits.length ? "short" : "no_window",
      openOn,
      windowEnd,
      deposits,
      sum,
      short: Math.max(0, bonus.target - sum),
      alreadyOpen: opened !== null,
    });
  }

  const usedAny = rotation.some((r) => r.deposits.length > 0);
  const payrollHome = usedAny ? paydays[cursor] : null;

  // Ledger: every payday up to and including the first one back home (at least 4 rows).
  const owner = new Map<Day, { r: RotationItem; idx: number }>();
  for (const r of rotation) r.deposits.forEach((d, idx) => owner.set(d, { r, idx }));
  const lastRow = Math.min(paydays.length - 1, Math.max(cursor, 3));
  const ledger: LedgerRow[] = [];
  for (let k = 0; k <= lastRow; k++) {
    const hit = owner.get(paydays[k]);
    if (hit) {
      const running = amount * (hit.idx + 1);
      ledger.push({
        payday: paydays[k],
        bonusId: hit.r.bonus.id,
        running,
        target: hit.r.bonus.target,
        completes: hit.r.status === "met" && hit.idx === hit.r.deposits.length - 1,
      });
    } else {
      ledger.push({ payday: paydays[k], bonusId: null, running: 0, target: 0, completes: false });
    }
  }

  return { paydays, rotation, payrollHome, ledger };
}

/**
 * The on-track total split by the year each bonus is met, earliest year first.
 * Queue bonuses: the last paycheck that meets them. Alongside: the end of the deposit window,
 * counted from the opened date, else the open-by date, else today. Not the year the bank pays.
 */
export function onTrackByYear(plan: Plan, today: Day): { year: number; total: number }[] {
  const dated: [Day, number][] = [
    ...plan.rotation.filter((r) => r.status === "met").map((r): [Day, number] => [r.deposits[r.deposits.length - 1], r.bonus.bonusAmount]),
    ...plan.side
      .filter((s) => !s.expired)
      .map((s): [Day, number] => [(s.openedOn ?? s.openBy ?? today) + Math.max(0, s.bonus.windowDays) * DAY, s.bonus.bonusAmount]),
  ];
  const years = new Map<number, number>();
  for (const [day, amount] of dated) {
    const year = new Date(day).getUTCFullYear();
    years.set(year, (years.get(year) ?? 0) + amount);
  }
  return [...years].sort((a, b) => a[0] - b[0]).map(([year, total]) => ({ year, total }));
}

/** Flags for every bonus, worst first: expired and short, then soon, then running and on track. */
export function buildFlags(rotation: RotationItem[], side: SideItem[]): Flag[] {
  const flags: Flag[] = [];
  for (const r of rotation) {
    const n = r.bonus.name;
    const id = r.bonus.id;
    const openHint = !r.alreadyOpen && r.openOn !== null ? ` Open it and submit the payroll switch by ${fmtShort(r.openOn)}.` : "";
    if (r.status === "expired") {
      flags.push({ level: "bad", label: "Expired", bonusId: id, text: `${n}: the open-by date has passed.` });
    } else if (r.status === "no_window") {
      flags.push({ level: "bad", label: "Short", bonusId: id, text: `${n}: no paychecks land inside its window. Move it earlier in the order or check the paycheck amount.` });
    } else if (r.status === "met") {
      const last = r.deposits[r.deposits.length - 1];
      flags.push({
        level: "good",
        label: "On track",
        bonusId: id,
        text: `${n}: target met on ${fmtShort(last)} with ${r.deposits.length} paycheck${r.deposits.length > 1 ? "s" : ""} (${money(r.sum)} of ${money(r.bonus.target)}).${openHint}`,
      });
    } else {
      const fix =
        r.bonus.rule === "ach"
          ? "Any ACH counts here, so a transfer from another bank can cover it."
          : "Send a bigger share of one paycheck, check for an alternate route, or move it earlier in the order.";
      flags.push({
        level: "bad",
        label: "Short",
        bonusId: id,
        text: `${n}: ${r.deposits.length} paycheck${r.deposits.length > 1 ? "s" : ""} fit, leaving it ${money(r.short)} short when the window closes ${fmtShort(r.windowEnd!)}. ${fix}${openHint}`,
      });
    }
  }
  for (const s of side) {
    const n = s.bonus.name;
    const id = s.bonus.id;
    const note = s.bonus.note ? ` ${s.bonus.note}` : "";
    if (s.expired) flags.push({ level: "bad", label: "Expired", bonusId: id, text: `${n}: the open-by date has passed.` });
    else if (s.openedOn !== null) flags.push({ level: "info", label: "Running", bonusId: id, text: `${n}: opened ${fmtShort(s.openedOn)}. No paycheck needed.${note}` });
    else if (s.openBy !== null && s.daysLeft !== null) {
      const soon = s.daysLeft <= 14;
      flags.push({
        level: soon ? "warn" : "info",
        label: soon ? "Soon" : "Open by",
        bonusId: id,
        text: `${n}: open by ${fmtShort(s.openBy)} (${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} left). No paycheck needed.${note}`,
      });
    }
  }
  const order = { bad: 0, warn: 1, info: 2, good: 3 } as const;
  return flags.sort((a, b) => order[a.level] - order[b.level]);
}
