"use client";
import { useEffect, useState } from "react";

// Compact relative timestamp ("2m", "1h", "3d"). Computed on the client after
// mount — same reasoning as KickoffTime: avoid a server/client tz/clock drift
// hydration mismatch. Falls back to a calendar date past ~4 weeks.
function relative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  const sec = Math.max(0, Math.round(diff / 1000));
  if (sec < 45) return "now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 28) return `${day}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function RelativeTime({ iso }: { iso: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    setText(relative(iso));
  }, [iso]);
  return (
    <span suppressHydrationWarning className="text-[11px] tabular-nums text-zinc-600">
      {text || " "}
    </span>
  );
}
