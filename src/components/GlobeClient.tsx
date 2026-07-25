"use client";

import dynamic from "next/dynamic";

import type { GlobeMarker } from "./Globe";

const Globe = dynamic(() => import("./Globe"), {
  ssr: false,
  loading: () => (
    <div
      className="rounded-full bg-[var(--color-panel-sunk)] shimmer"
      style={{ width: "100%", maxWidth: 620, aspectRatio: "1" }}
    />
  ),
});

export default function GlobeClient({
  markers,
  size,
  className,
}: {
  markers: GlobeMarker[];
  size?: number;
  className?: string;
}) {
  return <Globe markers={markers} size={size} className={className} />;
}
