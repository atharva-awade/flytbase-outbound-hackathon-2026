"use client";

import createGlobe, { type Arc, type Globe as CobeGlobe, type Marker } from "cobe";
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
  signalHeadline?: string;
  signalUrgency?: number;
}

/** FlytBase's engineering base. Arcs originate here, which is literally true. */
const HQ = { lat: 18.5204, lon: 73.8567, label: "FlytBase · Pune" };
const HQ_ID = "hq";

/**
 * Live globe.
 *
 * Positions are taken from the renderer rather than recomputed. Given a marker
 * with an id, cobe maintains a one-pixel anchor element whose left and top track
 * that marker's projected position, and writes a `--cobe-visible-<id>` custom
 * property while the marker is on the near side of the sphere. Reading those two
 * things gives pixel-exact overlay placement that cannot drift from the dots the
 * canvas is drawing — an earlier attempt at reprojecting the coordinates
 * independently put markers in arcs off the edge of the globe, because matching a
 * renderer's own projection by hand is a losing game.
 *
 * Rotation holds whenever the pointer is over the globe, because asking someone
 * to click a moving six-pixel target is hostile.
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
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [linked, setLinked] = useState<string | null>(null);

  /** Rendered positions, keyed by marker id, in container percentages. */
  const [placed, setPlaced] = useState<Record<string, { x: number; y: number; visible: boolean }>>({});

  const phi = useRef(4.3);
  const theta = useRef(0.28);
  const paused = useRef(false);
  const drag = useRef<{ x: number; y: number; phi: number; theta: number } | null>(null);
  const velocity = useRef(0);

  // Stable, CSS-safe ids. cobe interpolates these into custom property names.
  const idFor = useCallback((osmId: string) => `s${osmId.replace(/[^a-z0-9]/gi, "")}`, []);
  const siteById = useMemo(() => {
    const m = new Map<string, GlobeSite>();
    for (const s of sites) m.set(idFor(s.osmId), s);
    return m;
  }, [sites, idFor]);

  const markers: Marker[] = useMemo(
    () => [
      ...sites.map((s) => ({
        id: idFor(s.osmId),
        location: [s.lat, s.lon] as [number, number],
        size: Math.max(0.028, Math.min(0.085, 0.026 + s.weight * 0.06)),
      })),
      { id: HQ_ID, location: [HQ.lat, HQ.lon] as [number, number], size: 0.05, color: [0.71, 0.33, 0.04] as [number, number, number] },
    ],
    [sites, idFor],
  );

  // Arcs are hidden until a site is selected. A sky full of lines on load is
  // decoration; one line drawn on demand is information.
  const arcs: Arc[] = useMemo(() => {
    if (!linked) return [];
    const s = siteById.get(linked);
    if (!s) return [];
    return [
      {
        id: `link${linked}`,
        from: [HQ.lat, HQ.lon] as [number, number],
        to: [s.lat, s.lon] as [number, number],
        color: [0.106, 0.31, 0.847] as [number, number, number],
      },
    ];
  }, [linked, siteById]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;

    let width = el.offsetWidth || size;
    let frame = 0;
    let globe: CobeGlobe | null = null;
    let anchors: Map<string, HTMLElement> | null = null;
    let visStyle: HTMLStyleElement | null = null;

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
      markers,
      arcs,
      arcColor: [0.106, 0.31, 0.847],
      // Raised so the link reads as an arc leaving the surface rather than a
      // line drawn across it.
      arcWidth: 0.6,
      arcHeight: 0.6,
    });

    /** cobe inserts a relative wrapper around the canvas and appends its anchors there. */
    const collectAnchors = () => {
      const wrap = el.parentElement;
      if (!wrap) return null;
      const found = new Map<string, HTMLElement>();
      for (const child of Array.from(wrap.children)) {
        if (!(child instanceof HTMLElement) || child === el) continue;
        const m = /--cobe-(?:arc-)?([a-z0-9_-]+)/i.exec(child.getAttribute("style") ?? "");
        if (m) found.set(m[1], child);
      }
      return found.size ? found : null;
    };

    const findVisStyle = () =>
      Array.from(document.head.querySelectorAll("style")).find((s) =>
        (s.textContent ?? "").includes("--cobe-visible-"),
      ) ?? null;

    let last = performance.now();
    let sinceSync = 0;

    const loop = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;

      if (!paused.current && !drag.current) {
        velocity.current *= 0.94;
        phi.current += 0.00022 * dt + velocity.current;
      }
      globe?.update({ phi: phi.current, theta: theta.current, width: width * 2, height: width * 2 });

      // Read the renderer's own placement a few times per second. Every frame
      // would be wasted work; the globe turns slowly.
      sinceSync += dt;
      if (sinceSync > 55) {
        sinceSync = 0;
        anchors ??= collectAnchors();
        visStyle ??= findVisStyle();

        if (anchors) {
          const visibleIds = new Set(
            Array.from((visStyle?.textContent ?? "").matchAll(/--cobe-visible-([a-z0-9_-]+)/gi)).map(
              (m) => m[1],
            ),
          );
          const next: Record<string, { x: number; y: number; visible: boolean }> = {};
          for (const [id, node] of anchors) {
            const x = Number.parseFloat(node.style.left);
            const y = Number.parseFloat(node.style.top);
            if (Number.isNaN(x) || Number.isNaN(y)) continue;
            next[id] = { x, y, visible: visibleIds.size === 0 ? true : visibleIds.has(id) };
          }
          setPlaced(next);
        }
      }

      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    window.addEventListener("resize", onResize);
    const reveal = setTimeout(() => setReady(true), 90);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(reveal);
      window.removeEventListener("resize", onResize);
      globe?.destroy();
    };
  }, [markers, arcs, size, fullscreen]);

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
    theta.current = Math.max(-0.85, Math.min(0.85, drag.current.theta + dy / 340));
  }, []);
  const endDrag = useCallback(() => {
    drag.current = null;
  }, []);

  const inner = (
    <div
      className="relative"
      style={
        fullscreen
          ? { width: "min(84vh, 84vw)", height: "min(84vh, 84vw)" }
          : { width: "100%", aspectRatio: "1" }
      }
      onPointerEnter={() => {
        paused.current = true;
      }}
      onPointerLeave={() => {
        paused.current = false;
        endDrag();
        setHovered(null);
      }}
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
          cursor: "grab",
          contain: "layout paint size",
          opacity: ready ? 1 : 0,
          transition: "opacity 900ms ease",
          touchAction: "none",
        }}
      />

      {/* Interactive overlay, placed from the renderer's own anchors. */}
      <div className="pointer-events-none absolute inset-0">
        {Object.entries(placed).map(([id, p]) => {
          if (!p.visible) return null;
          if (id === HQ_ID) {
            return (
              <span
                key={id}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                title={HQ.label}
              >
                <span className="relative block h-3 w-3">
                  <span
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: "rgba(180,83,10,0.32)",
                      animation: "globe-pulse 2.1s cubic-bezier(0.36,0.11,0.29,1) infinite",
                    }}
                  />
                  <span className="absolute inset-[26%] rounded-full bg-[var(--color-v-mining)] shadow-[0_0_0_1.5px_rgba(255,255,255,0.95)]" />
                </span>
              </span>
            );
          }

          const s = siteById.get(id);
          if (!s) return null;
          const isHover = hovered === id;
          const isLinked = linked === id;
          const urgent = (s.signalUrgency ?? 0) >= 0.8;
          const px = 16 + s.weight * 14;

          return (
            <button
              key={id}
              type="button"
              onPointerEnter={() => setHovered(id)}
              onFocus={() => setHovered(id)}
              onBlur={() => setHovered(null)}
              onClick={() => {
                setLinked(id);
                onSelect?.(s);
              }}
              aria-label={`${s.name}, ${s.areaKm2.toFixed(2)} square kilometres, ${s.accountName}`}
              className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full outline-none"
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: px,
                height: px,
                zIndex: isHover ? 30 : 10,
                cursor: "pointer",
              }}
            >
              {/* Pulse rate carries urgency, so the globe reads as live. */}
              <span
                className="absolute inset-0 rounded-full"
                style={{
                  background: isLinked
                    ? "rgba(18,36,95,0.4)"
                    : urgent
                      ? "rgba(27,79,216,0.32)"
                      : "rgba(27,79,216,0.18)",
                  animation: `globe-pulse ${urgent ? 1.5 : 2.7}s cubic-bezier(0.36,0.11,0.29,1) infinite`,
                }}
              />
              {isHover && (
                <span className="absolute inset-[18%] rounded-full ring-2 ring-[var(--color-accent)]" />
              )}
            </button>
          );
        })}
      </div>

      {/* Hover card */}
      {hovered &&
        placed[hovered]?.visible &&
        (() => {
          const s = siteById.get(hovered);
          const p = placed[hovered];
          if (!s) return null;
          const flip = p.y > 62;
          return (
            <div
              className="pointer-events-none absolute z-40 w-56 rounded-[10px] bg-[rgba(255,255,255,0.97)] p-2.5 shadow-[var(--shadow-lift)]"
              style={{
                left: `${Math.min(88, Math.max(12, p.x))}%`,
                top: `${p.y}%`,
                transform: flip ? "translate(-50%, -118%)" : "translate(-50%, 14px)",
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
              <p className="t-micro mt-1.5 opacity-60">click to open · draws the link to Pune</p>
            </div>
          );
        })()}

      {!ready && <div className="shimmer absolute inset-0 rounded-full bg-[var(--color-panel-sunk)]" />}
    </div>
  );

  const chrome = (
    <>
      <div className={cx("absolute z-40 flex gap-1.5", fullscreen ? "right-5 top-5" : "-top-1 right-0")}>
        {linked && (
          <button
            type="button"
            onClick={() => setLinked(null)}
            className="rounded-[7px] bg-[rgba(255,255,255,0.92)] px-2 py-1.5 text-[0.72rem] font-[520] shadow-[var(--shadow-hair)] transition-shadow hover:shadow-[var(--shadow-panel)]"
          >
            clear link
          </button>
        )}
        <button
          type="button"
          onClick={() => setFullscreen((v) => !v)}
          className="rounded-[7px] bg-[rgba(255,255,255,0.92)] px-2 py-1.5 text-[0.72rem] font-[520] shadow-[var(--shadow-hair)] transition-shadow hover:shadow-[var(--shadow-panel)]"
          title={fullscreen ? "Exit full screen (Esc)" : "Full screen"}
        >
          {fullscreen ? "✕ Close" : "⤢ Full screen"}
        </button>
      </div>

      <div
        className={cx(
          "absolute z-30 flex flex-wrap items-center gap-x-3 gap-y-1",
          fullscreen ? "bottom-5 left-5" : "-bottom-5 left-0",
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
        <span className="t-micro flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-v-mining)]" />
          {HQ.label}
        </span>
      </div>

      <style>{`
        @keyframes globe-pulse {
          0%   { transform: scale(0.5); opacity: 0.9; }
          70%  { transform: scale(1.85); opacity: 0; }
          100% { transform: scale(1.85); opacity: 0; }
        }
      `}</style>
    </>
  );

  if (!fullscreen) {
    return (
      <div className="relative mx-auto" style={{ width: "100%", maxWidth: size }}>
        {inner}
        {chrome}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-[rgba(251,251,250,0.98)] backdrop-blur-sm">
      <div className="absolute left-6 top-5 z-40">
        <p className="t-label">Measured sites · live view</p>
        <p className="t-micro mt-0.5">
          {sites.length} sites · drag to rotate · hover holds the rotation · click a site to open it and draw
          its link to Pune · Esc to close
        </p>
      </div>
      <div className="flex h-full items-center justify-center">{inner}</div>
      {chrome}
    </div>
  );
}
