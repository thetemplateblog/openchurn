// Paycheck splitting (ChurnTracker spec 024): on split paydays the paycheck is shared across banks in queue order,
// fixed amounts to each bank but the last, and the leftover to the last.
import { describe, expect, it } from "vitest";
import { ceil50, computePlan, isSplitDay, planQueue, submitBy } from "./planner.js";
import { EXAMPLE_PLAN, newBonus } from "./example.js";
import { parseDay, toISODay } from "./dates.js";
import type { BonusInput, PlanInput } from "./types.js";

const iso = (d: number | null) => (d === null ? null : toISODay(d));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const day = (s: string) => parseDay(s)!;
const bonus = (id: string, patch: Partial<BonusInput>): BonusInput => ({ ...newBonus(id), name: id, ...patch });
const SPLIT = { split: true };

// The motivating plan: $2,000 every two weeks, lead 1, today 2026-11-04 (so Nov 12 is already fixed).
const TODAY = day("2026-11-04");
const motivating = (): PlanInput => ({
  pay: { amount: 2000, freqDays: 14, nextPayday: "2026-11-12", switchLead: 1, split: { from: "2026-11-26" } },
  bonuses: [
    // Opened, with $72 still needed (live tracking passes in what's left).
    bonus("truist", { bonusAmount: 400, rule: "payroll", target: 72, minDeposits: 1, windowDays: 120, openedOn: "2026-10-01" }),
    bonus("capone", { bonusAmount: 400, rule: "payroll", target: 1000, minDeposits: 2, minPerDeposit: 500, windowDays: 90 }),
    bonus("chase", { bonusAmount: 900, rule: "payroll", target: 10000, minDeposits: 1, windowDays: 90, openBy: "2026-11-12" }),
  ],
});
const byId = (plan: ReturnType<typeof computePlan>) => Object.fromEntries(plan.rotation.map((r) => [r.bonus.id, r]));
const rowOn = (plan: ReturnType<typeof computePlan>, d: string) => plan.ledger.find((r) => iso(r.payday) === d)!;
const shares = (plan: ReturnType<typeof computePlan>, d: string) =>
  rowOn(plan, d).split!.shares.map((s) => [s.bonusId, s.amount, s.leftover] as const);

describe("splitting is off unless asked for", () => {
  const today = day("2026-10-17");

  it("split days without { split: true } change nothing", () => {
    const input = clone(EXAMPLE_PLAN);
    input.pay.split = { from: "2026-10-23" };
    expect(computePlan(input, today)).toEqual(computePlan(EXAMPLE_PLAN, today));
  });

  it("{ split: true } without split days changes nothing", () => {
    expect(computePlan(EXAMPLE_PLAN, today, SPLIT)).toEqual(computePlan(EXAMPLE_PLAN, today));
  });

  it("the split pass gives the 1.0 queue when every bonus is done before the first split payday", () => {
    // The worked example's payroll is home Apr 23 2027; splitting from 2027-06 runs the split pass but changes no bonus.
    const input = clone(EXAMPLE_PLAN);
    input.pay.split = { from: "2027-06-04" };
    const legacy = planQueue(EXAMPLE_PLAN.pay, EXAMPLE_PLAN.bonuses, today);
    const split = planQueue(input.pay, input.bonuses, today, SPLIT);
    expect(split.rotation.map(({ amounts, ...r }) => r)).toEqual(legacy.rotation);
    expect(split.payrollHome).toBe(legacy.payrollHome);
    expect(split.ledger).toEqual(legacy.ledger);
  });
});

