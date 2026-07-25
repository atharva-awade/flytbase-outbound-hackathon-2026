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

/** Short, human label for a source class, used on chips. */
export const SOURCE_CLASS_LABEL: Record<string, string> = {
  primary_filing: "SEC filing",
  statutory_disclosure: "Statutory disclosure",
  regulator: "Regulator",
  company_primary: "Company source",
  geospatial: "Measured geometry",
  conference_roster: "Conference roster",
  academic: "Academic record",
  trade_press: "Trade press",
  search_result: "Search result",
  aggregator: "Aggregator",
};

export const ATTRIBUTION_LABEL: Record<string, string> = {
  osm_operator_tag: "operator tag",
  osm_name_match: "name match",
  proximity_cluster: "proximity inferred",
  company_reported: "company reported",
  unattributed: "unattributed",
};

export const ASSET_CLASS_LABEL: Record<string, string> = {
  open_pit: "Open pit",
  solution_mine: "Solution / brine operation",
  brine_pond: "Evaporation pond",
  tailings: "Tailings basin",
  process_plant: "Process plant",
  pv_plant: "PV plant",
  pv_array: "PV array",
  processing_works: "Processing works",
  oilfield_facility: "Oilfield facility",
  offshore_platform: "Offshore platform",
  harbour: "Harbour",
  port_terminal: "Port terminal",
  rail_yard: "Rail yard",
  substation: "Substation",
};

export const BUYING_ROLE_LABEL: Record<string, string> = {
  champion: "Champion",
  economic_buyer: "Economic buyer",
  technical_buyer: "Technical buyer",
  risk_validator: "Risk validator",
  influencer: "Influencer",
};

export function fmtKm2(n: number): string {
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

export function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}, ${d
    .toISOString()
    .slice(11, 16)} UTC`;
}

export function daysAgo(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}
