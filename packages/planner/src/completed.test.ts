import { describe, expect, it } from "vitest";
import { completedByYear } from "./completed.js";
import { EXAMPLE_PLAN, newBonus } from "./example.js";
import type { BonusInput } from "./types.js";

const b = (id: string, bonusAmount: number, completedOn: string): BonusInput => ({ ...newBonus(id), bonusAmount, completedOn });

describe("completedByYear", () => {
  it("groups received bonuses by year, newest year first, with each year's total", () => {
    const years = completedByYear([b("a", 500, "2025-03-02"), b("b", 400, "2026-01-15"), b("c", 900, "2026-09-30"), b("d", 300, "2025-12-31")]);
    expect(years.map((y) => [y.year, y.total, y.bonuses.map((x) => x.id)])).toEqual([
      [2026, 1300, ["c", "b"]],
      [2025, 800, ["d", "a"]],
    ]);
  });

  it("leaves out bonuses that aren't received or have an invalid date", () => {
    expect(completedByYear([b("a", 500, ""), b("b", 400, "soon")])).toEqual([]);
  });
});

describe("completedByYear – example plan", () => {
  it("new accounts start with three years of received bonuses", () => {
    expect(completedByYear(EXAMPLE_PLAN.bonuses).map((y) => [y.year, y.total, y.bonuses.length])).toEqual([
      [2026, 1250, 4],
      [2025, 1450, 3],
      [2024, 450, 2],
    ]);
  });
});
