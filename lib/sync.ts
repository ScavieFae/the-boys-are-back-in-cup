import { db, ensureSchema } from "./db";
import { fetchFixtures, type EspnSide } from "./espn";
import { buildNameResolver } from "./teams";

export interface SyncResult {
  fixtures: number;
  upserted: number;
  unmatchedTeams: string[];
}

// Pull the tournament feed, reconcile teams (enriching them with ESPN code +
// authoritative group), and upsert every fixture into the matches table.
export async function syncFixtures(opts?: { dates?: string }): Promise<SyncResult> {
  await ensureSchema();
  const fixtures = await fetchFixtures(opts);

  const teamsRes = await db.execute("SELECT id, name FROM teams");
  const canonicalNames = teamsRes.rows.map((r) => r.name as string);
  const resolve = buildNameResolver(canonicalNames);
  const idByName = new Map(
    teamsRes.rows.map((r) => [r.name as string, Number(r.id)]),
  );

  const unmatched = new Set<string>();
  const now = new Date().toISOString();

  async function resolveSide(side: EspnSide): Promise<number | null> {
    const canonical = resolve(side.name);
    if (!canonical) {
      if (side.name && side.name !== "TBD") unmatched.add(side.name);
      return null;
    }
    const teamId = idByName.get(canonical) ?? null;
    if (teamId) {
      // Backfill ESPN identifiers once; COALESCE keeps the first non-null.
      await db.execute({
        sql: "UPDATE teams SET fifa_code = COALESCE(fifa_code, ?), espn_id = COALESCE(espn_id, ?) WHERE id = ?",
        args: [side.code, side.espnId, teamId],
      });
    }
    return teamId;
  }

  let upserted = 0;
  for (const fx of fixtures) {
    const homeId = await resolveSide(fx.home);
    const awayId = await resolveSide(fx.away);

    // The tournament feed is authoritative for group assignment — overwrite.
    if (fx.groupLetter) {
      for (const tid of [homeId, awayId]) {
        if (tid) {
          await db.execute({
            sql: "UPDATE teams SET group_letter = ? WHERE id = ?",
            args: [fx.groupLetter, tid],
          });
        }
      }
    }

    await db.execute({
      sql: `INSERT INTO matches
        (espn_event_id, kickoff_utc, status, status_detail, stage, group_letter,
         home_team_id, away_team_id, home_name, away_name, home_code, away_code,
         home_score, away_score, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(espn_event_id) DO UPDATE SET
          kickoff_utc=excluded.kickoff_utc, status=excluded.status,
          status_detail=excluded.status_detail, stage=excluded.stage,
          group_letter=excluded.group_letter,
          home_team_id=excluded.home_team_id, away_team_id=excluded.away_team_id,
          home_name=excluded.home_name, away_name=excluded.away_name,
          home_code=excluded.home_code, away_code=excluded.away_code,
          home_score=excluded.home_score, away_score=excluded.away_score,
          updated_at=excluded.updated_at`,
      args: [
        fx.espnEventId, fx.kickoffUtc, fx.status, fx.statusDetail, fx.stage,
        fx.groupLetter, homeId, awayId, fx.home.name, fx.away.name,
        fx.home.code, fx.away.code, fx.home.score, fx.away.score, now,
      ],
    });
    upserted++;
  }

  return {
    fixtures: fixtures.length,
    upserted,
    unmatchedTeams: Array.from(unmatched).sort(),
  };
}
