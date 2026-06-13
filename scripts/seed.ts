import { db, ensureSchema } from "../lib/db";
import draft from "../data/draft.json";

interface Pick {
  team: string;
  owner: string | null;
  round: number | null;
  csvGroup: string;
}

async function main() {
  await ensureSchema();

  // Full reseed: clear in FK-safe order.
  await db.executeMultiple(
    "DELETE FROM matches; DELETE FROM teams; DELETE FROM people;",
  );

  const peopleIds = new Map<string, number>();
  for (const name of draft.managers) {
    const res = await db.execute({
      sql: "INSERT INTO people (name) VALUES (?)",
      args: [name],
    });
    peopleIds.set(name, Number(res.lastInsertRowid));
  }

  const all: Pick[] = [...draft.picks, ...draft.freeAgents];
  for (const p of all) {
    const ownerId = p.owner ? peopleIds.get(p.owner) ?? null : null;
    await db.execute({
      sql: "INSERT INTO teams (name, csv_group, owner_id, draft_round) VALUES (?,?,?,?)",
      args: [p.team, p.csvGroup, ownerId, p.round],
    });
  }

  console.log(
    `Seeded ${draft.managers.length} managers and ${all.length} teams ` +
      `(${draft.picks.length} drafted, ${draft.freeAgents.length} free agents).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
