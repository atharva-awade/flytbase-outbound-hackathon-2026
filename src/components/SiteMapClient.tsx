"use client";

import dynamic from "next/dynamic";

import type { SiteMapProps } from "./SiteMap";

/**
 * MapLibre touches `window` at import time, so the map is loaded only in the
 * browser. Without this the server render crashes rather than degrading.
 */
const SiteMap = dynamic(() => import("./SiteMap"), {
  ssr: false,
  loading: () => <div className="shimmer h-full w-full rounded-[12px] bg-[var(--color-panel-sunk)]" />,
});

export default function SiteMapClient(props: SiteMapProps) {
  return <SiteMap {...props} />;
}
