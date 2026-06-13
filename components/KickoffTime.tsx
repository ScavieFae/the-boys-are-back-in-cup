"use client";
import { useEffect, useState } from "react";

// Renders the kickoff in the viewer's local timezone. Computed on the client
// after mount to avoid a server/client timezone hydration mismatch.
export function KickoffTime({ iso }: { iso: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const d = new Date(iso);
    setText(
      d.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    );
  }, [iso]);
  return <span suppressHydrationWarning>{text || " "}</span>;
}
