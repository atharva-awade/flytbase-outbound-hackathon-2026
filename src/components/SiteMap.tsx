"use client";

import maplibregl, { type Map as MlMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { lockScroll, pushLayer } from "@/lib/overlay";

import type { SiteGeometry } from "@/lib/types";
import { cx } from "./ui";

/**
 * Satellite imagery for the measured polygons.
 *
 * Esri World Imagery is the default because it needs no key, which keeps the
 * deployed page working for a reviewer with no credentials configured. When a
 * MapTiler key is present the tiles upgrade automatically.
 */
function basemap(maptilerKey?: string): maplibregl.StyleSpecification {
  const source: maplibregl.RasterSourceSpecification = maptilerKey
    ? {
        type: "raster",
        tiles: [`https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${maptilerKey}`],
        tileSize: 256,
        attribution:
          '<a href="https://www.maptiler.com/copyright/">MapTiler</a> · <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxzoom: 20,
      }
    : {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
        maxzoom: 19,
      };

  return {
    version: 8,
    sources: { sat: source },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#ececeb" } },
      { id: "sat", type: "raster", source: "sat", paint: { "raster-opacity": 1 } },
    ],
  };
}

export interface SiteMapProps {
  sites: SiteGeometry[];
  /** Highlighted feature, drawn in the accent colour with a halo. */
  focusOsmId?: string;
  height?: number;
  maptilerKey?: string;
  onSelect?: (osmId: string) => void;
  /** Show the full-screen control. */
  allowFullscreen?: boolean;
}

