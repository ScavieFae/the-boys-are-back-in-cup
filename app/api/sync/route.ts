import { NextResponse } from "next/server";
import { syncFixtures } from "@/lib/sync";

export const dynamic = "force-dynamic";

// Hit by the cron job (and manually) to refresh the match feed from ESPN.
// In production, protect with CRON_SECRET so randoms can't hammer it.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    const url = new URL(request.url);
    const provided = auth?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("key");
    if (provided !== secret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await syncFixtures();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
