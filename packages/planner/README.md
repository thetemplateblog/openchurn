# @openchurn/planner

Plan bank sign-up bonuses around one paycheck: when to open each account, which paychecks go where, and where you'll
fall short. These are the rules behind [OpenChurn](https://github.com/thetemplateblog/openchurn) and
[ChurnTracker](https://churntracker.app).

- **No dependencies.** Pure TypeScript, compiled to ES modules with type declarations.
- **No side effects.** No network, file system, environment or global state; every function depends only on its arguments.
- **Tested.** The worked example below and the plan file format are covered by the package's tests.
- **MIT licensed.**

## Install

```sh
npm install @openchurn/planner
```

Requires Node 20.19 or newer, or any modern bundler. ES modules only.

## Quick start

```ts
import { EXAMPLE_PLAN, computePlan, fmtShort, todayUTC } from "@openchurn/planner";

const plan = computePlan(EXAMPLE_PLAN, todayUTC());

for (const r of plan.rotation) {
  const when = r.openOn === null ? "—" : fmtShort(r.openOn);
  console.log(`${r.step}. ${r.bonus.name}: ${r.status}, open by ${when}, ${r.deposits.length} paychecks`);
}
console.log("Payroll back home:", plan.payrollHome && fmtShort(plan.payrollHome));
console.log(plan.flags.map((f) => `${f.label}: ${f.text}`).join("\n"));
```

## How the plan is worked out

Bonuses that need a direct deposit form a **queue**, in the order you give them. Each one, in turn, takes the next
paychecks that land inside its deposit window, until its deposit total and minimum number of deposits are met. The
account is opened, and the payroll change submitted, one day before the first paycheck that should reach it, allowing
for how many paychecks the switch takes to take effect (`switchLead`). Bonuses with no deposit requirement (`rule:
"none"`) sit **alongside** the queue and take no paychecks. Received bonuses (with `completedOn`) leave the plan.

The plan assumes you open each account and submit the payroll change on the same day, each paycheck posts on payday,
and the deposit window starts the day you open the account. Bonus terms come from the user, from the bank's own offer
page; this package never supplies them.

### Worked example

`EXAMPLE_PLAN`: $1,500 every two weeks, next payday 2026-10-23, the switch taking effect one paycheck later, and
"today" 2026-10-17:

- Truist (any ACH counts, $2,000 in 120 days, already open) is met Nov 20.
- PNC opens by Nov 19 and is met Jan 15.
- Chase opens by Jan 14, gets 6 paychecks and is $1,000 short.
- Payroll goes back to your main bank Apr 23, 2027.

## API

All dates are `Day` values: milliseconds since the epoch at UTC midnight. Inputs use `YYYY-MM-DD` strings, with `""`
for "not set".

### Plans

| Function | Returns |
|---|---|
| `computePlan(plan: PlanInput, today: Day)` | `Plan`: the whole plan for one paycheck. |
| `planQueue(pay: PaySettings, bonuses: BonusInput[], today: Day)` | `{ paydays, rotation, payrollHome, ledger }`: one paycheck's queue. Building block for apps with several paychecks. |
| `sideItems(bonuses: BonusInput[], today: Day)` | `SideItem[]`: bonuses that need no paycheck. |
| `buildFlags(rotation: RotationItem[], side: SideItem[])` | `Flag[]`: what to do about each bonus, worst first. |
| `onTrackByYear(plan: Plan, today: Day)` | `{ year, total }[]`: the on-track total split by the year each bonus is met (not paid), earliest first. |
| `paydaySchedule(nextPayday: string, freqDays: number, today: Day)` | `Day[]`: upcoming paydays from today. |

`Plan`:

| Field | Meaning |
|---|---|
| `rotation: RotationItem[]` | Queue bonuses in order. |
| `side: SideItem[]` | Bonuses alongside the queue. |
| `flags: Flag[]` | One per bonus: `level` (`"bad"`, `"warn"`, `"info"`, `"good"`), a short `label`, and `text` saying what to do. |
| `payrollHome: Day \| null` | The first payday after the last bonus is met, when payroll can go back to the main bank. |
| `ledger: LedgerRow[]` | Payday by payday: which bonus gets it (`bonusId`, or `null` for the main bank), `running` total, `target`, and `completes`. |
| `paydays: Day[]` | The schedule the plan used. |
| `onTrackTotal: number` | Bonus dollars on track: met queue bonuses plus alongside bonuses not expired. |
| `shortfalls: number` | Queue bonuses that won't be met. |

`RotationItem`:

| Field | Meaning |
|---|---|
| `bonus`, `step` | The bonus and its place in the queue (1, 2, …). |
| `status` | `"met"`, `"short"` (some paychecks fit, not enough), `"no_window"` (none fit) or `"expired"` (open-by date passed). |
| `openOn` | When to open the account and submit the payroll change (or when it was opened). |
| `windowEnd` | The last day of the deposit window. |
| `deposits`, `sum` | The paydays assigned to it and their total. |
| `short` | Dollars still missing at the end of the window. |
| `alreadyOpen` | Whether the account was already open (`openedOn` set). |

`SideItem`: `bonus`, `openedOn`, `openBy`, `expired`, and `daysLeft` until the open-by date.

### Plan files

| Export | Use |
|---|---|
| `toPlanFile(plan: PlanInput): string` | Readable, indented JSON with a version: `{ "openchurn": 1, "pay": …, "bonuses": […] }`. |
| `parsePlanFile(text: string)` | `{ ok: true, plan }` or `{ ok: false, error }`. Checks every field and rejects impossible dates; errors name the bonus and field (for example `Bonus 2 (PNC Virtual Wallet): deposit rule must be "payroll", "ach" or "none".`). Fills in missing optional text fields and drops fields it doesn't know. Rejects files from a newer format version. |
| `PLAN_FILE_VERSION` | The format version this package writes (`1`). |

### Completed bonuses

| Export | Use |
|---|---|
| `isCompleted(bonus)` | `true` once the bonus has a valid `completedOn` date. |
| `completedByYear(bonuses)` | `CompletedYear[]`: `{ year, total, bonuses }`, newest year first, most recently received first. |

### Helpers

| Export | Use |
|---|---|
| `EXAMPLE_PLAN` | The worked example. Its bonuses are illustrative, not current offers. |
| `newBonus(id)` | A new bonus with sensible defaults. |
| `offerLink(text)` | A safe `http(s)` link for an offer URL the user typed (adds `https://` when missing), or `null`. Never returns a script URL. |
| `parseDay`, `toISODay`, `todayUTC`, `DAY` | Date conversion: `YYYY-MM-DD` to `Day` and back, today at UTC midnight, one day in milliseconds. |
| `fmtShort`, `fmtLong`, `money` | Display formatting: `Nov 20`, `Nov 20, 2026`, `$1,500`. |

### Types

`PlanInput` is `{ pay: PaySettings; bonuses: BonusInput[] }`.

- `PaySettings`: `amount` you can move per paycheck, `freqDays` (`7` or `14`), `nextPayday`, `switchLead` (`0`, `1` or `2`
  paychecks).
- `BonusInput`: `id`, `name`, `bonusAmount`, `rule` (`"payroll"`, `"ach"` or `"none"`), `target` (deposit total),
  `minDeposits`, `windowDays`, `debitRequired`, `debitMinAmount`, `balanceRequired`, `holdDays`, `openedOn`, `openBy`,
  `note`, `offerUrl`, `completedOn`, `included`.

## Contributing

Issues and pull requests are welcome at [github.com/thetemplateblog/openchurn](https://github.com/thetemplateblog/openchurn).
Rule changes come with a failing test first.

## License

[MIT](https://github.com/thetemplateblog/openchurn/blob/main/LICENSE)
