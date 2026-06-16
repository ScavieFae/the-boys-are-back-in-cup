// Unobtrusive broadcaster badge for match cards. Shows "📺 {networks}", and
// when the match is live with a watch link, renders it as an external link.
export function BroadcastBadge({
  broadcast,
  watchUrl,
  live,
}: {
  broadcast: string | null;
  watchUrl: string | null;
  live: boolean;
}) {
  if (!broadcast) return null;

  if (live && watchUrl) {
    return (
      <a
        href={watchUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[11px] text-zinc-500 hover:text-zinc-300"
      >
        📺 {broadcast} ↗
      </a>
    );
  }

  return <span className="text-[11px] text-zinc-500">📺 {broadcast}</span>;
}
