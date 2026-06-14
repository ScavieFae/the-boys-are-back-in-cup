/* eslint-disable @typescript-eslint/no-explicit-any */
// Seeds two settled three-spot pools as test/historic data (amounts are
// illustrative and intentionally don't match the odds). Idempotent: clears any
// pools on these two matches first. Runs against whatever DB the env points at
// (local file by default; set TURSO_* to target production).
import { db, ensureSchema } from "../lib/db";

async function main() {
  await ensureSchema();

  const pid = async (name: string) =>
    Number((await db.execute({ sql: "SELECT id FROM people WHERE name=?", args: [name] })).rows[0].id);
  const [Brian, Dereck, Nathan] = [await pid("Brian"), await pid("Dereck"), await pid("Nathan")];

  const matchId = async (home: string, awayLike: string) => {
    const r = (await db.execute({
      sql: "SELECT id FROM matches WHERE home_name=? AND away_name LIKE ? LIMIT 1",
      args: [home, awayLike],
    })).rows[0] as any;
    if (!r) throw new Error(`no match ${home} v ${awayLike}`);
    return Number(r.id);
  };
  const mexSA = await matchId("Mexico", "%South Africa%");
  const canBos = await matchId("Canada", "%Bosnia%");

  const now = new Date().toISOString();
  await db.execute({ sql: "DELETE FROM bet_pools WHERE match_id IN (?,?)", args: [mexSA, canBos] });

  const insert = async (
    matchId: number,
    buyin: { home: number; draw: number; away: number },
    who: { home: number; draw: number; away: number },
    result: string,
  ) => {
    await db.execute({
      sql: `INSERT INTO bet_pools
        (match_id, created_by, created_at, buyin_home, buyin_draw, buyin_away,
         home_person_id, draw_person_id, away_person_id, status, result, settled_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?, 'settled', ?, ?, ?)`,
      args: [matchId, who.home, now, buyin.home, buyin.draw, buyin.away, who.home, who.draw, who.away, result, now, now],
    });
  };

  // Mexico v South Africa — Mexico won. Brian(Mexico $22), Nathan(Tie $8), Dereck(SA $5). Pot $35 -> Brian.
  await insert(mexSA, { home: 22, draw: 8, away: 5 }, { home: Brian, draw: Nathan, away: Dereck }, "home");
  // Canada v Bosnia — draw. Brian(Canada $23), Nathan(Tie $11), Dereck(Bosnia $10). Pot $44 -> Nathan.
  await insert(canBos, { home: 23, draw: 11, away: 10 }, { home: Brian, draw: Nathan, away: Dereck }, "draw");

  console.log(`Seeded 2 historic pools (matches ${mexSA}, ${canBos}).`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
