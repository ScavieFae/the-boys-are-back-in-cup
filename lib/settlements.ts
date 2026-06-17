/* eslint-disable @typescript-eslint/no-explicit-any */
// Settle-up payments engine: create, confirm, undo, void, read views, and the
// directed transfers that fold into the unified Settle Up ledger.
//
// A settlement is a real-dollar payment from a debtor (from_person / payer) to a
// creditor (to_person / payee). It carries TWO acks — payer_ack (from-side) and
// payee_ack (to-side):
//   payer ack only  -> 'payer_marked'
//   payee ack only  -> 'payee_marked'
//   both            -> 'paid'
// Either party can create it (their ack is set on creation); the other confirms
// later. OFFSET TIMING is option A: an ACTIVE settlement offsets the bet-debt as
// soon as it exists, regardless of ack count.
//
// This file NEVER imports lib/bets.ts — bets.ts imports settlementLedgerTransfers()
// from here to fold settlements into getLedger, keeping the dependency
// one-directional (mirrors lib/parimutuel.ts).
import { db, ensureSchema } from "./db";

const nowIso = () => new Date().toISOString();

export type Ok = { ok: true };
export type Err = { ok: false; error: string };

export type AckStatus = "payer_marked" | "payee_marked" | "paid";

export interface SettlementView {
  id: number;
  from: string; // debtor / payer (manager name)
  to: string; // creditor / payee (manager name)
  fromPersonId: number;
  toPersonId: number;
  amount: number;
  payerAckAt: string | null;
  payeeAckAt: string | null;
  ackStatus: AckStatus;
  createdAt: string;
  note: string | null;
}

function ackStatusFor(payerAckAt: string | null, payeeAckAt: string | null): AckStatus {
  if (payerAckAt && payeeAckAt) return "paid";
  if (payerAckAt) return "payer_marked";
  return "payee_marked";
}

// ---- Mutations ----------------------------------------------------------------

export async function createSettlement(opts: {
  fromPersonId: number;
  toPersonId: number;
  amount: number;
  ackByPersonId: number;
  note?: string;
}): Promise<({ ok: true; id: number }) | Err> {
  await ensureSchema();
  const { fromPersonId, toPersonId, amount, ackByPersonId, note } = opts;

  if (!Number.isInteger(amount) || amount < 1) {
    return { ok: false, error: "amount must be a whole dollar amount of at least $1" };
  }
  if (fromPersonId === toPersonId) {
    return { ok: false, error: "payer and payee must be different people" };
  }
  // The marker must be a party to the debt.
  if (ackByPersonId !== fromPersonId && ackByPersonId !== toPersonId) {
    return { ok: false, error: "only a party to the payment can mark it paid" };
  }

  const ts = nowIso();
  const payerAck = ackByPersonId === fromPersonId ? ts : null;
  const payeeAck = ackByPersonId === toPersonId ? ts : null;

  const res = await db.execute({
    sql: `INSERT INTO settlements
            (from_person, to_person, amount, payer_ack_at, payee_ack_at, created_by, created_at, note, status)
          VALUES (?,?,?,?,?,?,?,?, 'active')`,
    args: [fromPersonId, toPersonId, amount, payerAck, payeeAck, ackByPersonId, ts, note ?? null],
  });
  return { ok: true, id: Number(res.lastInsertRowid) };
}

// The OTHER party confirms: the from-side sets payer_ack, the to-side sets
// payee_ack. Rejects if the caller isn't a party or their ack is already set.
export async function confirmSettlement(id: number, byPersonId: number): Promise<Ok | Err> {
  await ensureSchema();
  const s = (await db.execute({ sql: "SELECT * FROM settlements WHERE id=? AND status='active'", args: [id] })).rows[0] as any;
  if (!s) return { ok: false, error: "settlement not found" };

  const fromPerson = Number(s.from_person);
  const toPerson = Number(s.to_person);
  let col: "payer_ack_at" | "payee_ack_at";
  if (byPersonId === fromPerson) {
    if (s.payer_ack_at) return { ok: false, error: "you've already marked this paid" };
    col = "payer_ack_at";
  } else if (byPersonId === toPerson) {
    if (s.payee_ack_at) return { ok: false, error: "you've already confirmed this payment" };
    col = "payee_ack_at";
  } else {
    return { ok: false, error: "only a party to the payment can confirm it" };
  }

  await db.execute({ sql: `UPDATE settlements SET ${col}=? WHERE id=?`, args: [nowIso(), id] });
  return { ok: true };
}

