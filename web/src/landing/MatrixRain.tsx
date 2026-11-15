import { useEffect, useRef } from "react";

/**
 * "Digital rain" behind the hero, in Acolyte's lime: columns of figures falling, each led by a bright head
 * and fading behind. Data-flavoured glyphs (digits, R, %, +, -). Cheap: about 24 frames a second, paused
 * when the hero is off screen or the tab is hidden, a single still frame for people who prefer reduced motion.
 */
const GLYPHS = "0123456789010101R%+-.<>=$";
const BG = "12, 12, 14";            // the page's ink (#0c0c0e), used for the fading trail
const HEAD = "#ecff9e", BODY = "#c8f135", DIM = "#5d7a0a";

export default function MatrixRain() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = 0, h = 0, size = 16, cols: { y: number; speed: number; dim: boolean }[] = [];
    let raf = 0, last = 0, visible = true;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      size = w < 700 ? 13 : 16;
      const n = Math.ceil(w / size);
      cols = Array.from({ length: n }, () => ({ y: Math.random() * -h / size, speed: 0.35 + Math.random() * 0.75, dim: Math.random() < 0.45 }));
      ctx.fillStyle = `rgb(${BG})`; ctx.fillRect(0, 0, w, h);
    };
    const glyph = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];
    const draw = () => {
      ctx.fillStyle = `rgba(${BG}, 0.12)`;   // fade the previous frame: this makes the trails
      ctx.fillRect(0, 0, w, h);
      ctx.font = `600 ${size}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.textAlign = "center";
      cols.forEach((c, i) => {
        const x = i * size + size / 2, y = c.y * size;
        if (y > 0) {
          ctx.fillStyle = c.dim ? DIM : BODY;           // the char just behind the head settles to the trail colour
          ctx.fillText(glyph(), x, y - size);
          ctx.fillStyle = c.dim ? BODY : HEAD;           // the leading glyph is brightest
          ctx.fillText(glyph(), x, y);
        }
        c.y += c.speed;
        if (y > h + size * 4 && Math.random() > 0.975) { c.y = Math.random() * -12; c.speed = 0.35 + Math.random() * 0.75; c.dim = Math.random() < 0.45; }
      });
    };
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden || t - last < 42) return;   // ~24 fps
      last = t;
      draw();
    };

    resize();
    if (reduce) {
      for (let i = 0; i < 120; i++) draw();   // one settled still frame
    } else {
      raf = requestAnimationFrame(loop);
    }
    const ro = new ResizeObserver(() => { resize(); if (reduce) for (let i = 0; i < 120; i++) draw(); });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(canvas);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, []);
  return <canvas ref={ref} className="matrix-rain" aria-hidden="true" />;
}
