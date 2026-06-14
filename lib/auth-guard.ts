import { redirect } from "next/navigation";
import { auth } from "@/auth";

export interface CurrentManager {
  manager: string;
  personId: number;
}

/**
 * Read the signed-in manager from the session, or null if logged out / not
 * resolvable. Safe to call anywhere on the server (returns null instead of
 * throwing when auth is unconfigured).
 */
export async function getCurrentManager(): Promise<CurrentManager | null> {
  const session = await auth();
  const manager = session?.user?.manager;
  const personId = session?.user?.personId;
  if (!manager || personId == null) return null;
  return { manager, personId };
}

/**
 * Require a logged-in manager for a server action or route. Redirects to the
 * Google sign-in flow when logged out; returns the manager otherwise. Use this
 * in future betting routes that must know WHO is acting.
 */
export async function requireManager(): Promise<CurrentManager> {
  const current = await getCurrentManager();
  if (!current) redirect("/api/auth/signin");
  return current;
}
