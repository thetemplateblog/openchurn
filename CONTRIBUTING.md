# Contributing to OpenChurn

Thanks for helping. Bug reports, fixes and ideas are all welcome.

## Getting started

```sh
npm install
npm test         # must pass
npm run dev      # the app at http://localhost:5173
npm start        # the openchurn command against ~/OpenChurn/plan.json (use `node cli/bin/openchurn.js ./test.json` for a scratch file)
```

## Where things live

- **Rules** (`packages/planner/src`): `planner.ts` (the rotation), `dates.ts`, `completed.ts`, `plan-file.ts`. Pure
  functions of the plan and today's date.
- **UI** (`app/src`): `Planner.tsx` (the screen), `storage.ts` (where the plan is saved), `App.tsx`.
- **Local server** (`cli/src/server.js`): serves the app and reads and writes the plan file.

## Ground rules

- **Change a rule by writing a failing test first.** The worked example in `planner.test.ts` must stay true unless the
  change is deliberate and explained.
- **Read-only with money.** OpenChurn never moves money, opens accounts or changes direct deposits, and never asks for
  bank logins.
- **No network.** No analytics, tracking or remote fonts. Everything runs from the local files.
- **Never invent bonus terms.** Terms come from the user, from the bank's own offer page.
- **Plan file changes need a version bump** in `plan-file.ts`, with old files still opening.
- Keep the local server bound to `127.0.0.1`, with its Host and Origin checks and its one fixed file path.

## Pull requests

Describe what changed and why, include tests for rule changes, and run `npm test` and `npm run build` before opening
it. CI runs both.

## Releasing (maintainers)

1. Bump `version` in `packages/planner/package.json` and `cli/package.json`, and `cli`'s dependency on
   `@openchurn/planner` to match.
2. `npm install`, commit, then `git tag vX.Y.Z && git push --tags`.
3. The Release workflow tests, builds, publishes both packages to npm and attaches `openchurn.html` to a GitHub Release.
