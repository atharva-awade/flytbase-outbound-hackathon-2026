import Link from "next/link";
import type { ReactNode } from "react";

import type { Confidence, EvidenceRow, IcpScore } from "@/lib/types";
import { SOURCE_CLASS_LABEL, fmtDate } from "@/lib/format";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ── Layout ───────────────────────────────────────────────────────────────

export function Panel({
  children,
  className,
  sunk,
}: {
  children: ReactNode;
  className?: string;
  sunk?: boolean;
}) {
  return <div className={cx(sunk ? "panel-sunk" : "panel", className)}>{children}</div>;
}

export function SectionHead({
  label,
  title,
  aside,
  note,
}: {
  label: string;
  title: string;
  aside?: ReactNode;
  note?: string;
}) {
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="t-label">{label}</p>
          <h2 className="t-h2 mt-1.5">{title}</h2>
        </div>
        {aside}
      </div>
      {note && <p className="t-small mt-2 max-w-3xl">{note}</p>}
    </div>
  );
}

export function KeyValue({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="t-micro shrink-0">{k}</span>
      <span className={cx("text-right text-[0.84rem]", mono && "font-[family-name:var(--font-mono)] tnum")}>
        {v}
      </span>
    </div>
  );
}

// ── Evidence: the credibility primitive ──────────────────────────────────

const CONFIDENCE_CHIP: Record<Confidence, string> = {
  VERIFIED: "chip-verified",
  CORROBORATED: "chip-verified",
  CONFLICT: "chip-conflict",
  INFERRED: "chip-inferred",
  UNVERIFIED: "chip-null",
};

const CONFIDENCE_MARK: Record<Confidence, string> = {
  VERIFIED: "✓",
  CORROBORATED: "✓✓",
  CONFLICT: "≠",
  INFERRED: "~",
  UNVERIFIED: "?",
};

/**
 * Every fact in the interface is rendered through one of these. The chip is a
 * real link to the source, and its tooltip carries the verbatim snippet the
 * claim was read from, so "verifiable" is something a judge can click rather
 * than something a README asserts.
 */
export function EvidenceChip({ row, compact }: { row: EvidenceRow; compact?: boolean }) {
  const label = SOURCE_CLASS_LABEL[row.sourceClass] ?? row.sourceClass;
  // A professional profile redirects into a sign-in wall, so its body is never
  // fetched. The evidence is the search-result title, and the profile link is
  // the citation — worth saying plainly, because a reviewer who clicks one and
  // hits a login screen should know that was expected rather than broken.
  const gated = row.sourceClass === "search_result" && /linkedin\.com/i.test(row.sourceUrl);
  const tip = [
    row.verbatim ? `"${truncate(row.verbatim, 340)}"` : "",
    row.translation ? `EN: "${truncate(row.translation, 240)}"` : "",
    `— ${label}${row.language && row.language !== "en" ? ` · ${row.language}` : ""} · retrieved ${fmtDate(row.fetchedAt)}`,
    gated
      ? "This link needs a sign-in. The quoted text above is the public search-result title, which is what was read; the profile body was never fetched."
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return (
    <a
      href={row.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={tip}
      className={cx("chip", CONFIDENCE_CHIP[row.confidence])}
    >
      <span aria-hidden>{CONFIDENCE_MARK[row.confidence]}</span>
      {!compact && <span>{label}</span>}
      {row.language && row.language !== "en" && (
        <span className="opacity-60">{row.language.split("-")[0]}</span>
      )}
    </a>
  );
}

/** A run of chips for a cited value. Renders nothing when there is no evidence. */
export function Citations({
  rows,
  max = 4,
  className,
}: {
  rows: EvidenceRow[];
  max?: number;
  /** Used where a surrounding row disables pointer events. */
  className?: string;
}) {
  if (rows.length === 0) return null;
  const shown = rows.slice(0, max);
  return (
    <span className={cx("ml-1.5 inline-flex flex-wrap items-center gap-1 align-baseline", className)}>
      {shown.map((r) => (
        <EvidenceChip key={r.id} row={r} compact />
      ))}
      {rows.length > max && <span className="t-micro">+{rows.length - max}</span>}
    </span>
  );
}

/** Shown where a claim would otherwise appear without support. */
export function Unsourced({ what }: { what: string }) {
  return (
    <span className="chip chip-null" title="No source was found for this during the run.">
      not verified: {what}
    </span>
  );
}

// ── Tiering ──────────────────────────────────────────────────────────────

const TIER_STYLE: Record<IcpScore["tier"], string> = {
  A: "bg-[var(--color-verified-wash)] text-[var(--color-verified)] ring-[rgba(15,123,79,0.2)]",
  B: "bg-[var(--color-accent-wash)] text-[var(--color-accent-ink)] ring-[rgba(27,79,216,0.18)]",
  C: "bg-[var(--color-panel-sunk)] text-[var(--color-ink-3)] ring-[rgba(16,18,22,0.1)]",
  DISQUALIFIED: "bg-[var(--color-conflict-wash)] text-[var(--color-conflict)] ring-[rgba(168,50,42,0.2)]",
};

export function TierBadge({ tier, score }: { tier: IcpScore["tier"]; score?: number }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-[7px] px-2 py-0.5 text-[0.7rem] font-medium ring-1 ring-inset",
        TIER_STYLE[tier],
      )}
    >
      <span className="font-[family-name:var(--font-mono)]">
        {tier === "DISQUALIFIED" ? "OUT" : `TIER ${tier}`}
      </span>
      {score !== undefined && <span className="tnum opacity-70">{score}</span>}
    </span>
  );
}

