# Deploying The Boys Are Back In Cup

Steps marked **(you)** need a browser login. Everything else Claude can run for you
once you're authenticated. Run the **(you)** commands from your prompt with a leading
`!` so the output lands in the session.

## 1. Turso database — **(you)** then Claude

```bash
# install the CLI
brew install tursodatabase/tap/turso        # or: curl -sSfL https://tur.so/install.sh | bash

# log in (opens a browser, sign in with GitHub)
turso auth login
```

Then Claude runs:

```bash
turso db create the-boys-are-back-in-cup
turso db show the-boys-are-back-in-cup --url           # -> TURSO_DATABASE_URL
turso db tokens create the-boys-are-back-in-cup        # -> TURSO_AUTH_TOKEN
```

## 2. Seed Turso (Claude)

```bash
TURSO_DATABASE_URL=<url> TURSO_AUTH_TOKEN=<token> npm run seed
TURSO_DATABASE_URL=<url> TURSO_AUTH_TOKEN=<token> npm run sync
```

## 3. Vercel — **(you)** then Claude

```bash
vercel login        # (you) opens a browser
```

Then Claude runs:

```bash
vercel link          # link this dir to a Vercel project (scope: your account)
# set env vars for production:
vercel env add TURSO_DATABASE_URL production
vercel env add TURSO_AUTH_TOKEN production
vercel env add ADMIN_PASSWORD production
vercel env add CRON_SECRET production
vercel --prod        # deploy
```

`ADMIN_PASSWORD` = the shared password for `/admin`.
`CRON_SECRET` = any long random string; protects `/api/sync`.

## 4. Frequent sync via GitHub Actions

The workflow in `.github/workflows/sync.yml` runs every 5 minutes. Give it the deploy
URL and secret:

```bash
gh variable set DEPLOY_URL --repo ScavieFae/the-boys-are-back-in-cup --body "https://<your-vercel-domain>"
gh secret   set CRON_SECRET --repo ScavieFae/the-boys-are-back-in-cup --body "<same CRON_SECRET as Vercel>"
```

Trigger a first run to confirm:

```bash
gh workflow run "Sync scores" --repo ScavieFae/the-boys-are-back-in-cup
```

## Notes

- Vercel's daily cron (`vercel.json`) is a backstop; the GitHub Action does the live work.
- Vercel cron auto-sends `Authorization: Bearer $CRON_SECRET`, which `/api/sync` checks.
- Re-running `npm run seed` against Turso wipes and reseeds teams/people (and clears matches).
