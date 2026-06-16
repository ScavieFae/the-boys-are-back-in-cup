"use client";

import { useState } from "react";
import { RuleCard, type RuleCardData } from "@/components/RuleCard";

// Client-side list of rule cards: renders the saved rules (server-provided) plus
// any blank draft cards the user reveals with "Add a rule". Drafts vanish once
// saved/activated (the page revalidates and the new rule arrives as a real card).
export function RuleList({ rules }: { rules: RuleCardData[] }) {
  const [drafts, setDrafts] = useState<number[]>([]); // local keys for blank cards

  const addDraft = () => setDrafts((d) => [...d, Date.now()]);
  const removeDraft = (key: number) => setDrafts((d) => d.filter((k) => k !== key));

  const blank: RuleCardData = {
    id: null,
    criteria: "draw",
    exclude: "none",
    stake: 10,
    horizonDays: 2,
    active: false,
  };

  return (
    <div className="space-y-3">
      {rules.length > 1 && (
        <p className="text-[11px] text-zinc-600">
          Top rule wins when two of your rules want the same game.
        </p>
      )}

      {rules.map((rule, i) => (
        <RuleCard key={rule.id} rule={rule} isFirst={i === 0} isLast={i === rules.length - 1} />
      ))}

      {drafts.map((key) => (
        <RuleCard key={`draft-${key}`} rule={blank} onRemoveDraft={() => removeDraft(key)} />
      ))}

      <button
        onClick={addDraft}
        className="w-full rounded-xl border border-dashed border-white/15 px-3 py-3 text-sm text-zinc-400 hover:border-white/30 hover:bg-white/[0.02]"
      >
        + Add a rule
      </button>
    </div>
  );
}
