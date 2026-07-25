/**
 * Content-addressed disk cache.
 *
 * This exists from the first line of the data layer on purpose. Our research
 * engine (groq/compound) is capped at 250 requests per DAY on the free tier,
 * and Overpass rate-limits aggressive querying, retrofitting caching late is
 * the classic way a build like this dies. Every outbound fetch goes through
 * here, keyed by a hash of its full request description.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CACHE_DIR =
  process.env.AERION_CACHE_DIR ?? (process.env.VERCEL ? "/tmp/aerion-cache" : ".cache");

export function cacheKey(namespace: string, payload: unknown): string {
  const h = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24);
  return `${namespace}-${h}`;
}

let ensured = false;
async function ensureDir() {
  if (ensured) return;
  await mkdir(CACHE_DIR, { recursive: true }).catch(() => {});
  ensured = true;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await readFile(join(CACHE_DIR, `${key}.json`), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  try {
    await ensureDir();
    await writeFile(join(CACHE_DIR, `${key}.json`), JSON.stringify(value), "utf8");
  } catch {
    /* A read-only or full filesystem must never break a run. */
  }
}

/** Read-through cache. `fresh` is only invoked on a miss. */
export async function cached<T>(
  namespace: string,
  keyPayload: unknown,
  fresh: () => Promise<T>,
): Promise<{ value: T; hit: boolean }> {
  const key = cacheKey(namespace, keyPayload);
  const existing = await cacheGet<T>(key);
  if (existing !== null) return { value: existing, hit: true };
  const value = await fresh();
  await cacheSet(key, value);
  return { value, hit: false };
}

// ── Politeness primitives ────────────────────────────────────────────────

/** Serialises calls per host and enforces a minimum gap between them. */
export class Throttle {
  private last = 0;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly minGapMs: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      const wait = this.minGapMs - (Date.now() - this.last);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      return fn();
    });
    // Keep the chain alive even when a link rejects.
    this.chain = next.catch(() => {});
    return next;
  }
}

export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { attempts?: number; baseMs?: number; label?: string } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 700;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) break;
      // Exponential backoff with jitter.
      const delay = baseMs * 2 ** i + Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
