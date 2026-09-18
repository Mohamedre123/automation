import { useEffect, useRef } from "react";

/* Site-wide animated space backdrop: twinkling stars on three depth layers that keep drifting
   across the sky (near ones faster), slowly wandering planets, faint constellation lines, a
   shooting star every few seconds, and a touch/mouse glow that gently parts the stars (a tap
   sends a ripple). Motion is time-based so phones at 30fps move exactly like desktops. */

interface Star {
  x: number;
  y: number;
  /** Own cruising velocity (px/s); pushes from the pointer decay back to it. */
  bx: number;
  by: number;
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
  /** Position as a fraction of the screen, so resizes never make planets jump. */
  fx: number;
  fy: number;
  vx: number;
  vy: number;
  depth: number;
  spin: number;
  angle: number;
  bob: number;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  duration: number;
}

interface Ripple {
  x: number;
  y: number;
  age: number;
}

const LINK_DISTANCE = 120;
const POINTER_DISTANCE = 170;
/** Whole sky drifts slowly (px/s at full depth). */
const SKY_DRIFT = { x: -9, y: 4 };

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

const PLANET_SPECS: { size: number; colors: [string, string, string]; ring: boolean; x: number; y: number; depth: number; desktopOnly?: boolean }[] = [
  // Big ringed amber giant, far right.
  { size: 0.075, colors: ["#fde68a", "#f59e0b", "#7c2d12"], ring: true, x: 0.84, y: 0.22, depth: 0.35 },
  // Small rose planet, low left.
  { size: 0.032, colors: ["#fecdd3", "#f43f5e", "#4c0519"], ring: false, x: 0.12, y: 0.72, depth: 0.6 },
  // Distant pale moon.
  { size: 0.018, colors: ["#fff7ed", "#fdba74", "#7c2d12"], ring: false, x: 0.38, y: 0.12, depth: 0.2 },
  { size: 0.045, colors: ["#fed7aa", "#ea580c", "#431407"], ring: false, x: 0.62, y: 0.86, depth: 0.5, desktopOnly: true },
];

const rand = (min: number, max: number) => min + Math.random() * (max - min);

