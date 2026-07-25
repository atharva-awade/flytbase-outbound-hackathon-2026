"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import type { GlobeSite } from "./LiveGlobe";
import type { SiteGeometry } from "@/lib/types";
import { ASSET_CLASS_LABEL, ATTRIBUTION_LABEL, fmtKm2 } from "@/lib/format";
import { cx } from "./ui";

const LiveGlobe = dynamic(() => import("./LiveGlobe"), {
  ssr: false,
  loading: () => (
    <div
      className="shimmer mx-auto rounded-full bg-[var(--color-panel-sunk)]"
      style={{ width: "100%", maxWidth: 560, aspectRatio: "1" }}
    />
  ),
});

const SiteMap = dynamic(() => import("./SiteMap"), {
  ssr: false,
  loading: () => <div className="shimmer h-full w-full rounded-[12px] bg-[var(--color-panel-sunk)]" />,
});

export interface ExplorerSite extends GlobeSite {
  /** Full geometry, so the detail view can draw the real polygon. */
  geometry: SiteGeometry;
  /** Sibling sites at the same account, for spatial context in the detail map. */
  siblings: SiteGeometry[];
  osmUrl: string;
  contactName?: string;
  contactTitle?: string;
}

/**
 * The globe, and what happens when you click it.
 *
 * The globe alone is decoration; the value is that every dot is a real measured
 * site and clicking one opens that site's satellite view, its measured figures,
 * the operator it belongs to and whoever runs it. So the sequence a viewer
 * follows is the same sequence the pipeline followed: world, then operation,
 * then the person accountable for it.
 */
export default function GlobeExplorer({
  sites,
  maptilerKey,
}: {
  sites: ExplorerSite[];
  maptilerKey?: string;
}) {
  const [selected, setSelected] = useState<ExplorerSite | null>(null);

  const globeSites: GlobeSite[] = useMemo(
    () =>
      sites.map((s) => ({
        osmId: s.osmId,
        name: s.name,
        accountSlug: s.accountSlug,
        accountName: s.accountName,
        countryName: s.countryName,
        lat: s.lat,
        lon: s.lon,
        areaKm2: s.areaKm2,
        perimeterKm: s.perimeterKm,
        assetClass: s.assetClass,
        attributionMethod: s.attributionMethod,
        tier: s.tier,
        weight: s.weight,
        signalHeadline: s.signalHeadline,
        signalUrgency: s.signalUrgency,
      })),
    [sites],
  );

  const onSelect = useCallback(
    (g: GlobeSite) => {
      setSelected(sites.find((s) => s.osmId === g.osmId) ?? null);
    },
    [sites],
  );

  return (
    <>
      <LiveGlobe sites={globeSites} onSelect={onSelect} size={560} />

      {selected && (
        <SiteDetail site={selected} maptilerKey={maptilerKey} onClose={() => setSelected(null)} />
      )}
    </>
  );
}

