/**
 * Cross-Verification Officer.
 *
 * Two jobs, both about what happens when sources are compared rather than read
 * in isolation.
 *
 * The first is corroboration. A person named on two independent pages is a
 * stronger claim than the same person named once, so agreement is detected and
 * recorded rather than assumed. Codelco publishes its officers on both a
 * statutory roster and a divisional-management page, which means the same
 * individual can be confirmed twice from disclosures the company is legally
 * obliged to keep consistent.
 *
 * The second is conflict. Where a figure we measured disagrees with a figure
 * someone else published, the disagreement is surfaced with a stated trust order
 * rather than quietly resolved in favour of whichever number flatters the pitch.
 * A reconciled conflict is more persuasive than a clean number, because it shows
 * the numbers were actually looked at.
 */

import type { Account, Contact, EvidenceRow, SourceClass } from "./types";
import { SOURCE_CLASS_TRUST } from "./types";
import { round } from "./icp";

export interface Corroboration {
  subject: string;
  claim: string;
  /** Independent sources that agree, best-trusted first. */
  agreeing: { sourceUrl: string; sourceClass: SourceClass; verbatim: string }[];
  strength: "single" | "corroborated";
  note: string;
}

export interface Conflict {
  subject: string;
  question: string;
  positions: {
    value: string;
    sourceUrl: string;
    sourceClass: SourceClass;
    label: string;
  }[];
  /** Which position the system uses, and why. */
  resolution: string;
  /** Whether the two figures are genuinely incompatible or measure different things. */
  kind: "different_scope" | "genuine_disagreement" | "stale_source";
}

export interface CrossVerification {
  corroborations: Corroboration[];
  conflicts: Conflict[];
  /** Counts for the headline. */
  stats: { corroborated: number; singleSourced: number; conflicts: number };
}

function trustRank(cls: SourceClass): number {
  const i = SOURCE_CLASS_TRUST.indexOf(cls);
  return i === -1 ? 99 : i;
}

/**
 * Published figures we can hold our own measurements against. These are real
 * public claims with sources, kept deliberately small, an unsourced comparison
 * figure would defeat the purpose of the exercise.
 */
const PUBLISHED_FIGURES: {
  accountKey: string;
  question: string;
  label: string;
  value: string;
  sourceUrl: string;
  sourceClass: SourceClass;
  /** Why this may legitimately differ from what we measured. */
  scopeNote: string;
}[] = [
  {
    accountKey: "sqm",
    question: "How large is the operation being inspected?",
    label: "FlytBase published case study",
    value: "678 km²",
    sourceUrl:
      "https://www.flytbase.com/case-studies/sqm-678-km2-mine-autonomous-inspection-adentu-and-flytbase",
    sourceClass: "company_primary",
    scopeNote:
      "The published figure describes the operation covered by that specific deployment, which is the iodine and nitrate side of the business. Our measurement covers every SQM feature mapped across the sampled regions, including the lithium brine operation at Salar de Atacama. The two are measuring different things, so neither is wrong.",
  },
];

