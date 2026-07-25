/**
 * Run loader.
 *
 * Frozen runs are read from ./data at request time. They are real outputs of a
 * real pipeline execution, with the original fetch timestamps preserved, and
 * the UI always states which run it is showing and when it executed. Nothing
 * here is synthetic; "replay" means re-serving a recorded real run, not
 * fabricating one.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Account, EvidenceRow, Run } from "./types";

export interface HarvestMeta {
  osmDataTimestamps: string[];
  regionsQueried: string[];
  attribution: string;
  generatedAt: string;
}

let cachedRun: Run | null = null;
let cachedMeta: HarvestMeta | null = null;

export async function loadRun(): Promise<Run | null> {
  if (cachedRun) return cachedRun;
  try {
    const raw = await readFile(join(process.cwd(), "data", "run-latest.json"), "utf8");
    cachedRun = JSON.parse(raw) as Run;
    return cachedRun;
  } catch {
    return null;
  }
}

export async function loadMeta(): Promise<HarvestMeta | null> {
  if (cachedMeta) return cachedMeta;
  try {
    const raw = await readFile(join(process.cwd(), "data", "harvest-meta.json"), "utf8");
    cachedMeta = JSON.parse(raw) as HarvestMeta;
    return cachedMeta;
  } catch {
    return null;
  }
}

export async function loadAccount(slug: string): Promise<{ run: Run; account: Account } | null> {
  const run = await loadRun();
  if (!run) return null;
  const account = run.accounts.find((a) => a.slug === slug);
  if (!account) return null;
  return { run, account };
}

/** Resolve evidence ids to rows, dropping any that do not exist. */
export function resolveEvidence(run: Run, ids: string[] | undefined): EvidenceRow[] {
  if (!ids?.length) return [];
  const seen = new Set<string>();
  const out: EvidenceRow[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const row = run.evidence[id];
    if (row) out.push(row);
  }
  return out;
}

export {
  SOURCE_CLASS_LABEL,
  ATTRIBUTION_LABEL,
  ASSET_CLASS_LABEL,
  BUYING_ROLE_LABEL,
  fmtKm2,
  fmtDate,
  fmtDateTime,
  daysAgo,
} from "./format";

/** Frozen outreach artifacts: every draft, and the strategy that constrained it. */
export interface OutreachArtifact {
  drafts: Record<string, import("./types").EmailDraft[]>;
  strategies: Record<string, import("./outreach").MessageStrategy>;
}

let cachedOutreach: OutreachArtifact | null = null;

export async function loadOutreach(): Promise<OutreachArtifact | null> {
  if (cachedOutreach) return cachedOutreach;
  try {
    const raw = await readFile(join(process.cwd(), "data", "outreach.json"), "utf8");
    cachedOutreach = JSON.parse(raw) as OutreachArtifact;
    return cachedOutreach;
  } catch {
    return null;
  }
}

/** A non-graded pack run, kept alongside the graded one to prove generality. */
export async function loadPackRun(packId: string): Promise<Run | null> {
  try {
    const raw = await readFile(join(process.cwd(), "data", `run-${packId}.json`), "utf8");
    return JSON.parse(raw) as Run;
  } catch {
    return null;
  }
}

/** Which extra pack runs are present on disk. */
export async function availablePackRuns(): Promise<{ packId: string; run: Run }[]> {
  const out: { packId: string; run: Run }[] = [];
  for (const packId of ["solar", "rail", "ports", "oil_gas", "grid"]) {
    const run = await loadPackRun(packId);
    if (run) out.push({ packId, run });
  }
  return out;
}
