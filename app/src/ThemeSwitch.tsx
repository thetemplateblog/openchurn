import { useEffect, useRef, useState } from "react";
import { CheckIcon, ThemeIcon } from "./icons";

type Theme = "system" | "light" | "dark";
const KEY = "openchurn-theme";
const OPTIONS: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function stored(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

// Applies the choice right away and remembers it in this browser. index.html applies it before the first paint.
function applyTheme(theme: Theme) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    /* not remembered; still applied */
  }
}

/** The theme button in the header: System, Light or Dark. */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(stored);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(next: Theme) {
    setTheme(next);
    applyTheme(next);
    setOpen(false);
  }

  return (
    <div className="menu" ref={ref}>
      <button type="button" className="theme-btn" aria-haspopup="menu" aria-expanded={open} aria-label="Change theme" title="Change theme" onClick={() => setOpen((o) => !o)}>
        <ThemeIcon className="icon" />
      </button>
      {open ? (
        <div className="menu-list" role="menu">
          {OPTIONS.map((o) => (
            <button key={o.value} type="button" role="menuitemradio" aria-checked={theme === o.value} onClick={() => choose(o.value)}>
              {o.label}
              {theme === o.value ? <CheckIcon className="icon check" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
