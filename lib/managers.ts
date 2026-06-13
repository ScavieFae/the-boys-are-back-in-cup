// The five managers and their colors. Full Tailwind class strings are listed
// literally so the compiler keeps them — do not build these dynamically.

export const MANAGERS = ["Brian", "Nathan", "Dan", "Mattie", "Dereck"] as const;
export type Manager = (typeof MANAGERS)[number];

export interface ManagerStyle {
  chip: string; // background + text for a name chip
  ring: string; // ring/border accent
  bar: string; // solid color bar
}

export const MANAGER_STYLES: Record<string, ManagerStyle> = {
  Brian: { chip: "bg-emerald-500/15 text-emerald-300", ring: "ring-emerald-500/40", bar: "bg-emerald-500" },
  Nathan: { chip: "bg-sky-500/15 text-sky-300", ring: "ring-sky-500/40", bar: "bg-sky-500" },
  Dan: { chip: "bg-amber-500/15 text-amber-300", ring: "ring-amber-500/40", bar: "bg-amber-500" },
  Mattie: { chip: "bg-fuchsia-500/15 text-fuchsia-300", ring: "ring-fuchsia-500/40", bar: "bg-fuchsia-500" },
  Dereck: { chip: "bg-violet-500/15 text-violet-300", ring: "ring-violet-500/40", bar: "bg-violet-500" },
};

// Free agents / unowned teams.
export const FREE_AGENT_STYLE: ManagerStyle = {
  chip: "bg-zinc-500/15 text-zinc-400",
  ring: "ring-zinc-500/30",
  bar: "bg-zinc-600",
};

export function styleFor(owner: string | null | undefined): ManagerStyle {
  if (!owner) return FREE_AGENT_STYLE;
  return MANAGER_STYLES[owner] ?? FREE_AGENT_STYLE;
}
