"use client";

import createGlobe, { type Arc, type Globe as CobeGlobe } from "cobe";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cx } from "./ui";

export interface GlobeSite {
  osmId: string;
  name: string;
  accountSlug: string;
  accountName: string;
  countryName: string;
  lat: number;
  lon: number;
  areaKm2: number;
  perimeterKm: number;
  assetClass: string;
  attributionMethod: string;
  tier: string;
  /** 0..1 — drives dot size and pulse rate. */
  weight: number;
  /** Highest-urgency signal on the owning account, when there is one. */
  signalHeadline?: string;
  signalUrgency?: number;
}

/** FlytBase's engineering base. Arcs originate here, which is literally true. */
const HQ = { lat: 18.5204, lon: 73.8567, label: "FlytBase · Pune" };

const DEG = Math.PI / 180;

/**
 * Live globe.
 *
 * Markers are DOM elements positioned from the same rotation the canvas is
 * rendering, rather than drawn into the canvas. That is a deliberate trade:
 * hit-testing, hover, focus and the pulse animation all become native browser
 * behaviour, so a site is genuinely clickable and keyboard-reachable instead of
 * being a coloured pixel that needs raycasting to identify.
 *
 * Rotation pauses whenever the pointer is over the globe, because asking someone
 * to click a moving 6-pixel target is hostile.
 */