export function NetworkBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const touch = window.matchMedia("(pointer: coarse)").matches;
    const lowPower = touch || window.innerWidth < 768 || (navigator.hardwareConcurrency ?? 8) <= 4;
    const frameGap = lowPower ? 1000 / 32 : 0;
    /** strength fades in/out so a lifted finger doesn't make the effect vanish abruptly. */
    const pointer = { x: -9999, y: -9999, active: false, strength: 0 };
    const parallax = { x: 0, y: 0, tx: 0, ty: 0 };
    let stars: Star[] = [];
    let planets: Planet[] = [];
    const meteors: Meteor[] = [];
    const ripples: Ripple[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let lastFrame = 0;
    let lastStep = 0;
    let nextMeteor = 0;
    let scrollShift = 0;
    let light = document.documentElement.dataset.theme === "light";

    const makePlanets = () => {
      const unit = Math.min(width, height);
      const previous = planets;
      planets = PLANET_SPECS.filter((s) => !(lowPower && s.desktopOnly)).map((s, i) => {
        const old = previous[i];
        return {
          sprite: planetSprite(Math.max(8, s.size * unit), s.colors, s.ring, light),
          fx: old?.fx ?? s.x,
          fy: old?.fy ?? s.y,
          // Slow but visible wander: a few px per second.
          vx: old?.vx ?? rand(3, 7) * (Math.random() < 0.5 ? -1 : 1) * (0.5 + s.depth),
          vy: old?.vy ?? rand(1.5, 4) * (Math.random() < 0.5 ? -1 : 1) * (0.5 + s.depth),
          depth: s.depth,
          spin: old?.spin ?? rand(-0.03, 0.03),
          angle: old?.angle ?? 0,
          bob: old?.bob ?? Math.random() * Math.PI * 2,
        };
      });
    };

    const addStar = () => {
      // More far stars than near ones, like a real sky.
      const layer = Math.random();
      const depth = layer < 0.55 ? rand(0.15, 0.3) : layer < 0.88 ? rand(0.4, 0.6) : rand(0.8, 1);
      const angle = Math.random() * Math.PI * 2;
      const cruise = rand(3, 9) * depth;
      const bx = SKY_DRIFT.x * depth + Math.cos(angle) * cruise;
      const by = SKY_DRIFT.y * depth + Math.sin(angle) * cruise;
      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        bx,
        by,
        vx: bx,
        vy: by,
        r: 0.35 + depth * rand(1.1, 2.2),
        depth,
        phase: Math.random() * Math.PI * 2,
        speed: rand(0.6, 2.4),
        tint: Math.random(),
      });
    };

    const resize = () => {
      const nextWidth = window.innerWidth;
      // Phones: the address bar showing/hiding while scrolling only changes the height. The canvas is
      // sized to the tallest viewport (CSS 100lvh), so ignore those instead of redrawing mid-scroll.
      const nextHeight = touch && nextWidth === width ? Math.max(height, window.innerHeight) : window.innerHeight;
      if (nextWidth === width && nextHeight === height) return;
      const sx = width ? nextWidth / width : 1;
      const sy = height ? nextHeight / height : 1;
      width = nextWidth;
      height = nextHeight;
      const dpr = lowPower ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const star of stars) {
        star.x *= sx;
        star.y *= sy;
      }
      const target = lowPower
        ? Math.max(55, Math.min(100, Math.round((width * height) / 8000)))
        : Math.max(90, Math.min(260, Math.round((width * height) / 6000)));
      while (stars.length < target) addStar();
      stars = stars.slice(0, target);
      makePlanets();
      if (reducedMotion) draw(0);
    };

    const wrap = (value: number, max: number, margin: number) =>
      value < -margin ? value + max + margin * 2 : value > max + margin ? value - max - margin * 2 : value;

    const draw = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      const palette = light ? LIGHT : DARK;
      const t = time / 1000;

      // Planets behind the stars.
      for (const planet of planets) {
        const s = planet.sprite.width;
        const px = planet.fx * width + parallax.x * planet.depth * 40;
        const py = planet.fy * height + parallax.y * planet.depth * 40 - scrollShift * planet.depth * 0.25 + Math.sin(t * 0.4 + planet.bob) * 6;
        ctx.save();
        ctx.globalAlpha = light ? 0.55 : 0.9;
        ctx.translate(px, py);
        ctx.rotate(planet.angle);
        ctx.drawImage(planet.sprite, -s / 2, -s / 2);
        ctx.restore();
      }

      // Soft glow where the finger / mouse is.
      if (pointer.strength > 0.01) {
        const glow = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, POINTER_DISTANCE * 0.9);
        glow.addColorStop(0, `rgba(${palette.pointer}, ${(light ? 0.1 : 0.14) * pointer.strength})`);
        glow.addColorStop(1, `rgba(${palette.pointer}, 0)`);
        ctx.fillStyle = glow;
        ctx.fillRect(pointer.x - POINTER_DISTANCE, pointer.y - POINTER_DISTANCE, POINTER_DISTANCE * 2, POINTER_DISTANCE * 2);
      }

      const positions: { x: number; y: number }[] = [];
      for (const star of stars) {
        const x = star.x + parallax.x * star.depth * 30;
        const y = star.y + parallax.y * star.depth * 30 - scrollShift * star.depth * 0.35;
        const twinkle = 0.55 + 0.45 * Math.sin(t * star.speed + star.phase);
        const alpha = (light ? 0.35 : 0.45) + star.depth * (light ? 0.35 : 0.5) * twinkle;
        const color = palette.stars[star.tint < 0.55 ? 0 : star.tint < 0.78 ? 1 : star.tint < 0.93 ? 2 : 3];
        ctx.fillStyle = `rgba(${color}, ${Math.min(1, alpha)})`;
        ctx.beginPath();
        ctx.arc(x, y, star.r * (0.85 + 0.15 * twinkle), 0, Math.PI * 2);
        ctx.fill();
        // Near bright stars get a small cross sparkle.
        if (star.depth > 0.85 && star.r > 1.6) {
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
        if (star.depth > 0.35) positions.push({ x, y });
      }

      // Faint constellations between close mid/near stars, and toward the pointer.
      ctx.lineWidth = 0.8;
      for (let i = 0; i < positions.length; i++) {
        const a = positions[i];
        for (let j = i + 1; j < positions.length; j++) {
          const b = positions[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          if (Math.abs(dx) > LINK_DISTANCE || Math.abs(dy) > LINK_DISTANCE) continue;
          const dist = Math.hypot(dx, dy);
          if (dist < LINK_DISTANCE) {
            ctx.strokeStyle = `rgba(${palette.link}, ${(light ? 0.12 : 0.16) * (1 - dist / LINK_DISTANCE)})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        if (pointer.strength > 0.01) {
          const dist = Math.hypot(a.x - pointer.x, a.y - pointer.y);
          if (dist < POINTER_DISTANCE) {
            ctx.strokeStyle = `rgba(${palette.pointer}, ${(light ? 0.3 : 0.4) * (1 - dist / POINTER_DISTANCE) * pointer.strength})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(pointer.x, pointer.y);
            ctx.stroke();
          }
        }
      }

      // Tap ripples.
      for (const ripple of ripples) {
        const progress = ripple.age / 0.9;
        ctx.strokeStyle = `rgba(${palette.pointer}, ${(light ? 0.35 : 0.45) * (1 - progress)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, 12 + progress * 150, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Shooting stars: a bright head with a fading tail.
      for (const m of meteors) {
        const fade = Math.sin(Math.PI * Math.min(1, m.age / m.duration));
        const tailX = m.x - m.vx * 0.22;
        const tailY = m.y - m.vy * 0.22;
        const tail = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
        tail.addColorStop(0, `rgba(${palette.stars[0]}, ${0.95 * fade})`);
        tail.addColorStop(0.3, `rgba(${palette.stars[1]}, ${0.5 * fade})`);
        tail.addColorStop(1, `rgba(${palette.stars[1]}, 0)`);
        ctx.strokeStyle = tail;
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
        ctx.fillStyle = `rgba(${palette.stars[0]}, ${fade})`;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const launchMeteor = () => {
      const fromLeft = Math.random() < 0.5;
      // Unhurried: crosses a good part of the screen in about 1.2-1.8s.
      const speed = rand(380, 560) * (width < 700 ? 0.75 : 1);
      const angle = rand(0.35, 0.65);
      meteors.push({
        x: fromLeft ? rand(-0.05, 0.45) * width : rand(0.55, 1.05) * width,
        y: rand(-0.05, 0.35) * height,
        vx: (fromLeft ? 1 : -1) * Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        duration: rand(1.2, 1.8),
      });
    };

    const step = (time = 0) => {
      frame = requestAnimationFrame(step);
      if (frameGap && time - lastFrame < frameGap) return;
      lastFrame = time;
      // Seconds since last update, capped so a stalled tab doesn't teleport everything.
      const dt = Math.min(0.1, lastStep ? (time - lastStep) / 1000 : 0);
      lastStep = time;
      // Theme switch in progress: hold still so the reveal animation gets the whole frame budget.
      if (document.documentElement.classList.contains("theme-switching")) return;

      const ease = 1 - Math.pow(0.05, dt);
      parallax.x += (parallax.tx - parallax.x) * ease;
      parallax.y += (parallax.ty - parallax.y) * ease;
      scrollShift *= Math.pow(0.03, dt);
      pointer.strength += ((pointer.active ? 1 : 0) - pointer.strength) * (1 - Math.pow(0.02, dt));

      const relax = 1 - Math.pow(0.3, dt);
      for (const star of stars) {
        // Near stars part gently around the pointer, then drift back to their course.
        if (pointer.strength > 0.05 && star.depth > 0.35) {
          const dx = star.x - pointer.x;
          const dy = star.y - pointer.y;
          const dist = Math.hypot(dx, dy);
          if (dist < POINTER_DISTANCE && dist > 1) {
            const push = (1 - dist / POINTER_DISTANCE) * 90 * star.depth * pointer.strength * dt;
            star.vx += (dx / dist) * push;
            star.vy += (dy / dist) * push;
          }
        }
        for (const ripple of ripples) {
          const dx = star.x - ripple.x;
          const dy = star.y - ripple.y;
          const dist = Math.hypot(dx, dy);
          const front = 12 + (ripple.age / 0.9) * 150;
          if (dist > 1 && Math.abs(dist - front) < 26) {
            const kick = 260 * star.depth * dt * (1 - ripple.age / 0.9);
            star.vx += (dx / dist) * kick;
            star.vy += (dy / dist) * kick;
          }
        }
        star.vx += (star.bx - star.vx) * relax;
        star.vy += (star.by - star.vy) * relax;
        star.x = wrap(star.x + star.vx * dt, width, 12);
        star.y = wrap(star.y + star.vy * dt, height, 12);
      }
      for (const planet of planets) {
        const margin = planet.sprite.width / 2 / Math.max(1, width);
        planet.fx = wrap(planet.fx + (planet.vx * dt) / Math.max(1, width), 1, margin);
        planet.fy = wrap(planet.fy + (planet.vy * dt) / Math.max(1, height), 1, planet.sprite.width / 2 / Math.max(1, height));
        planet.angle += planet.spin * dt;
      }
      for (let i = ripples.length - 1; i >= 0; i--) {
        ripples[i].age += dt;
        if (ripples[i].age >= 0.9) ripples.splice(i, 1);
      }

      if (!nextMeteor) nextMeteor = time + rand(1500, 4000);
      if (time >= nextMeteor) {
        launchMeteor();
        nextMeteor = time + rand(4500, 10000);
      }
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i];
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        m.age += dt;
        if (m.age >= m.duration) meteors.splice(i, 1);
      }
      draw(time);
    };

    const aim = (x: number, y: number) => {
      pointer.x = x;
      pointer.y = y;
      pointer.active = true;
      parallax.tx = (x / Math.max(1, width) - 0.5) * 2;
      parallax.ty = (y / Math.max(1, height) - 0.5) * 2;
    };
    const release = () => {
      pointer.active = false;
      parallax.tx = 0;
      parallax.ty = 0;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch") aim(e.clientX, e.clientY);
    };
    const onPointerDown = (e: PointerEvent) => {
      aim(e.clientX, e.clientY);
      if (ripples.length < 4) ripples.push({ x: e.clientX, y: e.clientY, age: 0 });
    };
    // Touch events keep firing while the page scrolls (pointer events get cancelled), so the
    // glow follows the finger the whole time.
    const onTouch = (e: TouchEvent) => {
      const point = e.touches[0];
      if (point) aim(point.clientX, point.clientY);
    };
    let lastScroll = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      scrollShift = Math.max(-60, Math.min(60, scrollShift + (y - lastScroll) * 0.6));
      lastScroll = y;
    };
    const onVisibility = () => {
      cancelAnimationFrame(frame);
      lastStep = 0;
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
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.documentElement.addEventListener("pointerleave", release);
    window.addEventListener("touchstart", onTouch, { passive: true });
    window.addEventListener("touchmove", onTouch, { passive: true });
    window.addEventListener("touchend", release, { passive: true });
    window.addEventListener("touchcancel", release, { passive: true });
    window.addEventListener("blur", release);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisibility);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    if (!reducedMotion) frame = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      document.documentElement.removeEventListener("pointerleave", release);
      window.removeEventListener("touchstart", onTouch);
      window.removeEventListener("touchmove", onTouch);
      window.removeEventListener("touchend", release);
      window.removeEventListener("touchcancel", release);
      window.removeEventListener("blur", release);
      window.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      themeObserver.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="net-bg" aria-hidden="true" />;
}
