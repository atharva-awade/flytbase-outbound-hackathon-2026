import { NextResponse } from "next/server";

import { loadAccount, loadOutreach } from "@/lib/run";
import { osmUrl } from "@/lib/geo";

export const dynamic = "force-dynamic";

/**
 * CRM-shaped exports.
 *
 * The important behaviour is what is NOT exported: an address that was only
 * inferred leaves the email column empty and records the inference in a separate
 * field. A guessed address that survives into a CRM becomes a real send later,
 * by someone who never saw the warning, so the guard belongs here rather than in
 * a footnote.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const found = await loadAccount(slug);
  if (!found) return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  const { run, account } = found;

  const format = new URL(req.url).searchParams.get("format") ?? "contacts";
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "json") {
    const outreach = await loadOutreach();
    const contactIds = new Set(account.contacts.map((c) => c.id));
    const drafts = Object.fromEntries(
      Object.entries(outreach?.drafts ?? {}).filter(([k]) => contactIds.has(k)),
    );
    const evidenceIds = new Set<string>();
    const collect = (ids?: string[]) => ids?.forEach((i) => evidenceIds.add(i));
    account.sites.forEach((s) => collect(s.evidenceIds));
    account.contacts.forEach((c) => collect(c.evidenceIds));
    account.signals.forEach((s) => collect(s.evidenceIds));
    collect(account.anchorComparison.evidenceIds);
    account.riskScan?.passages.forEach((p) => evidenceIds.add(p.evidenceId));

    return new NextResponse(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          runId: run.id,
          runExecutedAt: run.startedAt,
          brief: run.brief,
          account,
          cadence: run.cadences[account.id] ?? [],
          drafts,
          // Only the evidence this account actually relies on.
          evidence: Object.fromEntries(
            [...evidenceIds].filter((id) => run.evidence[id]).map((id) => [id, run.evidence[id]]),
          ),
          nullResults: run.nullResults.filter((n) => n.subject === account.displayName),
        },
        null,
        2,
      ),
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="aerion-${slug}-${stamp}.json"`,
        },
      },
    );
  }

  if (format === "sites") {
    const rows = [
      [
        "osm_id",
        "osm_url",
        "name",
        "asset_class",
        "area_km2",
        "perimeter_km",
        "latitude",
        "longitude",
        "attribution_method",
        "excluded",
        "exclusion_reason",
        "operator_tag",
      ],
      ...[...account.sites]
        .sort((a, b) => b.areaKm2 - a.areaKm2)
        .map((s) => [
          s.osmId,
          osmUrl(s.osmId),
          s.name ?? "",
          s.assetClass,
          s.areaKm2.toFixed(4),
          s.perimeterKm.toFixed(3),
          s.centroid.lat.toFixed(6),
          s.centroid.lon.toFixed(6),
          s.attributionMethod,
          s.excluded ? "yes" : "no",
          s.exclusionReason ?? "",
          s.operatorTag ?? "",
        ]),
    ];
    return csv(rows, `aerion-${slug}-sites-${stamp}.csv`);
  }

  // Default: contacts, with standard import headers.
  const outreach = await loadOutreach();
  const rows: string[][] = [
    [
      "First Name",
      "Last Name",
      "Email",
      "Company Name",
      "Job Title",
      "Job Title English",
      "Country/Region",
      "Website URL",
      "LinkedIn URL",
      "Buying Role",
      "Seniority",
      "Owns Site",
      "Owns Site Area Km2",
      "provenance",
      "email_status",
      "source_url",
      "aerion_tier",
      "aerion_score",
      "accepted_subject",
      "accepted_body",
      "run_id",
    ],
  ];

  for (const c of account.contacts) {
    const draft = (outreach?.drafts[c.id] ?? []).find((d) => d.accepted);
    const site = c.siteOsmId ? account.sites.find((s) => s.osmId === c.siteOsmId) : undefined;
    const evidence = c.evidenceIds.map((id) => run.evidence[id]).filter(Boolean);
    const [first, ...rest] = (c.name ?? "").split(" ");

    // An inferred address is never written into the Email column.
    const sendable = c.email && c.email.status === "OBSERVED" ? c.email.address : "";
    const emailStatus = c.email
      ? c.email.status === "OBSERVED"
        ? "observed"
        : "inferred, excluded from Email column, do not send"
      : "not sourced";

    rows.push([
      first ?? "",
      rest.join(" "),
      sendable,
      account.legalName,
      c.titleVerbatim ?? c.targetRole,
      c.titleEnglish ?? "",
      account.countryName,
      account.domain ? `https://${account.domain}` : "",
      c.linkedinUrl ?? "",
      c.buyingRole,
      c.seniority,
      site?.name ?? site?.osmId ?? "",
      site ? site.areaKm2.toFixed(3) : "",
      c.tier,
      emailStatus,
      evidence[0]?.sourceUrl ?? "",
      account.icp.tier,
      String(account.icp.total),
      draft?.subject ?? "",
      draft?.body ?? "",
      run.id,
    ]);
  }

  return csv(rows, `aerion-${slug}-contacts-${stamp}.csv`);
}

function csv(rows: string[][], filename: string): NextResponse {
  const body = rows.map((r) => r.map(escapeCell).join(",")).join("\r\n");
  // BOM so Excel opens UTF-8 accented names correctly rather than as mojibake.
  return new NextResponse(`﻿${body}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function escapeCell(v: string): string {
  const s = (v ?? "").replace(/\r?\n/g, " ").trim();
  // Guard against spreadsheet formula injection from scraped text.
  const safe = /^[=+\-@\t]/.test(s) ? `'${s}` : s;
  return /[",]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