export default function LiveGlobe({
  sites,
  onSelect,
  size = 560,
}: {
  sites: GlobeSite[];
  onSelect?: (site: GlobeSite) => void;
  size?: number;
}) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Rotation state lives in refs so the render loop never triggers React work.
  const phi = useRef(4.3);
  const theta = useRef(0.28);
  const paused = useRef(false);
  const drag = useRef<{ x: number; y: number; phi: number; theta: number } | null>(null);
  const velocity = useRef(0);
  const projected = useRef<Map<string, { x: number; y: number; z: number }>>(new Map());

  const arcs: Arc[] = useMemo(() => {
    // One arc per account, to its largest site, so the sky is legible.
    const byAccount = new Map<string, GlobeSite>();
    for (const s of sites) {
      const cur = byAccount.get(s.accountSlug);
      if (!cur || s.areaKm2 > cur.areaKm2) byAccount.set(s.accountSlug, s);
    }
    return [...byAccount.values()].slice(0, 14).map((s) => ({
      from: [HQ.lat, HQ.lon] as [number, number],
      to: [s.lat, s.lon] as [number, number],
      color: [0.106, 0.31, 0.847] as [number, number, number],
    }));
  }, [sites]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;

    let width = el.offsetWidth || size;
    let frame = 0;
    let globe: CobeGlobe | null = null;

    const onResize = () => {
      width = el.offsetWidth || size;
      globe?.update({ width: width * 2, height: width * 2 });
    };

    globe = createGlobe(el, {
      devicePixelRatio: Math.min(2, window.devicePixelRatio || 1),
      width: width * 2,
      height: width * 2,
      phi: phi.current,
      theta: theta.current,
      dark: 0,
      diffuse: 0.4,
      mapSamples: 24_000,
      mapBrightness: 6.4,
      mapBaseBrightness: 0.05,
      baseColor: [1, 1, 1],
      markerColor: [0.106, 0.31, 0.847],
      glowColor: [0.965, 0.968, 0.976],
      opacity: 0.97,
      arcs,
      arcColor: [0.106, 0.31, 0.847],
      arcWidth: 0.3,
      arcHeight: 0.36,
      // Markers are rendered as DOM overlays, so the canvas draws none.
      markers: [],
    });

    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;

      if (!paused.current && !drag.current) {
        velocity.current *= 0.94;
        phi.current += 0.00022 * dt + velocity.current;
      }
      globe?.update({ phi: phi.current, theta: theta.current, width: width * 2, height: width * 2 });

      // Recompute overlay positions from the same rotation.
      const r = width / 2;
      const next = new Map<string, { x: number; y: number; z: number }>();
      for (const s of sites) {
        next.set(s.osmId, project(s.lat, s.lon, phi.current, theta.current, r));
      }
      projected.current = next;
      // One state bump per frame drives the overlay transform.
      setTick((t) => (t + 1) % 1_000_000);

      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    window.addEventListener("resize", onResize);
    const reveal = setTimeout(() => setReady(true), 80);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(reveal);
      window.removeEventListener("resize", onResize);
      globe?.destroy();
    };
  }, [sites, arcs, size, fullscreen]);

  // Escape leaves fullscreen, which is the behaviour people expect.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [fullscreen]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, phi: phi.current, theta: theta.current };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    const nextPhi = drag.current.phi + dx / 220;
    velocity.current = (nextPhi - phi.current) * 0.2;
    phi.current = nextPhi;
    // Clamp the tilt so the globe cannot be flipped upside down.
    theta.current = Math.max(-0.85, Math.min(0.85, drag.current.theta + dy / 340));
  }, []);

  const endDrag = useCallback(() => {
    drag.current = null;
  }, []);

  const dim = fullscreen ? undefined : size;

  const body = (
    <div
      ref={wrap}
      className={cx(
        "relative select-none",
        fullscreen ? "h-full w-full" : "mx-auto",
      )}
      style={fullscreen ? undefined : { width: "100%", maxWidth: dim }}
      onPointerEnter={() => {
        paused.current = true;
      }}
      onPointerLeave={() => {
        paused.current = false;
        endDrag();
        setHovered(null);
      }}
    >
      <div
        className={cx("relative", fullscreen && "flex h-full items-center justify-center")}
        style={fullscreen ? undefined : { aspectRatio: "1" }}
      >
        <div
          className="relative"
          style={
            fullscreen
              ? { width: "min(86vh, 86vw)", height: "min(86vh, 86vw)" }
              : { width: "100%", height: "100%" }
          }
        >
          <canvas
            ref={canvas}
            aria-label={`Interactive globe showing ${sites.length} measured industrial sites`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            style={{
              width: "100%",
              height: "100%",
              cursor: drag.current ? "grabbing" : "grab",
              contain: "layout paint size",
              opacity: ready ? 1 : 0,
              transition: "opacity 900ms ease",
              touchAction: "none",
            }}
          />

          {/* Marker overlay. Positioned from the live rotation. */}
          <div className="pointer-events-none absolute inset-0" data-tick={tick}>
            {sites.map((s) => {
              const p = projected.current.get(s.osmId);
              if (!p || p.z <= 0.02) return null;
              const isHover = hovered === s.osmId;
              const urgent = (s.signalUrgency ?? 0) >= 0.8;
              const px = 9 + s.weight * 12;
              // Fade near the limb so markers appear to wrap the sphere.
              const edge = Math.min(1, p.z * 3.2);

              return (
                <button
                  key={s.osmId}
                  type="button"
                  onPointerEnter={() => setHovered(s.osmId)}
                  onFocus={() => setHovered(s.osmId)}
                  onBlur={() => setHovered(null)}
                  onClick={() => onSelect?.(s)}
                  aria-label={`${s.name}, ${s.areaKm2.toFixed(2)} square kilometres, ${s.accountName}`}
                  className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full outline-none"
                  style={{
                    left: `calc(50% + ${p.x}px)`,
                    top: `calc(50% + ${p.y}px)`,
                    width: px,
                    height: px,
                    opacity: edge,
                    zIndex: isHover ? 30 : 10,
                    cursor: "pointer",
                  }}
                >
                  {/* Pulse ring — rate carries urgency, so the globe reads as live. */}
                  <span
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: urgent ? "rgba(27,79,216,0.34)" : "rgba(27,79,216,0.2)",
                      animation: `globe-pulse ${urgent ? 1.5 : 2.6}s cubic-bezier(0.36,0.11,0.29,1) infinite`,
                    }}
                  />
                  <span
                    className="absolute rounded-full"
                    style={{
                      inset: "28%",
                      background: isHover ? "#12245f" : "#1b4fd8",
                      boxShadow: isHover ? "0 0 0 3px rgba(27,79,216,0.28)" : "0 0 0 1.5px rgba(255,255,255,0.9)",
                    }}
                  />
                </button>
              );
            })}

            {/* Home marker for the arc origin. */}
            <HomeMarker phi={phi.current} theta={theta.current} tick={tick} wrapRef={wrap} />
          </div>

          {/* Hover card */}
          {hovered &&
            (() => {
              const s = sites.find((x) => x.osmId === hovered);
              const p = projected.current.get(hovered);
              if (!s || !p) return null;
              return (
                <div
                  className="pointer-events-none absolute z-40 w-56 rounded-[10px] bg-[rgba(255,255,255,0.97)] p-2.5 shadow-[var(--shadow-lift)]"
                  style={{
                    left: `calc(50% + ${p.x}px)`,
                    top: `calc(50% + ${p.y + 18}px)`,
                    transform: "translate(-50%, 0)",
                  }}
                >
                  <p className="text-[0.82rem] font-[600] leading-tight">{s.name}</p>
                  <p className="t-micro mt-0.5">
                    {s.accountName} · {s.countryName}
                  </p>
                  <div className="mt-1.5 flex gap-3">
                    <span className="tnum text-[0.9rem] font-[560]">
                      {s.areaKm2.toFixed(2)}
                      <span className="t-micro ml-0.5">km²</span>
                    </span>
                    <span className="tnum text-[0.9rem] font-[560]">
                      {s.perimeterKm.toFixed(1)}
                      <span className="t-micro ml-0.5">km</span>
                    </span>
                  </div>
                  {s.signalHeadline && (
                    <p className="t-micro mt-1.5 border-t border-[var(--color-hair)] pt-1.5">
                      {s.signalHeadline.slice(0, 110)}
                    </p>
                  )}
                  <p className="t-micro mt-1.5 opacity-60">click to open the site</p>
                </div>
              );
            })()}
        </div>
      </div>

      {/* Controls */}
      <div className={cx("absolute z-40 flex gap-1.5", fullscreen ? "right-5 top-5" : "right-1 top-1")}>
        <button
          type="button"
          onClick={() => setFullscreen((v) => !v)}
          className="rounded-[7px] bg-[rgba(255,255,255,0.92)] px-2 py-1.5 text-[0.72rem] font-[520] shadow-[var(--shadow-hair)] transition-shadow hover:shadow-[var(--shadow-panel)]"
          title={fullscreen ? "Exit full screen (Esc)" : "Full screen"}
        >
          {fullscreen ? "✕ Close" : "⤢ Full screen"}
        </button>
      </div>

      {/* Legend */}
      <div
        className={cx(
          "absolute z-30 flex flex-wrap items-center gap-x-3 gap-y-1",
          fullscreen ? "bottom-5 left-5" : "bottom-0 left-0",
        )}
      >
        <span className="t-micro flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-accent)]" />
          measured site · size is footprint
        </span>
        <span className="t-micro flex items-center gap-1.5">
          <span className="pulse-ring inline-block h-2 w-2 rounded-full bg-[var(--color-accent)]" />
          faster pulse · live timing signal
        </span>
        <span className="t-micro">arcs originate at {HQ.label}</span>
      </div>

      {!ready && (
        <div className="shimmer absolute inset-0 rounded-full bg-[var(--color-panel-sunk)]" />
      )}

      <style>{`
        @keyframes globe-pulse {
          0%   { transform: scale(0.55); opacity: 0.85; }
          70%  { transform: scale(1.9);  opacity: 0; }
          100% { transform: scale(1.9);  opacity: 0; }
        }
      `}</style>
    </div>
  );

  if (!fullscreen) return body;

  return (
    <div className="fixed inset-0 z-[100] bg-[rgba(251,251,250,0.98)] backdrop-blur-sm">
      <div className="absolute left-6 top-5 z-40">
        <p className="t-label">Measured sites · live view</p>
        <p className="t-micro mt-0.5">
          {sites.length} sites · drag to rotate · hover to hold · click a site to open it · Esc to close
        </p>
      </div>
      {body}
    </div>
  );
}

