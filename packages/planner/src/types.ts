/** Which deposits count toward a bonus: real payroll only, any incoming ACH, or none (no deposit needed). */
export type DepositRule = "payroll" | "ach" | "none";

/** The paycheck you can route to bonus banks. */
export interface PaySettings {
  /** The part of each paycheck you can move, in dollars. */
  amount: number;
  freqDays: 7 | 14;
  /** YYYY-MM-DD */
  nextPayday: string;
  /** How many paychecks after you submit a direct deposit change it takes effect. */
  switchLead: 0 | 1 | 2;
}

export interface BonusInput {
  id: string;
  name: string;
  bonusAmount: number;
  rule: DepositRule;
  /** Total deposits needed, in dollars. */
  target: number;
  minDeposits: number;
  /** Days after opening to meet the requirements. */
  windowDays: number;
  debitRequired: number;
  debitMinAmount: number;
  balanceRequired: number;
  holdDays: number;
  /** YYYY-MM-DD, or "" when not opened. */
  openedOn: string;
  /** YYYY-MM-DD, or "" when there's no deadline. */
  openBy: string;
  note: string;
  /** The bank's offer page, or "". */
  offerUrl: string;
  /** YYYY-MM-DD the bonus was received, or "". */
  completedOn: string;
  included: boolean;
}

export interface PlanInput {
  pay: PaySettings;
  bonuses: BonusInput[];
}
