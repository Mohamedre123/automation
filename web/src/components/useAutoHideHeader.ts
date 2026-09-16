import { useEffect, useState } from "react";

/**
 * Top bar that gets out of the way: hides while scrolling down, comes back when scrolling up
 * or as soon as the scroll stops. Turns see-through once the page is scrolled.
 */
export function useAutoHideHeader(pinned = false) {
  const [state, setState] = useState({ hidden: false, scrolled: false });

  useEffect(() => {
    if (pinned) {
      setState((s) => (s.hidden ? { ...s, hidden: false } : s));
      return;
    }
    let lastY = window.scrollY;
    let frame = 0;
    let idle = 0;

    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const delta = y - lastY;
      if (Math.abs(delta) < 6 && y > 0) return;
      const scrolled = y > 12;
      let hidden: boolean | undefined;
      if (y < 80) hidden = false;
      else if (delta > 0) hidden = true;
      else if (delta < 0) hidden = false;
      lastY = y;
      setState((s) => {
        const next = { scrolled, hidden: hidden ?? s.hidden };
        return next.scrolled === s.scrolled && next.hidden === s.hidden ? s : next;
      });
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
      // Stopped scrolling: bring the bar back.
      window.clearTimeout(idle);
      idle = window.setTimeout(() => setState((s) => (s.hidden ? { ...s, hidden: false } : s)), 450);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      window.clearTimeout(idle);
    };
  }, [pinned]);

  return state;
}
