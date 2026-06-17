"use client";
import { useEffect, useState } from "react";

export function NumberInput({
  value, onChange, min = 1, className, ariaLabel, autoFocus,
}: {
  value: number;
  onChange: (n: number) => void;   // receives 0 when the field is empty
  min?: number;                    // spinner floor only; does NOT block typing/clearing
  className?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}) {
  // Local text state so the field can be "" while editing. Seed from value.
  const [text, setText] = useState(value ? String(value) : "");
  // Keep in sync if the PARENT changes value externally (e.g. modal recompute),
  // but don't fight the user mid-type: only resync when the numeric meaning differs.
  useEffect(() => {
    const cur = text === "" ? 0 : Math.floor(Number(text));
    if (value !== cur) setText(value ? String(value) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      type="number"
      min={min}
      inputMode="numeric"
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;       // "" when cleared
        setText(raw);
        const n = raw === "" ? 0 : Math.floor(Number(raw));
        onChange(Number.isFinite(n) ? Math.max(0, n) : 0);
      }}
      className={className}
    />
  );
}