describe("the motivating plan", () => {
  it("whole paychecks leave Chase $2,000 short", () => {
    const plan = computePlan(motivating(), TODAY);
    const r = byId(plan);
    expect(r.truist.deposits.map(iso)).toEqual(["2026-11-12"]);
    expect(r.capone.deposits.map(iso)).toEqual(["2026-11-26", "2026-12-10"]);
    expect(r.chase.status).toBe("short");
    expect(r.chase.short).toBe(2000);
  });

  it("splitting from Nov 26 puts every bonus on track", () => {
    const plan = computePlan(motivating(), TODAY, SPLIT);
    const r = byId(plan);
    expect(r.truist.status).toBe("met");
    expect(r.truist.deposits.map(iso)).toEqual(["2026-11-12"]);
    expect(r.capone.deposits.map(iso)).toEqual(["2026-11-26", "2026-12-10"]);
    expect(r.capone.amounts).toEqual([500, 500]);
    expect(r.capone.status).toBe("met");
    // Feb 4: Chase needs only $1,000 more, so the other $1,000 goes back home.
    expect(r.chase.amounts).toEqual([1500, 1500, 2000, 2000, 2000, 1000]);
    expect(iso(r.chase.deposits[r.chase.deposits.length - 1])).toBe("2027-02-04");
    expect(r.chase.sum).toBe(10000);
    expect(shares(plan, "2027-02-04")).toEqual([["chase", 1000, false], [null, 1000, true]]);
    expect(iso(plan.payrollHome)).toBe("2027-02-18");
    // The row still shows Chase's progress when the leftover goes home.
    expect(rowOn(plan, "2027-02-04")).toMatchObject({ bonusId: "chase", running: 10000, completes: true });
    expect(r.chase.status).toBe("met");
    expect(plan.shortfalls).toBe(0);
  });

  it("each split payday is one line: fixed amounts, then the leftover bank", () => {
    const plan = computePlan(motivating(), TODAY, SPLIT);
    expect(shares(plan, "2026-11-26")).toEqual([["capone", 500, false], ["chase", 1500, true]]);
    expect(shares(plan, "2026-12-10")).toEqual([["capone", 500, false], ["chase", 1500, true]]);
    // Once Capital One 360 is done, Chase takes the whole paycheck as the leftover.
    expect(shares(plan, "2026-12-24")).toEqual([["chase", 2000, true]]);
    expect(rowOn(plan, "2026-11-26").bonusId).toBe("chase");
    expect(rowOn(plan, "2026-11-12").split).toBeUndefined();
  });

  it("shares add up to the paycheck, with exactly one leftover, last", () => {
    const plan = computePlan(motivating(), TODAY, SPLIT);
    for (const row of plan.ledger.filter((r) => r.split && !r.split.tooLate)) {
      expect(row.split!.shares.reduce((s, x) => s + x.amount, 0)).toBe(2000);
      expect(row.split!.shares.filter((x) => x.leftover)).toHaveLength(1);
      expect(row.split!.shares[row.split!.shares.length - 1].leftover).toBe(true);
    }
    for (const r of plan.rotation) if (r.amounts) expect(r.amounts.reduce((s, x) => s + x, 0)).toBe(r.sum);
  });
});

describe("share sizes", () => {
  it("rounds up to the next $50", () => {
    expect(ceil50(72)).toBe(100);
    expect(ceil50(100)).toBe(100);
    expect(ceil50(0)).toBe(0);
    expect(ceil50(1)).toBe(50);
  });

  const twoBanks = (first: Partial<BonusInput>): PlanInput => ({
    pay: { amount: 2000, freqDays: 14, nextPayday: "2026-11-12", switchLead: 0, split: { from: "2026-11-12" } },
    bonuses: [
      bonus("a", { openedOn: "2026-11-01", minDeposits: 1, windowDays: 120, ...first }),
      bonus("b", { openedOn: "2026-11-01", target: 5000, minDeposits: 1, windowDays: 120 }),
    ],
  });

  it("a bank that needs $72 gets $100", () => {
    const plan = computePlan(twoBanks({ target: 72 }), TODAY, SPLIT);
    expect(shares(plan, "2026-11-12")).toEqual([["a", 100, false], ["b", 1900, true]]);
  });

  it("spreads what's needed over the deposits still needed", () => {
    const plan = computePlan(twoBanks({ target: 1000, minDeposits: 2 }), TODAY, SPLIT);
    expect(shares(plan, "2026-11-12")[0]).toEqual(["a", 500, false]);
    expect(shares(plan, "2026-11-26")[0]).toEqual(["a", 500, false]);
  });

  it("the minimum per deposit wins over a smaller need", () => {
    const plan = computePlan(twoBanks({ target: 72, minPerDeposit: 250 }), TODAY, SPLIT);
    expect(shares(plan, "2026-11-12")[0]).toEqual(["a", 250, false]);
  });

  it("a bank whose dollars are met but deposits aren't still gets a deposit: its minimum, or $50", () => {
    let plan = computePlan(twoBanks({ target: 0, minDeposits: 1 }), TODAY, SPLIT);
    expect(shares(plan, "2026-11-12")[0]).toEqual(["a", 50, false]);
    plan = computePlan(twoBanks({ target: 0, minDeposits: 1, minPerDeposit: 300 }), TODAY, SPLIT);
    expect(shares(plan, "2026-11-12")[0]).toEqual(["a", 300, false]);
  });

  it("a share never goes past the paycheck", () => {
    const plan = computePlan(twoBanks({ target: 5000 }), TODAY, SPLIT);
    expect(shares(plan, "2026-11-12")).toEqual([["a", 2000, true]]);
  });
});

