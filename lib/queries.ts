/* eslint-disable @typescript-eslint/no-explicit-any */
// Boundary layer: maps untyped libSQL result rows into typed view models.
import { db } from "./db";

export interface MatchView {
  id: number;
  kickoffUtc: string;
  status: "pre" | "in" | "post";
  statusDetail: string;
  stage: string | null;
  groupLetter: string | null;
  home: { name: string; code: string | null; owner: string | null; score: number | null };
  away: { name: string; code: string | null; owner: string | null; score: number | null };
}

// One row of the matches join, with manual override folded in.
const MATCH_SELECT = /* sql */ `
  SELECT m.id, m.kickoff_utc, m.stage, m.group_letter,
         m.home_name, m.away_name, m.home_code, m.away_code,
         m.home_score, m.away_score,
         m.status, m.status_detail,
         m.manual_override, m.manual_home_score, m.manual_away_score, m.manual_status,
         hp.name AS home_owner, ap.name AS away_owner
  FROM matches m
  LEFT JOIN teams ht ON ht.id = m.home_team_id
  LEFT JOIN teams at ON at.id = m.away_team_id
  LEFT JOIN people hp ON hp.id = ht.owner_id
  LEFT JOIN people ap ON ap.id = at.owner_id
`;

function toMatchView(r: Record<string, any>): MatchView {
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
    home: { name: r.home_name, code: r.home_code, owner: r.home_owner ?? null, score: homeScore },
    away: { name: r.away_name, code: r.away_code, owner: r.away_owner ?? null, score: awayScore },
  };
}

export interface HomepageMatches {
  live: MatchView[];
  recent: MatchView[];
  upcoming: MatchView[];
}

export async function getAllMatchViews(): Promise<MatchView[]> {
  return (await db.execute(`${MATCH_SELECT} ORDER BY m.kickoff_utc ASC`)).rows.map(toMatchView);
}

export async function getHomepageMatches(): Promise<HomepageMatches> {
  const rows = await getAllMatchViews();
  const live = rows.filter((m) => m.status === "in");
  const recent = rows.filter((m) => m.status === "post").slice(-8).reverse();
  const upcoming = rows.filter((m) => m.status === "pre").slice(0, 12);
  return { live, recent, upcoming };
}

export interface RosterTeam {
  name: string;
  code: string | null;
  groupLetter: string | null;
  draftRound: number | null;
}

export interface ManagerRoster {
  manager: string;
  teams: RosterTeam[];
}

export async function getRosters(): Promise<ManagerRoster[]> {
  const rows = (
    await db.execute(`
      SELECT p.name AS manager, t.name, t.fifa_code AS code, t.group_letter, t.draft_round
      FROM people p
      JOIN teams t ON t.owner_id = p.id
      ORDER BY p.name, t.draft_round
    `)
  ).rows;
  const byManager = new Map<string, RosterTeam[]>();
  for (const r of rows as any[]) {
    if (!byManager.has(r.manager)) byManager.set(r.manager, []);
    byManager.get(r.manager)!.push({
      name: r.name,
      code: r.code,
      groupLetter: r.group_letter,
      draftRound: r.draft_round != null ? Number(r.draft_round) : null,
    });
  }
  return [...byManager.entries()].map(([manager, teams]) => ({ manager, teams }));
}

export interface TeamRow {
  name: string;
  code: string | null;
  groupLetter: string | null;
  owner: string | null;
  draftRound: number | null;
}

export async function getAllTeams(): Promise<TeamRow[]> {
  const rows = (
    await db.execute(`
      SELECT t.name, t.fifa_code AS code, t.group_letter, t.draft_round, p.name AS owner
      FROM teams t
      LEFT JOIN people p ON p.id = t.owner_id
      ORDER BY t.group_letter, t.name
    `)
  ).rows;
  return (rows as any[]).map((r) => ({
    name: r.name,
    code: r.code,
    groupLetter: r.group_letter,
    owner: r.owner ?? null,
    draftRound: r.draft_round != null ? Number(r.draft_round) : null,
  }));
}
