import { db, ensureSchema } from "./db";
import { fetchFixtures, fetchClosingOdds, type EspnSide, type MatchOdds } from "./espn";
import { buildNameResolver } from "./teams";
import { settleAllPools } from "./bets";

export interface SyncResult {
  fixtures: number;
  upserted: number;
  unmatchedTeams: string[];
  poolsSettled: number;
  poolsVoided: number;
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

  // Finished matches that already have stored odds — their closing line is
  // static, so we never re-fetch the summary endpoint for them.
  const haveOdds = new Set(
    (await db.execute("SELECT espn_event_id FROM matches WHERE odds_home IS NOT NULL")).rows.map(
      (r) => r.espn_event_id as string,
    ),
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

    // Backfill closing odds for newly-finished matches (scoreboard drops them).
    let odds: MatchOdds | null = fx.odds;
    if (!odds && fx.status === "post" && !haveOdds.has(fx.espnEventId)) {
      odds = await fetchClosingOdds(fx.espnEventId);
    }

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
         home_score, away_score, home_red_cards, away_red_cards,
         odds_home, odds_draw, odds_away, odds_provider, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(espn_event_id) DO UPDATE SET
          kickoff_utc=excluded.kickoff_utc, status=excluded.status,
          status_detail=excluded.status_detail, stage=excluded.stage,
          group_letter=excluded.group_letter,
          home_team_id=excluded.home_team_id, away_team_id=excluded.away_team_id,
          home_name=excluded.home_name, away_name=excluded.away_name,
          home_code=excluded.home_code, away_code=excluded.away_code,
          home_score=excluded.home_score, away_score=excluded.away_score,
          home_red_cards=excluded.home_red_cards, away_red_cards=excluded.away_red_cards,
          odds_home=excluded.odds_home, odds_draw=excluded.odds_draw,
          odds_away=excluded.odds_away, odds_provider=excluded.odds_provider,
          updated_at=excluded.updated_at`,
      args: [
        fx.espnEventId, fx.kickoffUtc, fx.status, fx.statusDetail, fx.stage,
        fx.groupLetter, homeId, awayId, fx.home.name, fx.away.name,
        fx.home.code, fx.away.code, fx.home.score, fx.away.score,
        fx.home.redCards, fx.away.redCards,
        odds?.home ?? null, odds?.draw ?? null, odds?.away ?? null, odds?.provider ?? null,
        now,
      ],
    });
    upserted++;
  }

  // Now that results are fresh, resolve any bets whose match finished (or void
  // under-filled pools whose match kicked off).
  const pools = await settleAllPools();

  return {
    fixtures: fixtures.length,
    upserted,
    unmatchedTeams: Array.from(unmatched).sort(),
    poolsSettled: pools.settled,
    poolsVoided: pools.voided,
  };
}
