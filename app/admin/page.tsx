import { isAdmin, adminPasswordSet } from "@/lib/admin-auth";
import { getEditableMatches, type AdminMatch } from "@/lib/admin";
import { OwnerChip } from "@/components/OwnerChip";
import { KickoffTime } from "@/components/KickoffTime";
import {
  loginAction,
  logoutAction,
  saveScoreAction,
  clearOverrideAction,
  syncAction,
} from "./actions";

export const dynamic = "force-dynamic";

function LoginForm() {
  return (
    <div className="max-w-sm mx-auto mt-16">
      <h1 className="text-xl font-bold mb-1">Admin</h1>
      <p className="text-zinc-500 text-sm mb-4">Enter the shared password to edit scores.</p>
      <form action={loginAction} className="flex gap-2">
        <input
          type="password"
          name="password"
          placeholder="Password"
          autoFocus
          className="flex-1 rounded-md bg-white/5 border border-white/10 px-3 py-2 text-sm outline-none focus:border-white/30"
        />
        <button className="rounded-md bg-white text-black px-4 py-2 text-sm font-medium hover:bg-zinc-200">
          Enter
        </button>
      </form>
    </div>
  );
}

function MatchEditor({ m }: { m: AdminMatch }) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        m.overridden ? "border-amber-500/40 bg-amber-500/[0.04]" : "border-white/10 bg-white/[0.02]"
      }`}
    >
      <div className="flex items-center justify-between mb-3 text-xs">
        <span className="text-zinc-500">
          {m.groupLetter ? `Group ${m.groupLetter}` : m.stage ?? ""} ·{" "}
          <KickoffTime iso={m.kickoffUtc} />
        </span>
        {m.overridden ? (
          <span className="font-semibold text-amber-400">MANUAL OVERRIDE</span>
        ) : (
          <span className="text-zinc-500">ESPN: {m.espnStatus}</span>
        )}
      </div>

      <form action={saveScoreAction} className="space-y-2">
        <input type="hidden" name="matchId" value={m.id} />

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-[10px] text-zinc-500 w-8">{m.home.code ?? "—"}</span>
            <span className="truncate">{m.home.name}</span>
            <OwnerChip owner={m.home.owner} />
          </div>
          <input
            type="number"
            name="home"
            defaultValue={m.home.score ?? ""}
            min={0}
            className="w-16 rounded-md bg-white/5 border border-white/10 px-2 py-1 text-center tabular-nums outline-none focus:border-white/30"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-[10px] text-zinc-500 w-8">{m.away.code ?? "—"}</span>
            <span className="truncate">{m.away.name}</span>
            <OwnerChip owner={m.away.owner} />
          </div>
          <input
            type="number"
            name="away"
            defaultValue={m.away.score ?? ""}
            min={0}
            className="w-16 rounded-md bg-white/5 border border-white/10 px-2 py-1 text-center tabular-nums outline-none focus:border-white/30"
          />
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <select
            name="status"
            defaultValue={m.status}
            className="rounded-md bg-white/5 border border-white/10 px-2 py-1 text-sm outline-none focus:border-white/30"
          >
            <option value="pre">Upcoming</option>
            <option value="in">Live</option>
            <option value="post">Final</option>
          </select>
          <div className="flex items-center gap-2">
            {m.overridden && (
              <button
                formAction={clearOverrideAction}
                className="rounded-md border border-white/15 px-3 py-1 text-sm text-zinc-300 hover:bg-white/5"
              >
                Revert to ESPN
              </button>
            )}
            <button className="rounded-md bg-white text-black px-3 py-1 text-sm font-medium hover:bg-zinc-200">
              Save
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export default async function AdminPage() {
  if (!(await isAdmin())) return <LoginForm />;

  const matches = await getEditableMatches();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
          <p className="text-zinc-500 text-sm mt-1">
            Fix a score when ESPN lags or is wrong. Manual values win until you revert.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <form action={syncAction}>
            <button className="rounded-md border border-white/15 px-3 py-2 text-sm hover:bg-white/5">
              Sync ESPN now
            </button>
          </form>
          {adminPasswordSet() && (
            <form action={logoutAction}>
              <button className="rounded-md px-3 py-2 text-sm text-zinc-400 hover:bg-white/5">
                Log out
              </button>
            </form>
          )}
        </div>
      </div>

      {!adminPasswordSet() && (
        <p className="mb-6 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-300">
          No ADMIN_PASSWORD set — this page is unprotected. Set it before deploying.
        </p>
      )}

      {matches.length === 0 ? (
        <p className="text-sm text-zinc-600">No matches in the editable window (live, ±3 days, or overridden).</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {matches.map((m) => (
            <MatchEditor key={m.id} m={m} />
          ))}
        </div>
      )}
    </div>
  );
}
