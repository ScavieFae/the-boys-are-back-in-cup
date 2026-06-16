import { getFeed } from "@/lib/feed";
import { getCurrentManager } from "@/lib/auth-guard";
import { FeedRail } from "@/components/FeedRail";

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  let me: string | null = null;
  try {
    me = (await getCurrentManager())?.manager ?? null;
  } catch {
    me = null;
  }

  const items = await getFeed(50);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Activity</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Every bet, join, settle, and kickoff — newest first.
        </p>
      </div>

      <FeedRail items={items} currentManager={me} title="Activity" />
    </div>
  );
}
