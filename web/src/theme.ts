import { useCallback, useState } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "tadfuq_theme";
const THEME_COLORS: Record<Theme, string> = { dark: "#080a12", light: "#f6f7fc" };

export const currentTheme = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

function apply(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}

/**
 * Switches theme with a circular reveal from where the user clicked (View Transitions API),
 * falling back to a soft color cross-fade in browsers without it.
 */
export function switchTheme(theme: Theme, origin?: { x: number; y: number }) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private mode: the choice lasts for this visit */
  }

  const root = document.documentElement;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const startViewTransition = (document as any).startViewTransition?.bind(document) as
    | ((update: () => void) => { ready: Promise<void> })
    | undefined;

  if (!startViewTransition || reducedMotion) {
    root.classList.add("theme-fade");
    apply(theme);
    window.setTimeout(() => root.classList.remove("theme-fade"), 500);
    return;
  }

  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? 0;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  startViewTransition(() => apply(theme))
    .ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 650, easing: "cubic-bezier(0.4, 0, 0.2, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    })
    .catch(() => {});
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const toggle = useCallback(
    (event?: { clientX: number; clientY: number }) => {
      const next: Theme = theme === "dark" ? "light" : "dark";
      switchTheme(next, event ? { x: event.clientX, y: event.clientY } : undefined);
      setTheme(next);
    },
    [theme],
  );
  return { theme, toggle };
}
