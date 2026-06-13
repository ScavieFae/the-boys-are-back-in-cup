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

  return {
    espnEventId: String(ev.id),
    kickoffUtc: ev.date,
    status,
    statusDetail,
    stage,
    groupLetter,
    home: parseSide(homeC),
    away: parseSide(awayC),
  };
}

function parseSide(c: Record<string, any>): EspnSide {
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
  };
}
