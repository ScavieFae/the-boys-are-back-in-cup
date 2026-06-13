// Reconcile the names ESPN uses against the canonical names in data/draft.json.
// ESPN tends to use full/formal names ("Korea Republic") where our sheet uses
// colloquial ones ("South Korea"). Match on a normalized key, with an alias map
// for the cases plain normalization can't bridge.

export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics: ü -> u, ç -> c
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Maps a normalized ESPN/alternate spelling -> our canonical team name.
// Keys are passed through normalizeName(), so list them in readable form.
const ALIASES: Record<string, string> = {
  "turkey": "Türkiye",
  "turkiye": "Türkiye",
  "czech republic": "Czechia",
  "korea republic": "South Korea",
  "south korea": "South Korea",
  "ir iran": "Iran",
  "iran": "Iran",
  "cote d ivoire": "Ivory Coast",
  "ivory coast": "Ivory Coast",
  "congo dr": "DR Congo",
  "dr congo": "DR Congo",
  "democratic republic of congo": "DR Congo",
  "bosnia and herzegovina": "Bosnia & Herzegovina",
  "bosnia herzegovina": "Bosnia & Herzegovina",
  "curacao": "Curaçao",
  "united states": "USA",
  "usa": "USA",
  "cabo verde": "Cape Verde",
  "cape verde": "Cape Verde",
};

// Build a lookup from normalized canonical names -> canonical name, merged with aliases.
export function buildNameResolver(canonicalNames: string[]): (raw: string) => string | null {
  const table = new Map<string, string>();
  for (const name of canonicalNames) table.set(normalizeName(name), name);
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    table.set(normalizeName(alias), canonical);
  }
  return (raw: string) => table.get(normalizeName(raw)) ?? null;
}
