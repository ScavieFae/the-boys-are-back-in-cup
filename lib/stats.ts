/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "./db";

export interface TeamStat {
  team: string;
  code: string | null;
  group: string | null;
  owner: string | null;
  goals: number;
  reds: number;
  played: number;
}

export interface ManagerStat {
  manager: string;
  goals: number;
  reds: number;
  teams: number;
}

export interface Stats {
  teams: TeamStat[];
  managers: ManagerStat[];
  totalGoals: number;
  totalReds: number;
}

// Goals + red cards per team, keyed on team_id so only our 48 teams count
// (knockout TBD placeholders have no team_id and are excluded). Then rolled
// up per manager.
export async function getStats(): Promise<Stats> {
  const rows = (
    await db.execute(`
      SELECT t.name, t.fifa_code AS code, t.group_letter AS grp, p.name AS owner,
        COALESCE(SUM(CASE WHEN m.home_team_id = t.id THEN m.home_score
                          WHEN m.away_team_id = t.id THEN m.away_score END), 0) AS goals,
        COALESCE(SUM(CASE WHEN m.home_team_id = t.id THEN m.home_red_cards
                          WHEN m.away_team_id = t.id THEN m.away_red_cards END), 0) AS reds,
        COALESCE(SUM(CASE WHEN m.status IN ('in','post') THEN 1 ELSE 0 END), 0) AS played
      FROM teams t
      LEFT JOIN matches m ON (m.home_team_id = t.id OR m.away_team_id = t.id)
      LEFT JOIN people p ON p.id = t.owner_id
      GROUP BY t.id
      ORDER BY goals DESC, reds DESC, t.name ASC
    `)
  ).rows as any[];

  const teams: TeamStat[] = rows.map((r) => ({
    team: r.name,
    code: r.code,
    group: r.grp,
    owner: r.owner ?? null,
    goals: Number(r.goals),
    reds: Number(r.reds),
    played: Number(r.played),
  }));

  const mgr = new Map<string, ManagerStat>();
  for (const t of teams) {
    if (!t.owner) continue;
    if (!mgr.has(t.owner)) mgr.set(t.owner, { manager: t.owner, goals: 0, reds: 0, teams: 0 });
    const m = mgr.get(t.owner)!;
    m.goals += t.goals;
    m.reds += t.reds;
    m.teams += 1;
  }
  const managers = [...mgr.values()].sort(
    (a, b) => b.goals - a.goals || b.reds - a.reds || a.manager.localeCompare(b.manager),
  );

  return {
    teams,
    managers,
    totalGoals: teams.reduce((s, t) => s + t.goals, 0),
    totalReds: teams.reduce((s, t) => s + t.reds, 0),
  };
}
