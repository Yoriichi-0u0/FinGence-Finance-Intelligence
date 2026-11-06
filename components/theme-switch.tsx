"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Theme = "system" | "light" | "dark";
const KEY = "fingence-theme";
const EVENT = "fingence-theme";

function read(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}
function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
function choose(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Storage may be unavailable (private mode); the choice then lasts for this page only.
  }
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  window.dispatchEvent(new Event(EVENT));
}

const OPTIONS: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "Match device", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

/** Light, dark or the device setting. The choice is kept in this browser's localStorage only. */
export function ThemeSwitch() {
  const theme = useSyncExternalStore(subscribe, read, () => "system" as Theme);
  return (
    <div role="radiogroup" aria-label="Colour theme" className="grid grid-cols-3 gap-1 rounded-xl bg-white/[0.06] p-1">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          title={label}
          onClick={() => choose(value)}
          className={`flex min-h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors ${
            theme === value ? "bg-white/[0.14] text-white" : "text-[var(--rail-muted)] hover:text-white"
          }`}
        >
          <Icon aria-hidden="true" size={15} />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}
