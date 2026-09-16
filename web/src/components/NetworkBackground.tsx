import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

interface Point {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hue: number;
}

const LINK_DISTANCE = 150;
const POINTER_DISTANCE = 190;

/**
 * Site-wide animated backdrop: a slow drifting network of nodes (the platform's own "flows")
 * that reaches toward the pointer or finger and shifts with scrolling. Colors follow the theme.
 */
export function NetworkBackground() {
  const { pathname } = useLocation();
  // The workflow editor has its own grid: the moving network there only distracts.
  if (pathname.startsWith("/app/workflows/")) return <div className="net-bg" aria-hidden="true" />;
  return <NetworkCanvas />;
}

function NetworkCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lowPower =
      window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768 || (navigator.hardwareConcurrency ?? 8) <= 4;
    const frameGap = lowPower ? 1000 / 30 : 0;
    let lastFrame = 0;
    const pointer = { x: -9999, y: -9999, active: false };
    let points: Point[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let lastScroll = window.scrollY;
    let scrollDrift = 0;
    let light = document.documentElement.dataset.theme === "light";

    const resize = () => {
      const dpr = lowPower ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Density scales with the screen so phones stay light and wide monitors don't look empty.
      const target = lowPower
        ? Math.max(16, Math.min(30, Math.round((width * height) / 24000)))
        : Math.max(26, Math.min(95, Math.round((width * height) / 15000)));
      while (points.length < target) {
        points.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.32,
          vy: (Math.random() - 0.5) * 0.32,
          r: 1.2 + Math.random() * 1.6,
          hue: Math.random(),
        });
      }
      points = points.slice(0, target);
      if (reducedMotion) draw();
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      // Accent violet -> cyan, softer on the light theme.
      const lineAlpha = light ? 0.2 : 0.26;
      const dotAlpha = light ? 0.5 : 0.7;

      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        for (let j = i + 1; j < points.length; j++) {
          const b = points[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < LINK_DISTANCE) {
            ctx.strokeStyle = `rgba(${light ? "234, 88, 12" : "249, 115, 22"}, ${lineAlpha * (1 - dist / LINK_DISTANCE)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        if (pointer.active) {
          const dist = Math.hypot(a.x - pointer.x, a.y - pointer.y);
          if (dist < POINTER_DISTANCE) {
            ctx.strokeStyle = `rgba(${light ? "225, 29, 72" : "251, 191, 36"}, ${(light ? 0.4 : 0.5) * (1 - dist / POINTER_DISTANCE)})`;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(pointer.x, pointer.y);
            ctx.stroke();
          }
        }
      }

      for (const p of points) {
        const color = p.hue > 0.5 ? (light ? "225, 29, 72" : "251, 191, 36") : light ? "234, 88, 12" : "251, 146, 60";
        ctx.fillStyle = `rgba(${color}, ${dotAlpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const step = (time = 0) => {
      // Phones: 30fps is plenty for a slow drift and halves the work.
      if (frameGap && time - lastFrame < frameGap) {
        frame = requestAnimationFrame(step);
        return;
      }
      lastFrame = time;
      scrollDrift *= 0.92;
      for (const p of points) {
        // Gentle pull toward the pointer so the network visibly "notices" it.
        if (pointer.active) {
          const dx = pointer.x - p.x;
          const dy = pointer.y - p.y;
          const dist = Math.hypot(dx, dy);
          if (dist < POINTER_DISTANCE && dist > 30) {
            p.vx += (dx / dist) * 0.012;
            p.vy += (dy / dist) * 0.012;
          }
        }
        p.vx *= 0.99;
        p.vy *= 0.99;
        const speed = Math.hypot(p.vx, p.vy);
        if (speed < 0.08) {
          p.vx += (Math.random() - 0.5) * 0.04;
          p.vy += (Math.random() - 0.5) * 0.04;
        }
        p.x += p.vx;
        p.y += p.vy - scrollDrift;
        if (p.x < -20) p.x = width + 20;
        if (p.x > width + 20) p.x = -20;
        if (p.y < -20) p.y = height + 20;
        if (p.y > height + 20) p.y = -20;
      }
      draw();
      frame = requestAnimationFrame(step);
    };

    const onPointer = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
    };
    const onLeave = () => {
      pointer.active = false;
    };
    const onScroll = () => {
      const y = window.scrollY;
      scrollDrift = Math.max(-6, Math.min(6, scrollDrift + (y - lastScroll) * 0.04));
      lastScroll = y;
    };
    const onVisibility = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden && !reducedMotion) frame = requestAnimationFrame(step);
    };
    const themeObserver = new MutationObserver(() => {
      light = document.documentElement.dataset.theme === "light";
      if (reducedMotion) draw();
    });

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerdown", onPointer, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    document.addEventListener("pointerleave", onLeave);
    window.addEventListener("touchend", onLeave, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisibility);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    if (!reducedMotion) frame = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("touchend", onLeave);
      window.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      themeObserver.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="net-bg" aria-hidden="true" />;
}