function SiteDetail({
  site,
  maptilerKey,
  onClose,
}: {
  site: ExplorerSite;
  maptilerKey?: string;
  onClose: () => void;
}) {
  // The selected feature plus its siblings, so the detail map shows the
  // operation in context rather than one polygon floating in the desert.
  const mapSites = useMemo(() => {
    const others = site.siblings.filter((s) => s.osmId !== site.osmId).slice(0, 40);
    return [site.geometry, ...others];
  }, [site]);

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-[rgba(20,22,26,0.28)] p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${site.name} detail`}
    >
      <div
        className="max-h-[92vh] w-full max-w-[1080px] overflow-y-auto rounded-t-[16px] bg-[var(--color-paper)] shadow-[var(--shadow-lift)] sm:rounded-[16px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--color-hair)] bg-[rgba(251,251,250,0.95)] px-5 py-4 backdrop-blur-md">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip chip-accent">{ASSET_CLASS_LABEL[site.assetClass] ?? site.assetClass}</span>
              <span
                className={cx(
                  "chip",
                  site.attributionMethod === "proximity_cluster" ? "chip-inferred" : "chip-verified",
                )}
              >
                {ATTRIBUTION_LABEL[site.attributionMethod] ?? site.attributionMethod}
              </span>
              <span className="t-micro">{site.countryName}</span>
            </div>
            <h2 className="t-h2 mt-1.5 truncate">{site.name}</h2>
            <p className="t-micro mt-0.5">
              operated by <span className="font-[560] text-[var(--color-ink-2)]">{site.accountName}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-[7px] bg-[var(--color-panel-sunk)] px-2.5 py-1.5 text-[0.78rem] font-[520] transition-shadow hover:shadow-[var(--shadow-hair)]"
          >
            ✕ Close
          </button>
        </div>

        <div className="px-5 py-5">
          {/* Measured figures */}
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Figure label="Mapped footprint" value={fmtKm2(site.areaKm2)} unit="km²" />
            <Figure label="Boundary" value={site.perimeterKm.toFixed(1)} unit="km" />
            <Figure
              label="Coordinates"
              value={`${site.lat.toFixed(4)}, ${site.lon.toFixed(4)}`}
              small
            />
            <Figure label="Feature" value={site.osmId} small />
          </div>

          {/* Satellite */}
          <div className="mt-5 overflow-hidden rounded-[12px] shadow-[var(--shadow-panel)]">
            <SiteMap
              sites={mapSites}
              focusOsmId={site.osmId}
              height={400}
              maptilerKey={maptilerKey}
              allowFullscreen
            />
          </div>
          <p className="t-micro mt-2">
            The highlighted outline is the feature measured for this figure. Other outlines are the rest of
            this operator&apos;s mapped footprint, shown for context. Measured from OpenStreetMap geometry,
            © OpenStreetMap contributors under the Open Database Licence.
          </p>

          {/* Signal */}
          {site.signalHeadline && (
            <div className="mt-5 rounded-[12px] bg-[var(--color-accent-wash)] p-4 ring-1 ring-inset ring-[rgba(27,79,216,0.14)]">
              <div className="flex items-center justify-between gap-3">
                <p className="t-label" style={{ color: "var(--color-accent-ink)" }}>
                  Why this site is live right now
                </p>
                {site.signalUrgency !== undefined && (
                  <div className="flex items-center gap-2">
                    <span className="t-micro" style={{ color: "var(--color-accent-ink)" }}>
                      urgency
                    </span>
                    <div className="h-[4px] w-16 overflow-hidden rounded-full bg-[rgba(27,79,216,0.16)]">
                      <div
                        className="h-full rounded-full bg-[var(--color-accent)]"
                        style={{ width: `${site.signalUrgency * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
              <p className="mt-1.5 text-[0.9rem]" style={{ color: "var(--color-accent-ink)" }}>
                {site.signalHeadline}
              </p>
            </div>
          )}

          {/* Who runs it */}
          {site.contactName && (
            <div className="mt-4 rounded-[12px] bg-[var(--color-panel)] p-4 shadow-[var(--shadow-hair)]">
              <p className="t-label">Who is accountable for this ground</p>
              <p className="mt-1.5 text-[0.95rem] font-[600]">{site.contactName}</p>
              {site.contactTitle && <p className="t-small mt-0.5 italic">{site.contactTitle}</p>}
              <p className="t-micro mt-2">
                A named leader beside the measured extent of what they run. One half comes from a published
                disclosure, the other from geometry — which is why this pairing cannot be produced by a
                prompt.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="mt-5 flex flex-wrap gap-2 border-t border-[var(--color-hair)] pt-4">
            <Link
              href={`/console/account/${site.accountSlug}`}
              className="rounded-[8px] bg-[var(--color-ink)] px-3 py-2 text-[0.84rem] font-[520] text-white transition-opacity hover:opacity-88"
            >
              Open the full account brief
            </Link>
            <a
              href={site.osmUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-[8px] bg-[var(--color-panel-sunk)] px-3 py-2 text-[0.84rem] font-[520] transition-shadow hover:shadow-[var(--shadow-hair)]"
            >
              Verify this feature on OpenStreetMap
            </a>
            <a
              href={`https://www.google.com/maps/@${site.lat},${site.lon},14z/data=!3m1!1e3`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-[8px] bg-[var(--color-panel-sunk)] px-3 py-2 text-[0.84rem] font-[520] transition-shadow hover:shadow-[var(--shadow-hair)]"
            >
              Second opinion on the imagery
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  unit,
  small,
}: {
  label: string;
  value: string;
  unit?: string;
  small?: boolean;
}) {
  return (
    <div>
      <p className="t-label">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span
          className={cx(
            "tnum font-[560] leading-none tracking-[-0.02em]",
            small ? "font-[family-name:var(--font-mono)] text-[0.86rem]" : "text-[1.45rem]",
          )}
        >
          {value}
        </span>
        {unit && <span className="t-small">{unit}</span>}
      </p>
    </div>
  );
}
