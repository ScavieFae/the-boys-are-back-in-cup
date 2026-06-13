import { getStandings, rivalryHeadline } from "../lib/standings";

async function main() {
  const s = await getStandings();

  console.log("=== Managers' Table ===");
  console.log("Pos Manager   P  W  D  L  GF GA GD Pts");
  s.table.forEach((r, i) => {
    console.log(
      `${String(i + 1).padEnd(3)} ${r.manager.padEnd(8)} ${String(r.played).padStart(2)} ${String(r.w).padStart(2)} ${String(r.d).padStart(2)} ${String(r.l).padStart(2)} ${String(r.gf).padStart(2)} ${String(r.ga).padStart(2)} ${String(r.gd).padStart(3)} ${String(r.pts).padStart(3)}`,
    );
  });

  console.log(`\n=== Rivalries (${s.managerMeetings} manager-vs-manager games) ===`);
  if (s.rivalries.length === 0) console.log("(none yet)");
  s.rivalries.forEach((r) => console.log("  " + rivalryHeadline(r)));

  // --- consistency checks ---
  let ok = true;
  const fail = (msg: string) => { ok = false; console.log("  ✗ " + msg); };

  // 1. Each rivalry's results sum to its meetings.
  for (const r of s.rivalries) {
    if (r.aWins + r.bWins + r.draws !== r.meetings) fail(`rivalry ${r.a}/${r.b} totals != meetings`);
  }
  // 2. H2H symmetry: A's wins over B == B's losses to A; draws mirror.
  for (const a of s.managers) {
    for (const b of s.managers) {
      if (a === b) continue;
      if (s.h2h[a][b].w !== s.h2h[b][a].l) fail(`asym wins ${a} vs ${b}`);
      if (s.h2h[a][b].d !== s.h2h[b][a].d) fail(`asym draws ${a} vs ${b}`);
    }
  }
  // 3. Total H2H wins == total H2H losses across everyone.
  let totW = 0, totL = 0;
  for (const a of s.managers) for (const b of s.managers) {
    if (a === b) continue;
    totW += s.h2h[a][b].w; totL += s.h2h[a][b].l;
  }
  if (totW !== totL) fail(`total wins ${totW} != total losses ${totL}`);
  // 4. Table sanity: played == w+d+l, pts == 3w+d.
  for (const r of s.table) {
    if (r.played !== r.w + r.d + r.l) fail(`${r.manager} played != w+d+l`);
    if (r.pts !== 3 * r.w + r.d) fail(`${r.manager} pts formula off`);
  }

  console.log(ok ? "\nPASS ✅ standings internally consistent" : "\nFAIL ❌");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
