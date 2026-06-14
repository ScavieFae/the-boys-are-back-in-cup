import { MANAGERS, type Manager } from "@/lib/managers";

// The allowlist lives in an env var because the repo is PUBLIC and these are
// real personal emails. Format: comma-separated `email:Manager` pairs, e.g.
//   someone@gmail.com:Brian,other@gmail.com:Nathan
// Only the five known managers (see lib/managers.ts) are valid targets; any
// pair pointing at an unknown manager name is ignored.

const MANAGER_SET = new Set<string>(MANAGERS);

function isManager(name: string): name is Manager {
  return MANAGER_SET.has(name);
}

/** Parse AUTH_ALLOWLIST into a normalized email -> Manager map. */
export function parseAllowlist(raw: string | undefined): Map<string, Manager> {
  const map = new Map<string, Manager>();
  if (!raw) return map;
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const idx = trimmed.lastIndexOf(":");
    if (idx === -1) continue;
    const email = trimmed.slice(0, idx).trim().toLowerCase();
    const manager = trimmed.slice(idx + 1).trim();
    if (!email || !isManager(manager)) continue;
    map.set(email, manager);
  }
  return map;
}

/** Resolve a signed-in email to its manager, or null if not allowlisted. */
export function managerForEmail(email: string | null | undefined): Manager | null {
  if (!email) return null;
  const map = parseAllowlist(process.env.AUTH_ALLOWLIST);
  return map.get(email.trim().toLowerCase()) ?? null;
}
