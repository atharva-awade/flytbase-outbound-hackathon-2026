/**
 * Persistence for discoveries.
 *
 * A discovery is expensive: it opens a geocode, an Overpass query, a live
 * profile search and up to four model calls. Throwing that away on a page
 * reload is wasteful, and more to the point a reviewer should be able to come
 * back to a link and find the account still there.
 *
 * Two drivers, chosen by which credentials exist:
 *
 *   supabase   POST to the REST endpoint with the service key. Used in
 *              production. Survives cold starts, shared across instances.
 *   file       A JSON file per discovery under data/discoveries. Used in local
 *              development, where it is easier to read a saved record with an
 *              editor than to query a database.
 *
 * If neither is configured the result is returned to the caller anyway and the
 * response says plainly that it was not persisted. A silent failure to save is
 * worse than a visible one, because the reviewer finds out by losing work.
 *
 * No secret reaches the browser. Everything here runs server side only, and the
 * service key is read from the environment at call time rather than held in a
 * module constant that could be bundled.
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Contact, EmailDraft, EvidenceRow, IcpScore, OpportunitySizing, SiteGeometry } from "./types";
import type { RevenueCase } from "./revenue";

export interface DiscoveryRecord {
  id: string;
  createdAt: string;
  place: string;
  packId: string;
  operator: string;
  aliases: string[];
  country: string;
  summary: ReturnType<typeof import("./geo").summariseSites>;
  sites: SiteGeometry[];
  contacts: Contact[];
  icp: IcpScore | null;
  sizing: OpportunitySizing;
  revenue: RevenueCase;
  drafts: EmailDraft[];
  evidence: Record<string, EvidenceRow>;
}

export type StoreDriver = "supabase" | "file" | "none";

const TABLE = "discoveries";
const DIR = join(process.cwd(), "data", "discoveries");

function supabaseConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  // The service role key bypasses row level security, which is correct for a
  // server side writer and is exactly why it must never be sent to a browser.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

export function storeDriver(): StoreDriver {
  if (supabaseConfig()) return "supabase";
  // A serverless filesystem is read only apart from the temp directory, so the
  // file driver is only claimed where a write can actually land.
  if (!process.env.VERCEL) return "file";
  return "none";
}

function idFor(operator: string, place: string): string {
  const base = `${operator}-${place}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  // A short suffix from the content keeps two searches of the same operator in
  // different places from overwriting one another, without needing a clock.
  let hash = 0;
  for (const ch of `${operator}|${place}`) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `${base || "discovery"}-${hash.toString(36).slice(0, 5)}`;
}

export async function saveDiscovery(
  input: Omit<DiscoveryRecord, "id" | "createdAt">,
): Promise<{ id: string; driver: StoreDriver; persisted: boolean; reason?: string }> {
  const record: DiscoveryRecord = {
    ...input,
    id: idFor(input.operator, input.place),
    createdAt: new Date().toISOString(),
  };
  const driver = storeDriver();

  if (driver === "supabase") {
    const cfg = supabaseConfig()!;
    try {
      const res = await fetch(`${cfg.url}/rest/v1/${TABLE}`, {
        method: "POST",
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
          "Content-Type": "application/json",
          // Upsert, so re-running the same search updates rather than duplicates.
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify([
          {
            id: record.id,
            created_at: record.createdAt,
            place: record.place,
            pack_id: record.packId,
            operator: record.operator,
            country: record.country,
            area_km2: record.summary.totalAreaKm2,
            feature_count: record.summary.siteCount,
            named_contacts: record.contacts.filter((c) => c.tier !== "ROLE_TARGET_NO_NAME").length,
            icp_total: record.icp?.total ?? null,
            payload: record,
          },
        ]),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 260);
        return {
          id: record.id,
          driver,
          persisted: false,
          reason: `Supabase refused the write with HTTP ${res.status}. ${detail}`,
        };
      }
      return { id: record.id, driver, persisted: true };
    } catch (err) {
      return { id: record.id, driver, persisted: false, reason: `Supabase was unreachable: ${(err as Error).message}` };
    }
  }

  if (driver === "file") {
    try {
      await mkdir(DIR, { recursive: true });
      await writeFile(join(DIR, `${record.id}.json`), JSON.stringify(record, null, 2), "utf8");
      return { id: record.id, driver, persisted: true };
    } catch (err) {
      return { id: record.id, driver, persisted: false, reason: `The file write failed: ${(err as Error).message}` };
    }
  }

  return {
    id: record.id,
    driver,
    persisted: false,
    reason:
      "No database is configured on this deployment, and a serverless filesystem cannot be written to. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to persist discoveries.",
  };
}

export interface DiscoverySummaryRow {
  id: string;
  createdAt: string;
  place: string;
  packId: string;
  operator: string;
  country: string;
  areaKm2: number;
  featureCount: number;
  namedContacts: number;
  icpTotal: number | null;
  acceptedDraft: boolean;
}

export async function listDiscoveries(limit = 40): Promise<{ rows: DiscoverySummaryRow[]; driver: StoreDriver }> {
  const driver = storeDriver();

  if (driver === "supabase") {
    const cfg = supabaseConfig()!;
    try {
      const res = await fetch(
        `${cfg.url}/rest/v1/${TABLE}?select=id,created_at,place,pack_id,operator,country,area_km2,feature_count,named_contacts,icp_total,payload&order=created_at.desc&limit=${limit}`,
        { headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` }, cache: "no-store" },
      );
      if (!res.ok) return { rows: [], driver };
      const raw = (await res.json()) as Record<string, unknown>[];
      return {
        driver,
        rows: raw.map((r) => ({
          id: String(r.id),
          createdAt: String(r.created_at),
          place: String(r.place ?? ""),
          packId: String(r.pack_id ?? ""),
          operator: String(r.operator ?? ""),
          country: String(r.country ?? ""),
          areaKm2: Number(r.area_km2 ?? 0),
          featureCount: Number(r.feature_count ?? 0),
          namedContacts: Number(r.named_contacts ?? 0),
          icpTotal: r.icp_total === null || r.icp_total === undefined ? null : Number(r.icp_total),
          acceptedDraft: Boolean(
            (r.payload as DiscoveryRecord | undefined)?.drafts?.some((d) => d.accepted),
          ),
        })),
      };
    } catch {
      return { rows: [], driver };
    }
  }

  if (driver === "file") {
    try {
      const names = (await readdir(DIR)).filter((n) => n.endsWith(".json"));
      const rows: DiscoverySummaryRow[] = [];
      for (const name of names.slice(0, limit)) {
        const rec = JSON.parse(await readFile(join(DIR, name), "utf8")) as DiscoveryRecord;
        rows.push({
          id: rec.id,
          createdAt: rec.createdAt,
          place: rec.place,
          packId: rec.packId,
          operator: rec.operator,
          country: rec.country,
          areaKm2: rec.summary.totalAreaKm2,
          featureCount: rec.summary.siteCount,
          namedContacts: rec.contacts.filter((c) => c.tier !== "ROLE_TARGET_NO_NAME").length,
          icpTotal: rec.icp?.total ?? null,
          acceptedDraft: rec.drafts.some((d) => d.accepted),
        });
      }
      rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { rows, driver };
    } catch {
      return { rows: [], driver };
    }
  }

  return { rows: [], driver };
}

export async function loadDiscovery(id: string): Promise<DiscoveryRecord | null> {
  // Ids are generated by this module and are restricted to a safe alphabet, so a
  // caller-supplied id can never escape the directory or the query.
  if (!/^[a-z0-9-]{1,80}$/.test(id)) return null;
  const driver = storeDriver();

  if (driver === "supabase") {
    const cfg = supabaseConfig()!;
    try {
      const res = await fetch(`${cfg.url}/rest/v1/${TABLE}?select=payload&id=eq.${id}&limit=1`, {
        headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
        cache: "no-store",
      });
      if (!res.ok) return null;
      const raw = (await res.json()) as { payload?: DiscoveryRecord }[];
      return raw[0]?.payload ?? null;
    } catch {
      return null;
    }
  }

  if (driver === "file") {
    try {
      return JSON.parse(await readFile(join(DIR, `${id}.json`), "utf8")) as DiscoveryRecord;
    } catch {
      return null;
    }
  }

  return null;
}
