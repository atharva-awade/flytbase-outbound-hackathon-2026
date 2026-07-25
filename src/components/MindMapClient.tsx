"use client";

import dynamic from "next/dynamic";

import type { TraceEvent } from "@/lib/types";

const MindMap = dynamic(() => import("./MindMap"), {
  ssr: false,
  loading: () => <div className="shimmer h-96 rounded-[12px] bg-[var(--color-panel-sunk)]" />,
});

export default function MindMapClient(props: {
  trace: TraceEvent[];
  counts: { evidence: number; nulls: number; accounts: number; sites: number };
}) {
  return <MindMap {...props} />;
}