describe("the leftover", () => {
  const base = (): PlanInput => ({
    pay: { amount: 1000, freqDays: 14, nextPayday: "2026-11-12", switchLead: 0, split: { from: "2026-11-12" } },
    bonuses: [
      bonus("a", { openedOn: "2026-11-01", target: 700, minDeposits: 1, windowDays: 120 }),
      bonus("b", { openedOn: "2026-11-01", target: 2000, minDeposits: 1, minPerDeposit: 500, windowDays: 120 }),
    ],
  });

  it("stays with the bank before when it's below the next bank's minimum, and the next bank waits", () => {
    const plan = computePlan(base(), TODAY, SPLIT);
    // a takes $700, $300 is left, below b's $500 minimum: a is the leftover bank.
    expect(shares(plan, "2026-11-12")).toEqual([["a", 1000, true]]);
    expect(byId(plan).b.deposits.map(iso)[0]).toBe("2026-11-26");
  });

  it("goes to the payroll home once every bank is covered", () => {
    const input = base();
    input.bonuses = [input.bonuses[0]];
    const plan = computePlan(input, TODAY, SPLIT);
    expect(shares(plan, "2026-11-12")).toEqual([["a", 700, false], [null, 300, true]]);
  });

  it("stops at a bank that can't be paid yet, so the bank before takes the leftover", () => {
    const input = base();
    // b opens Nov 20, so it can't take Nov 12 (and has no minimum, so only that stops it).
    input.bonuses[1] = bonus("b", { openedOn: "2026-11-20", target: 2000, minDeposits: 1, windowDays: 120 });
    const plan = computePlan(input, TODAY, SPLIT);
    expect(shares(plan, "2026-11-12")).toEqual([["a", 1000, true]]);
    expect(shares(plan, "2026-11-26")).toEqual([["b", 1000, true]]);
  });
});

describe("which paydays are split", () => {
  it("from a date, plus single days on, minus single days off", () => {
    const c = { from: "2026-12-10", on: ["2026-11-12"], off: ["2026-12-24"] };
    expect(isSplitDay(c, day("2026-11-12"))).toBe(true);
    expect(isSplitDay(c, day("2026-11-26"))).toBe(false);
    expect(isSplitDay(c, day("2026-12-10"))).toBe(true);
    expect(isSplitDay(c, day("2026-12-24"))).toBe(false);
    expect(isSplitDay(c, day("2027-01-07"))).toBe(true);
    expect(isSplitDay(undefined, day("2027-01-07"))).toBe(false);
  });
});

describe("when to open the next bank", () => {
  it("as late as possible to catch the first payday it gets a share of", () => {
    const plan = computePlan(motivating(), TODAY, SPLIT);
    // Nov 26 with lead 1: open the day before Nov 12.
    expect(iso(byId(plan).capone.openOn)).toBe("2026-11-11");
    expect(iso(byId(plan).chase.openOn)).toBe("2026-11-11");
  });

  it("earlier when its open-by date is earlier", () => {
    const input = motivating();
    input.bonuses[2].openBy = "2026-11-06";
    const plan = computePlan(input, TODAY, SPLIT);
    expect(iso(byId(plan).chase.openOn)).toBe("2026-11-06");
  });

  it("expired when its open-by date has passed", () => {
    const input = motivating();
    input.bonuses[2].openBy = "2026-11-01";
    const plan = computePlan(input, TODAY, SPLIT);
    expect(byId(plan).chase.status).toBe("expired");
    expect(shares(plan, "2026-11-26")).toEqual([["capone", 2000, true]]);
  });
});

describe("submit by, changes and too late", () => {
  it("a split must be in before the payday a lead ahead of it", () => {
    const { pay } = motivating();
    const paydays = computePlan(motivating(), TODAY).paydays;
    expect(iso(submitBy(paydays, 1, pay))).toBe("2026-11-11");
    pay.switchLead = 0;
    expect(iso(submitBy(paydays, 1, pay))).toBe("2026-11-25");
  });

  it("the split line carries its submit-by date", () => {
    const plan = computePlan(motivating(), TODAY, SPLIT);
    expect(iso(rowOn(plan, "2026-11-26").split!.submitBy)).toBe("2026-11-11");
  });

  it("a split chosen too late is planned whole and flagged", () => {
    const input = motivating();
    input.pay.split = { on: ["2026-11-12"] };
    const plan = computePlan(input, TODAY, SPLIT);
    const line = rowOn(plan, "2026-11-12").split!;
    expect(line.tooLate).toBe(true);
    expect(line.shares).toEqual([{ bonusId: "truist", amount: 2000, leftover: true }]);
    expect(byId(plan).truist.amounts).toEqual([2000]);
  });

  it("marks a change when the banks or fixed amounts differ from the payday before", () => {
    const plan = computePlan(motivating(), TODAY, SPLIT);
    expect(rowOn(plan, "2026-11-26").split!.change).toBe(true);
    expect(rowOn(plan, "2026-12-10").split!.change).toBe(false);
    expect(rowOn(plan, "2026-12-24").split!.change).toBe(true);
    expect(rowOn(plan, "2027-01-07").split!.change).toBe(false);
  });
});
