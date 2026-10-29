// Calendar days as UTC midnight timestamps, so time zones never shift a date.
export const DAY = 86_400_000;

export type Day = number;

export function parseDay(s: string | null | undefined): Day | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function toISODay(d: Day): string {
  return new Date(d).toISOString().slice(0, 10);
}

export function todayUTC(now: Date = new Date()): Day {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

export function fmtShort(d: Day): string {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function fmtLong(d: Day): string {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}
