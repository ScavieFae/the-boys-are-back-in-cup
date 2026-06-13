import { getAllMatchViews } from "./queries";
import { MANAGERS } from "./managers";

// A row in the managers' league table — aggregate performance of all the teams
// a manager drafted, across every finished match (including vs free agents).
export interface TableRow {
  manager: string;
  played: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
}

// One manager's record against another (from the row manager's perspective).
export interface H2HCell {
  w: number;
  d: number;
  l: number;
}

export interface Rivalry {
  a: string;
  b: string;
  aWins: number;
  bWins: number;
  draws: number;
  meetings: number;
}

export interface Standings {
  table: TableRow[];
  managers: string[];
  h2h: Record<string, Record<string, H2HCell>>;
  rivalries: Rivalry[];
  managerMeetings: number; // finished owner-vs-owner matches counted in H2H
}

export async function getStandings(): Promise<Standings> {
  const all = await getAllMatchViews();
  const finished = all.filter(
    (m) => m.status === "post" && m.home.score != null && m.away.score != null,
  );

  const managers = [...MANAGERS];

  const table = new Map<string, TableRow>();
  for (const m of managers) {
    table.set(m, { manager: m, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 });
  }

  const h2h: Record<string, Record<string, H2HCell>> = {};
  for (const a of managers) {
    h2h[a] = {};
    for (const b of managers) if (a !== b) h2h[a][b] = { w: 0, d: 0, l: 0 };
  }

  const rivalries = new Map<string, Rivalry>();
  let managerMeetings = 0;

  for (const m of finished) {
    const hs = m.home.score as number;
    const as = m.away.score as number;
    const ho = m.home.owner;
    const ao = m.away.owner;

    // League table: tally each owned side independently.
    if (ho && table.has(ho)) {
      const r = table.get(ho)!;
      r.played++;
      r.gf += hs;
      r.ga += as;
      if (hs > as) { r.w++; r.pts += 3; } else if (hs < as) { r.l++; } else { r.d++; r.pts += 1; }
    }
    if (ao && table.has(ao)) {
      const r = table.get(ao)!;
      r.played++;
      r.gf += as;
      r.ga += hs;
      if (as > hs) { r.w++; r.pts += 3; } else if (as < hs) { r.l++; } else { r.d++; r.pts += 1; }
    }

    // Head-to-head: only when both sides are owned by *different* managers.
    if (ho && ao && ho !== ao && h2h[ho] && h2h[ao]) {
      managerMeetings++;
      if (hs > as) { h2h[ho][ao].w++; h2h[ao][ho].l++; }
      else if (hs < as) { h2h[ao][ho].w++; h2h[ho][ao].l++; }
      else { h2h[ho][ao].d++; h2h[ao][ho].d++; }

      const [pa, pb] = [ho, ao].sort();
      const key = `${pa}|${pb}`;
      if (!rivalries.has(key)) {
        rivalries.set(key, { a: pa, b: pb, aWins: 0, bWins: 0, draws: 0, meetings: 0 });
      }
      const riv = rivalries.get(key)!;
      riv.meetings++;
      if (hs === as) riv.draws++;
      else {
        const winner = hs > as ? ho : ao;
        if (winner === pa) riv.aWins++; else riv.bWins++;
      }
    }
  }

  for (const r of table.values()) r.gd = r.gf - r.ga;

  const tableArr = [...table.values()].sort(
    (x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.manager.localeCompare(y.manager),
  );

  const rivalryArr = [...rivalries.values()].sort(
    (x, y) =>
      y.meetings - x.meetings ||
      Math.abs(y.aWins - y.bWins) - Math.abs(x.aWins - x.bWins) ||
      x.a.localeCompare(y.a),
  );

  return { table: tableArr, managers, h2h, rivalries: rivalryArr, managerMeetings };
}

// "Mattie leads Nathan 4–2" / "Dan & Dereck are level 1–1"
export function rivalryHeadline(r: Rivalry): string {
  const drawTail = r.draws > 0 ? `, ${r.draws} draw${r.draws > 1 ? "s" : ""}` : "";
  if (r.aWins > r.bWins) return `${r.a} leads ${r.b} ${r.aWins}–${r.bWins}${drawTail}`;
  if (r.bWins > r.aWins) return `${r.b} leads ${r.a} ${r.bWins}–${r.aWins}${drawTail}`;
  if (r.aWins === 0 && r.draws > 0)
    return `${r.a} & ${r.b} have drawn all ${r.draws}`;
  return `${r.a} & ${r.b} are level ${r.aWins}–${r.bWins}${drawTail}`;
}
