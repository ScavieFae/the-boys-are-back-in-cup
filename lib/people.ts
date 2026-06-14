import { db, ensureSchema } from "@/lib/db";

// Helpers that bridge an authenticated session to a row in the `people` table.
// The five managers are seeded by name (see scripts/seed.ts); auth attaches the
// signed-in Google email to the matching row so future betting routes can join
// wagers to a concrete person id.

/** Record the signed-in email on the manager's people row. Idempotent. */
export async function linkEmailToManager(manager: string, email: string): Promise<void> {
  await ensureSchema();
  await db.execute({
    sql: "UPDATE people SET email = ? WHERE name = ?",
    args: [email.trim().toLowerCase(), manager],
  });
}

/** Look up the people.id for a manager name, or null if not seeded. */
export async function personIdForManager(manager: string): Promise<number | null> {
  await ensureSchema();
  const res = await db.execute({
    sql: "SELECT id FROM people WHERE name = ? LIMIT 1",
    args: [manager],
  });
  const row = res.rows[0];
  return row ? Number(row.id) : null;
}
