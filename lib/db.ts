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
  -- manual override (takes precedence over synced ESPN values when set)
  manual_override   INTEGER NOT NULL DEFAULT 0,
  manual_home_score INTEGER,
  manual_away_score INTEGER,
  manual_status     TEXT,
  updated_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_matches_kickoff ON matches(kickoff_utc);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
`;

export async function ensureSchema(): Promise<void> {
  await db.executeMultiple(SCHEMA);
}
