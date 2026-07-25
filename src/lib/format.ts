/**
 * Client-safe labels and formatters.
 *
 * Kept separate from the run loader because that module touches the filesystem,
 * and anything a client component imports must not drag `node:fs` into the
 * browser bundle.
 */

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
  if (!iso) return "not recorded";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(iso: string | undefined): string {
  if (!iso) return "not recorded";
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
