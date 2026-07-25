/**
 * Request limits on the two endpoints that can do damage.
 *
 * `/api/send` delivers real email to whatever address the caller types, and
 * `/api/run` executes live queries against Overpass, SEC EDGAR and company
 * sites. Unlimited, the first is an open relay and the second is a way to get
 * our access to those sources withdrawn. SEC asks for a descriptive agent and
 * no more than ten requests a second, and Overpass bans on abuse. Neither
 * endpoint needs authentication for a public demonstration, but both need a
 * ceiling.
 *
 * The state is per-instance and in memory. On a serverless platform that means
 * several instances each keep their own counters, so the effective limit is the
 * stated one times the number of warm instances. That is a real weakness and it
 * is recorded here rather than papered over: a shared store is the correct fix
 * and is not worth a dependency for this deployment. The daily cap on sending
 * exists because that weakness would otherwise be charged against a real
 * mailbox.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
let lastSweep = 0;

/** Drop expired entries so a long-lived instance does not grow without bound. */
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
}

export interface Verdict {
  ok: boolean;
  /** Seconds until the caller may retry. Only meaningful when `ok` is false. */
  retryAfter: number;
  remaining: number;
}

export function take(key: string, limit: number, windowMs: number, now = Date.now()): Verdict {
  sweep(now);
  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0, remaining: limit - 1 };
  }
  if (existing.count >= limit) {
    return { ok: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000), remaining: 0 };
  }
  existing.count += 1;
  return { ok: true, retryAfter: 0, remaining: limit - existing.count };
}

/**
 * Best-effort caller identity.
 *
 * `x-forwarded-for` is set by the platform proxy and is trustworthy only to the
 * extent that the proxy overwrites what a client sends. Vercel does overwrite
 * it. Behind a proxy that does not, the leftmost value is caller-controlled, so
 * this is a throttle and never an access control.
 */
export function callerKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || "unknown";
  return ip;
}

export function limitResponse(verdict: Verdict, message: string): Response {
  return new Response(JSON.stringify({ error: message, retryAfter: verdict.retryAfter }), {
    status: 429,
    headers: {
      "content-type": "application/json",
      "retry-after": String(verdict.retryAfter),
    },
  });
}
