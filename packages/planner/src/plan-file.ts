// Reading and writing a plan as a file: readable JSON with a version number, so the format can change safely.
import { parseDay, toISODay } from "./dates.js";
import type { BonusInput, DepositRule, PaySettings, PlanInput } from "./types.js";

export const PLAN_FILE_VERSION = 1;

export type PlanFileResult = { ok: true; plan: PlanInput } | { ok: false; error: string };

/** The plan as file text: `{ "openchurn": 1, "pay": …, "bonuses": […] }`, indented for reading and diffing. */
export function toPlanFile(plan: PlanInput): string {
  return JSON.stringify({ openchurn: PLAN_FILE_VERSION, pay: plan.pay, bonuses: plan.bonuses }, null, 2) + "\n";
}

const RULES: DepositRule[] = ["payroll", "ach", "none"];
const NOT_A_PLAN = "This isn't a plan file.";

class Invalid extends Error {}

/**
 * Reads file text back into a plan, checking every field. Optional text fields default to "", and fields this
 * version doesn't know are dropped. Errors name the bonus and field that's wrong.
 */
export function parsePlanFile(text: string): PlanFileResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: NOT_A_PLAN };
  }
  if (!isObject(data) || !isObject(data.pay) || !Array.isArray(data.bonuses)) return { ok: false, error: NOT_A_PLAN };
  if (typeof data.openchurn === "number" && data.openchurn > PLAN_FILE_VERSION) {
    return { ok: false, error: "This plan file was made by a newer version of OpenChurn. Update OpenChurn to open it." };
  }
  try {
    const pay = readPay(data.pay);
    const ids = new Set<string>();
    const bonuses = data.bonuses.map((raw, i) => {
      const b = readBonus(raw, i);
      if (ids.has(b.id)) throw new Invalid(`${label(raw, i)} has the same id as another bonus.`);
      ids.add(b.id);
      return b;
    });
    return { ok: true, plan: { pay, bonuses } };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    throw e;
  }
}

function readPay(p: Record<string, unknown>): PaySettings {
  const at = "Your paycheck";
  if (p.freqDays !== 7 && p.freqDays !== 14) throw new Invalid(`${at}: how often must be weekly or every two weeks.`);
  if (p.switchLead !== 0 && p.switchLead !== 1 && p.switchLead !== 2) throw new Invalid(`${at}: switch takes effect must be 0, 1 or 2 paychecks later.`);
  return {
    amount: amount(p.amount, `${at}: amount you can move`),
    freqDays: p.freqDays,
    nextPayday: date(p.nextPayday, `${at}: next payday`),
    switchLead: p.switchLead,
  };
}

function readBonus(raw: unknown, i: number): BonusInput {
  if (!isObject(raw)) throw new Invalid(`Bonus ${i + 1} isn't a bonus.`);
  const at = label(raw, i);
  if (typeof raw.id !== "string" || !raw.id) throw new Invalid(`${at} has no id.`);
  if (typeof raw.name !== "string") throw new Invalid(`${at}: name must be text.`);
  if (!RULES.includes(raw.rule as DepositRule)) throw new Invalid(`${at}: deposit rule must be "payroll", "ach" or "none".`);
  if (typeof raw.included !== "boolean") throw new Invalid(`${at}: include in plan must be true or false.`);
  return {
    id: raw.id,
    name: raw.name,
    bonusAmount: amount(raw.bonusAmount, `${at}: bonus`),
    rule: raw.rule as DepositRule,
    target: amount(raw.target, `${at}: deposits needed`),
    minDeposits: amount(raw.minDeposits, `${at}: minimum deposits`),
    windowDays: amount(raw.windowDays, `${at}: window`),
    debitRequired: amount(raw.debitRequired, `${at}: debit purchases needed`),
    debitMinAmount: amount(raw.debitMinAmount, `${at}: each debit purchase at least`),
    balanceRequired: amount(raw.balanceRequired, `${at}: balance to hold`),
    holdDays: amount(raw.holdDays, `${at}: hold for`),
    openedOn: date(raw.openedOn, `${at}: opened on`),
    openBy: date(raw.openBy, `${at}: open by`),
    note: text(raw.note, `${at}: notes`),
    offerUrl: text(raw.offerUrl, `${at}: offer URL`),
    completedOn: date(raw.completedOn, `${at}: bonus received`),
    included: raw.included,
  };
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const label = (raw: unknown, i: number) => (isObject(raw) && typeof raw.name === "string" && raw.name ? `Bonus ${i + 1} (${raw.name})` : `Bonus ${i + 1}`);

function amount(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Invalid(`${what} must be a number of 0 or more.`);
  return v;
}

/** "" or a real YYYY-MM-DD date; missing counts as "". */
function date(v: unknown, what: string): string {
  if (v === undefined || v === "") return "";
  // parseDay rolls impossible dates over (2026-13-40 becomes a 2027 date), so the date must read back unchanged.
  const day = typeof v === "string" ? parseDay(v) : null;
  if (day === null || toISODay(day) !== v) throw new Invalid(`${what} isn't a valid date.`);
  return v;
}

function text(v: unknown, what: string): string {
  if (v === undefined) return "";
  if (typeof v !== "string") throw new Invalid(`${what} must be text.`);
  return v;
}
