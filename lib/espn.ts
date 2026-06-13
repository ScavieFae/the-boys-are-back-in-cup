/* eslint-disable @typescript-eslint/no-explicit-any */
// Boundary layer: parses ESPN's untyped JSON, so `any` is intentional here.
// Adapter around ESPN's undocumented FIFA World Cup scoreboard endpoint.
// This is the ONLY place that knows ESPN's response shape — if the endpoint
// changes or we swap providers, this file is the blast radius.

export type FixtureStatus = "pre" | "in" | "post";

export interface EspnSide {
  name: string;
  code: string | null;
  score: number | null;
  espnId: string | null;
  redCards: number;
}

export interface MatchOdds {
  home: string | null; // American odds, e.g. "+1300"
  draw: string | null;
  away: string | null;
  provider: string | null;
}

export interface EspnFixture {
  espnEventId: string;
  kickoffUtc: string;
  status: FixtureStatus;
  statusDetail: string;
  stage: string | null;
  groupLetter: string | null;
  home: EspnSide;
  away: EspnSide;
  odds: MatchOdds | null;
}

const SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

// The 2026 tournament window: group stage opens Jun 11, final Jul 19.
const DEFAULT_DATES = "20260611-20260719";

export async function fetchFixtures(opts?: {
  dates?: string;
  limit?: number;
}): Promise<EspnFixture[]> {
  const dates = opts?.dates ?? DEFAULT_DATES;
  const limit = opts?.limit ?? 1000;
  const url = `${SCOREBOARD}?dates=${dates}&limit=${limit}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "the-boys-are-back-in-cup/1.0 (hobby project)" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`ESPN scoreboard returned ${res.status}`);
  const json = (await res.json()) as { events?: unknown[] };
  const events = Array.isArray(json.events) ? json.events : [];
  return events
    .map((ev) => parseEvent(ev as Record<string, any>))
    .filter((f): f is EspnFixture => f !== null);
}

function parseEvent(ev: Record<string, any>): EspnFixture | null {
  const comp = ev?.competitions?.[0];
  if (!comp) return null;

  const statusType = comp.status?.type ?? ev.status?.type ?? {};
  const status = (statusType.state ?? "pre") as FixtureStatus;
  const statusDetail: string =
    statusType.shortDetail ?? statusType.detail ?? statusType.description ?? "";

  const competitors: any[] = comp.competitors ?? [];
  const homeC =
    competitors.find((c) => c.homeAway === "home") ?? competitors[0];
  const awayC =
    competitors.find((c) => c.homeAway === "away") ?? competitors[1];
  if (!homeC || !awayC) return null;

  // Group / stage label: group stage uses altGameNote ("FIFA World Cup, Group A");
  // knockout rounds carry their round name there too ("Round of 32", etc).
  const note: string =
    comp.altGameNote ?? comp.notes?.[0]?.headline ?? ev.name ?? "";
  const groupMatch = /group\s+([a-l])\b/i.exec(note);
  const groupLetter = groupMatch ? groupMatch[1].toUpperCase() : null;
  const stage = note.replace(/^FIFA World Cup,?\s*/i, "").trim() || null;

  // Red cards live in competition.details[] with a redCard boolean and a
  // team.id matching the competitor's team id. Tally per side.
  const details: any[] = Array.isArray(comp.details) ? comp.details : [];
  const homeId = homeC.team?.id != null ? String(homeC.team.id) : null;
  const awayId = awayC.team?.id != null ? String(awayC.team.id) : null;
  let homeReds = 0;
  let awayReds = 0;
  for (const d of details) {
    if (!d?.redCard) continue;
    const tid = d.team?.id != null ? String(d.team.id) : null;
    if (tid && tid === homeId) homeReds++;
    else if (tid && tid === awayId) awayReds++;
  }

  return {
    espnEventId: String(ev.id),
    kickoffUtc: ev.date,
    status,
    statusDetail,
    stage,
    groupLetter,
    home: parseSide(homeC, homeReds),
    away: parseSide(awayC, awayReds),
    odds: parseOdds(comp),
  };
}

// Pull a 3-way moneyline out of an ESPN odds/pickcenter entry. Prefer the
// closing line, fall back to the opening line.
function oddsFromEntry(o: any): MatchOdds | null {
  if (!o?.moneyline) return null;
  const pick = (side: any): string | null => side?.close?.odds ?? side?.open?.odds ?? null;
  const home = pick(o.moneyline.home);
  const draw = pick(o.moneyline.draw);
  const away = pick(o.moneyline.away);
  if (home == null && draw == null && away == null) return null;
  return { home, draw, away, provider: o.provider?.name ?? null };
}

function parseOdds(comp: Record<string, any>): MatchOdds | null {
  const list: any[] = Array.isArray(comp.odds) ? comp.odds : [];
  return oddsFromEntry(list.find((x) => x && x.moneyline));
}

// ESPN strips live odds from the scoreboard once a match ends, but the summary
// endpoint's pickcenter retains the closing line. Used to backfill finished games.
export async function fetchClosingOdds(eventId: string): Promise<MatchOdds | null> {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${eventId}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "the-boys-are-back-in-cup/1.0 (hobby project)" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { pickcenter?: any[] };
    const pc = Array.isArray(json.pickcenter) ? json.pickcenter : [];
    return oddsFromEntry(pc.find((x) => x && x.moneyline) ?? pc[0]);
  } catch {
    return null;
  }
}

function parseSide(c: Record<string, any>, redCards: number): EspnSide {
  const team = c.team ?? {};
  const rawScore = c.score;
  return {
    name: team.displayName ?? team.name ?? team.shortDisplayName ?? "TBD",
    code: team.abbreviation ?? null,
    score:
      rawScore != null && rawScore !== "" && !Number.isNaN(Number(rawScore))
        ? Number(rawScore)
        : null,
    espnId: team.id != null ? String(team.id) : null,
    redCards,
  };
}
