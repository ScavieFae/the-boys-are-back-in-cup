# ⚽ The Boys Are Back In Cup

A World Cup 2026 draft-pool tracker. Five managers ran an 8-round snake draft over
the 48 teams; this site tracks who drafted whom and shows every match annotated
with its owners — *"USA (Mattie) vs France (Nathan)"* — live, recent, and upcoming.

$10 a man. Winner takes the pot.

## Stack

- **Next.js 15** (App Router, TypeScript, Tailwind v4) on **Vercel**
- **libSQL / Turso** for storage (a local SQLite file in dev, Turso in prod)
- **ESPN** undocumented `fifa.world` scoreboard as the live-score source,
  with a manual override for when it lags or lies

## Data model

- `data/draft.json` is the source of truth for **ownership** (manager + draft round),
  taken from the league spreadsheet.
- **Group assignments are reconciled from the live feed**, not the sheet — the
  spreadsheet's Group-F column had overflowed (8 teams, no Group I); the sync
  auto-corrects France/Iraq/Norway/Senegal into their real Group I.

## Local development

```bash
npm install
npm run seed     # create + seed the local SQLite db from data/draft.json
npm run sync     # pull the tournament feed from ESPN into the db
npm run dev      # http://localhost:3000
```

Useful scripts:

- `npm run seed` — reseed people + teams from `data/draft.json`
- `npm run sync` — fetch ESPN fixtures and upsert matches (or `npm run sync -- 20260613` for one day)
- `npx tsx scripts/check.ts` — sanity-check the db (counts, group corrections, sample fixtures)

## Environment

Local dev needs nothing — it falls back to `file:./data/local.db`. For production,
set the vars in `.env.example` (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `CRON_SECRET`).

## Roadmap

- [x] Draft data + verified ESPN sync
- [x] Live homepage (live / recent / upcoming with ownership)
- [ ] Manager rosters + full team list
- [ ] Admin manual score override
- [ ] Deploy (Turso + Vercel + scheduled sync)
- [ ] Head-to-head history (who's beaten whom)
- [ ] Wagering
