import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../icons";

/*
 * A carousel that is a scroller first: it snaps, it swipes on a phone, and the arrows and dots
 * only ever ask a child to scroll itself into view - which keeps it correct in RTL with no maths.
 */
export function Rail({
  children,
  className = "",
  /** Only behaves as a carousel on phones (a grid on wider screens). */
  phoneOnly,
  label,
}: {
  children: ReactNode;
  className?: string;
  phoneOnly?: boolean;
  label: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(0);
  const [carousel, setCarousel] = useState(!phoneOnly);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    if (!phoneOnly) return;
    const query = window.matchMedia("(max-width: 860px)");
    const sync = () => setCarousel(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [phoneOnly]);

  // Which card is in the middle right now: asked of the browser, not computed from scrollLeft.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || !carousel) return;
    const items = [...track.children] as HTMLElement[];
    setCount(items.length);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > 0.55) setIndex(items.indexOf(entry.target as HTMLElement));
        }
      },
      { root: track, threshold: [0.55, 0.9] },
    );
    for (const item of items) observer.observe(item);

    // Nothing to page through when everything already fits.
    const measure = () => setOverflows(track.scrollWidth > track.clientWidth + 4);
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(track);
    return () => {
      observer.disconnect();
      resize.disconnect();
    };
  }, [children, carousel]);

  const goTo = useCallback((next: number) => {
    const track = trackRef.current;
    const item = track?.children[next] as HTMLElement | undefined;
    item?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, []);

  return (
    <div className={`rail ${phoneOnly ? "rail-phone" : ""} ${className}`}>
      <div className="rail-track" ref={trackRef} role="group" aria-label={label} tabIndex={carousel ? 0 : -1}>
        {children}
      </div>
      {carousel && overflows && count > 1 && (
        <div className="rail-nav">
          <button className="btn ghost icon sm" onClick={() => goTo(Math.max(0, index - 1))} disabled={index === 0} aria-label="السابق">
            <Icon name="arrowRight" size={17} />
          </button>
          <div className="rail-dots">
            {Array.from({ length: count }, (_, i) => (
              <button key={i} className={i === index ? "on" : ""} onClick={() => goTo(i)} aria-label={`${i + 1}`} aria-current={i === index} />
            ))}
          </div>
          <button
            className="btn ghost icon sm"
            onClick={() => goTo(Math.min(count - 1, index + 1))}
            disabled={index >= count - 1}
            aria-label="التالي"
          >
            <Icon name="arrowLeft" size={17} />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Fades sections in as they come into view, once each. Elements opt in with data-reveal,
 * and anything already on screen at load shows immediately so nothing is ever missing.
 */
export function useReveal(deps: unknown[] = []) {
  useEffect(() => {
    const targets = [...document.querySelectorAll<HTMLElement>("[data-reveal]:not(.revealed)")];
    if (!targets.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const el of targets) el.classList.add("revealed");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("revealed");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );
    for (const el of targets) observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
