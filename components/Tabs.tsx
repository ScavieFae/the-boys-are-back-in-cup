"use client";
import { useState } from "react";

// Simple labeled tabs. Each tab's `content` is server-rendered and passed in as
// a prop; this client component just toggles which panel is visible.
export function Tabs({ tabs }: { tabs: { label: string; content: React.ReactNode }[] }) {
  const [active, setActive] = useState(0);
  return (
    <div>
      <div className="flex gap-1 mb-6 border-b border-white/10 overflow-x-auto">
        {tabs.map((t, i) => (
          <button
            key={t.label}
            onClick={() => setActive(i)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 whitespace-nowrap transition ${
              i === active ? "border-white text-white" : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs[active]?.content}
    </div>
  );
}
