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
  updated_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_pools_match ON bet_pools(match_id);
CREATE INDEX IF NOT EXISTS idx_pools_status ON bet_pools(status);
`;

export async function ensureSchema(): Promise<void> {
  await db.executeMultiple(SCHEMA);
  // Additive migrations for databases created before a column existed.
  await ensureColumns("matches", {
    home_red_cards: "INTEGER NOT NULL DEFAULT 0",
    away_red_cards: "INTEGER NOT NULL DEFAULT 0",
    odds_home: "TEXT",
    odds_draw: "TEXT",
    odds_away: "TEXT",
    odds_provider: "TEXT",
  });
  // Auth: link a signed-in Google email to its manager's people row.
  await ensureColumns("people", {
    email: "TEXT",
  });
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
