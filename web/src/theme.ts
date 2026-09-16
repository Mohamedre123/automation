import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "tadfuq_theme";
const THEME_COLORS: Record<Theme, string> = { dark: "#0b0907", light: "#fbf8f4" };

export const currentTheme = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

function apply(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}

/**
 * Switches theme with a circular reveal from where the user clicked - on phones too.
 * Browsers with View Transitions reveal the new page; others (older iOS Safari) get a
 * single GPU-animated circle in the new background color. The animated background pauses
 * meanwhile so the device only animates one thing.
 */
export function switchTheme(theme: Theme, origin?: { x: number; y: number }) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private mode: the choice lasts for this visit */
  }

  const root = document.documentElement;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    apply(theme);
    return;
  }

  const phone = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 900;
  const duration = phone ? 480 : 650;
  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? 0;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const done = () => root.classList.remove("theme-switching", "theme-instant");
  root.classList.add("theme-switching", "theme-instant");

  const startViewTransition = (document as any).startViewTransition?.bind(document) as
    | ((update: () => void) => { ready: Promise<void>; finished: Promise<void> })
    | undefined;

  if (startViewTransition) {
    const transition = startViewTransition(() => apply(theme));
    transition.ready
      .then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration, easing: "cubic-bezier(0.4, 0, 0.2, 1)", pseudoElement: "::view-transition-new(root)" },
        );
      })
      .catch(() => {});
    transition.finished.then(done, done);
    return;
  }

  // Fallback: one circle in the new background grows over the page, then fades away.
  const veil = document.createElement("div");
  veil.className = "theme-veil";
  veil.style.background = THEME_COLORS[theme];
  document.body.appendChild(veil);
  const grow = veil.animate(
    { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
    { duration: duration * 0.8, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" },
  );
  grow.finished
    .then(() => {
      apply(theme);
      return veil.animate({ opacity: [1, 0] }, { duration: 220, easing: "ease-out", fill: "forwards" }).finished;
    })
    .catch(() => apply(theme))
    .finally(() => {
      veil.remove();
      done();
    });
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  // Several toggles can be on screen (top bar + drawer): keep them all in sync with the page.
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
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
