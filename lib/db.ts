import { createClient, type Client } from "@libsql/client";

// Local dev uses a SQLite file; production points at Turso via env vars.
const url = process.env.TURSO_DATABASE_URL ?? "file:./data/local.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

// Reuse the client across hot reloads / serverless invocations.
const globalForDb = globalThis as unknown as { __db?: Client };
export const db: Client = globalForDb.__db ?? createClient({ url, authToken });
if (process.env.NODE_ENV !== "production") globalForDb.__db = db;

export const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS people (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS teams (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,   -- canonical name (matches data/draft.json)
  espn_id       TEXT,                   -- ESPN team id, filled at sync time
  fifa_code     TEXT,                   -- 3-letter code, filled at sync time
  group_letter  TEXT,                   -- authoritative group, reconciled from ESPN
  csv_group     TEXT,                   -- group as typed in the spreadsheet (fallback)
  owner_id      INTEGER REFERENCES people(id),
  draft_round   INTEGER                 -- null for free agents
);

CREATE TABLE IF NOT EXISTS matches (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  espn_event_id   TEXT UNIQUE,
  kickoff_utc     TEXT,                 -- ISO 8601
  status          TEXT,                 -- pre | in | post
  status_detail   TEXT,                 -- "Scheduled" | "HT" | "FT" | "67'" ...
  stage           TEXT,                 -- "Group Stage" | "Round of 32" ...
  group_letter    TEXT,
  home_team_id    INTEGER REFERENCES teams(id),
  away_team_id    INTEGER REFERENCES teams(id),
  home_name       TEXT,                 -- raw ESPN name (covers TBD / unmatched)
  away_name       TEXT,
  home_code       TEXT,
  away_code       TEXT,
  home_score      INTEGER,
  away_score      INTEGER,
  home_red_cards  INTEGER NOT NULL DEFAULT 0,
  away_red_cards  INTEGER NOT NULL DEFAULT 0,
  odds_home       TEXT,
  odds_draw       TEXT,
  odds_away       TEXT,
  odds_provider   TEXT,
  broadcast       TEXT,                 -- broadcaster label, e.g. "FOX · Peacock"
  watch_url       TEXT,                 -- live/gamecast link
  -- manual override (takes precedence over synced ESPN values when set)
  manual_override   INTEGER NOT NULL DEFAULT 0,
  manual_home_score INTEGER,
  manual_away_score INTEGER,
  manual_status     TEXT,
  updated_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_matches_kickoff ON matches(kickoff_utc);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);

-- Three-spot betting pools. Exactly three spots (home/draw/away) so the spots
-- live as columns on the pool rather than a separate table. Buy-ins and odds
-- are locked at creation; a spot's person_id is null until someone takes it.
CREATE TABLE IF NOT EXISTS bet_pools (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id        INTEGER NOT NULL REFERENCES matches(id),
  created_by      INTEGER NOT NULL REFERENCES people(id),
  created_at      TEXT NOT NULL,
  -- de-vig source: the locked moneyline snapshot used to size the buy-ins
  odds_home       TEXT,
  odds_draw       TEXT,
  odds_away       TEXT,
  -- fixed buy-in for each spot (whole dollars)
  buyin_home      INTEGER NOT NULL,
  buyin_draw      INTEGER NOT NULL,
  buyin_away      INTEGER NOT NULL,
  -- who holds each spot (null = open)
  home_person_id  INTEGER REFERENCES people(id),
  draw_person_id  INTEGER REFERENCES people(id),
  away_person_id  INTEGER REFERENCES people(id),
  status          TEXT NOT NULL DEFAULT 'open',  -- open | settled | void
  result          TEXT,                           -- home | draw | away (when settled)
  settled_at      TEXT,
  updated_at      TEXT,
  edited_at       TEXT                            -- last time the creator re-priced (edited) the open bet
);

CREATE INDEX IF NOT EXISTS idx_pools_match ON bet_pools(match_id);
CREATE INDEX IF NOT EXISTS idx_pools_status ON bet_pools(status);

-- Auto-bet engine. Each person can have MANY standing rules; runAutoBets walks
-- the active rules (person_id ASC, then per-person sort_order ASC) and records
-- one placement per (person, match) it acts on — the first applicable rule wins
-- a contested match.
CREATE TABLE IF NOT EXISTS auto_bet_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id     INTEGER NOT NULL REFERENCES people(id),
  criteria      TEXT NOT NULL,   -- draw | my_teams | home | away | favorite | underdog
  exclude       TEXT NOT NULL DEFAULT 'none', -- none | my_team_games | lopsided | free_agent
  sort_order    INTEGER NOT NULL DEFAULT 0,   -- per-person priority (lower = wins contested match)
  stake         INTEGER NOT NULL,
  horizon_days  INTEGER NOT NULL DEFAULT 2,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT,
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS auto_bet_placements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id   INTEGER NOT NULL REFERENCES people(id),
  match_id    INTEGER NOT NULL REFERENCES matches(id),
  pool_id     INTEGER REFERENCES bet_pools(id),
  outcome     TEXT NOT NULL,   -- home | draw | away
  action      TEXT NOT NULL,   -- open | join
  placed_at   TEXT,
  -- One row per pool the person acted on (a single auto-bet can join several
  -- pools on the same match, up to its budget). "Already handled this match" is
  -- gated separately by the existence of ANY (person_id, match_id) row.
  UNIQUE(person_id, pool_id)
);

