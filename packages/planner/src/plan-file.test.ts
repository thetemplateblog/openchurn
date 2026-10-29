import { describe, expect, it } from "vitest";
import { EXAMPLE_PLAN } from "./example.js";
import { PLAN_FILE_VERSION, parsePlanFile, toPlanFile } from "./plan-file.js";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const file = (patch: (f: Record<string, any>) => void) => {
  const f = JSON.parse(toPlanFile(EXAMPLE_PLAN));
  patch(f);
  return JSON.stringify(f);
};
const error = (text: string) => {
  const r = parsePlanFile(text);
  return r.ok ? null : r.error;
};

describe("plan file", () => {
  it("writes readable, versioned JSON", () => {
    const text = toPlanFile(EXAMPLE_PLAN);
    expect(PLAN_FILE_VERSION).toBe(1);
    expect(JSON.parse(text).openchurn).toBe(1);
    expect(text).toContain('\n  "pay": {');
  });

  it("reads back exactly what it wrote", () => {
    const r = parsePlanFile(toPlanFile(EXAMPLE_PLAN));
    expect(r.ok && r.plan).toEqual(EXAMPLE_PLAN);
  });

  it("rejects files that aren't plans", () => {
    expect(error("not json")).toBe("This isn't a plan file.");
    expect(error("[1,2]")).toBe("This isn't a plan file.");
    expect(error('{"hello": 1}')).toBe("This isn't a plan file.");
  });

  it("rejects files from a newer OpenChurn", () => {
    expect(error(file((f) => (f.openchurn = 2)))).toBe("This plan file was made by a newer version of OpenChurn. Update OpenChurn to open it.");
  });

  it("names the field that's wrong", () => {
    expect(error(file((f) => (f.pay.freqDays = 30)))).toBe("Your paycheck: how often must be weekly or every two weeks.");
    expect(error(file((f) => (f.pay.nextPayday = "2026-13-40")))).toBe("Your paycheck: next payday isn't a valid date.");
    expect(error(file((f) => (f.bonuses[1].rule = "cash")))).toBe('Bonus 2 (PNC Virtual Wallet): deposit rule must be "payroll", "ach" or "none".');
    expect(error(file((f) => (f.bonuses[0].openBy = "soon")))).toBe("Bonus 1 (Truist One Checking): open by isn't a valid date.");
    expect(error(file((f) => (f.bonuses[2].target = -5)))).toBe("Bonus 3 (Chase): deposits needed must be a number of 0 or more.");
    expect(error(file((f) => (f.bonuses[1].id = f.bonuses[0].id)))).toBe("Bonus 2 (PNC Virtual Wallet) has the same id as another bonus.");
  });

  it("fills in optional fields and drops ones it doesn't know", () => {
    const text = file((f) => {
      delete f.bonuses[0].offerUrl;
      delete f.bonuses[0].note;
      delete f.bonuses[0].completedOn;
      f.bonuses[0].paycheckId = "side";
      f.extraPays = [];
    });
    const r = parsePlanFile(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.bonuses[0]).toMatchObject({ offerUrl: "", note: "", completedOn: "" });
    expect("paycheckId" in r.plan.bonuses[0]).toBe(false);
    expect("extraPays" in r.plan).toBe(false);
  });

  it("accepts an empty plan", () => {
    const empty = clone(EXAMPLE_PLAN);
    empty.bonuses = [];
    const r = parsePlanFile(toPlanFile(empty));
    expect(r.ok && r.plan.bonuses).toEqual([]);
  });
});
