import {
  deVig,
  computeBuyins,
  settlePool,
  potentialProfit,
  americanToImpliedProb,
  type Outcome,
} from "../lib/betting";

let ok = true;
const check = (cond: boolean, label: string) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) ok = false;
};
const approx = (a: number, b: number, eps = 0.011) => Math.abs(a - b) <= eps;

// --- de-vig: USA +105 / Draw +220 / France +310 ---
const odds = { home: "+105", draw: "+220", away: "+310" };
const probs = deVig(odds)!;
check(approx(probs.home + probs.draw + probs.away, 1), "de-vigged probs sum to 1");
check(probs.home > probs.draw && probs.draw > probs.away, "favorite has highest prob");
// raw implied (with vig) would sum > 1
const rawSum =
  americanToImpliedProb("+105") + americanToImpliedProb("+220") + americanToImpliedProb("+310");
check(rawSum > 1.02, `raw implied has vig (sum=${rawSum.toFixed(4)})`);

// --- buy-ins: creator on home (USA) for $24 ---
const b = computeBuyins(probs, "home", 24);
console.log(`  buy-ins -> USA $${b.home}  Draw $${b.draw}  France $${b.away}`);
check(b.home === 24, "creator buy-in stays exact");
check(b.home > b.draw && b.draw > b.away, "favorite costs most, dog least");

// --- all-three-filled pool reproduces ~the line for each backer ---
const all = { home: b.home, draw: b.draw, away: b.away };
for (const o of ["home", "draw", "away"] as Outcome[]) {
  const profit = potentialProfit(all, o);
  const impliedOddsProfitRatio = profit / all[o]; // profit per $ staked
  const fairRatio = (1 - probs[o]) / probs[o]; // de-vigged fair payout ratio
  check(
    approx(impliedOddsProfitRatio, fairRatio, 0.06),
    `${o}: full-pool payout ≈ de-vigged line (got ${impliedOddsProfitRatio.toFixed(2)}, fair ${fairRatio.toFixed(2)})`,
  );
}

// --- settlement: all three filled ---
for (const result of ["home", "draw", "away"] as Outcome[]) {
  const s = settlePool(all, result);
  if (s.status !== "win") { check(false, `all-filled ${result} should win`); continue; }
  const pot = all.home + all.draw + all.away;
  const winnerGain = s.entries.reduce((x, e) => x + e.amount, 0);
  check(s.winner === result && s.pot === pot, `all-filled: ${result} wins pot $${pot}`);
  check(winnerGain === pot - all[result], `all-filled ${result}: zero-sum (winner +$${winnerGain})`);
}

// --- settlement: only 2 spots (USA + France), draw spot empty ---
const two = { home: b.home, away: b.away };
const drawPush = settlePool(two, "draw");
check(drawPush.status === "push", "2-spot, draw result -> PUSH (draw spot empty)");
const homeWin2 = settlePool(two, "home");
check(
  homeWin2.status === "win" && homeWin2.pot === b.home + b.away && homeWin2.entries.length === 1,
  "2-spot, home wins -> takes both buy-ins",
);

// --- the risk-flip: same two players, draw spot now taken by a third ---
const three = { home: b.home, away: b.away, draw: b.draw };
const drawNowLoses = settlePool(three, "draw");
check(
  drawNowLoses.status === "win" && drawNowLoses.winner === "draw",
  "draw spot filled -> draw now LOSES for home/away (push became loss)",
);

// --- void: fewer than two spots ---
check(settlePool({ home: 10 }, "home").status === "void", "1 spot -> void");

console.log(ok ? "\nPASS ✅ betting math is sound" : "\nFAIL ❌");
process.exit(ok ? 0 : 1);
