"use client";

import createGlobe, { type Arc, type Globe as CobeGlobe } from "cobe";
import { useEffect, useRef, useState } from "react";

export interface GlobeMarker {
  lat: number;
  lon: number;
  /** Drives dot size — larger operations read as larger points. */
  weight: number;
  label: string;
  accent: [number, number, number];
}

export interface GlobeArc {
  from: [number, number];
  to: [number, number];
}

/**
 * White dotted globe.
 *
 * Configured for a light interface: `dark: 0` with a white base and a low
 * diffuse value, so the sphere reads as paper with printed dots rather than a
 * glowing dark object. Markers are the real centroids of measured sites, so the
 * globe is a view of the dataset rather than decoration.
 *
 * cobe v2 has no render callback — rotation is driven by calling `update()` on
 * a frame loop, which also lets a drag interrupt the idle spin cleanly.
 */
export default function Globe({
  markers,
  arcs = [],
  size = 620,
  className,
}: {
  markers: GlobeMarker[];
  arcs?: GlobeArc[];
  size?: number;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);

  const dragStartX = useRef<number | null>(null);
  const dragOffset = useRef(0);
  const dragOffsetAtStart = useRef(0);
  const velocity = useRef(0);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;

    let phi = 4.15;
    let width = el.offsetWidth || size;
    let frame = 0;
    let globe: CobeGlobe | null = null;

    const onResize = () => {
      width = el.offsetWidth || size;
      globe?.update({ width: width * 2, height: width * 2 });
    };

    const cobeArcs: Arc[] = arcs.slice(0, 26).map((a) => ({
      from: a.from,
      to: a.to,
      color: [0.106, 0.31, 0.847],
    }));

    globe = createGlobe(el, {
      devicePixelRatio: Math.min(2, window.devicePixelRatio || 1),
      width: width * 2,
      height: width * 2,
      phi,
      theta: 0.3,
      dark: 0,
      diffuse: 0.4,
      mapSamples: 22_000,
      mapBrightness: 6.4,
      mapBaseBrightness: 0.06,
      baseColor: [1, 1, 1],
      markerColor: [0.106, 0.31, 0.847],
      glowColor: [0.965, 0.968, 0.976],
      opacity: 0.97,
      arcs: cobeArcs,
      arcColor: [0.106, 0.31, 0.847],
      arcWidth: 0.28,
      arcHeight: 0.32,
      markers: markers.slice(0, 220).map((m) => ({
        location: [m.lat, m.lon] as [number, number],
        size: Math.max(0.032, Math.min(0.1, 0.028 + m.weight * 0.07)),
      })),
    });

    const tick = () => {
      if (dragStartX.current === null) {
        velocity.current *= 0.93;
        phi += 0.0024 + velocity.current;
      }
      globe?.update({ phi: phi + dragOffset.current });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    window.addEventListener("resize", onResize);
    const reveal = setTimeout(() => setReady(true), 80);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(reveal);
      window.removeEventListener("resize", onResize);
      globe?.destroy();
    };
  }, [markers, arcs, size]);

  return (
    <div className={className} style={{ width: "100%", maxWidth: size, aspectRatio: "1" }}>
      <canvas
        ref={canvas}
        aria-label={`Globe showing ${markers.length} measured industrial sites`}
        onPointerDown={(e) => {
          dragStartX.current = e.clientX;
          dragOffsetAtStart.current = dragOffset.current;
          e.currentTarget.style.cursor = "grabbing";
        }}
        onPointerUp={(e) => {
          dragStartX.current = null;
          e.currentTarget.style.cursor = "grab";
        }}
        onPointerLeave={(e) => {
          dragStartX.current = null;
          e.currentTarget.style.cursor = "grab";
        }}
        onPointerMove={(e) => {
          if (dragStartX.current === null) return;
          const next = dragOffsetAtStart.current + (e.clientX - dragStartX.current) / 240;
          velocity.current = (next - dragOffset.current) * 0.2;
          dragOffset.current = next;
        }}
        style={{
          width: "100%",
          height: "100%",
          cursor: "grab",
          contain: "layout paint size",
          opacity: ready ? 1 : 0,
          transition: "opacity 900ms ease",
          touchAction: "pan-y",
        }}
      />
    </div>
  );
}