CREATE INDEX IF NOT EXISTS idx_autobet_placements_person ON auto_bet_placements(person_id);
CREATE INDEX IF NOT EXISTS idx_autobet_placements_match ON auto_bet_placements(match_id);

-- Activity feed: an append-only event log spanning the bet + match lifecycle.
-- Writes are best-effort (see lib/feed.ts) and idempotent via dedup_key, so
-- settle/match-transition emits that run repeatedly never duplicate.
CREATE TABLE IF NOT EXISTS feed_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL,                 -- event time (ISO); backfilled events use the historical time
  type        TEXT NOT NULL,                 -- bet_opened | bet_joined | bet_filled | bet_edited | bet_canceled | bet_settled | bet_voided | match_started | match_final
  actor_id    INTEGER REFERENCES people(id), -- who did it; NULL for system/match events
  match_id    INTEGER REFERENCES matches(id),
  pool_id     INTEGER REFERENCES bet_pools(id),
  source      TEXT NOT NULL DEFAULT 'manual',-- manual | auto | system
  run_id      TEXT,                          -- groups one auto-bet batch; NULL otherwise
  payload     TEXT,                          -- JSON string, type-specific
  dedup_key   TEXT UNIQUE,                   -- natural key for idempotency; NULL allowed (SQLite permits multiple NULLs)
  created_at  TEXT NOT NULL                  -- row insert time (ISO)
);
CREATE INDEX IF NOT EXISTS idx_feed_events_ts ON feed_events(ts DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_feed_events_pool ON feed_events(pool_id);

-- Pari-mutuel pots. ONE pool per match (UNIQUE match_id). Each person backs a
-- single outcome (top-ups to the same outcome accumulate as multiple entries;
-- switching outcomes is rejected by the engine). At full-time the whole pot is
-- split pro-rata among backers of the winning outcome; if nobody backed the
-- winner the pool voids (everyone refunded). Amounts are whole dollars.
CREATE TABLE IF NOT EXISTS pari_pools (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id    INTEGER NOT NULL UNIQUE REFERENCES matches(id),
  status      TEXT NOT NULL DEFAULT 'open',   -- open | settled | void
  result      TEXT,                            -- home|draw|away when settled
  created_at  TEXT NOT NULL,
  settled_at  TEXT,
  updated_at  TEXT
);
CREATE TABLE IF NOT EXISTS pari_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pool_id     INTEGER NOT NULL REFERENCES pari_pools(id),
  person_id   INTEGER NOT NULL REFERENCES people(id),
  outcome     TEXT NOT NULL,                    -- home|draw|away
  amount      INTEGER NOT NULL,                 -- whole dollars
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pari_entries_pool ON pari_entries(pool_id);
CREATE INDEX IF NOT EXISTS idx_pari_pools_match ON pari_pools(match_id);

-- Settle-up payments. A settlement records a real-dollar payment from a debtor
-- (from_person / payer) to a creditor (to_person / payee), OFFSETTING the
-- bet-debt the two have between them. It carries two acknowledgments: payer_ack
-- (the from-side) and payee_ack (the to-side). Created when EITHER party "marks
-- paid" (their ack is set on creation); the other party can later confirm,
-- setting their ack. An ACTIVE settlement offsets the debt as soon as it exists,
-- regardless of how many acks it has. Admin can void (soft-delete) a settlement.
CREATE TABLE IF NOT EXISTS settlements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  from_person   INTEGER NOT NULL REFERENCES people(id),  -- debtor / payer
  to_person     INTEGER NOT NULL REFERENCES people(id),  -- creditor / payee
  amount        INTEGER NOT NULL,                         -- whole dollars
  payer_ack_at  TEXT,                                     -- set when the payer (from) acks
  payee_ack_at  TEXT,                                     -- set when the payee (to) acks
  created_by    INTEGER REFERENCES people(id),
  created_at    TEXT NOT NULL,
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'active'            -- active | voided
);
CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlements(status);
`;

// Memoized so any code path can call it cheaply (and concurrent callers all
// await the SAME run — important so a parallel query can't race ahead of an
// additive column migration on a cold serverless instance). Resets on failure
// so a later call can retry.
let schemaReady: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = runEnsureSchema().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

async function runEnsureSchema(): Promise<void> {
  await db.executeMultiple(SCHEMA);
  // Auto-bet rules: the original table had UNIQUE(person_id) (one rule/person)
  // and no `exclude`/`sort_order` columns. SQLite can't DROP a UNIQUE
  // constraint, so when the new `exclude` column is missing we REBUILD the
  // table: create the new shape, copy existing rows (defaulting exclude='none'
  // and sort_order=id to preserve their order), drop the old, rename. Idempotent
  // — only runs when `exclude` is absent.
  await migrateAutoBetRules();
  // Additive migrations for databases created before a column existed.
  await ensureColumns("matches", {
    home_red_cards: "INTEGER NOT NULL DEFAULT 0",
    away_red_cards: "INTEGER NOT NULL DEFAULT 0",
    odds_home: "TEXT",
    odds_draw: "TEXT",
    odds_away: "TEXT",
    odds_provider: "TEXT",
    broadcast: "TEXT",
    watch_url: "TEXT",
  });
  // Auth: link a signed-in Google email to its manager's people row.
  await ensureColumns("people", {
    email: "TEXT",
  });
  // Bet edits: record when the creator last re-priced an open pool.
  await ensureColumns("bet_pools", {
    edited_at: "TEXT",
  });
}

async function migrateAutoBetRules(): Promise<void> {
  const info = await db.execute("PRAGMA table_info(auto_bet_rules)");
  const cols = new Set(info.rows.map((r) => r.name as string));
  // Fresh DBs already get the new shape from SCHEMA (has `exclude`). Only
  // old-shape tables (no `exclude`) need the rebuild.
  if (cols.has("exclude")) return;

  await db.executeMultiple(`
    CREATE TABLE auto_bet_rules_new (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id     INTEGER NOT NULL REFERENCES people(id),
      criteria      TEXT NOT NULL,
      exclude       TEXT NOT NULL DEFAULT 'none',
      sort_order    INTEGER NOT NULL DEFAULT 0,
      stake         INTEGER NOT NULL,
      horizon_days  INTEGER NOT NULL DEFAULT 2,
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT,
      updated_at    TEXT
    );
    INSERT INTO auto_bet_rules_new
      (id, person_id, criteria, exclude, sort_order, stake, horizon_days, active, created_at, updated_at)
      SELECT id, person_id, criteria, 'none', id, stake, horizon_days, active, created_at, updated_at
      FROM auto_bet_rules;
    DROP TABLE auto_bet_rules;
    ALTER TABLE auto_bet_rules_new RENAME TO auto_bet_rules;
  `);
}

async function ensureColumns(table: string, cols: Record<string, string>): Promise<void> {
  const info = await db.execute(`PRAGMA table_info(${table})`);
  const existing = new Set(info.rows.map((r) => r.name as string));
  for (const [name, def] of Object.entries(cols)) {
    if (!existing.has(name)) {
      await db.execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
    }
  }
}
