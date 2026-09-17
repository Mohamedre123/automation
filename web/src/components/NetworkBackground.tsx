import { useEffect, useRef } from "react";

/* Site-wide animated space backdrop: twinkling stars on three depth layers (far ones barely move,
   near ones drift and shift more with the pointer and scroll), a few planets, faint constellation
   lines between close stars, and the odd shooting star. Colors follow the theme. */

interface Star {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** 0.15 (far) .. 1 (near): parallax strength, speed and brightness. */
  depth: number;
  phase: number;
  speed: number;
  tint: number;
}

interface Planet {
  sprite: HTMLCanvasElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  depth: number;
  size: number;
  spin: number;
  angle: number;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

const LINK_DISTANCE = 120;
const POINTER_DISTANCE = 170;

type Palette = { stars: string[]; link: string; pointer: string };
const DARK: Palette = { stars: ["255, 250, 240", "251, 191, 36", "251, 146, 60", "253, 164, 175"], link: "249, 115, 22", pointer: "251, 191, 36" };
const LIGHT: Palette = { stars: ["234, 88, 12", "217, 119, 6", "225, 29, 72", "120, 90, 60"], link: "234, 88, 12", pointer: "225, 29, 72" };

/** Planets are drawn once to small canvases, then just moved each frame. */
function planetSprite(size: number, colors: [string, string, string], ring: boolean, light: boolean) {
  const pad = ring ? size * 0.9 : size * 0.35;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.ceil((size + pad) * 2);
  const ctx = canvas.getContext("2d")!;
  const c = canvas.width / 2;

  // Soft glow around the planet.
  const glow = ctx.createRadialGradient(c, c, size * 0.6, c, c, size + pad * 0.8);
  glow.addColorStop(0, `${colors[1]}${light ? "30" : "40"}`);
  glow.addColorStop(1, `${colors[1]}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const drawRing = (front: boolean) => {
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(-0.35);
    ctx.scale(1, 0.28);
    ctx.beginPath();
    ctx.arc(0, 0, size * 1.65, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
    ctx.lineWidth = size * 0.32;
    const ringGradient = ctx.createLinearGradient(-size * 1.7, 0, size * 1.7, 0);
    ringGradient.addColorStop(0, `${colors[2]}10`);
    ringGradient.addColorStop(0.5, `${colors[2]}${light ? "70" : "90"}`);
    ringGradient.addColorStop(1, `${colors[2]}10`);
    ctx.strokeStyle = ringGradient;
    ctx.stroke();
    ctx.restore();
  };

  if (ring) drawRing(false);
  // Lit from the top-left: bright edge to deep shadow.
  const body = ctx.createRadialGradient(c - size * 0.4, c - size * 0.45, size * 0.1, c, c, size);
  body.addColorStop(0, colors[0]);
  body.addColorStop(0.55, colors[1]);
  body.addColorStop(1, colors[2]);
  ctx.beginPath();
  ctx.arc(c, c, size, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  // Faint bands for texture.
  ctx.save();
  ctx.clip();
  ctx.globalAlpha = 0.12;
  for (let i = -3; i <= 3; i++) {
    ctx.fillStyle = i % 2 ? "#ffffff" : "#000000";
    ctx.fillRect(c - size, c + i * size * 0.26, size * 2, size * 0.1);
  }
  ctx.restore();
  // Night side.
  const shade = ctx.createRadialGradient(c + size * 0.55, c + size * 0.55, size * 0.2, c + size * 0.3, c + size * 0.3, size * 1.3);
  shade.addColorStop(0, "rgba(0,0,0,0.55)");
  shade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.beginPath();
  ctx.arc(c, c, size, 0, Math.PI * 2);
  ctx.fillStyle = shade;
  ctx.fill();
  if (ring) drawRing(true);
  return canvas;
}

export function NetworkBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lowPower =
      window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768 || (navigator.hardwareConcurrency ?? 8) <= 4;
    const frameGap = lowPower ? 1000 / 30 : 0;
    const pointer = { x: -9999, y: -9999, active: false };
    const parallax = { x: 0, y: 0, tx: 0, ty: 0 };
    let stars: Star[] = [];
    let planets: Planet[] = [];
    const meteors: Meteor[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let lastFrame = 0;
    let scrollShift = 0;
    let light = document.documentElement.dataset.theme === "light";

    const makePlanets = () => {
      const unit = Math.min(width, height);
      const specs: { size: number; colors: [string, string, string]; ring: boolean; x: number; y: number; depth: number }[] = [
        // Big ringed amber giant, far right.
        { size: unit * 0.075, colors: ["#fde68a", "#f59e0b", "#7c2d12"], ring: true, x: 0.84, y: 0.22, depth: 0.35 },
        // Small rose planet, low left.
        { size: unit * 0.032, colors: ["#fecdd3", "#f43f5e", "#4c0519"], ring: false, x: 0.12, y: 0.72, depth: 0.6 },
        // Distant pale moon.
        { size: unit * 0.018, colors: ["#fff7ed", "#fdba74", "#7c2d12"], ring: false, x: 0.38, y: 0.12, depth: 0.2 },
      ];
      if (!lowPower) specs.push({ size: unit * 0.045, colors: ["#fed7aa", "#ea580c", "#431407"], ring: false, x: 0.62, y: 0.86, depth: 0.5 });
      planets = specs.map((s) => ({
        sprite: planetSprite(Math.max(8, s.size), s.colors, s.ring, light),
        x: s.x * width,
        y: s.y * height,
        vx: (Math.random() - 0.5) * 0.05 * s.depth,
        vy: (Math.random() - 0.5) * 0.03 * s.depth,
        depth: s.depth,
        size: s.size,
        spin: (Math.random() - 0.5) * 0.0004,
        angle: 0,
      }));
    };

    const resize = () => {
      const dpr = lowPower ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = lowPower
        ? Math.max(50, Math.min(90, Math.round((width * height) / 9000)))
        : Math.max(90, Math.min(260, Math.round((width * height) / 6000)));
      while (stars.length < target) {
        // More far stars than near ones, like a real sky.
        const layer = Math.random();
        const depth = layer < 0.55 ? 0.15 + Math.random() * 0.15 : layer < 0.88 ? 0.4 + Math.random() * 0.2 : 0.8 + Math.random() * 0.2;
        stars.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.12 * depth,
          vy: (Math.random() - 0.5) * 0.12 * depth,
          r: 0.35 + depth * (1.1 + Math.random() * 1.1),
          depth,
          phase: Math.random() * Math.PI * 2,
          speed: 0.6 + Math.random() * 1.8,
          tint: Math.random(),
        });
      }
      stars = stars.slice(0, target);
      makePlanets();
      if (reducedMotion) draw(0);
    };

    const wrap = (value: number, max: number, margin: number) => (value < -margin ? max + margin : value > max + margin ? -margin : value);

    const draw = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      const palette = light ? LIGHT : DARK;
      const t = time / 1000;

      // Planets behind the stars.
      for (const planet of planets) {
        const px = planet.x + parallax.x * planet.depth * 40;
        const py = planet.y + parallax.y * planet.depth * 40 - scrollShift * planet.depth * 0.25;
        const s = planet.sprite.width;
        ctx.save();
        ctx.globalAlpha = light ? 0.55 : 0.9;
        ctx.translate(px, wrap(py, height, s));
        ctx.rotate(planet.angle);
        ctx.drawImage(planet.sprite, -s / 2, -s / 2);
        ctx.restore();
      }

      const positions: { x: number; y: number; star: Star }[] = [];
      for (const star of stars) {
        const x = wrap(star.x + parallax.x * star.depth * 30, width, 10);
        const y = wrap(star.y + parallax.y * star.depth * 30 - scrollShift * star.depth * 0.35, height, 10);
        const twinkle = 0.55 + 0.45 * Math.sin(t * star.speed + star.phase);
        const alpha = (light ? 0.35 : 0.45) + star.depth * (light ? 0.35 : 0.5) * twinkle;
        const color = palette.stars[star.tint < 0.55 ? 0 : star.tint < 0.78 ? 1 : star.tint < 0.93 ? 2 : 3];
        ctx.fillStyle = `rgba(${color}, ${Math.min(1, alpha)})`;
        ctx.beginPath();
        ctx.arc(x, y, star.r * (0.85 + 0.15 * twinkle), 0, Math.PI * 2);
        ctx.fill();
        // Near bright stars get a small cross sparkle.
        if (star.depth > 0.85 && star.r > 1.6 && !lowPower) {
          ctx.strokeStyle = `rgba(${color}, ${0.35 * twinkle})`;
          ctx.lineWidth = 0.6;
          const len = star.r * 3.2 * twinkle;
          ctx.beginPath();
          ctx.moveTo(x - len, y);
          ctx.lineTo(x + len, y);
          ctx.moveTo(x, y - len);
          ctx.lineTo(x, y + len);
          ctx.stroke();
        }
        if (star.depth > 0.35) positions.push({ x, y, star });
      }

      // Faint constellations between close mid/near stars, and toward the pointer.
      for (let i = 0; i < positions.length; i++) {
        const a = positions[i];
        for (let j = i + 1; j < positions.length; j++) {
          const b = positions[j];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist < LINK_DISTANCE) {
            ctx.strokeStyle = `rgba(${palette.link}, ${(light ? 0.12 : 0.16) * (1 - dist / LINK_DISTANCE)})`;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        if (pointer.active) {
          const dist = Math.hypot(a.x - pointer.x, a.y - pointer.y);
          if (dist < POINTER_DISTANCE) {
            ctx.strokeStyle = `rgba(${palette.pointer}, ${(light ? 0.3 : 0.4) * (1 - dist / POINTER_DISTANCE)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(pointer.x, pointer.y);
            ctx.stroke();
          }
        }
      }

      // Shooting stars.
      for (const m of meteors) {
        const tail = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 14, m.y - m.vy * 14);
        tail.addColorStop(0, `rgba(${palette.stars[0]}, ${0.9 * m.life})`);
        tail.addColorStop(1, `rgba(${palette.stars[1]}, 0)`);
        ctx.strokeStyle = tail;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(m.x - m.vx * 14, m.y - m.vy * 14);
        ctx.stroke();
      }
    };

    const step = (time = 0) => {
      frame = requestAnimationFrame(step);
      if (frameGap && time - lastFrame < frameGap) return;
      lastFrame = time;
      // Theme switch in progress: hold still so the reveal animation gets the whole frame budget.
      if (document.documentElement.classList.contains("theme-switching")) return;

      parallax.x += (parallax.tx - parallax.x) * 0.05;
      parallax.y += (parallax.ty - parallax.y) * 0.05;
      scrollShift *= 0.94;

      for (const star of stars) {
        // Near stars lean gently toward the pointer.
        if (pointer.active && star.depth > 0.5) {
          const dx = pointer.x - star.x;
          const dy = pointer.y - star.y;
          const dist = Math.hypot(dx, dy);
          if (dist < POINTER_DISTANCE && dist > 30) {
            star.vx += (dx / dist) * 0.004 * star.depth;
            star.vy += (dy / dist) * 0.004 * star.depth;
          }
        }
        star.vx *= 0.995;
        star.vy *= 0.995;
        if (Math.hypot(star.vx, star.vy) < 0.02 * star.depth) {
          star.vx += (Math.random() - 0.5) * 0.02 * star.depth;
          star.vy += (Math.random() - 0.5) * 0.02 * star.depth;
        }
        star.x = wrap(star.x + star.vx, width, 10);
        star.y = wrap(star.y + star.vy, height, 10);
      }
      for (const planet of planets) {
        planet.x = wrap(planet.x + planet.vx, width, planet.sprite.width);
        planet.y = wrap(planet.y + planet.vy, height, planet.sprite.width);
        planet.angle += planet.spin;
      }
      if (!lowPower && meteors.length < 1 && Math.random() < 0.0025) {
        const fromLeft = Math.random() < 0.5;
        meteors.push({
          x: fromLeft ? Math.random() * width * 0.5 : width * (0.5 + Math.random() * 0.5),
          y: Math.random() * height * 0.4,
          vx: (fromLeft ? 1 : -1) * (7 + Math.random() * 5),
          vy: 3 + Math.random() * 3,
          life: 1,
        });
      }
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i];
        m.x += m.vx;
        m.y += m.vy;
        m.life -= 0.02;
        if (m.life <= 0 || m.y > height + 40) meteors.splice(i, 1);
      }
      draw(time);
    };

    const onPointer = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
      parallax.tx = (e.clientX / Math.max(1, width) - 0.5) * 2;
      parallax.ty = (e.clientY / Math.max(1, height) - 0.5) * 2;
    };
    const onLeave = () => {
      pointer.active = false;
      parallax.tx = 0;
      parallax.ty = 0;
    };
    let lastScroll = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      scrollShift = Math.max(-60, Math.min(60, scrollShift + (y - lastScroll) * 0.6));
      lastScroll = y;
    };
    const onVisibility = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden && !reducedMotion) frame = requestAnimationFrame(step);
    };
    const themeObserver = new MutationObserver(() => {
      const next = document.documentElement.dataset.theme === "light";
      if (next === light) return;
      light = next;
      makePlanets();
      if (reducedMotion) draw(0);
    });

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerdown", onPointer, { passive: true });
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
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("touchend", onLeave);
      window.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      themeObserver.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="net-bg" aria-hidden="true" />;
}
