# @openchurn/planner

The rules behind [OpenChurn](https://github.com/thetemplateblog/openchurn): plan bank sign-up bonuses around one paycheck.
Pure TypeScript, no dependencies.

```ts
import { EXAMPLE_PLAN, computePlan, parsePlanFile, toPlanFile, todayUTC } from "@openchurn/planner";

const plan = computePlan(EXAMPLE_PLAN, todayUTC());
plan.rotation;      // queue bonuses: open-by date, paychecks, met or short
plan.side;          // bonuses that need no paycheck
plan.flags;         // what to do, worst first
plan.payrollHome;   // when payroll can go back to your main bank
plan.ledger;        // where each paycheck goes

const text = toPlanFile(EXAMPLE_PLAN);   // versioned JSON
const back = parsePlanFile(text);        // { ok: true, plan } or { ok: false, error }
```

MIT licensed.
