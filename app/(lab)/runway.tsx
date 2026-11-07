'use client';

// Six looks on a turning 3D ring. Bodies are positioned by writing styles directly each frame (no re-render).
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { LOOKS, feeOf } from '@/lib/catalogue';
import l from './landing.module.css';
import w from './wire.module.css';

const n = LOOKS.length;
const N = n * Math.ceil(8 / n);
const step = (2 * Math.PI) / N;
const K = 95;
const C = 2 * Math.sqrt(K);
const AUTOPLAY = 5000;
const FS = 1.08;
const ENTRANCE = -1.15;

const mod = (a: number, m: number) => ((a % m) + m) % m;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Drag = { id: number; x0: number; t0: number; samples: { x: number; t: number }[]; moved: boolean };

export function Runway() {
  const [index, setIndex] = useState(0);
  const [playWanted, setPlayWanted] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [rearm, setRearm] = useState(0);
  const playing = playWanted && !reduced;

  const stageRef = useRef<HTMLDivElement>(null);
  const bodies = useRef<(HTMLDivElement | null)[]>([]);
  const size = useRef({ W: 0, H: 0 });
  const cur = useRef(ENTRANCE);
  const vel = useRef(0);
  const target = useRef(0);
  const indexRef = useRef(0);
  const reducedRef = useRef(false);
  const loopRef = useRef(0);
  const last = useRef<number | null>(null);
  const drag = useRef<Drag | null>(null);

  const render = useCallback(() => {
    const { W, H } = size.current;
    if (!W || !H) return;
    const mobile = W < 520;
    const cx = 0.5 * W;
    const R = (mobile ? 0.72 : 0.62) * W;
    const P = (mobile ? 1.9 : 1.65) * W;
    const floor = H - 8;
    const horizon = 0.36 * H;
    bodies.current.forEach((el, a) => {
      if (!el) return;
      let phi = mod((a - cur.current) * step + Math.PI, 2 * Math.PI) - Math.PI;
      if (phi === -Math.PI) phi = Math.PI; // wrap into (−π, π]
      const z = R * (1 - Math.cos(phi));
      const persp = P / (P + z);
      const sl = Math.abs(phi) / step;
      const scale = persp * (1 + (FS - 1) * clamp(1 - sl, 0, 1));
      const x = cx + R * Math.sin(phi) * persp;
      const feet = horizon + (floor - horizon) * persp;
      const blur = sl <= 1 ? 1.8 * sl : Math.min(1.8 + (sl - 1) * 2, 6.5);
      const opacity = clamp((Math.cos(phi) + 0.55) / 0.3, 0, 1);
      const s = el.style;
      s.transform = `translate3d(${x}px, ${-(H - feet)}px, 0) translateX(-50%) scale(${scale})`;
      s.opacity = opacity.toFixed(3);
      s.zIndex = String(Math.round(scale * 1000));
      s.filter = blur > 0.05 ? `blur(${blur}px)` : '';
      s.visibility = opacity < 0.01 ? 'hidden' : '';
    });
  }, []);

  // Critically damped spring, 3 sub-steps a frame; stops itself once settled.
  const kick = useCallback(() => {
    if (reducedRef.current) {
      cur.current = target.current;
      vel.current = 0;
      render();
      return;
    }
    if (loopRef.current) return;
    last.current = null;
    const frame = (t: number) => {
      const dt = last.current == null ? 1 / 60 : Math.min(0.034, (t - last.current) / 1000);
      last.current = t;
      const h = dt / 3;
      for (let i = 0; i < 3; i++) {
        const acc = -K * (cur.current - target.current) - C * vel.current;
        vel.current += acc * h;
        cur.current += vel.current * h;
      }
      if (Math.abs(cur.current - target.current) <= 0.0005 && Math.abs(vel.current) <= 0.0005) {
        cur.current = target.current;
        vel.current = 0;
        loopRef.current = 0;
      } else {
        loopRef.current = requestAnimationFrame(frame);
      }
      render();
    };
    loopRef.current = requestAnimationFrame(frame);
  }, [render]);

  const moveTo = useCallback(
    (T: number) => {
      target.current = T;
      indexRef.current = mod(Math.round(T), n);
      setIndex(indexRef.current);
      kick();
    },
    [kick],
  );
  const next = useCallback(() => moveTo(Math.round(target.current) + 1), [moveTo]);
  const prev = useCallback(() => moveTo(Math.round(target.current) - 1), [moveTo]);
  const go = (i: number) => {
    let d = mod(i - indexRef.current, n);
    if (d > n / 2) d -= n;
    moveTo(Math.round(target.current) + d);
  };

  // Reduced motion, size and the entrance walk.
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      reducedRef.current = mq.matches;
      setReduced(mq.matches);
    };
    apply();
    mq.addEventListener('change', apply);
    if (mq.matches) cur.current = 0;

    const stage = stageRef.current!;
    const ro = new ResizeObserver(() => {
      const r = stage.getBoundingClientRect();
      size.current = { W: r.width, H: r.height };
      render();
    });
    ro.observe(stage);
    kick();
    return () => {
      mq.removeEventListener('change', apply);
      ro.disconnect();
      cancelAnimationFrame(loopRef.current);
      loopRef.current = 0;
    };
  }, [kick, render]);

  // Autoplay: one timeout per index change; a hidden tab or a drag re-arms instead of advancing.
  useEffect(() => {
    if (!playing) return;
    const id = setTimeout(() => {
      if (document.visibilityState === 'visible' && !drag.current) next();
      else setRearm((r) => r + 1);
    }, AUTOPLAY);
    return () => clearTimeout(id);
  }, [index, playing, rearm, next]);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.dataset.active = '';
    vel.current = 0;
    drag.current = { id: e.pointerId, x0: e.clientX, t0: cur.current, samples: [{ x: e.clientX, t: e.timeStamp }], moved: false };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x0;
    const unit = Math.max(120, 0.3 * size.current.W);
    cur.current = target.current = d.t0 - dx / unit;
    if (Math.abs(dx) > 8) d.moved = true;
    d.samples.push({ x: e.clientX, t: e.timeStamp });
    if (d.samples.length > 6) d.samples.shift();
    render();
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    delete e.currentTarget.dataset.active;
    const unit = Math.max(120, 0.3 * size.current.W);
    const a = d.samples[0];
    const b = d.samples[d.samples.length - 1];
    const vx = b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0;
    const start = Math.round(d.t0);
    let i = Math.round(cur.current - (vx * 160) / unit);
    if (i === start && Math.abs(vx) > 0.3) i += vx < 0 ? 1 : -1;
    moveTo(clamp(i, start - 2, start + 2));
    if (d.moved) setPlayWanted(false);
  };

  const look = LOOKS[index];
  const total = feeOf(look);

  return (
    <>
      <div
        ref={stageRef}
        className={l.runway}
        role="region"
        aria-roledescription="carousel"
        aria-label="Hire looks. Use the arrow keys or drag to turn."
        tabIndex={0}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            next();
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            prev();
          }
        }}
      >
        {Array.from({ length: N }, (_, a) => (
          <div key={a} ref={(el) => void (bodies.current[a] = el)} className={l.body} aria-hidden="true">
            <span className={l.floorShadow} />
            <Image
              src={`/looks/${LOOKS[a % n].img}.webp`}
              alt=""
              fill
              sizes="(max-width: 900px) 40vw, 18vw"
              loading="eager" // bodies 6–11 reuse the same six URLs, and body 11 is beside the front at load
              draggable={false}
            />
          </div>
        ))}
        <p className={w.srOnly} aria-live="polite">
          Look {index + 1} of {n}: {look.occasion}, {look.name}
        </p>
      </div>

      <aside className={l.heroCard} aria-labelledby="look-title">
        <p className={l.lookKicker}>{look.occasion}</p>
        <h2 id="look-title" className={l.edit}>
          {look.name}
        </h2>
        <ul className={l.editList}>
          {look.pieces.map(([piece, price]) => (
            <li key={piece}>
              <span>{piece}</span>
              <span className={w.num}>£{price}</span>
            </li>
          ))}
        </ul>
        <p className={l.lookTotal}>
          The whole look, for the weekend <strong className={w.num}>£{total}</strong>
        </p>
        <Link href={`/look?l=${look.slug}`} className={w.block}>
          Hire this look
        </Link>
        <div className={l.controls}>
          <button
            type="button"
            className={l.icon}
            aria-label="Previous look"
            onClick={() => {
              setPlayWanted(false);
              prev();
            }}
          >
            <svg width="26" height="14" viewBox="0 0 26 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M25 7H1M7 1L1 7l6 6" />
            </svg>
          </button>
          <div className={l.rwTicks}>
            {LOOKS.map((lk, i) => (
              <button
                key={lk.slug}
                type="button"
                className={l.rwTick}
                aria-current={i === index}
                aria-label={`${lk.occasion}: ${lk.name}`}
                onClick={() => {
                  setPlayWanted(false);
                  go(i);
                }}
              >
                <span className={`${l.rwTickBar} ${i === index ? (playing ? l.rwTickRun : l.rwTickOn) : ''}`} />
              </button>
            ))}
          </div>
          <button
            type="button"
            className={l.icon}
            aria-pressed={playing}
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={() => setPlayWanted(!playWanted)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d={playing ? 'M6.5 4.5h3.5v15H6.5zM14 4.5h3.5v15H14z' : 'M7 4.5v15l12.5-7.5z'} />
            </svg>
          </button>
          <button
            type="button"
            className={l.icon}
            aria-label="Next look"
            onClick={() => {
              setPlayWanted(false);
              next();
            }}
          >
            <svg width="26" height="14" viewBox="0 0 26 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M1 7h24M19 1l6 6-6 6" />
            </svg>
          </button>
        </div>
      </aside>
    </>
  );
}