/** The arc origin, drawn with the same projection so it sits on Pune. */
function HomeMarker({
  phi,
  theta,
  tick,
  wrapRef,
}: {
  phi: number;
  theta: number;
  tick: number;
  wrapRef: React.RefObject<HTMLDivElement | null>;
}) {
  const w = wrapRef.current?.clientWidth ?? 0;
  if (!w) return null;
  const p = project(HQ.lat, HQ.lon, phi, theta, w / 2);
  if (p.z <= 0.02) return null;
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `calc(50% + ${p.x}px)`, top: `calc(50% + ${p.y}px)`, opacity: Math.min(1, p.z * 3) }}
      data-tick={tick}
    >
      <span className="relative block h-2.5 w-2.5">
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background: "rgba(180,83,10,0.35)",
            animation: "globe-pulse 2s cubic-bezier(0.36,0.11,0.29,1) infinite",
          }}
        />
        <span className="absolute inset-[22%] rounded-full bg-[var(--color-v-mining)] shadow-[0_0_0_1.5px_rgba(255,255,255,0.9)]" />
      </span>
    </div>
  );
}

/**
 * Project a geographic coordinate onto the canvas using the same convention the
 * globe renderer uses, so an overlay marker lands on the landmass beneath it.
 * Returns z as a facing term: positive means the point is on the near side.
 */
function project(
  lat: number,
  lon: number,
  phi: number,
  theta: number,
  radius: number,
): { x: number; y: number; z: number } {
  const polar = (90 - lat) * DEG;
  const azim = (lon + 180) * DEG + phi;

  // Unit sphere, y up.
  const sx = Math.sin(polar) * Math.cos(azim);
  const sy = Math.cos(polar);
  const sz = Math.sin(polar) * Math.sin(azim);

  // Tilt about the horizontal axis.
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const ry = sy * ct - sz * st;
  const rz = sy * st + sz * ct;

  return { x: sx * radius, y: -ry * radius, z: rz };
}
