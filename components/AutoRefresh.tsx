"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Periodically re-renders the server component tree so live scores update
// without a manual reload. Faster cadence when something is actually live.
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
