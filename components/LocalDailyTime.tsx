"use client";
import { useEffect, useState } from "react";

// Renders a fixed daily UTC time-of-day in the viewer's local timezone
// (e.g. 12:00 UTC -> "8:00 AM"). Computed on the client to avoid a tz mismatch.
export function LocalDailyTime({ utcHour, utcMinute = 0 }: { utcHour: number; utcMinute?: number }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const d = new Date();
    d.setUTCHours(utcHour, utcMinute, 0, 0);
    setText(d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
  }, [utcHour, utcMinute]);
  return <span suppressHydrationWarning>{text || `${utcHour}:00 UTC`}</span>;
}
