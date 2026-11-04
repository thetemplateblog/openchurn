// The paycheck rotation planner: given one paycheck and bonuses in order, when to open each account, which paychecks go
// where, and which bonuses fall short. Pure functions of the plan and today's date.
import { isCompleted } from "./completed.js";
import { DAY, type Day, fmtShort, money, parseDay, toISODay } from "./dates.js";
import type { BonusInput, PaySettings, PlanInput, PlanOptions, SplitChoice } from "./types.js";

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
  /** Dollars per entry of `deposits`, when the plan splits paychecks (spec 024). */
  amounts?: number[];
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
  /** On a payday chosen to be split: who gets what. `bonusId` is then the last bank in the split (null if none). */
  split?: SplitLine;
}

/** One bank's part of a split payday. `bonusId` null means the payroll home. */
export interface SplitShare {
  bonusId: string | null;
  amount: number;
  /** The last share takes whatever is left of the paycheck; the others are fixed amounts. */
  leftover: boolean;
}

/** What to give the employer for one split payday. */
export interface SplitLine {
  shares: SplitShare[];
  /** The last day to submit it, from the switch lead. */
  submitBy: Day;
  /** The banks or fixed amounts differ from the payday before. */
  change: boolean;
  /** Chosen, but its submit-by date has passed: the payday is planned whole. */
  tooLate: boolean;
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
export function computePlan(input: PlanInput, today: Day, options?: PlanOptions): Plan {
  const { paydays, rotation, payrollHome, ledger } = planQueue(input.pay, input.bonuses, today, options);
  const side = sideItems(input.bonuses, today);
  const flags = buildFlags(rotation, side);
  const onTrackTotal =
    rotation.filter((r) => r.status === "met").reduce((s, r) => s + r.bonus.bonusAmount, 0) +
    side.filter((s) => !s.expired).reduce((s, x) => s + x.bonus.bonusAmount, 0);
  const shortfalls = rotation.filter((r) => r.status !== "met").length;
  return { paydays, rotation, side, payrollHome, ledger, flags, onTrackTotal, shortfalls };
}

export interface Queue {
  paydays: Day[];
  rotation: RotationItem[];
  payrollHome: Day | null;
  ledger: LedgerRow[];
}

/**
 * One paycheck's queue: its bonuses in order, each taking the next paychecks that fit its window. Received,
 * excluded and no-deposit bonuses are skipped. With `{ split: true }`, paydays chosen in `pay.split` are shared
 * across banks (spec 024); without it, or with no split paydays, every payday goes whole to one bank.
 */
export function planQueue(pay: PaySettings, bonuses: BonusInput[], today: Day, options?: PlanOptions): Queue {
  if (options?.split && pay.split && (Number(pay.amount) || 0) > 0) {
    const paydays = paydaySchedule(pay.nextPayday, pay.freqDays, today);
    if (paydays.some((d) => isSplitDay(pay.split, d))) return planSplitQueue(pay, bonuses, today, paydays);
  }
  return planWholeQueue(pay, bonuses, today);
}

function planWholeQueue(pay: PaySettings, bonuses: BonusInput[], today: Day): Queue {
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

/** Whether a payday is split: every payday from `from` on, plus `on`, minus `off`. */
export function isSplitDay(choice: SplitChoice | undefined, day: Day): boolean {
  if (!choice) return false;
  const d = toISODay(day);
  if (choice.off?.includes(d)) return false;
  if (choice.on?.includes(d)) return true;
  return !!choice.from && d >= choice.from;
}

/** Rounds dollars up to the next $50. */
export function ceil50(n: number): number {
  return Math.ceil(Math.max(0, n) / 50) * 50;
}

/** The last day to give the employer the routing for `paydays[index]`: the day before the payday a lead ahead of it. */
export function submitBy(paydays: Day[], index: number, pay: PaySettings): Day {
  const stepMs = (pay.freqDays || 14) * DAY;
  return paydays[0] + (index - (pay.switchLead ?? 1)) * stepMs - DAY;
}

interface SplitState {
  bonus: BonusInput;
  item: RotationItem;
  /** False until the queue reaches it and its open date is set. */
  reached: boolean;
  firstEligible: Day;
  minDeposits: number;
  done: boolean;
}

/**
 * The queue when some paydays are split (spec 024), one payday at a time. A whole payday goes to the first bank in
 * the queue that still needs deposits, as in `planWholeQueue`. A split payday gives each bank in queue order what it
 * still needs, spread over the deposits it still needs, rounded up to $50 and at least its minimum per deposit; the
 * last bank that got money takes the leftover. A bank that can't be paid yet, or whose minimum is more than what's
 * left, stops the split. When no bank still needs anything, the leftover goes back home.
 */
function planSplitQueue(pay: PaySettings, bonuses: BonusInput[], today: Day, paydays: Day[]): Queue {
  const amount = Math.max(0, Number(pay.amount) || 0);
  const stepMs = (pay.freqDays || 14) * DAY;
  const lead = pay.switchLead ?? 1;

  const states: SplitState[] = [];
  let step = 0;
  for (const bonus of bonuses) {
    if (!bonus.included || isCompleted(bonus) || bonus.rule === "none") continue;
    step++;
    const openBy = parseDay(bonus.openBy);
    const opened = parseDay(bonus.openedOn);
    const expired = opened === null && openBy !== null && openBy < today;
    const item: RotationItem = {
      bonus, step, status: expired ? "expired" : "no_window", openOn: null, windowEnd: null, deposits: [], sum: 0,
      short: bonus.target, alreadyOpen: opened !== null, amounts: [],
    };
    states.push({ bonus, item, reached: false, firstEligible: 0, minDeposits: Math.max(1, bonus.minDeposits || 0), done: expired });
  }

  // The queue reaches a bank at payday d: it opens as late as possible to catch d (or by its open-by date).
  const reach = (s: SplitState, d: Day) => {
    if (s.reached) return;
    s.reached = true;
    const opened = parseDay(s.bonus.openedOn);
    const openBy = parseDay(s.bonus.openBy);
    let openOn = opened ?? Math.max(today, d - lead * stepMs - DAY);
    if (opened === null && openBy !== null && openOn > openBy) openOn = openBy;
    s.item.openOn = openOn;
    s.item.windowEnd = openOn + Math.max(0, s.bonus.windowDays) * DAY;
    s.firstEligible = openOn + Math.max(0, lead * stepMs - DAY);
  };
  const isMet = (s: SplitState) => s.item.sum >= s.bonus.target && s.item.deposits.length >= s.minDeposits;
  // A bank stops taking paychecks once it's met, or once its window has closed.
  const settle = (s: SplitState, d: Day) => {
    if (!s.done && s.reached && (isMet(s) || d > s.item.windowEnd!)) s.done = true;
  };
  const pay_ = (s: SplitState, d: Day, dollars: number) => {
    s.item.deposits.push(d);
    s.item.amounts!.push(dollars);
    s.item.sum += dollars;
  };
  /** The first bank still in the queue at payday d, reached; null when the queue is done. */
  const head = (d: Day): SplitState | null => {
    for (const s of states) {
      if (s.done) continue;
      reach(s, d);
      settle(s, d);
      if (!s.done) return s;
    }
    return null;
  };
  const eligible = (s: SplitState, d: Day) => d >= s.firstEligible && d <= s.item.windowEnd!;

  type Route = { bonusId: string | null; amount: number; leftover: boolean }[];
  const lines = new Map<Day, SplitLine>();
  const leftoverOf = new Map<Day, string | null>();
  let lastUsed = -1;
  let prev: Route | null = null;
  let queueDone = false;

  for (let k = 0; k < paydays.length && !queueDone; k++) {
    const d = paydays[k];
    const chosen = isSplitDay(pay.split, d);
    const by = submitBy(paydays, k, pay);
    const tooLate = chosen && by < today;
    let route: Route;

    if (chosen && !tooLate) {
      route = [];
      let left = amount;
      let last: SplitState | null = null;
      for (const s of states) {
        if (left <= 0) break;
        if (s.done) continue;
        reach(s, d);
        settle(s, d);
        if (s.done) continue;
        if (!eligible(s, d)) break;
        const min = Math.max(0, Number(s.bonus.minPerDeposit) || 0);
        if (left < min) break;
        const needDollars = Math.max(0, s.bonus.target - s.item.sum);
        const needDeposits = Math.max(1, s.minDeposits - s.item.deposits.length);
        const share = Math.min(left, Math.max(min, ceil50(needDollars / needDeposits), 50));
        pay_(s, d, share);
        route.push({ bonusId: s.bonus.id, amount: share, leftover: false });
        left -= share;
        last = s;
      }
      const stillNeeded = states.some((s) => !s.done && !isMet(s));
      if (left > 0 && last && stillNeeded) {
        last.item.amounts![last.item.amounts!.length - 1] += left;
        last.item.sum += left;
        route[route.length - 1].amount += left;
      } else if (left > 0) {
        route.push({ bonusId: null, amount: left, leftover: false });
      }
      route[route.length - 1].leftover = true;
      if (route.some((r) => r.bonusId !== null)) lastUsed = k;
    } else {
      const s = head(d);
      if (s && eligible(s, d)) {
        pay_(s, d, amount);
        route = [{ bonusId: s.bonus.id, amount, leftover: true }];
        lastUsed = k;
      } else {
        route = [{ bonusId: null, amount, leftover: true }];
      }
    }
    for (const s of states) settle(s, d);

    if (chosen) {
      const fixed = (r: Route) => r.map((x) => `${x.bonusId}:${x.leftover ? "rest" : x.amount}`).join("|");
      lines.set(d, { shares: route, submitBy: by, change: prev !== null && fixed(prev) !== fixed(route), tooLate });
    }
    // The ledger row follows the last bank in the split, so its progress shows even when the leftover goes home.
    leftoverOf.set(d, [...route].reverse().find((r) => r.bonusId !== null)?.bonusId ?? null);
    prev = route;
    queueDone = states.every((s) => s.done);
  }

  // Banks the queue never reached before the paydays ran out are planned from the payday after the last one used.
  for (const s of states) if (!s.reached && !s.done) reach(s, paydays[Math.min(paydays.length - 1, lastUsed + 1)]);

  const rotation = states.map(({ item, bonus }) => {
    if (item.status === "expired") return { ...item, amounts: [] };
    const met = item.deposits.length > 0 && item.sum >= bonus.target && item.deposits.length >= Math.max(1, bonus.minDeposits || 0);
    const status: RotationStatus = met ? "met" : item.deposits.length ? "short" : "no_window";
    return { ...item, status, short: Math.max(0, bonus.target - item.sum) };
  });

  const cursor = lastUsed + 1;
  const payrollHome = rotation.some((r) => r.deposits.length > 0) ? paydays[cursor] : null;

  // Ledger: every payday up to and including the first one back home (at least 4 rows), as in `planWholeQueue`.
  const running = new Map<string, number>();
  const byBonus = new Map(rotation.map((r) => [r.bonus.id, r]));
  const lastRow = Math.min(paydays.length - 1, Math.max(cursor, 3));
  const ledger: LedgerRow[] = [];
  for (let k = 0; k <= lastRow; k++) {
    const d = paydays[k];
    for (const r of rotation) {
      const i = r.deposits.indexOf(d);
      if (i >= 0) running.set(r.bonus.id, (running.get(r.bonus.id) ?? 0) + r.amounts![i]);
    }
    const id = leftoverOf.get(d) ?? null;
    const r = id ? byBonus.get(id)! : null;
    const row: LedgerRow = r
      ? {
          payday: d,
          bonusId: id,
          running: running.get(id!) ?? 0,
          target: r.bonus.target,
          completes: r.status === "met" && r.deposits[r.deposits.length - 1] === d,
        }
      : { payday: d, bonusId: null, running: 0, target: 0, completes: false };
    const line = lines.get(d);
    if (line) row.split = line;
    ledger.push(row);
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