// Clear THIS caller's ack (the from-side clears payer_ack, the to-side clears
// payee_ack). If, after clearing, BOTH acks are null, the record no longer
// represents a payment -> void it. Otherwise keep it active with the remaining ack.
export async function undoSettlement(id: number, byPersonId: number): Promise<Ok | Err> {
  await ensureSchema();
  const s = (await db.execute({ sql: "SELECT * FROM settlements WHERE id=? AND status='active'", args: [id] })).rows[0] as any;
  if (!s) return { ok: false, error: "settlement not found" };

  const fromPerson = Number(s.from_person);
  const toPerson = Number(s.to_person);
  if (byPersonId !== fromPerson && byPersonId !== toPerson) {
    return { ok: false, error: "only a party to the payment can undo it" };
  }

  const payerAck = byPersonId === fromPerson ? null : (s.payer_ack_at ?? null);
  const payeeAck = byPersonId === toPerson ? null : (s.payee_ack_at ?? null);

  if (payerAck == null && payeeAck == null) {
    await db.execute({ sql: "UPDATE settlements SET payer_ack_at=NULL, payee_ack_at=NULL, status='voided' WHERE id=?", args: [id] });
  } else {
    const col: "payer_ack_at" | "payee_ack_at" = byPersonId === fromPerson ? "payer_ack_at" : "payee_ack_at";
    await db.execute({ sql: `UPDATE settlements SET ${col}=NULL WHERE id=?`, args: [id] });
  }
  return { ok: true };
}

// Admin soft-delete: stops offsetting the debt.
export async function voidSettlement(id: number): Promise<void> {
  await ensureSchema();
  await db.execute({ sql: "UPDATE settlements SET status='voided' WHERE id=?", args: [id] });
}

export async function reactivateSettlement(id: number): Promise<void> {
  await ensureSchema();
  await db.execute({ sql: "UPDATE settlements SET status='active' WHERE id=?", args: [id] });
}

// ---- Read views ---------------------------------------------------------------

const SETTLE_SELECT = /* sql */ `
  SELECT s.id, s.amount, s.payer_ack_at, s.payee_ack_at, s.created_at, s.note, s.status,
         s.from_person, s.to_person,
         fp.name AS from_mgr, tp.name AS to_mgr
  FROM settlements s
  LEFT JOIN people fp ON fp.id = s.from_person
  LEFT JOIN people tp ON tp.id = s.to_person
`;

function shapeSettlement(r: any): SettlementView {
  const payerAckAt = (r.payer_ack_at ?? null) as string | null;
  const payeeAckAt = (r.payee_ack_at ?? null) as string | null;
  return {
    id: Number(r.id),
    from: r.from_mgr,
    to: r.to_mgr,
    fromPersonId: Number(r.from_person),
    toPersonId: Number(r.to_person),
    amount: Number(r.amount),
    payerAckAt,
    payeeAckAt,
    ackStatus: ackStatusFor(payerAckAt, payeeAckAt),
    createdAt: r.created_at,
    note: (r.note ?? null) as string | null,
  };
}

export async function getSettlements(): Promise<SettlementView[]> {
  await ensureSchema();
  const rows = (await db.execute(`${SETTLE_SELECT} WHERE s.status='active' ORDER BY s.created_at DESC, s.id DESC`)).rows as any[];
  return rows.map(shapeSettlement);
}

export async function getAllSettlementsAdmin(): Promise<(SettlementView & { status: string })[]> {
  await ensureSchema();
  const rows = (await db.execute(`${SETTLE_SELECT} ORDER BY s.created_at DESC, s.id DESC`)).rows as any[];
  return rows.map((r) => ({ ...shapeSettlement(r), status: r.status as string }));
}

// ---- Unified ledger transfers -------------------------------------------------

// For every ACTIVE settlement, emit a REVERSE edge that REDUCES the debtor's
// debt. A payment from->to (payer pays creditor) means the creditor now "owes
// back" that amount, so we emit { from: toManager, to: fromManager, amount }.
// When getLedger nets this against the original bet-debt (from owes to), the
// outstanding debt shrinks by `amount`. Manager names; getLedger rounds.
export async function settlementLedgerTransfers(): Promise<{ from: string; to: string; amount: number }[]> {
  await ensureSchema();
  const rows = (
    await db.execute(`
      SELECT s.amount, fp.name AS from_mgr, tp.name AS to_mgr
      FROM settlements s
      LEFT JOIN people fp ON fp.id = s.from_person
      LEFT JOIN people tp ON tp.id = s.to_person
      WHERE s.status='active'
    `)
  ).rows as any[];

  const transfers: { from: string; to: string; amount: number }[] = [];
  for (const r of rows) {
    if (!r.from_mgr || !r.to_mgr) continue;
    // Reverse edge: creditor (to) owes back the debtor (from) the paid amount.
    transfers.push({ from: r.to_mgr as string, to: r.from_mgr as string, amount: Number(r.amount) });
  }
  return transfers;
}
