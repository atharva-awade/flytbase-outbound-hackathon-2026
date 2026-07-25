"use client";

import createGlobe, { type Arc, type Globe as CobeGlobe, type Marker } from "cobe";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lockScroll, pushLayer } from "@/lib/overlay";

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
  /** 0..1, drives dot size and pulse rate. */
  weight: number;
  signalHeadline?: string;
  signalUrgency?: number;
}

/**
 * A marker's drawn position (x, y) and its true anchor (ax, ay). The two differ
 * only where declutter had to move a dot to keep it clickable.
 */
interface Placed {
  x: number;
  y: number;
  ax: number;
  ay: number;
  visible: boolean;
}

/**
 * Nudge overlapping dots apart, in screen space, after the renderer has placed
 * them.
 *
 * Clustering already collapses one operator's features into one dot, but the
 * Atacama holds several different operators within a couple of degrees of each
 * other, and those must not be merged: one dot standing for two companies would
 * misstate who holds the ground. Left alone they landed 2px apart and neither
 * could be hovered.
 *
 * So a few relaxation passes push coincident dots apart along the line between
 * them. Displacement is capped, and any dot that moved keeps its true anchor so
 * the overlay can draw a hairline back to the real coordinate, the position
 * stays honest, it is just legible as well.
 */
function declutter(placed: Record<string, Placed>, widthPx: number) {
  const ids = Object.keys(placed).filter((id) => placed[id].visible);
  if (ids.length < 2 || widthPx <= 0) return;

  // Work in percentages, which is what the anchors give us.
  const minPct = (30 / widthPx) * 100;
  const maxPullPct = (34 / widthPx) * 100;

  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = placed[ids[i]];
        const b = placed[ids[j]];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= minPct) continue;
        if (d < 1e-4) {
          // Exactly coincident: pick a deterministic direction from the index so
          // the layout does not jitter between frames.
          const ang = (i * 2.399963) % (Math.PI * 2);
          dx = Math.cos(ang);
          dy = Math.sin(ang);
          d = 1;
        }
        const push = ((minPct - d) / 2 / d) * 1.02;
        a.x -= dx * push;
        a.y -= dy * push;
        b.x += dx * push;
        b.y += dy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }

  // Never let a dot drift far from the ground it represents.
  for (const id of ids) {
    const p = placed[id];
    const dx = p.x - p.ax;
    const dy = p.y - p.ay;
    const d = Math.hypot(dx, dy);
    if (d > maxPullPct) {
      p.x = p.ax + (dx / d) * maxPullPct;
      p.y = p.ay + (dy / d) * maxPullPct;
    }
  }
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
 * canvas is drawing, an earlier attempt at reprojecting the coordinates
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
  const [placed, setPlaced] = useState<Record<string, Placed>>({});

  /**
   * Open with the accounts facing the viewer.
   *
   * The rotation used to start at a fixed angle, which for a Latin American run
   * put every mark on the left limb at load: squashed by the curve of the sphere,
   * with its labels hanging off the edge. The first second of a page is the only
   * one guaranteed to be seen, so the opening angle is derived from the data
   * instead of hard coded. cobe's phi runs opposite to longitude, hence the sign.
   */
  const openingPhi = useMemo(() => {
    if (sites.length === 0) return 4.3;
    const weight = (x: GlobeSite) => Math.max(x.areaKm2, 0.01);
    const total = sites.reduce((t, x) => t + weight(x), 0);
    const meanLon = sites.reduce((t, x) => t + x.lon * weight(x), 0) / total;
    // Established by testing rather than derived: at phi equal to minus the
    // longitude in radians the target sits on the right limb, and rotating a
    // quarter turn back brings it to the centre of the visible face. Adding that
    // quarter instead of subtracting it puts the target behind the globe, which
    // is how the sign was pinned down.
    return -(meanLon * Math.PI) / 180 - Math.PI / 2;
  }, [sites]);

  const phi = useRef(openingPhi);
  const theta = useRef(0.28);
  const paused = useRef(false);
  const drag = useRef<{ x: number; y: number; phi: number; theta: number } | null>(null);
  const velocity = useRef(0);

  // Stable, CSS-safe ids. cobe interpolates these into custom property names.
  const idFor = useCallback((osmId: string) => `s${osmId.replace(/[^a-z0-9]/gi, "")}`, []);

  /**
   * One dot per operation, not per polygon.
   *
   * Plotting every measured feature put 60 markers on a 560px sphere, 939 of
   * whose pairs sat within 12px of each other. SQM alone has 49 features inside
   * a couple of degrees. The result read as a blue smear rather than a set of
   * sites, and clicking any particular one was luck.
   *
   * So features are grouped by operator and a coarse geographic cell. Grouping
   * is deliberately never across operators: merging two companies into one dot
   * would misstate who holds the ground. Within one operator, "49 features,
   * 548 km² total" is the truer statement anyway, that is the unit a rep sells
   * to. The cell is geographic rather than screen-space so a cluster does not
   * re-form as the globe turns.
   */
  const clusters = useMemo(() => {
    // One mark per account.
    //
    // This started as one mark per polygon: sixty of them, 939 pairs inside
    // twelve pixels, which read as spawn rather than as an instrument. Grouping
    // by operator and a 2.5 degree cell got it to twenty, still sixteen crowded
    // pairs, because the Atacama is genuinely the densest mining district on
    // earth and no amount of styling fixes twenty marks inside 150 pixels of
    // sphere.
    //
    // So the unit is the account, which is also the unit this product sells. Six
    // named, sized, separated marks state something twenty anonymous dots cannot:
    // these are the companies, this is how much ground each one holds. The dot
    // sits at the area-weighted centre of that account's footprint, so it lands
    // over the bulk of the operation, and the label names the account and its
    // total, so nothing is implied that is not written.
    const groups = new Map<string, GlobeSite[]>();
    for (const s of sites) {
      const key = s.accountSlug;
      const g = groups.get(key);
      if (g) g.push(s);
      else groups.set(key, [s]);
    }
    const out = Array.from(groups.values()).map((members) => {
      const byArea = [...members].sort((a, b) => b.areaKm2 - a.areaKm2);
      const lead = byArea[0];
      const totalArea = members.reduce((t, m) => t + m.areaKm2, 0);
      const totalPerimeter = members.reduce((t, m) => t + m.perimeterKm, 0);
      // Area-weighted centre, so the dot sits over the bulk of the ground.
      const wsum = members.reduce((t, m) => t + Math.max(m.areaKm2, 0.01), 0);
      const lat = members.reduce((t, m) => t + m.lat * Math.max(m.areaKm2, 0.01), 0) / wsum;
      const lon = members.reduce((t, m) => t + m.lon * Math.max(m.areaKm2, 0.01), 0) / wsum;
      const urgent = members.reduce(
        (best, m) => ((m.signalUrgency ?? 0) > (best.signalUrgency ?? 0) ? m : best),
        members[0],
      );
      return {
        id: idFor(lead.osmId),
        lead,
        members,
        count: members.length,
        totalArea,
        totalPerimeter,
        lat,
        lon,
        weight: Math.max(...members.map((m) => m.weight)),
        signalHeadline: urgent.signalHeadline,
        signalUrgency: urgent.signalUrgency,
      };
    });
    // Largest last, so the biggest operations paint on top of smaller neighbours.
    return out.sort((a, b) => a.totalArea - b.totalArea);
  }, [sites, idFor]);

  /**
   * Footprint drives the mark, and only the largest few are labelled.
   *
   * With every mark the same size and the same flat blue, twenty of them in one
   * mining district read as a clump rather than as an instrument. Area maps to
   * radius on a square root, which is how area should map to a circle, and the
   * biggest four operations carry a chip in the same style as the Pune station,
   * so the eye lands on a name instead of a field of identical dots.
   */
  const maxClusterArea = useMemo(
    () => Math.max(0.01, ...clusters.map((c) => c.totalArea)),
    [clusters],
  );
  /**
   * One standing label, and one only.
   *
   * Every account labelled at once put eight chips inside one district, stacked
   * on each other and running off the sphere. The whole point of a label is that
   * it is readable. So the largest footprint carries a standing annotation, which
   * is the fact worth stating unprompted, and every other mark names itself on
   * hover through the card that already exists.
   */
  const labelledIds = useMemo(
    // One, and one only.
    //
    // Three was tried and three does not fit: when every account sits inside one
    // mining district, sixty pixels of sphere cannot hold three chips, and
    // staggering them vertically only turned an overlap into a stack. The globe
    // carries the largest name and the shape of the data; the ranked list beside
    // it carries every name legibly, which is the job a list is better at.
    () => new Set([...clusters].sort((a, b) => b.totalArea - a.totalArea).slice(0, 1).map((c) => c.id)),
    [clusters],
  );

  const clusterById = useMemo(() => {
    const m = new Map<string, (typeof clusters)[number]>();
    for (const c of clusters) m.set(c.id, c);
    return m;
  }, [clusters]);

  const markers: Marker[] = useMemo(
    () => [
      ...clusters.map((c) => ({
        id: c.id,
        location: [c.lat, c.lon] as [number, number],
        // Sub-pixel on purpose, so the canvas draws nothing visible.
        //
        // This is the fix for the thing that made a dense district look like
        // spawn. Two marks were being drawn per account: cobe's own dot at the
        // true coordinate, and the interactive HTML dot in the overlay, which
        // declutter may have nudged a few pixels away. Every account therefore
        // appeared twice with a hairline between the two, and ten accounts in the
        // Atacama became twenty overlapping dots joined by spokes.
        //
        // The marker still has to exist, because cobe maintains one anchor
        // element per marker and reading those anchors is how the overlay knows
        // where the projection put each account. So the marker stays and the dot
        // does not.
        size: 0.0008,
      })),
      {
        id: HQ_ID,
        location: [HQ.lat, HQ.lon] as [number, number],
        size: 0.0008,
        color: [0.71, 0.33, 0.04] as [number, number, number],
      },
    ],
    [clusters],
  );

  // Arcs are hidden until a site is selected. A sky full of lines on load is
  // decoration; one line drawn on demand is information.
  const arcs: Arc[] = useMemo(() => {
    if (!linked) return [];
    const s = clusterById.get(linked);
    if (!s) return [];
    return [
      {
        id: `link${linked}`,
        from: [HQ.lat, HQ.lon] as [number, number],
        to: [s.lat, s.lon] as [number, number],
        color: [0.106, 0.31, 0.847] as [number, number, number],
      },
    ];
  }, [linked, clusterById]);

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
          const next: Record<string, Placed> = {};
          for (const [id, node] of anchors) {
            const x = Number.parseFloat(node.style.left);
            const y = Number.parseFloat(node.style.top);
            if (Number.isNaN(x) || Number.isNaN(y)) continue;
            next[id] = { x, y, ax: x, ay: y, visible: visibleIds.size === 0 ? true : visibleIds.has(id) };
          }
          declutter(next, width);
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
  // Deliberately NOT dependent on `fullscreen`: the frame loop reads the live
  // container width every tick, so the canvas resizes itself. Rebuilding the
  // globe on a layout change would destroy and re-create a WebGL context for no
  // reason, and was part of what made full screen unstable.
  }, [markers, arcs, size]);

  useEffect(() => {
    if (!fullscreen) return;
    const layer = pushLayer();
    const unlock = lockScroll();
    const onKey = (e: KeyboardEvent) => {
      // Only the topmost layer answers Escape, so one press does not also close
      // the dialog this may be sitting inside.
      if (e.key === "Escape" && layer.isTop()) setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      unlock();
      layer.release();
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
  // Screen-space endpoints of the selected link, used to draw a living
  // connection over the top of the arc the canvas renders.
  const link = linked && placed[linked]?.visible && placed[HQ_ID]?.visible
    ? { from: placed[HQ_ID], to: placed[linked] }
    : null;

  // ONE stable tree. Full screen changes only the size of the box the canvas
  // sits in. Returning a different subtree here is what crashed the page
  // previously: cobe inserts its own wrapper element around the canvas, so when
  // React reconciled a canvas that had been moved, removeChild threw.
  return (
    <div
      className={cx(
        fullscreen
          ? "fixed inset-0 z-[100] flex items-center justify-center bg-[var(--color-paper)]"
          : "relative mx-auto",
      )}
      style={fullscreen ? undefined : { width: "100%", maxWidth: size }}
    >
      {fullscreen && (
        <div className="absolute left-6 top-6 z-40 max-w-md">
          <p className="t-label">Measured sites · live view</p>
          <p className="t-micro mt-0.5">
            {sites.length} sites · drag to rotate · hover holds the rotation · click a site to open it and draw
            its link to Pune · Esc to close
          </p>
        </div>
      )}

      <div
        className="relative"
        style={
          fullscreen
            ? { width: "min(78vh, 78vw)", height: "min(78vh, 78vw)" }
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

        {/* Living connection. The canvas draws the arc in three dimensions; this
            adds the sense of traffic moving along it, which a static line cannot
            convey. Drawn as a curve bulging away from the globe centre so it
            tracks the rendered arc closely. */}
        {link && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
          >
            
            {(() => {
              const x1 = link.from.x;
              const y1 = link.from.y;
              const x2 = link.to.x;
              const y2 = link.to.y;
              // Bow the control point away from the sphere centre so the 2D curve
              // sits over the 3D arc rather than cutting under it.
              const mx = (x1 + x2) / 2;
              const my = (y1 + y2) / 2;
              const dx = mx - 50;
              const dy = my - 50;
              const len = Math.max(0.001, Math.hypot(dx, dy));
              const bow = 16;
              const cx2 = mx + (dx / len) * bow;
              const cy2 = my + (dy / len) * bow;
              const d = `M ${x1} ${y1} Q ${cx2} ${cy2} ${x2} ${y2}`;
              return (
                <>
                  <path d={d} fill="none" stroke="rgba(27,79,216,0.16)" strokeWidth="1.1" vectorEffect="non-scaling-stroke" />
                  <path
                    d={d}
                    fill="none"
                    stroke="rgba(27,79,216,0.95)"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    strokeDasharray="5 13"
                    className="globe-flow"
                  />
                </>
              );
            })()}
          </svg>
        )}

        {/* Interactive overlay, placed from the renderer's own anchors. */}
        <div className="pointer-events-none absolute inset-0">
          {Object.entries(placed).map(([id, p]) => {
            if (!p.visible) return null;

            // ── FlytBase HQ ────────────────────────────────────────────
            if (id === HQ_ID) {
              return (
                <span
                  key={id}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${p.x}%`, top: `${p.y}%`, zIndex: 25 }}
                >
                  <span className="relative flex items-center">
                    <span className="relative block h-3.5 w-3.5">
                      {/* Two staggered rings read as a station broadcasting. */}
                      <span className="globe-ring absolute inset-0 rounded-full border border-[rgba(180,83,10,0.6)]" />
                      <span
                        className="globe-ring absolute inset-0 rounded-full border border-[rgba(180,83,10,0.38)]"
                        style={{ animationDelay: "1.05s" }}
                      />
                      <span className="absolute inset-[30%] rounded-full bg-[var(--color-v-mining)] shadow-[0_0_0_1.5px_#fff,0_1px_3px_rgba(16,24,40,0.3)]" />
                    </span>
                    <span className="ml-2 whitespace-nowrap rounded-[6px] bg-[rgba(255,255,255,0.94)] px-1.5 py-0.5 text-[0.62rem] font-[560] tracking-[0.01em] text-[var(--color-v-mining)] shadow-[var(--shadow-hair)]">
                      FlytBase HQ · Pune
                    </span>
                  </span>
                </span>
              );
            }

            const cluster = clusterById.get(id);
            if (!cluster) return null;
            const site = cluster.lead;
            const isHover = hovered === id;
            const isLinked = linked === id;
            const urgent = (cluster.signalUrgency ?? 0) >= 0.8;
            // Area to radius on a square root, over a deliberately wide range.
            //
            // Every mark within a few pixels of every other was the second half of
            // why this read as spawn: a set of near-identical dots carries no
            // information, so the eye has nothing to rank and sees texture instead
            // of data. Nine to twenty-six pixels makes the largest operation
            // unmistakable at a glance, which is the one thing this view is for.
            const core = 9 + Math.sqrt(Math.min(1, cluster.totalArea / maxClusterArea)) * 17;
            const hit = Math.max(26, core * 2.4);
            const labelled = labelledIds.has(id) || isHover || isLinked;
            // Only a site with a live timing signal pulses. Everything pulsing at
            // once is noise, and the pulse is supposed to mean something.
            const pulses = (cluster.signalUrgency ?? 0) >= 0.55;
            // The ring is an annotation, not a proportional mark, so it is capped.
            // Scaled off the core it threw a sixty pixel hoop off the largest dot.
            const ringSize = Math.min(core * 2.2, 30);
            // Label outward from the centre, so a chip never runs off the sphere.
            const flipLabel = p.x > 68;
            // Two labelled marks at a similar height put their chips on the same
            // line, and the wider one covers the narrower. Each subsequent chip in
            // a band steps down out of the way.
            const labelStep =
              labelled && !isHover
                ? Object.entries(placed).filter(
                    ([oid, op]) =>
                      oid !== id &&
                      op.visible &&
                      labelledIds.has(oid) &&
                      Math.abs(op.y - p.y) < 3.4 &&
                      op.x < p.x,
                  ).length
                : 0;

            return (
              <button
                key={id}
                type="button"
                onPointerEnter={() => setHovered(id)}
                onFocus={() => setHovered(id)}
                onBlur={() => setHovered(null)}
                onClick={() => {
                  setLinked(id);
                  onSelect?.(site);
                }}
                aria-label={
                  cluster.count > 1
                    ? `${site.accountName} near ${site.name}, ${cluster.count} mapped features, ${cluster.totalArea.toFixed(2)} square kilometres in total`
                    : `${site.name}, ${site.areaKm2.toFixed(2)} square kilometres, ${site.accountName}`
                }
                className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full outline-none"
                style={{
                  left: `${p.x}%`,
                  top: `${p.y}%`,
                  width: hit,
                  height: hit,
                  zIndex: isHover || isLinked ? 30 : 10,
                  cursor: "pointer",
                }}
              >
                {/* Expanding rings, two, staggered, so a site with a live signal
                    reads as transmitting rather than merely blinking. Drawn as a
                    hairline stroke, not a filled disc: filled pulses bled into one
                    another and turned a dense district into one blue blob. */}
                {pulses && (
                  <>
                <span
                  className="globe-ring absolute left-1/2 top-1/2 rounded-full"
                  style={{
                    width: ringSize,
                    height: ringSize,
                    marginLeft: -ringSize / 2,
                    marginTop: -ringSize / 2,
                    border: `1px solid ${urgent ? "rgba(27,79,216,0.62)" : "rgba(27,79,216,0.44)"}`,
                    animationDuration: urgent ? "1.7s" : "3s",
                  }}
                />
                <span
                  className="globe-ring absolute left-1/2 top-1/2 rounded-full"
                  style={{
                    width: ringSize,
                    height: ringSize,
                    marginLeft: -ringSize / 2,
                    marginTop: -ringSize / 2,
                    border: `1px solid ${urgent ? "rgba(27,79,216,0.4)" : "rgba(27,79,216,0.26)"}`,
                    animationDuration: urgent ? "1.7s" : "3s",
                    animationDelay: urgent ? "0.85s" : "1.5s",
                  }}
                />
                  </>
                )}

                {/* A soft halo seats the mark on the sphere instead of leaving it
                    pasted on top. Kept wide and very faint so neighbours do not
                    merge, which is what the old hard glow did. */}
                <span
                  className="absolute left-1/2 top-1/2 rounded-full"
                  style={{
                    width: core * 3.1,
                    height: core * 3.1,
                    marginLeft: -core * 1.55,
                    marginTop: -core * 1.55,
                    background:
                      "radial-gradient(circle, rgba(27,79,216,0.20) 0%, rgba(27,79,216,0.07) 45%, rgba(27,79,216,0) 72%)",
                    opacity: isHover || isLinked ? 1 : 0.75,
                    transition: "opacity 200ms ease",
                  }}
                />

                {/* The mark. A lens rather than a flat disc: lit from the top left,
                    deepening toward the bottom, with a hairline white keyline and a
                    real shadow underneath. Flat fills of one colour at one size are
                    what made a district of these read as spawn. */}
                <span
                  className="absolute left-1/2 top-1/2 rounded-full transition-transform duration-200"
                  style={{
                    width: core,
                    height: core,
                    marginLeft: -core / 2,
                    marginTop: -core / 2,
                    background: isLinked
                      ? "radial-gradient(circle at 32% 28%, #4b7bff 0%, #12245f 78%)"
                      : "radial-gradient(circle at 32% 28%, #5b86f7 0%, #1b4fd8 62%, #1740ad 100%)",
                    boxShadow: isHover
                      ? "0 0 0 1.6px #fff, 0 0 0 4px rgba(27,79,216,0.28), 0 3px 7px rgba(16,24,40,0.32), inset 0 -1px 2px rgba(11,26,74,0.55)"
                      : "0 0 0 1.4px #fff, 0 2px 4px rgba(16,24,40,0.26), inset 0 -1px 2px rgba(11,26,74,0.45)",
                    transform: isHover || isLinked ? "scale(1.18)" : "scale(1)",
                  }}
                />

                {/* Name and measured footprint, on the largest operations and on
                    whatever the pointer is over. The same chip the Pune station
                    uses, because that is the one element on this globe that already
                    read as finished. */}
                {labelled && (
                  <span
                    className="pointer-events-none absolute whitespace-nowrap rounded-[6px] bg-[rgba(255,255,255,0.95)] px-1.5 py-0.5 text-[0.62rem] font-[560] tracking-[0.01em] shadow-[var(--shadow-hair)]"
                    style={{
                      top: "50%",
                      transform: `translateY(calc(-50% + ${labelStep * 17}px))`,
                      left: flipLabel ? "auto" : `calc(50% + ${core / 2 + 7}px)`,
                      right: flipLabel ? `calc(50% + ${core / 2 + 7}px)` : "auto",
                      color: isHover || isLinked ? "var(--color-accent-ink)" : "var(--color-ink-2)",
                      zIndex: 2,
                    }}
                  >
                    {site.accountName.length > 22 ? `${site.accountName.slice(0, 21)}…` : site.accountName}
                    <span className="ml-1 opacity-55">{cluster.totalArea.toFixed(0)} km²</span>
                  </span>
                )}

                {/* Urgent sites carry a thin outer halo so "act now" is visible
                    without reading the tooltip. */}
              </button>
            );
          })}
        </div>

        {/* Hover card */}
        {hovered &&
          placed[hovered]?.visible &&
          (() => {
            const cluster = clusterById.get(hovered);
            const p = placed[hovered];
            if (!cluster) return null;
            const site = cluster.lead;
            const flip = p.y > 60;
            return (
              <div
                className="pointer-events-none absolute z-40 w-60 rounded-[11px] bg-[rgba(255,255,255,0.98)] p-3 shadow-[var(--shadow-lift)]"
                style={{
                  left: `${Math.min(86, Math.max(14, p.x))}%`,
                  top: `${p.y}%`,
                  transform: flip ? "translate(-50%, -116%)" : "translate(-50%, 16px)",
                }}
              >
                <p className="text-[0.84rem] font-[600] leading-tight">{site.name}</p>
                <p className="t-micro mt-0.5">
                  {site.accountName} · {site.countryName}
                </p>
                {cluster.count > 1 && (
                  <p className="t-micro mt-1">
                    plus {cluster.count - 1} more mapped {cluster.count === 2 ? "feature" : "features"} of
                    this operation
                  </p>
                )}
                <div className="mt-2 flex gap-4 border-t border-[var(--color-hair)] pt-2">
                  <span className="tnum text-[0.95rem] font-[560]">
                    {cluster.totalArea.toFixed(2)}
                    <span className="t-micro ml-0.5">km²{cluster.count > 1 ? " total" : ""}</span>
                  </span>
                  <span className="tnum text-[0.95rem] font-[560]">
                    {cluster.totalPerimeter.toFixed(1)}
                    <span className="t-micro ml-0.5">km edge</span>
                  </span>
                </div>
                {cluster.signalHeadline && (
                  <p className="t-micro mt-2 border-t border-[var(--color-hair)] pt-2">
                    {cluster.signalHeadline.slice(0, 110)}
                  </p>
                )}
                <p className="t-micro mt-2 font-[560] text-[var(--color-accent)]">
                  click to open · draws the link to Pune
                </p>
              </div>
            );
          })()}

        {!ready && <div className="shimmer absolute inset-0 rounded-full bg-[var(--color-panel-sunk)]" />}
      </div>

      {/* Controls */}
      <div className={cx("absolute z-40 flex gap-1.5", fullscreen ? "right-5 top-5" : "right-0 top-0")}>
        {linked && (
          <button
            type="button"
            onClick={() => setLinked(null)}
            className="rounded-[7px] bg-[rgba(255,255,255,0.94)] px-2 py-1.5 text-[0.72rem] font-[520] shadow-[var(--shadow-hair)] transition-shadow hover:shadow-[var(--shadow-panel)]"
          >
            clear link
          </button>
        )}
        <button
          type="button"
          onClick={() => setFullscreen((v) => !v)}
          className="rounded-[7px] bg-[rgba(255,255,255,0.94)] px-2 py-1.5 text-[0.72rem] font-[520] shadow-[var(--shadow-hair)] transition-shadow hover:shadow-[var(--shadow-panel)]"
          title={fullscreen ? "Exit full screen (Esc)" : "Full screen"}
        >
          {fullscreen ? "✕ Close" : "⤢ Full screen"}
        </button>
      </div>

      {/* Legend. In the inline layout this sits in normal flow beneath the globe
          so it can never collide with the caption underneath it. */}
      <div
        className={cx(
          "flex flex-wrap items-center gap-x-3 gap-y-1",
          fullscreen ? "absolute bottom-5 left-5 z-30" : "mt-3 justify-center lg:justify-end",
        )}
      >
        <span className="t-micro flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] shadow-[0_0_0_1.5px_rgba(255,255,255,0.9)]" />
          measured site · size is footprint
        </span>
        <span className="t-micro flex items-center gap-1.5">
          <span className="relative inline-block h-1.5 w-1.5">
            <span className="globe-ring absolute inset-0 rounded-full bg-[rgba(27,79,216,0.34)]" />
            <span className="absolute inset-0 rounded-full bg-[var(--color-accent)]" />
          </span>
          faster pulse · live timing signal
        </span>
        <span className="t-micro flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-v-mining)] shadow-[0_0_0_1.5px_rgba(255,255,255,0.9)]" />
          FlytBase HQ · Pune
        </span>
      </div>

      <style>{`
        @keyframes globe-ring-expand {
          0%   { transform: scale(0.45); opacity: 0.95; }
          75%  { transform: scale(2.6);  opacity: 0; }
          100% { transform: scale(2.6);  opacity: 0; }
        }
        .globe-ring {
          box-sizing: border-box;
          animation-name: globe-ring-expand;
          animation-duration: 2.6s;
          animation-timing-function: cubic-bezier(0.22, 0.61, 0.36, 1);
          animation-iteration-count: infinite;
        }
        @keyframes globe-flow-dash {
          from { stroke-dashoffset: 36; }
          to   { stroke-dashoffset: 0; }
        }
        .globe-flow {
          animation: globe-flow-dash 1.15s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .globe-ring, .globe-flow { animation: none; }
        }
      `}</style>
    </div>
  );
}
