import { db } from "../lib/db";

async function q(sql: string) {
  return (await db.execute(sql)).rows;
}

async function main() {
  const [{ n: matchCount }] = (await q("SELECT COUNT(*) n FROM matches")) as any;
  const byStatus = await q(
    "SELECT status, COUNT(*) n FROM matches GROUP BY status ORDER BY status",
  );
  const groupStageMatched = await q(
    "SELECT COUNT(*) n FROM matches WHERE home_team_id IS NOT NULL AND away_team_id IS NOT NULL",
  );
  // Any of our 48 teams that ESPN never matched (would mean a real reconciliation gap):
  const teamsNoGroup = await q(
    "SELECT name FROM teams WHERE group_letter IS NULL ORDER BY name",
  );
  const teamsNoCode = await q(
    "SELECT name FROM teams WHERE fifa_code IS NULL ORDER BY name",
  );
  // csv_group vs reconciled group_letter — show where the spreadsheet was wrong:
  const groupDiffs = await q(
    "SELECT name, csv_group, group_letter FROM teams WHERE group_letter IS NOT NULL AND csv_group <> group_letter ORDER BY name",
  );
  // Sample annotated fixtures:
  const sample = await q(`
    SELECT m.kickoff_utc, m.status, m.group_letter,
           m.home_name, hp.name AS home_owner,
           m.away_name, ap.name AS away_owner,
           m.home_score, m.away_score
    FROM matches m
    LEFT JOIN teams ht ON ht.id = m.home_team_id
    LEFT JOIN teams at ON at.id = m.away_team_id
    LEFT JOIN people hp ON hp.id = ht.owner_id
    LEFT JOIN people ap ON ap.id = at.owner_id
    ORDER BY m.kickoff_utc LIMIT 6
  `);

  console.log("matches total:", matchCount);
  console.log("by status:", byStatus);
  console.log("matches with BOTH teams matched:", groupStageMatched[0]);
  console.log("teams missing group_letter:", teamsNoGroup.map((r: any) => r.name));
  console.log("teams missing fifa_code:", teamsNoCode.map((r: any) => r.name));
  console.log("GROUP CORRECTIONS (csv -> reconciled):", groupDiffs);
  console.log("sample fixtures:");
  for (const r of sample as any[]) {
    const h = r.home_owner ? `${r.home_name} (${r.home_owner})` : `${r.home_name} (—)`;
    const a = r.away_owner ? `${r.away_name} (${r.away_owner})` : `${r.away_name} (—)`;
    const score = r.home_score != null ? ` ${r.home_score}-${r.away_score}` : "";
    console.log(`  [${r.status}] Grp ${r.group_letter ?? "?"}: ${h} vs ${a}${score}  @ ${r.kickoff_utc}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
