import { styleFor } from "@/lib/managers";

export function OwnerChip({ owner }: { owner: string | null }) {
  const s = styleFor(owner);
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-none ${s.chip}`}>
      {owner ?? "Free agent"}
    </span>
  );
}
