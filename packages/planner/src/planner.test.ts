import { describe, expect, it } from "vitest";
import { computePlan, onTrackByYear } from "./planner.js";
import { EXAMPLE_PLAN } from "./example.js";
import { parseDay, toISODay } from "./dates.js";
import type { PlanInput } from "./types.js";

const TODAY = parseDay("2026-10-17")!;
const iso = (d: number | null) => (d === null ? null : toISODay(d));
const clone = (p: PlanInput): PlanInput => JSON.parse(JSON.stringify(p));

describe("computePlan – worked example", () => {
  const plan = computePlan(EXAMPLE_PLAN, TODAY);
  const byId = Object.fromEntries(plan.rotation.map((r) => [r.bonus.id, r]));

  it("Truist gets Nov 6 and Nov 20 and is met", () => {
    expect(byId["ex-truist"].deposits.map(iso)).toEqual(["2026-11-06", "2026-11-20"]);
    expect(byId["ex-truist"].status).toBe("met");
  });

  it("PNC opens by Nov 19 and gets Dec 4 to Jan 15", () => {
    expect(iso(byId["ex-pnc"].openOn)).toBe("2026-11-19");
    expect(byId["ex-pnc"].deposits.map(iso)).toEqual(["2026-12-04", "2026-12-18", "2027-01-01", "2027-01-15"]);
    expect(byId["ex-pnc"].status).toBe("met");
  });

  it("Chase opens by Jan 14, gets 6 paychecks and is $1,000 short", () => {
    const c = byId["ex-chase"];
    expect(iso(c.openOn)).toBe("2027-01-14");
    expect(c.deposits).toHaveLength(6);
    expect(iso(c.deposits[0])).toBe("2027-01-29");
    expect(iso(c.deposits[5])).toBe("2027-04-09");
    expect(c.status).toBe("short");
    expect(c.short).toBe(1000);
  });

  it("payroll returns home Apr 23", () => {
    expect(iso(plan.payrollHome)).toBe("2027-04-23");
  });

  it("no-DD bonuses sit alongside the rotation", () => {
    expect(plan.side.map((s) => s.bonus.id)).toEqual(["ex-penn", "ex-key"]);
    expect(plan.rotation.map((r) => r.bonus.id)).not.toContain("ex-penn");
  });

  it("assigns each paycheck to at most one bonus", () => {
    const all = plan.rotation.flatMap((r) => r.deposits);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("computePlan – rules", () => {
  it("lead 0 lets the next payday go to the new bank", () => {
    const p = clone(EXAMPLE_PLAN);
    p.pay.switchLead = 0;
    const plan = computePlan(p, TODAY);
    expect(iso(plan.rotation[0].deposits[0])).toBe("2026-10-23");
  });

  it("marks an un-opened bonus with a past open-by date as expired", () => {
    const p = clone(EXAMPLE_PLAN);
    p.bonuses[1].openBy = "2026-10-01";
    const plan = computePlan(p, TODAY);
    const pnc = plan.rotation.find((r) => r.bonus.id === "ex-pnc")!;
    expect(pnc.status).toBe("expired");
    expect(pnc.deposits).toHaveLength(0);
  });

  it("suggests an ACH transfer when an any-ACH bonus is short", () => {
    const p = clone(EXAMPLE_PLAN);
    p.bonuses[0].target = 20000; // 120-day window holds at most 8 paychecks ($12,000)
    const plan = computePlan(p, TODAY);
    const flag = plan.flags.find((f) => f.bonusId === "ex-truist")!;
    expect(flag.level).toBe("bad");
    expect(flag.text).toMatch(/transfer from another bank/);
  });

  it("skips bonuses that are not included", () => {
    const p = clone(EXAMPLE_PLAN);
    p.bonuses[0].included = false;
    const plan = computePlan(p, TODAY);
    expect(plan.rotation.map((r) => r.bonus.id)).not.toContain("ex-truist");
  });

  it("produces no deposits with a zero paycheck", () => {
    const p = clone(EXAMPLE_PLAN);
    p.pay.amount = 0;
    const plan = computePlan(p, TODAY);
    expect(plan.rotation.every((r) => r.status !== "met")).toBe(true);
  });
});

describe("computePlan – completed bonuses", () => {
  it("a received bonus takes no paychecks and leaves the totals", () => {
    const input = clone(EXAMPLE_PLAN);
    input.bonuses.find((x) => x.id === "ex-truist")!.completedOn = "2026-10-01";
    input.bonuses.find((x) => x.id === "ex-key")!.completedOn = "2026-10-02";
    const plan = computePlan(input, TODAY);
    expect(plan.rotation.map((r) => r.bonus.id)).toEqual(["ex-pnc", "ex-chase"]);
    expect(plan.side.map((s) => s.bonus.id)).toEqual(["ex-penn"]);
    expect(plan.rotation[0].step).toBe(1);
    // PNC now gets the first free paychecks Truist would have used.
    expect(iso(plan.rotation[0].deposits[0])).toBe("2026-11-06");
    // Opened Oct 17 with a 60-day window, PNC only fits 3 paychecks; Truist's $500 and KeyBank's $700 no longer count.
    expect(plan.rotation[0].deposits).toHaveLength(3);
    expect(plan.rotation.map((r) => r.status)).toEqual(["short", "short"]);
    expect(plan.onTrackTotal).toBe(400);
  });
});

describe("onTrackByYear", () => {
  const sum = (ys: { total: number }[]) => ys.reduce((s, y) => s + y.total, 0);

  it("splits the worked example: Truist in 2026; PNC, Penn and KeyBank in 2027", () => {
    const plan = computePlan(EXAMPLE_PLAN, TODAY);
    const years = onTrackByYear(plan, TODAY);
    expect(years).toEqual([
      { year: 2026, total: 500 },
      { year: 2027, total: 1500 },
    ]);
    expect(sum(years)).toBe(plan.onTrackTotal);
  });

  it("returns one year when everything is met in the same year", () => {
    const input = clone(EXAMPLE_PLAN);
    input.bonuses = input.bonuses.filter((b) => b.id === "ex-truist");
    const plan = computePlan(input, TODAY);
    expect(onTrackByYear(plan, TODAY)).toEqual([{ year: 2026, total: 500 }]);
  });

  it("dates Alongside bonuses by window end: opened, else open-by, else today", () => {
    const input = clone(EXAMPLE_PLAN);
    input.bonuses = input.bonuses.filter((b) => b.rule === "none" && !b.completedOn);
    const [penn, key] = input.bonuses;
    // Opened Oct 15 + 60 days = Dec 14, 2026.
    key.windowDays = 60;
    // Not opened, no open-by: Oct 17 + 90 days = Jan 15, 2027.
    penn.openBy = "";
    penn.windowDays = 90;
    let years = onTrackByYear(computePlan(input, TODAY), TODAY);
    expect(years).toEqual([
      { year: 2026, total: 700 },
      { year: 2027, total: 400 },
    ]);
    // Open-by Nov 1 + 30 days = Dec 1, 2026.
    penn.openBy = "2026-11-01";
    penn.windowDays = 30;
    years = onTrackByYear(computePlan(input, TODAY), TODAY);
    expect(years).toEqual([{ year: 2026, total: 1100 }]);
  });

  it("leaves out short and expired bonuses", () => {
    const input = clone(EXAMPLE_PLAN);
    // Penn's open-by passes, so it expires; Chase stays short.
    const today = parseDay("2026-12-10")!;
    input.pay.nextPayday = "2026-12-11";
    const plan = computePlan(input, today);
    const years = onTrackByYear(plan, today);
    expect(plan.side.find((s) => s.bonus.id === "ex-penn")!.expired).toBe(true);
    expect(sum(years)).toBe(plan.onTrackTotal);
    expect(plan.rotation.some((r) => r.status !== "met")).toBe(true);
  });

  it("is empty when nothing is on track", () => {
    const input = clone(EXAMPLE_PLAN);
    input.bonuses = [];
    expect(onTrackByYear(computePlan(input, TODAY), TODAY)).toEqual([]);
  });
});
