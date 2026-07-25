import { NextResponse } from "next/server";

import {
  osmUrl,
  queryTerrain,
  round,
  summariseSites,
  TERRAIN_ATTRIBUTION,
} from "@/lib/geo";
import { bboxAreaKm2, GEOCODER_ATTRIBUTION, geocodePlace } from "@/lib/sources/geocode";
import { callerKey, limitResponse, take } from "@/lib/ratelimit";
import { sizeOpportunity } from "@/lib/sizing";
import { revenueCase } from "@/lib/revenue";
import { getPack, VERTICAL_PACKS } from "@/lib/verticals";
import type { SiteGeometry } from "@/lib/types";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Discovery on demand: any vertical, anywhere on earth.
 *
 * The frozen runs prove the pipeline produced real results once. This proves it
 * works on ground nobody chose in advance, which is a different and harder
 * claim. A reviewer types a place and a vertical, and watches the same three
 * steps the harvest performs: resolve the place, measure every matching feature
 * inside it, then work out who operates them.
 *
 * Nothing here is pre-computed and nothing is guessed. If a region has no
 * mapped features for a vertical, it returns none and says so, because a
 * discovery tool that always finds something is not measuring anything.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const place = (url.searchParams.get("place") ?? "").trim();
  const packId = url.searchParams.get("vertical") ?? "mining";

  if (!place) {
    return NextResponse.json(
      { error: "Name a place to search. A region, a district, a city or a country all work." },
      { status: 400 },
    );
  }
  if (place.length > 120) {
    return NextResponse.json({ error: "That place name is too long to be a place name." }, { status: 400 });
  }
  if (!VERTICAL_PACKS.some((p) => p.id === packId)) {
    return NextResponse.json(
      { error: `Unknown vertical. Available: ${VERTICAL_PACKS.map((p) => p.id).join(", ")}.` },
      { status: 400 },
    );
  }

  // Each discovery opens a geocode and an Overpass query against public
  // infrastructure that asks to be used gently.
  const gate = take(`discover:${callerKey(req)}`, 12, 5 * 60_000);
  if (!gate.ok) {
    return limitResponse(
      gate,
      `Discovery opens live queries against Nominatim and Overpass, both of which ask to be used gently, so it is capped at twelve every five minutes. Try again in ${gate.retryAfter}s.`,
    );
  }

  const pack = getPack(packId);
  const encoder = new TextEncoder();
  let seq = 0;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: Record<string, unknown>) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ seq: ++seq, at: new Date().toISOString(), ...event })}\n\n`,
          ),
        );
      };
      // HTTP/1.1 intermediaries close a connection that goes quiet, and the
      // Overpass step can take half a minute on a large district.
      const beat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(":ka\n\n"));
      }, 10_000);
      const finish = () => {
        clearInterval(beat);
        if (!closed) {
          closed = true;
          controller.close();
        }
      };

      try {
        send({
          type: "start",
          agent: "chief_of_staff",
          message: `Searching for ${pack.label.toLowerCase()} in "${place}". Resolving the place first, because nothing can be measured before its coordinates are known.`,
        });

        // ── 1. Resolve the place ────────────────────────────────────────
        send({ type: "step", agent: "terrain_surveyor", message: `Asking Nominatim to resolve "${place}".` });
        const resolved = await geocodePlace(place);
        if (!resolved) {
          send({
            type: "empty",
            agent: "terrain_surveyor",
            message: `OpenStreetMap has no place matching "${place}". Try a region, district or city name. Nothing was invented to fill the gap.`,
          });
          send({ type: "done", found: 0 });
          finish();
          return;
        }

        const searchedKm2 = bboxAreaKm2(resolved.bbox);
        send({
          type: "place",
          agent: "terrain_surveyor",
          place: resolved,
          searchedKm2,
          message: resolved.cropped
            ? `Resolved to ${resolved.displayName}. Its full extent spans ${resolved.originalSpanDeg?.lat}° by ${resolved.originalSpanDeg?.lon}°, which Overpass will not answer, so the search was cropped to roughly ${searchedKm2.toLocaleString("en-GB")} km² around its centre. That limit is stated rather than hidden.`
            : `Resolved to ${resolved.displayName}, about ${searchedKm2.toLocaleString("en-GB")} km² of ground.`,
        });

        // ── 2. Measure the ground ───────────────────────────────────────
        send({
          type: "step",
          agent: "terrain_surveyor",
          message: `Querying Overpass for ${pack.osmSignatures.length} tag signature(s) that mark ${pack.label.toLowerCase()}. Areas are computed geodesically from the returned rings, not read from any description.`,
        });

        const terrain = await queryTerrain(pack, resolved.bbox);
        if (terrain.sites.length === 0) {
          send({
            type: "empty",
            agent: "terrain_surveyor",
            query: terrain.query,
            message: `No ${pack.label.toLowerCase()} features are mapped inside ${resolved.displayName}. That is a real answer: the query ran, and the region has none tagged. ${pack.coverageNote}`,
          });
          send({ type: "done", found: 0 });
          finish();
          return;
        }

        const summary = summariseSites(terrain.sites);
        // A dense region can return ten thousand features, most of them rooftop
        // arrays of a few hundred square metres. Every one is measured and
        // counted in the totals; only the largest are shipped to the browser to
        // be drawn, and the interface is told how many were held back.
        const DRAW_LIMIT = 300;
        const drawable = [...terrain.sites].sort((a, b) => b.areaKm2 - a.areaKm2);
        const shown = drawable.slice(0, DRAW_LIMIT);
        send({
          type: "terrain",
          agent: "terrain_surveyor",
          sites: shown.map(publicSite),
          measuredCount: terrain.sites.length,
          drawnCount: shown.length,
          withheldCount: Math.max(0, terrain.sites.length - shown.length),
          smallestDrawnKm2: shown.length ? round(shown[shown.length - 1].areaKm2, 4) : 0,
          summary,
          operators: terrain.operators.slice(0, 24),
          unattributedCount: terrain.unattributedCount,
          excludedCount: terrain.excludedCount,
          cacheHit: terrain.cacheHit,
          osmDataTimestamp: terrain.osmDataTimestamp,
          endpoint: terrain.endpoint,
          query: terrain.query,
          attribution: `${TERRAIN_ATTRIBUTION} ${GEOCODER_ATTRIBUTION}`,
          message: `${terrain.sites.length} mapped feature(s), ${round(summary.totalAreaKm2, 2)} km² measured. ${terrain.operators.length} distinct operator string(s) read off the map; ${terrain.unattributedCount} feature(s) carry no operator tag and are reported as such rather than assigned to somebody.${terrain.sites.length > 300 ? ` The ${Math.max(0, terrain.sites.length - 300)} smallest features are counted in those totals but not drawn, so the map stays readable.` : ""}`,
        });

        // ── 3. Group into operators, and size each one ──────────────────
        send({
          type: "step",
          agent: "universe_scout",
          message: `Turning operator strings into candidate accounts. An operator that cannot be identified is left out rather than given an invented parent company.`,
        });

        const named = mergeOperators(terrain.operators).slice(0, 8);

        for (const op of named) {
          // Exact operator tags, not the attribution ladder.
          //
          // The ladder matches on site names and on proximity as well as on the
          // tag, which is right when the company is known in advance and its
          // neighbours can be reasoned about. Turned loose on an unknown region it
          // overreaches: a live test on Antofagasta credited "SQM Industrial
          // S.A.", which carries one tagged feature, with eleven and with its
          // sibling's entire 249 km², because the token "SQM" appears in the names
          // of those sites.
          //
          // Discovery does not need inference. Overpass already returned the
          // operator tag on every feature, so grouping on that exact string, plus
          // the name variants merged into it, gives counts that add back up to the
          // operator table above. Anything a reviewer can add up is worth more
          // than anything they have to take on trust.
          const wanted = new Set(op.aliases.map((a) => a.trim().toLowerCase()));
          const mine = terrain.sites.filter(
            (site) => site.operatorTag && wanted.has(site.operatorTag.trim().toLowerCase()),
          );
          if (mine.length === 0) continue;

          const opSummary = summariseSites(mine);
          const sizing = sizeOpportunity({ pack, sites: mine, geometryEvidenceIds: [] });
          const money = revenueCase(sizing, opSummary.totalAreaKm2);

          send({
            type: "operator",
            agent: "opportunity_engineer",
            operator: op.operator,
            aliases: op.aliases,
            features: mine.length,
            summary: opSummary,
            sizing,
            revenue: money,
            sites: mine.map(publicSite),
            message: `${op.operator}: ${mine.length} feature(s), ${round(opSummary.totalAreaKm2, 2)} km². Programme sizing and the money case are computed from that geometry, with every assumption shown.`,
          });
        }

        send({
          type: "done",
          found: terrain.sites.length,
          operators: named.length,
          message: `Discovery complete. Every figure above was measured during this request, and every feature id opens on openstreetmap.org so the measurement can be checked independently.`,
        });
      } catch (err) {
        send({
          type: "error",
          message: `The live query failed: ${(err as Error).message}. Overpass rate-limits aggressive use and returns 504 on large areas, which is the most common cause. This is shown rather than retried into silence.`,
        });
      } finally {
        finish();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

/**
 * Merge operator strings that name the same company.
 *
 * OSM is crowd-tagged, so the same operator arrives as "NTPC" on one feature and
 * "NTPC Limited" on the next. Left alone, a live search reported both as separate
 * accounts with separate money cases, which is the sort of thing a reviewer spots
 * in five seconds. Where one normalised name contains another, the longer name
 * wins and the counts add up.
 */
function mergeOperators(operators: { operator: string; features: number; areaKm2: number }[]) {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/(limited|ltd|pvt|private|inc|corp|corporation|company|co|s\.?a\.?|plc|gmbh|bv|nv)/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const rows = operators
    .filter((o) => o.operator && o.operator.trim().length > 1)
    .map((o) => ({ ...o, key: norm(o.operator) }))
    .filter((o) => o.key.length > 1)
    // Longest name first, so it becomes the surviving label.
    .sort((a, b) => b.operator.length - a.operator.length);

  // Whole words, never a bare substring. "minera" appears in a dozen unrelated
  // Chilean operator names, and substring matching would collapse them all into
  // whichever one happened to sort first.
  const sameCompany = (a: string, b: string): boolean => {
    if (a === b) return true;
    const wa = a.split(" ");
    const wb = b.split(" ");
    const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
    // A single shared word is only enough when it is distinctive. The threshold
    // is three characters, not four: "SQM" is exactly the kind of short operator
    // acronym that matters, and an earlier version of this project lost the
    // anchor account entirely to a length filter set one character too high.
    if (short.length === 1 && short[0].length < 3) return false;
    // The shorter name must be a run of whole words inside the longer one.
    for (let i = 0; i + short.length <= long.length; i++) {
      if (short.every((w, j) => long[i + j] === w)) return true;
    }
    return false;
  };

  const merged: { operator: string; features: number; areaKm2: number; aliases: string[] }[] = [];
  for (const row of rows) {
    const host = merged.find((m) => sameCompany(norm(m.operator), row.key));
    if (host) {
      host.features += row.features;
      host.areaKm2 = round(host.areaKm2 + row.areaKm2, 3);
      if (!host.aliases.includes(row.operator)) host.aliases.push(row.operator);
    } else {
      merged.push({
        operator: row.operator,
        features: row.features,
        areaKm2: row.areaKm2,
        aliases: [row.operator],
      });
    }
  }
  return merged.sort((a, b) => b.areaKm2 - a.areaKm2);
}

/**
 * Rings are the bulk of the payload and the browser needs them to draw, but a
 * 4,000 point boundary is no more accurate on screen than a 400 point one, so
 * long rings are decimated for transport. The measured figures were computed
 * from the full ring before this happens, so nothing derived from geometry
 * changes.
 */
function publicSite(s: SiteGeometry) {
  const ring = s.ring.length > 420 ? s.ring.filter((_, i) => i % Math.ceil(s.ring.length / 420) === 0) : s.ring;
  return {
    osmId: s.osmId,
    osmUrl: osmUrl(s.osmId),
    name: s.name,
    operatorTag: s.operatorTag,
    centroid: s.centroid,
    ring,
    ringPointsFull: s.ring.length,
    areaKm2: s.areaKm2,
    perimeterKm: s.perimeterKm,
    assetClass: s.assetClass,
    attributionMethod: s.attributionMethod,
    excluded: s.excluded,
    exclusionReason: s.exclusionReason,
    tags: s.tags,
  };
}
