import { getEditableMatches, setManualScore, clearManualOverride } from "../lib/admin";
import { getHomepageMatches } from "../lib/queries";

async function main() {
  const editable = await getEditableMatches();
  // Pick an upcoming match to fake a final result on.
  const target = editable.find((m) => m.espnStatus === "pre");
  if (!target) {
    console.log("No upcoming match in window to test with; skipping.");
    return;
  }
  console.log(`Target: ${target.home.name} vs ${target.away.name} (id ${target.id}), espnStatus=${target.espnStatus}`);

  // Override it to a 3-2 final.
  await setManualScore(target.id, 3, 2, "post");
  let home = await getHomepageMatches();
  const inRecent = home.recent.find((m) => m.id === target.id);
  console.log(
    `After override -> appears in RECENT as final: ${!!inRecent}` +
      (inRecent ? `, score ${inRecent.home.score}-${inRecent.away.score}, status ${inRecent.status}` : ""),
  );

  // Revert.
  await clearManualOverride(target.id);
  home = await getHomepageMatches();
  const backInUpcoming = home.upcoming.find((m) => m.id === target.id);
  const stillInRecent = home.recent.find((m) => m.id === target.id);
  console.log(
    `After revert -> back in UPCOMING: ${!!backInUpcoming}, gone from recent: ${!stillInRecent}`,
  );

  const pass =
    !!inRecent &&
    inRecent.home.score === 3 &&
    inRecent.away.score === 2 &&
    inRecent.status === "post" &&
    !!backInUpcoming &&
    !stillInRecent;
  console.log(pass ? "\nPASS ✅ override + revert work end-to-end" : "\nFAIL ❌");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
