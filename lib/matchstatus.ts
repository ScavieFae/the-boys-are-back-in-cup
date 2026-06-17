/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared match-status helpers. Both lib/bets.ts (3-spot pools) and
// lib/parimutuel.ts (pari-mutuel pots) read a match's "effective" status and
// result, honoring the manual override that takes precedence over synced ESPN
// values. Kept here (rather than in bets.ts) so parimutuel.ts can import these
// without pulling in bets.ts — keeping the dependency one-directional
// (bets.ts -> parimutuel.ts for the unified ledger; never the reverse).
import { type Outcome } from "./betting";

export function effectiveStatus(m: any): string {
  return Number(m.manual_override) === 1 && m.manual_status ? m.manual_status : m.status;
}

export function effectiveResult(m: any): Outcome | null {
  if (effectiveStatus(m) !== "post") return null;
  const ov = Number(m.manual_override) === 1;
  const hs = ov && m.manual_home_score != null ? Number(m.manual_home_score) : m.home_score != null ? Number(m.home_score) : null;
  const as = ov && m.manual_away_score != null ? Number(m.manual_away_score) : m.away_score != null ? Number(m.away_score) : null;
  if (hs == null || as == null) return null;
  return hs > as ? "home" : as > hs ? "away" : "draw";
}
