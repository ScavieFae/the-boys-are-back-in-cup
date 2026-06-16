/* eslint-disable @typescript-eslint/no-explicit-any */
// Unit tests for the pure ESPN broadcast/watch-link parsers (lib/espn.ts).
//
// SAFETY: parseBroadcast/parseWatchUrl are pure functions over plain objects.
// This script never touches the DB or the network — it just feeds ESPN-shaped
// literals through the parsers and asserts the derived strings.
import { parseBroadcast, parseWatchUrl } from "../lib/espn";

let ok = true;
const check = (c: boolean, label: string) => { console.log(`${c ? "✓" : "✗"} ${label}`); if (!c) ok = false; };

// --- parseBroadcast ---------------------------------------------------------

// names flatten across entries, dedupe case-insensitively, cap to 3.
check(
  parseBroadcast({ broadcasts: [{ names: ["FOX", "Tele", "Peacock"] }] }) === "FOX · Tele · Peacock",
  "broadcast: flattens names",
);
check(
  parseBroadcast({ broadcasts: [{ names: ["FOX", "fox", "FOX "] }, { names: ["Peacock"] }] }) === "FOX · Peacock",
  "broadcast: dedupes case-insensitively, keeps first casing",
);
check(
  parseBroadcast({ broadcasts: [{ names: ["A", "B", "C", "D", "E"] }] }) === "A · B · C",
  "broadcast: caps at 3",
);

// geoBroadcasts fallback only when broadcasts yields nothing.
check(
  parseBroadcast({ broadcasts: [], geoBroadcasts: [{ media: { shortName: "Telemundo" } }] }) === "Telemundo",
  "broadcast: falls back to geoBroadcasts media.shortName",
);
check(
  parseBroadcast({ broadcasts: [{ names: ["FOX"] }], geoBroadcasts: [{ media: { shortName: "Telemundo" } }] }) === "FOX",
  "broadcast: prefers broadcasts over geoBroadcasts",
);

// null-safety: missing/empty/odd shapes → null.
check(parseBroadcast({}) === null, "broadcast: empty comp → null");
check(parseBroadcast(null) === null, "broadcast: null comp → null");
check(parseBroadcast({ broadcasts: [{ names: [] }] }) === null, "broadcast: empty names → null");

// --- parseWatchUrl ----------------------------------------------------------

// isLive link wins.
check(
  parseWatchUrl({
    links: [
      { rel: ["summary"], href: "https://x/summary", text: "Summary" },
      { isLive: true, href: "https://x/live", text: "Watch" },
    ],
  }) === "https://x/live",
  "watchUrl: prefers isLive link",
);

// summary fallback by rel.
check(
  parseWatchUrl({ links: [{ rel: ["summary"], href: "https://x/summary" }] }) === "https://x/summary",
  "watchUrl: falls back to rel=summary",
);

// summary fallback by text.
check(
  parseWatchUrl({ links: [{ rel: ["foo"], href: "https://x/gc", text: "Summary" }] }) === "https://x/gc",
  "watchUrl: falls back to text=Summary",
);

// all-missing → null.
check(parseWatchUrl({ links: [] }) === null, "watchUrl: empty links → null");
check(parseWatchUrl({}) === null, "watchUrl: missing links → null");
check(parseWatchUrl(null) === null, "watchUrl: null ev → null");
check(
  parseWatchUrl({ links: [{ isLive: true }, { rel: ["stats"], href: "https://x/stats" }] }) === null,
  "watchUrl: no live-with-href and no summary → null",
);

console.log(ok ? "\nPASS ✅ ESPN broadcast/watch parsers sound" : "\nFAIL ❌");
process.exit(ok ? 0 : 1);
