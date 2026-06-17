"use client";
import { useEffect, useState } from "react";

export function NumberInput({
  value, onChange, className, ariaLabel, autoFocus,
}: {
  value: number;
  onChange: (n: number) => void;   // receives 0 when the field is empty
  min?: number;                    // kept for call-site compatibility; parents gate submit on it
  className?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}) {
  // Local text state so the field can be "" while editing. Seed from value.
  const [text, setText] = useState(value ? String(value) : "");
  // Keep in sync if the PARENT changes value externally (e.g. modal recompute),
  // but don't fight the user mid-type: only resync when the numeric meaning differs.
  useEffect(() => {
    const cur = text === "" ? 0 : parseInt(text, 10);
    if (value !== cur) setText(value ? String(value) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      value={text}
      onChange={(e) => {
        const cleaned = e.target.value.replace(/[^0-9]/g, "");
        setText(cleaned);
        onChange(cleaned === "" ? 0 : parseInt(cleaned, 10));
      }}
      className={className}
    />
  );
}
