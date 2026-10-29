import type { BonusInput, PlanInput } from "./types.js";

const base: Omit<BonusInput, "id" | "name" | "bonusAmount" | "rule"> = {
  target: 0,
  minDeposits: 1,
  windowDays: 90,
  debitRequired: 0,
  debitMinAmount: 0,
  balanceRequired: 0,
  holdDays: 0,
  openedOn: "",
  openBy: "",
  note: "",
  offerUrl: "",
  completedOn: "",
  included: true,
};

export function newBonus(id: string): BonusInput {
  return { ...base, id, name: "New bonus", bonusAmount: 500, rule: "payroll", target: 1000 };
}

/** Example plan shown when there is no plan yet. Illustrative bonuses, not current offers; labeled as an example in the UI. */
export const EXAMPLE_PLAN: PlanInput = {
  pay: { amount: 1500, freqDays: 14, nextPayday: "2026-10-23", switchLead: 1 },
  bonuses: [
    { ...base, id: "ex-truist", name: "Truist One Checking", bonusAmount: 500, rule: "ach", target: 2000, minDeposits: 2, windowDays: 120, debitRequired: 20, openedOn: "2026-10-13", note: "Any ACH over $5 counts." },
    { ...base, id: "ex-pnc", name: "PNC Virtual Wallet", bonusAmount: 400, rule: "payroll", target: 5000, windowDays: 60, openBy: "2027-01-07", note: "Paycheck, pension or Social Security only." },
    { ...base, id: "ex-chase", name: "Chase", bonusAmount: 900, rule: "payroll", target: 10000, windowDays: 90, openBy: "2027-01-27", note: "Confirm the deposit window on Chase's offer page." },
    { ...base, id: "ex-penn", name: "Penn Community Bank", bonusAmount: 400, rule: "none", windowDays: 60, debitRequired: 20, debitMinAmount: 20, openBy: "2026-12-05", note: "Debit route: 20 purchases of $20 or more." },
    { ...base, id: "ex-key", name: "KeyBank Key Smart", bonusAmount: 700, rule: "none", windowDays: 120, balanceRequired: 10000, holdDays: 60, openedOn: "2026-10-15", openBy: "2026-12-11", note: "Reach $10,000 by 12/14, then hold it 60 days." },
    // Already received: they fill the Completed section and take no paychecks.
    { ...base, id: "ex-wells", name: "Wells Fargo Everyday Checking", bonusAmount: 325, rule: "payroll", target: 1000, completedOn: "2026-09-18" },
    { ...base, id: "ex-capone", name: "Capital One 360 Checking", bonusAmount: 300, rule: "payroll", target: 1000, completedOn: "2026-07-02" },
    { ...base, id: "ex-sofi", name: "SoFi Checking and Savings", bonusAmount: 300, rule: "payroll", target: 5000, completedOn: "2026-04-11" },
    { ...base, id: "ex-citi", name: "Citi Regular Checking", bonusAmount: 325, rule: "ach", completedOn: "2026-02-20" },
    { ...base, id: "ex-bmo", name: "BMO Smart Advantage", bonusAmount: 400, rule: "payroll", target: 4000, completedOn: "2025-11-05" },
    { ...base, id: "ex-usbank", name: "US Bank Smartly Checking", bonusAmount: 450, rule: "payroll", target: 8000, completedOn: "2025-08-14" },
    { ...base, id: "ex-huntington", name: "Huntington Perks Checking", bonusAmount: 600, rule: "payroll", target: 1000, completedOn: "2025-03-27" },
    { ...base, id: "ex-discover", name: "Discover Cashback Checking", bonusAmount: 150, rule: "none", completedOn: "2024-12-09" },
    { ...base, id: "ex-boa", name: "Bank of America Advantage", bonusAmount: 300, rule: "payroll", target: 2000, completedOn: "2024-06-21" },
  ],
};
