# openchurn

Plan bank sign-up bonuses around one paycheck, on your own computer. Your plan is a file you own; nothing leaves your
computer.

Most direct-deposit bonuses want your paycheck, and you only have one. Put the bonuses in order and OpenChurn tells you
when to open each account, when to switch your payroll, which paycheck goes where, and where you'll fall short.

![OpenChurn showing the example plan](https://raw.githubusercontent.com/thetemplateblog/openchurn/main/docs/screenshot.png)

## Run it

```sh
npx openchurn
```

It prints a link (`http://127.0.0.1:4580`) to open in your browser. Your plan saves to `~/OpenChurn/plan.json` as you
edit. To use another file:

```sh
npx openchurn ./my-plan.json
```

| Option | Default |
|---|---|
| `[plan file]` | `~/OpenChurn/plan.json` |
| `--port <n>` | `4580`, or the next free port |
| `--help` | Shows usage |

Press Ctrl+C to stop. Requires Node 20.19 or newer.

## What it does

- **Queue:** your payroll bonuses in order, each with the date to open the account and submit the payroll change, and
  the paychecks that go to it.
- **Shortfalls:** bonuses that can't be met, by how much, and what would fix it.
- **Alongside:** bonuses that need no direct deposit, with their open-by dates.
- **Completed:** bonuses you've received, totaled by year.
- **Paychecks:** a payday-by-payday ledger of where each paycheck goes.

The planning rules are the [`@openchurn/planner`](https://www.npmjs.com/package/@openchurn/planner) package, copied
into this one when it's built, so installing it installs nothing else.

## Saving

- Every edit saves to the plan file shortly after you stop typing.
- The previous version is kept as `plan.json.bak`.
- Saves are written to a temporary file and renamed into place, so a crash never leaves half a file.
- If the file changed on disk since you opened it (another tab, or edited by hand), OpenChurn says so and lets you load
  the file or keep your version, instead of overwriting it.
- Files that aren't valid plans are refused with a reason, and nothing is changed.

## Security

- The server listens on `127.0.0.1` only, so other computers can't reach it.
- It refuses requests whose Host or Origin isn't its own address, so websites you visit can't read or change your plan.
- It only ever reads and writes the one plan file it was started with; the path never comes from a request.
- It makes no outgoing network requests and runs no other programs. No analytics, no remote fonts.
- No dependencies and no install scripts. The app it serves is shipped unminified, so you can read what runs.

## The plan file

Readable JSON with a format version:

```json
{
  "openchurn": 1,
  "pay": { "amount": 1500, "freqDays": 14, "nextPayday": "2026-10-23", "switchLead": 1 },
  "bonuses": [
    { "id": "…", "name": "Truist One Checking", "bonusAmount": 500, "rule": "ach", "target": 2000, "minDeposits": 2, "windowDays": 120, "…": "…" }
  ]
}
```

`rule` is `"payroll"` (paycheck only), `"ach"` (any incoming ACH counts) or `"none"` (no direct deposit). Dates are
`YYYY-MM-DD`, or `""` when not set. Always confirm bonus terms on the bank's own offer page.

## No install at all

Download `openchurn.html` from the [latest release](https://github.com/thetemplateblog/openchurn/releases/latest) and
double-click it, or use it at [thetemplateblog.github.io/openchurn](https://thetemplateblog.github.io/openchurn/). In
Chrome and Edge it saves to a file you choose; in Safari and Firefox it keeps the plan in the browser, with download and
open.

## More

Source, issues and contributing: [github.com/thetemplateblog/openchurn](https://github.com/thetemplateblog/openchurn).
OpenChurn is the free planner from [ChurnTracker](https://churntracker.app), which adds syncing across devices and live
tracking from your banks.

MIT licensed.