export function crossVerify(args: {
  account: Account;
  evidence: Record<string, EvidenceRow>;
}): CrossVerification {
  const { account, evidence } = args;
  const corroborations: Corroboration[] = [];
  const conflicts: Conflict[] = [];

  // ── Corroboration: the same person named by more than one source ──────
  const byPerson = new Map<string, { contact: Contact; rows: EvidenceRow[] }>();
  for (const c of account.contacts) {
    if (!c.name) continue;
    const key = c.name.toLowerCase().replace(/\s+/g, " ").trim();
    const rows = c.evidenceIds.map((id) => evidence[id]).filter(Boolean);
    const existing = byPerson.get(key);
    if (existing) {
      existing.rows.push(...rows);
    } else {
      byPerson.set(key, { contact: c, rows: [...rows] });
    }
  }

  for (const { contact, rows } of byPerson.values()) {
    // Distinct sources only. The same page cited twice is one source.
    const distinct = new Map<string, EvidenceRow>();
    for (const r of rows) if (!distinct.has(r.sourceUrl)) distinct.set(r.sourceUrl, r);
    const sources = [...distinct.values()].sort(
      (a, b) => trustRank(a.sourceClass) - trustRank(b.sourceClass),
    );
    if (sources.length === 0) continue;

    const corroborated = sources.length >= 2;
    corroborations.push({
      subject: contact.name!,
      claim: `holds the role "${contact.titleVerbatim ?? contact.targetRole}"`,
      agreeing: sources.map((s) => ({
        sourceUrl: s.sourceUrl,
        sourceClass: s.sourceClass,
        verbatim: s.verbatim,
      })),
      strength: corroborated ? "corroborated" : "single",
      note: corroborated
        ? `Named on ${sources.length} independent sources, the strongest being a ${sources[0].sourceClass.replace(/_/g, " ")}. Where a company is legally obliged to keep two disclosures consistent, agreement between them is meaningful rather than coincidental.`
        : `Named on one source only, a ${sources[0].sourceClass.replace(/_/g, " ")}. Sufficient to target, but confirm on a second source before the name goes into a CRM.`,
    });
  }

  // ── Conflict: our measurement against a published figure ──────────────
  const published = PUBLISHED_FIGURES.filter((p) => p.accountKey === account.slug);
  const measuredArea = round(
    account.sites.filter((s) => !s.excluded).reduce((a, s) => a + s.areaKm2, 0),
    1,
  );
  const largest = [...account.sites].sort((a, b) => b.areaKm2 - a.areaKm2)[0];

  for (const p of published) {
    if (measuredArea <= 0) continue;
    conflicts.push({
      subject: account.displayName,
      question: p.question,
      positions: [
        {
          value: p.value,
          sourceUrl: p.sourceUrl,
          sourceClass: p.sourceClass,
          label: p.label,
        },
        {
          value: `${measuredArea} km² across ${account.sites.filter((s) => !s.excluded).length} mapped features`,
          sourceUrl: largest ? `https://www.openstreetmap.org/${largest.osmId}` : "https://www.openstreetmap.org",
          sourceClass: "geospatial",
          label: "Measured here from mapped geometry",
        },
      ],
      resolution: `${p.scopeNote} Both figures are shown because presenting only one would imply a precision neither supports. In a conversation, cite the published figure when referring to the reference deployment and the measured figure when sizing this account's own ground.`,
      kind: "different_scope",
    });
  }

  // ── Conflict: attribution strength within our own measurement ─────────
  const clustered = account.sites.filter(
    (s) => !s.excluded && s.attributionMethod === "proximity_cluster",
  );
  const tagged = account.sites.filter(
    (s) => !s.excluded && s.attributionMethod !== "proximity_cluster",
  );
  if (clustered.length > 0 && tagged.length > 0) {
    const taggedArea = round(tagged.reduce((a, s) => a + s.areaKm2, 0), 1);
    conflicts.push({
      subject: account.displayName,
      question: "How much of the measured footprint is firmly attributable to this operator?",
      positions: [
        {
          value: `${taggedArea} km² across ${tagged.length} features`,
          sourceUrl: tagged[0] ? `https://www.openstreetmap.org/${tagged[0].osmId}` : "https://www.openstreetmap.org",
          sourceClass: "geospatial",
          label: "Carries an explicit operator or name match",
        },
        {
          value: `${measuredArea} km² across ${tagged.length + clustered.length} features`,
          sourceUrl: clustered[0]
            ? `https://www.openstreetmap.org/${clustered[0].osmId}`
            : "https://www.openstreetmap.org",
          sourceClass: "geospatial",
          label: "Including adjacent untagged features attributed by proximity",
        },
      ],
      resolution:
        "The smaller figure is the defensible one and is what should be quoted in a first conversation. The larger figure is shown because the adjacent features are almost certainly part of the same operation, but proximity is an inference and is labelled as one, on the map those outlines are drawn dashed.",
      kind: "different_scope",
    });
  }

  const corroborated = corroborations.filter((c) => c.strength === "corroborated").length;
  return {
    corroborations: corroborations.sort((a, b) => (a.strength === "corroborated" ? -1 : 1)),
    conflicts,
    stats: {
      corroborated,
      singleSourced: corroborations.length - corroborated,
      conflicts: conflicts.length,
    },
  };
}
