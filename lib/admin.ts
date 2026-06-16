/* eslint-disable @typescript-eslint/no-explicit-any */
// Admin data access: the editable match window and manual-override mutations.
import { db } from "./db";
import type { MatchView } from "./queries";

export interface AdminMatch extends MatchView {
  overridden: boolean;
  espnHomeScore: number | null;
  espnAwayScore: number | null;
  espnStatus: "pre" | "in" | "post";
}

function toAdminMatch(r: Record<string, any>): AdminMatch {
  const overridden = Number(r.manual_override) === 1;
  const status = (overridden && r.manual_status ? r.manual_status : r.status) as MatchView["status"];
  const homeScore = overridden && r.manual_home_score != null ? Number(r.manual_home_score) : r.home_score != null ? Number(r.home_score) : null;
  const awayScore = overridden && r.manual_away_score != null ? Number(r.manual_away_score) : r.away_score != null ? Number(r.away_score) : null;
  return {
    id: Number(r.id),
    kickoffUtc: r.kickoff_utc,
    status,
    statusDetail: overridden && r.manual_status ? "Manual" : (r.status_detail ?? ""),
    stage: r.stage ?? null,
    groupLetter: r.group_letter ?? null,
    home: { name: r.home_name, code: r.home_code, owner: r.home_owner ?? null, score: homeScore, redCards: Number(r.home_red_cards ?? 0) },
    away: { name: r.away_name, code: r.away_code, owner: r.away_owner ?? null, score: awayScore, redCards: Number(r.away_red_cards ?? 0) },
    odds: null,
    broadcast: null,
    watchUrl: null,
    overridden,
    espnHomeScore: r.home_score != null ? Number(r.home_score) : null,
    espnAwayScore: r.away_score != null ? Number(r.away_score) : null,
    espnStatus: (r.status ?? "pre") as "pre" | "in" | "post",
  };
}

// Matches worth editing: anything live, anything kicking off within a few days
// of now, plus anything already overridden (so corrections stay visible).
export async function getEditableMatches(): Promise<AdminMatch[]> {
  const now = Date.now();
  const lo = new Date(now - 3 * 864e5).toISOString();
  const hi = new Date(now + 3 * 864e5).toISOString();
  const rows = (
    await db.execute({
      sql: `
        SELECT m.id, m.kickoff_utc, m.stage, m.group_letter,
               m.home_name, m.away_name, m.home_code, m.away_code,
               m.home_score, m.away_score, m.home_red_cards, m.away_red_cards,
               m.status, m.status_detail,
               m.manual_override, m.manual_home_score, m.manual_away_score, m.manual_status,
               hp.name AS home_owner, ap.name AS away_owner
        FROM matches m
        LEFT JOIN teams ht ON ht.id = m.home_team_id
        LEFT JOIN teams at ON at.id = m.away_team_id
        LEFT JOIN people hp ON hp.id = ht.owner_id
        LEFT JOIN people ap ON ap.id = at.owner_id
        WHERE m.status = 'in'
           OR (m.kickoff_utc BETWEEN ? AND ?)
           OR m.manual_override = 1
        ORDER BY m.kickoff_utc ASC`,
      args: [lo, hi],
    })
  ).rows;
  return rows.map(toAdminMatch);
}

export async function setManualScore(
  id: number,
  homeScore: number | null,
  awayScore: number | null,
  status: string,
): Promise<void> {
  await db.execute({
    sql: `UPDATE matches
          SET manual_override = 1, manual_home_score = ?, manual_away_score = ?,
              manual_status = ?, updated_at = ?
          WHERE id = ?`,
    args: [homeScore, awayScore, status, new Date().toISOString(), id],
  });
}

export async function clearManualOverride(id: number): Promise<void> {
  await db.execute({
    sql: `UPDATE matches
          SET manual_override = 0, manual_home_score = NULL, manual_away_score = NULL,
              manual_status = NULL, updated_at = ?
          WHERE id = ?`,
    args: [new Date().toISOString(), id],
  });
}