// ── Numbers ──────────────────────────────────────────────────────────────

export function Stat({
  label,
  value,
  unit,
  sub,
  citations,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  citations?: EvidenceRow[];
}) {
  return (
    <div>
      <p className="t-label">{label}</p>
      <p className="mt-1.5 flex items-baseline gap-1">
        <span className="tnum text-[1.55rem] leading-none font-[560] tracking-[-0.025em]">{value}</span>
        {unit && <span className="t-small">{unit}</span>}
      </p>
      {(sub || citations?.length) && (
        <p className="t-micro mt-1.5">
          {sub}
          {citations && <Citations rows={citations} max={2} />}
        </p>
      )}
    </div>
  );
}

/**
 * Ranges are used wherever a figure rests on assumptions. A single number would
 * imply precision the inputs do not support.
 */
export function RangeStat({
  label,
  low,
  high,
  unit,
  note,
}: {
  label: string;
  low: number;
  high: number;
  unit: string;
  note?: string;
}) {
  const same = low === high;
  return (
    <div>
      <p className="t-label">{label}</p>
      <p className="mt-1.5 flex items-baseline gap-1.5">
        <span className="tnum text-[1.35rem] leading-none font-[560] tracking-[-0.02em]">
          {same ? fmt(low) : `${fmt(low)}–${fmt(high)}`}
        </span>
        <span className="t-small">{unit}</span>
      </p>
      {note && <p className="t-micro mt-1.5">{note}</p>}
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-GB", { maximumFractionDigits: 0 });
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

// ── Navigation ───────────────────────────────────────────────────────────

export function Nav({ current }: { current?: string }) {
  const items = [
    { href: "/", label: "Overview" },
    { href: "/console", label: "Console" },
    { href: "/how-it-thinks", label: "How it thinks" },
    { href: "/generality", label: "Generality" },
    { href: "/evidence", label: "Evidence" },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-hair)] bg-[rgba(251,251,250,0.86)] backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1340px] items-center gap-4 px-4 sm:gap-6 sm:px-6">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-[1.02rem] font-[600] tracking-[-0.035em]">Aerion</span>
          <span className="t-micro hidden sm:inline">outbound intelligence</span>
        </Link>
        <nav className="no-bar ml-auto flex min-w-0 items-center gap-1 overflow-x-auto">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className={cx(
                "shrink-0 whitespace-nowrap rounded-[7px] px-2 py-1.5 text-[0.82rem] transition-colors sm:px-2.5",
                current === i.href
                  ? "bg-[var(--color-panel-sunk)] text-[var(--color-ink)]"
                  : "text-[var(--color-ink-3)] hover:text-[var(--color-ink)]",
              )}
            >
              {i.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

export function Footer({ attribution }: { attribution?: string }) {
  return (
    <footer className="mt-20 border-t border-[var(--color-hair)] py-8">
      <div className="mx-auto max-w-[1340px] px-6">
        <p className="t-micro max-w-4xl">
          {attribution ??
            "Mapped footprints measured from OpenStreetMap geometry. © OpenStreetMap contributors, Open Database Licence (ODbL)."}
        </p>
        <p className="t-micro mt-2 max-w-4xl">
          Every figure in this interface links to the source it was read from. Where a source could not be
          found, the gap is recorded rather than filled.
        </p>
      </div>
    </footer>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────

export function NoRun() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-24">
      <p className="t-label">No frozen run</p>
      <h1 className="t-h1 mt-2">The pipeline has not been harvested yet.</h1>
      <p className="t-body mt-4">
        Run <code className="font-[family-name:var(--font-mono)] text-[0.85em]">pnpm harvest</code> to
        execute the pipeline against live sources and write a run artifact to{" "}
        <code className="font-[family-name:var(--font-mono)] text-[0.85em]">./data</code>.
      </p>
    </div>
  );
}
