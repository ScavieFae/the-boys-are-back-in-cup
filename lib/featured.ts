import type { MatchView } from "./queries";

// The default-featured match id for the home hero: first live, else next
// upcoming, else latest recent, else null. Lives in its own module (NOT the
// "use client" HomeFeatured) so the server page can call it directly — invoking
// a function exported from a client module on the server throws at runtime. The
// MatchView import is type-only, so this file pulls in no server-only code and
// is safe to import from the client component too.
export function defaultFeaturedId(
  live: MatchView[],
  upcoming: MatchView[],
  recent: MatchView[],
): number | null {
  return live[0]?.id ?? upcoming[0]?.id ?? recent[0]?.id ?? null;
}
