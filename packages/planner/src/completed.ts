import { parseDay } from "./dates.js";
import type { BonusInput } from "./types.js";

export interface CompletedYear {
  year: number;
  /** Sum of the bonus amounts as entered. */
  total: number;
  /** Most recently received first. */
  bonuses: BonusInput[];
}

/** True once the bonus has a valid received date. Completed bonuses leave the plan. */
export const isCompleted = (b: BonusInput) => parseDay(b.completedOn) !== null;

/** Received bonuses grouped by the year they were received, newest year first. */
export function completedByYear(bonuses: BonusInput[]): CompletedYear[] {
  const done = bonuses.filter(isCompleted).sort((a, b) => parseDay(b.completedOn)! - parseDay(a.completedOn)!);
  const years = new Map<number, CompletedYear>();
  for (const b of done) {
    const year = new Date(parseDay(b.completedOn)!).getUTCFullYear();
    const y = years.get(year) ?? { year, total: 0, bonuses: [] };
    y.total += b.bonusAmount;
    y.bonuses.push(b);
    years.set(year, y);
  }
  return [...years.values()];
}
