/**
 * Place name to bounding box.
 *
 * Live discovery needs to turn "Atacama", "Rajasthan" or "Rotterdam" into
 * coordinates before anything can be measured. Nominatim is the OpenStreetMap
 * project's own geocoder, needs no key, and returns the same object ids that the
 * Overpass query will later measure, so the two halves of a discovery agree by
 * construction rather than by coincidence.
 *
 * Its usage policy asks for a descriptive User-Agent, at most one request a
 * second, and no heavy automated use. All three are honoured here: the agent
 * names the project, requests are serialised through a throttle, and answers are
 * cached so repeating a search costs nothing.
 */

import { cached } from "@/lib/cache";
import type { BBox } from "@/lib/geo";

const ENDPOINT = "https://nominatim.openstreetmap.org/search";

export const GEOCODER_ATTRIBUTION =
  "Place lookup by Nominatim, © OpenStreetMap contributors, Open Database Licence (ODbL).";

/**
 * Overpass answers a continental bounding box with a 504, and a query that times
 * out teaches a reviewer nothing.
 *
 * Set to 3 degrees, roughly 330 km by 300 km, after a live test on Rajasthan
 * showed why a generous ceiling is worse than a tight one. At 8 degrees the box
 * around Rajasthan's centre reached into Pakistan and returned ten thousand
 * features, most of them rooftop arrays. The result was slow, spilled across a
 * border, and buried the twenty operators anybody cares about. A district-sized
 * window that says so is more useful than a country-sized one that quietly
 * misleads.
 */
const MAX_SPAN_DEG = 3;

export interface Place {
  /** What Nominatim calls it, which is what we show. Never our paraphrase. */
  displayName: string;
  lat: number;
  lon: number;
  bbox: BBox;
  /** True when the returned box was larger than Overpass can answer and was cropped. */
  cropped: boolean;
  /** Set when cropped, so the interface can say how much of the place was searched. */
  originalSpanDeg?: { lat: number; lon: number };
  osmType?: string;
  osmId?: number;
  /** Nominatim's own classification, for example "boundary/administrative". */
  category?: string;
  sourceUrl: string;
  fetchedAt: string;
}

interface NominatimRow {
  display_name?: string;
  lat?: string;
  lon?: string;
  boundingbox?: [string, string, string, string];
  osm_type?: string;
  osm_id?: number;
  class?: string;
  type?: string;
}

let lastCall = 0;

/** One request a second, as the usage policy asks. */
async function throttle() {
  const wait = 1100 - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

export async function geocodePlace(query: string): Promise<Place | null> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return null;

  const url = `${ENDPOINT}?q=${encodeURIComponent(trimmed)}&format=jsonv2&limit=1&polygon_geojson=0`;

  const { value: rows } = await cached<NominatimRow[]>("nominatim", url, async () => {
    await throttle();
    const res = await fetch(url, {
      headers: {
        // Nominatim rejects anonymous automated traffic, and asks to be told who
        // is calling so it can get in touch instead of blocking.
        "User-Agent": "Aerion/1.0 (outbound terrain research; contact via repository)",
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`Nominatim returned HTTP ${res.status}`);
    return (await res.json()) as NominatimRow[];
  });

  const row = rows?.[0];
  if (!row?.boundingbox || !row.lat || !row.lon) return null;

  const [south, north, west, east] = row.boundingbox.map(Number) as [number, number, number, number];
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  const spanLat = Math.abs(north - south);
  const spanLon = Math.abs(east - west);
  const cropped = spanLat > MAX_SPAN_DEG || spanLon > MAX_SPAN_DEG;

  // Crop around the place's own centre rather than the box centre, so a country
  // shaped like Chile is searched where its population and industry sit.
  const half = MAX_SPAN_DEG / 2;
  const bbox: BBox = cropped
    ? {
        south: Math.max(south, lat - half),
        north: Math.min(north, lat + half),
        west: Math.max(west, lon - half),
        east: Math.min(east, lon + half),
      }
    : { south, north, west, east };

  return {
    displayName: row.display_name ?? trimmed,
    lat,
    lon,
    bbox,
    cropped,
    originalSpanDeg: cropped ? { lat: Number(spanLat.toFixed(2)), lon: Number(spanLon.toFixed(2)) } : undefined,
    osmType: row.osm_type,
    osmId: row.osm_id,
    category: row.class && row.type ? `${row.class}/${row.type}` : row.class,
    sourceUrl:
      row.osm_type && row.osm_id
        ? `https://www.openstreetmap.org/${row.osm_type}/${row.osm_id}`
        : `https://www.openstreetmap.org/#map=8/${lat}/${lon}`,
    fetchedAt: new Date().toISOString(),
  };
}

/** Roughly how much ground the search covered, for the honesty line in the UI. */
export function bboxAreaKm2(b: BBox): number {
  const midLat = ((b.north + b.south) / 2) * (Math.PI / 180);
  const kmPerDegLat = 110.574;
  const kmPerDegLon = 111.32 * Math.cos(midLat);
  return Math.round(Math.abs(b.north - b.south) * kmPerDegLat * Math.abs(b.east - b.west) * kmPerDegLon);
}