export default function SiteMap({
  sites,
  focusOsmId,
  height = 420,
  maptilerKey,
  onSelect,
  allowFullscreen = true,
}: SiteMapProps) {
  const holder = useRef<HTMLDivElement | null>(null);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  // Swapping the basemap removes every source and layer, so the polygon layers
  // have to be rebuilt afterwards. Bumping this re-runs the layer effect.
  const [styleEpoch, setStyleEpoch] = useState(0);

  const featureCollection = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: sites
        .filter((s) => s.ring.length >= 4)
        .map((s) => ({
          type: "Feature" as const,
          id: s.osmId,
          properties: {
            osmId: s.osmId,
            name: s.name ?? s.assetClass.replace(/_/g, " "),
            areaKm2: Number(s.areaKm2.toFixed(3)),
            attribution: s.attributionMethod,
            excluded: s.excluded ? 1 : 0,
            focused: s.osmId === focusOsmId ? 1 : 0,
          },
          geometry: { type: "Polygon" as const, coordinates: [closeRing(s.ring)] },
        })),
    }),
    [sites, focusOsmId],
  );

  useEffect(() => {
    if (!holder.current || map.current) return;
    const m = new maplibregl.Map({
      container: holder.current,
      style: basemap(maptilerKey),
      center: [-68.3, -23.5],
      zoom: 8,
      attributionControl: { compact: true },
      dragRotate: false,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: "metric" }), "bottom-left");
    const markReady = () => {
      // The container is often laid out after construction; without this
      // MapLibre keeps a stale zero size and paints nothing.
      m.resize();
      setReady(true);
    };
    m.on("load", markReady);
    // `load` does not fire again for an already-loaded style, and a map created
    // inside a modal or a hidden container can finish loading before the
    // listener attaches. Both are checked rather than trusted.
    m.on("styledata", () => {
      if (m.isStyleLoaded()) markReady();
    });
    if (m.isStyleLoaded()) markReady();
    // Last resort: never leave a loading cover over a map that is actually fine.
    const readyFallback = setTimeout(markReady, 2_500);

    // A tile or style failure would otherwise be an unexplained blank panel.
    // A keyed provider can also reject a request for reasons that have nothing
    // to do with this page, a domain-restricted key, an exhausted quota, so the
    // first failure on a keyed basemap silently falls back to the keyless one
    // rather than leaving the reviewer with an empty rectangle.
    let fellBack = false;
    m.on("error", (e) => {
      const msg = (e as unknown as { error?: Error }).error?.message ?? "unknown map error";
      if (maptilerKey && !fellBack) {
        fellBack = true;
        try {
          m.setStyle(basemap(undefined));
          m.once("styledata", () => setStyleEpoch((n) => n + 1));
          setMapError(null);
          return;
        } catch {
          /* fall through to reporting it */
        }
      }
      setMapError(msg);
    });

    // Keep the canvas in step with its container for the life of the map.
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(holder.current);

    map.current = m;
    return () => {
      clearTimeout(readyFallback);
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, [maptilerKey]);

  // Leaving full screen with Escape is the expected behaviour, and MapLibre
  // needs an explicit resize when its container changes size.
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

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const t = setTimeout(() => m.resize(), 60);
    return () => clearTimeout(t);
  }, [fullscreen]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;

    const existing = m.getSource("sites") as maplibregl.GeoJSONSource | undefined;
    if (existing) {
      existing.setData(featureCollection);
    } else {
      m.addSource("sites", { type: "geojson", data: featureCollection });

      m.addLayer({
        id: "sites-fill",
        type: "fill",
        source: "sites",
        paint: {
          "fill-color": [
            "case",
            ["==", ["get", "focused"], 1],
            "#1b4fd8",
            ["==", ["get", "excluded"], 1],
            "#6b7280",
            ["==", ["get", "attribution"], "proximity_cluster"],
            "#9a6212",
            "#0f7b4f",
          ],
          "fill-opacity": ["case", ["==", ["get", "focused"], 1], 0.34, 0.2],
        },
      });

      // A wide, soft outline under the focused feature. Without this the
      // selected polygon is hard to pick out against satellite imagery.
      m.addLayer({
        id: "sites-halo",
        type: "line",
        source: "sites",
        filter: ["==", ["get", "focused"], 1],
        paint: {
          "line-color": "#1b4fd8",
          "line-width": 11,
          "line-blur": 7,
          "line-opacity": 0.55,
        },
      });

      m.addLayer({
        id: "sites-line",
        type: "line",
        source: "sites",
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "focused"], 1],
            "#1b4fd8",
            ["==", ["get", "excluded"], 1],
            "#9aa1ac",
            ["==", ["get", "attribution"], "proximity_cluster"],
            "#c58a2a",
            "#19a068",
          ],
          "line-width": ["case", ["==", ["get", "focused"], 1], 2.6, 1.5],
          // Proximity-inferred footprints are dashed, so a weaker claim looks weaker.
          "line-dasharray": [
            "case",
            ["==", ["get", "attribution"], "proximity_cluster"],
            ["literal", [2, 1.6]],
            ["literal", [1, 0]],
          ],
        },
      });

      m.addLayer({
        id: "sites-focus-label",
        type: "symbol",
        source: "sites",
        filter: ["==", ["get", "focused"], 1],
        layout: {
          "text-field": ["concat", ["get", "name"], "  ·  ", ["to-string", ["get", "areaKm2"]], " km²"],
          "text-size": 12,
          "text-offset": [0, 0.2],
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "rgba(18,36,95,0.9)",
          "text-halo-width": 1.6,
        },
      });

      const popup = new maplibregl.Popup({ closeButton: false, offset: 10, maxWidth: "260px" });

      m.on("mousemove", "sites-fill", (e) => {
        m.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as Record<string, string | number>;
        popup
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font:500 12px/1.45 system-ui;color:#14161a">
               <div style="font-weight:600">${escapeHtml(String(p.name))}</div>
               <div style="font-variant-numeric:tabular-nums">${p.areaKm2} km² mapped</div>
               <div style="color:#6b7280;font-size:11px;margin-top:2px">${String(p.attribution).replace(/_/g, " ")} · ${escapeHtml(String(p.osmId))}</div>
             </div>`,
          )
          .addTo(m);
      });
      m.on("mouseleave", "sites-fill", () => {
        m.getCanvas().style.cursor = "";
        popup.remove();
      });
      if (onSelect) {
        m.on("click", "sites-fill", (e) => {
          const id = e.features?.[0]?.properties?.osmId;
          if (typeof id === "string") onSelect(id);
        });
      }
    }

    // Frame the FOCUSED feature rather than every site. Codelco's sites span the
    // length of Chile, so fitting all of them puts the camera at a 300 km scale
    // where the pits are specks, technically correct and useless. The rest stay
    // on the map, one zoom-out away.
    const focused = focusOsmId
      ? featureCollection.features.find((f) => f.properties.osmId === focusOsmId)
      : undefined;
    const coords = (focused ? [focused] : featureCollection.features).flatMap(
      (f) => f.geometry.coordinates[0],
    );
    if (coords.length) {
      m.resize();
      const b = coords.reduce(
        (acc, c) => acc.extend(c as [number, number]),
        new maplibregl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number]),
      );
      m.fitBounds(b, { padding: focused ? 90 : 44, duration: 700, maxZoom: focused ? 15 : 11 });
    }
  }, [ready, featureCollection, onSelect, styleEpoch, focusOsmId]);

  return (
    <div
      className={cx(
        fullscreen
          ? "fixed inset-0 z-[120] flex flex-col gap-3 bg-[rgba(251,251,250,0.98)] p-4 backdrop-blur-sm sm:p-6"
          : "relative",
      )}
    >
      {fullscreen && (
        <div className="flex shrink-0 items-baseline justify-between gap-4">
          <div>
            <p className="t-label">Measured geometry · satellite</p>
            <p className="t-micro mt-0.5">
              {sites.filter((x) => !x.excluded).length} features · scroll to zoom · drag to pan · Esc to close
            </p>
          </div>
        </div>
      )}

      {/* The map container is rendered exactly once and only ever restyled.
          Returning a different tree for full screen would re-parent this canvas,
          and MapLibre would be rebuilt into a zero-size box. */}
      <div
        className="relative min-h-0 flex-1 overflow-hidden rounded-[12px]"
        style={fullscreen ? undefined : { height }}
      >
        {/* Positioned inline rather than by utility class. A third-party
            stylesheet already defeated `absolute` here once and silently
            collapsed this box to zero height; an inline style cannot be
            overridden by a stylesheet, so the map's geometry is guaranteed. */}
        <div
          ref={holder}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />

        {!ready && !mapError && (
          <div className="pointer-events-none absolute inset-0 bg-[var(--color-panel-sunk)] opacity-70" />
        )}

        {mapError && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-panel-sunk)] p-6">
            <div className="max-w-sm text-center">
              <p className="t-label" style={{ color: "var(--color-conflict)" }}>
                Imagery unavailable
              </p>
              <p className="t-small mt-1.5">
                The satellite layer did not load: {mapError}. The measured figures below come from the geometry
                itself and are unaffected, the map is a way to look at them, not their source.
              </p>
            </div>
          </div>
        )}

        {allowFullscreen && (
          <button
            type="button"
            onClick={() => setFullscreen((v) => !v)}
            className="absolute left-2 top-2 z-20 rounded-[7px] bg-[rgba(255,255,255,0.94)] px-2 py-1.5 text-[0.72rem] font-[520] shadow-[var(--shadow-hair)] transition-shadow hover:shadow-[var(--shadow-panel)]"
            title={fullscreen ? "Exit full screen (Esc)" : "Full screen"}
          >
            {fullscreen ? "✕ Close" : "⤢ Full screen"}
          </button>
        )}

        <div className="pointer-events-none absolute bottom-2 right-2 flex flex-col items-end gap-1">
          <Legend swatch="#19a068" label="operator attributed" />
          <Legend swatch="#c58a2a" label="proximity inferred" dashed />
          {focusOsmId && <Legend swatch="#1b4fd8" label="selected site" />}
        </div>
      </div>
    </div>
  );
}

function Legend({ swatch, label, dashed }: { swatch: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 rounded-[6px] bg-[rgba(255,255,255,0.88)] px-1.5 py-0.5 text-[0.62rem] text-[var(--color-ink-2)]">
      <span
        className="inline-block h-0 w-3.5"
        style={{ borderTop: `2px ${dashed ? "dashed" : "solid"} ${swatch}` }}
      />
      {label}
    </span>
  );
}

function closeRing(ring: [number, number][]): [number, number][] {
  if (ring.length === 0) return ring;
  const [f, l] = [ring[0], ring[ring.length - 1]];
  return f[0] === l[0] && f[1] === l[1] ? ring : [...ring, f];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
