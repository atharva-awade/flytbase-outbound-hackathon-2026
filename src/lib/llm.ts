/**
 * Model router.
 *
 * Uses raw fetch rather than an OpenAI SDK on purpose: the provider-specific
 * body params we depend on (`search_settings`, `compound_custom`,
 * `reasoning_effort`, `reasoning_format`) are stripped by the official client.
 *
 * Constraints this file exists to respect, all confirmed against provider docs:
 *
 *  - Structured outputs cannot be combined with tools or streaming. Search and
 *    strict-JSON extraction are therefore two separate calls, always.
 *  - Rate limits are ORGANISATION-scoped, not key-scoped. Minting more keys
 *    buys nothing; sharding work across model ids does. On 429 we re-route to
 *    the next model in the role's pool instead of sleeping.
 *  - Prompt-cached tokens do not count against rate limits on gpt-oss models,
 *    so every call places a byte-identical static prefix first and the
 *    per-request delta last. `usage.cached_tokens` is surfaced so cache hits
 *    are provable rather than claimed.
 *  - groq/compound is capped at 250 requests per DAY on the free tier, which is
 *    why every call is content-addressed and cached to disk.
 */

import { cached, Throttle } from "./cache";

const GROQ_BASE = "https://api.groq.com/openai/v1";
const NIM_BASE = "https://integrate.api.nvidia.com/v1";

export type ModelRole = "search" | "extract" | "prose" | "triage";

interface ModelSpec {
  id: string;
  provider: "groq" | "nim";
  /** Strict, schema-guaranteed JSON via constrained decoding. */
  strictJson: boolean;
  /** Automatic prefix caching, and cached tokens exempt from rate limits. */
  promptCache: boolean;
  supportsReasoningEffort: boolean;
  /** Free-tier tokens per minute, used to order the pool. */
  tpm: number;
}

/**
 * Pools are ordered best-first. Retired Groq ids (Kimi K2, Llama 4 Scout and
 * Maverick, Qwen3-32B, the DeepSeek-R1 distills) are deliberately absent.
 * The two Llama 3.x ids are scheduled for shutdown on 16 Aug 2026, so the
 * gpt-oss fallbacks sit directly behind them in every pool they appear in.
 */
const POOLS: Record<ModelRole, ModelSpec[]> = {
  search: [
    { id: "groq/compound", provider: "groq", strictJson: false, promptCache: false, supportsReasoningEffort: false, tpm: 70_000 },
    { id: "groq/compound-mini", provider: "groq", strictJson: false, promptCache: false, supportsReasoningEffort: false, tpm: 70_000 },
  ],
  extract: [
    { id: "openai/gpt-oss-120b", provider: "groq", strictJson: true, promptCache: true, supportsReasoningEffort: true, tpm: 8_000 },
    { id: "openai/gpt-oss-20b", provider: "groq", strictJson: true, promptCache: true, supportsReasoningEffort: true, tpm: 8_000 },
    { id: "nvidia/nemotron-3-super-120b-a12b", provider: "nim", strictJson: false, promptCache: false, supportsReasoningEffort: false, tpm: 0 },
    { id: "deepseek-ai/deepseek-v4-flash", provider: "nim", strictJson: false, promptCache: false, supportsReasoningEffort: false, tpm: 0 },
  ],
  prose: [
    { id: "llama-3.3-70b-versatile", provider: "groq", strictJson: false, promptCache: false, supportsReasoningEffort: false, tpm: 12_000 },
    { id: "openai/gpt-oss-120b", provider: "groq", strictJson: true, promptCache: true, supportsReasoningEffort: true, tpm: 8_000 },
    // NVIDIA's shared free workers are removed from this pool entirely: under
    // load they answer 503 "Worker local total request limit reached", observed
    // as high as 634/48, so routing prose there only adds latency and noise.
  ],
  triage: [
    { id: "llama-3.1-8b-instant", provider: "groq", strictJson: false, promptCache: false, supportsReasoningEffort: false, tpm: 6_000 },
    { id: "openai/gpt-oss-20b", provider: "groq", strictJson: true, promptCache: true, supportsReasoningEffort: true, tpm: 8_000 },
  ],
};

/** NVIDIA's free tier is ~40 RPM GLOBAL across all models on a key. */
const nimThrottle = new Throttle(1_750);
/**
 * Groq allows 30 RPM per model id, but the free tier's 12K tokens-per-minute is
 * the real constraint: bursting a critic loop straight at it produces 429s and
 * spills work onto NVIDIA's shared workers, which then answer 503. Pacing here
 * keeps the whole loop on the primary model.
 */
const groqThrottle = new Throttle(2_400);

export interface CallUsage {
  model: string;
  provider: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  cacheHit: boolean;
  attempts: number;
}

export interface SearchResultItem {
  title: string;
  url: string;
  content: string;
  score: number;
}

export interface SearchOutcome {
  text: string;
  /** Real URLs returned by the provider's server-side search. Our citation spine. */
  results: SearchResultItem[];
  executedTools: { type: string; arguments?: string; output?: string }[];
  usage: CallUsage;
}

function keyFor(provider: "groq" | "nim"): string {
  const k = provider === "groq" ? process.env.GROQ_API_KEY : process.env.NVIDIA_API_KEY;
  if (!k) throw new MissingKeyError(provider);
  return k;
}

export class MissingKeyError extends Error {
  constructor(public provider: string) {
    super(
      `No API key configured for ${provider}. Set ${provider === "groq" ? "GROQ_API_KEY" : "NVIDIA_API_KEY"}.`,
    );
    this.name = "MissingKeyError";
  }
}

export function hasKey(provider: "groq" | "nim"): boolean {
  return Boolean(provider === "groq" ? process.env.GROQ_API_KEY : process.env.NVIDIA_API_KEY);
}

interface RawResponse {
  choices?: {
    message?: {
      content?: string;
      reasoning?: string;
      executed_tools?: { type: string; arguments?: string; output?: string; search_results?: unknown }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cached_tokens?: number };
  error?: { message?: string };
}

async function post(
  spec: ModelSpec,
  body: Record<string, unknown>,
): Promise<{ json: RawResponse; latencyMs: number }> {
  const base = spec.provider === "groq" ? GROQ_BASE : NIM_BASE;
  const throttle = spec.provider === "groq" ? groqThrottle : nimThrottle;
  const started = Date.now();

  const res = await throttle.run(() =>
    fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${keyFor(spec.provider)}`,
      },
      body: JSON.stringify(body),
    }),
  );

  const latencyMs = Date.now() - started;

  if (!res.ok) {
    const retryAfter = Number(res.headers.get("retry-after") ?? "0");
    // NVIDIA returns 403 for a bad key (not 401) and 402 when credits run out.
    const text = await res.text().catch(() => "");
    throw new ProviderError(res.status, `${spec.id} -> HTTP ${res.status}: ${text.slice(0, 240)}`, retryAfter);
  }

  return { json: (await res.json()) as RawResponse, latencyMs };
}

export class ProviderError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterSec = 0,
  ) {
    super(message);
    this.name = "ProviderError";
  }
  get isRateLimit() {
    return this.status === 429;
  }
  /** Auth or credit failures: re-routing to the same provider will not help. */
  get isTerminalForProvider() {
    return this.status === 401 || this.status === 403 || this.status === 402;
  }
}

/**
 * Try each model in a role's pool. On rate-limit or provider-terminal errors,
 * advance to the next model id rather than waiting, the whole point of holding
 * several pools is that a 429 on one id says nothing about the next.
 */
async function withPool<T>(
  role: ModelRole,
  fn: (spec: ModelSpec) => Promise<T>,
  opts: { requireStrictJson?: boolean } = {},
): Promise<T> {
  const pool = POOLS[role].filter(
    (s) => (!opts.requireStrictJson || s.strictJson) && hasKey(s.provider),
  );
  if (pool.length === 0) {
    throw new MissingKeyError(POOLS[role][0]?.provider ?? "groq");
  }

  let lastErr: unknown;
  for (const spec of pool) {
    try {
      return await fn(spec);
    } catch (err) {
      lastErr = err;
      if (err instanceof ProviderError && (err.isRateLimit || err.isTerminalForProvider)) continue;
      if (err instanceof MissingKeyError) continue;
      // Unexpected failures also fall through, a working model beats a clean stack trace.
      continue;
    }
  }
  throw lastErr ?? new Error(`All models exhausted for role ${role}`);
}

// ── Search (server-side, real citations) ──────────────────────────────────

export interface SearchOptions {
  /** Scope the crawl. Wildcards such as "*.cl" are accepted. */
  includeDomains?: string[];
  excludeDomains?: string[];
  /** Boosts results from a country. chile, peru, brazil, argentina, mexico... */
  country?: string;
  /** Restrict which server-side tools may run. */
  tools?: ("web_search" | "visit_website" | "code_interpreter" | "wolfram_alpha")[];
  maxTokens?: number;
}

/**
 * One call performs the whole agentic search loop server-side and returns the
 * assistant's synthesis plus the raw result set with real URLs and relevance
 * scores. Those URLs become evidence rows, which is what makes the "all data
 * must be verifiable" rule cheap to honour.
 */
export async function searchWeb(prompt: string, opts: SearchOptions = {}): Promise<SearchOutcome> {
  const cacheable = { prompt, opts };

  const { value, hit } = await cached("llm-search", cacheable, async () =>
    withPool("search", async (spec) => {
      const body: Record<string, unknown> = {
        model: spec.id,
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: opts.maxTokens ?? 4_096,
        temperature: 0.2,
      };

      const search_settings: Record<string, unknown> = {};
      if (opts.includeDomains?.length) search_settings.include_domains = opts.includeDomains;
      if (opts.excludeDomains?.length) search_settings.exclude_domains = opts.excludeDomains;
      if (opts.country) search_settings.country = opts.country;
      if (Object.keys(search_settings).length) body.search_settings = search_settings;

      if (opts.tools?.length) {
        body.compound_custom = { tools: { enabled_tools: opts.tools } };
      }

      const { json, latencyMs } = await post(spec, body);
      const msg = json.choices?.[0]?.message;
      const executed = msg?.executed_tools ?? [];

      const results: SearchResultItem[] = [];
      for (const tool of executed) {
        const sr = (tool as { search_results?: unknown }).search_results;
        for (const item of normaliseSearchResults(sr)) results.push(item);
      }

      return {
        text: msg?.content ?? "",
        results: dedupeByUrl(results),
        executedTools: executed.map((t) => ({
          type: t.type,
          arguments: typeof t.arguments === "string" ? t.arguments.slice(0, 400) : undefined,
          output: typeof t.output === "string" ? t.output.slice(0, 600) : undefined,
        })),
        usage: {
          model: spec.id,
          provider: spec.provider,
          latencyMs,
          tokensIn: json.usage?.prompt_tokens ?? 0,
          tokensOut: json.usage?.completion_tokens ?? 0,
          tokensCached: json.usage?.cached_tokens ?? 0,
          cacheHit: false,
          attempts: 1,
        },
      } satisfies SearchOutcome;
    }),
  );

  return { ...value, usage: { ...value.usage, cacheHit: hit } };
}

/** Providers have shipped several shapes for search_results over time. */
function normaliseSearchResults(sr: unknown): SearchResultItem[] {
  const rows: unknown[] = Array.isArray(sr)
    ? sr
    : sr && typeof sr === "object" && Array.isArray((sr as { results?: unknown[] }).results)
      ? ((sr as { results: unknown[] }).results)
      : [];

  const out: SearchResultItem[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const url = typeof o.url === "string" ? o.url : typeof o.link === "string" ? o.link : "";
    if (!url) continue;
    out.push({
      title: typeof o.title === "string" ? o.title : "",
      url,
      content: typeof o.content === "string" ? o.content : typeof o.snippet === "string" ? o.snippet : "",
      score: typeof o.score === "number" ? o.score : 0,
    });
  }
  return out;
}

function dedupeByUrl(items: SearchResultItem[]): SearchResultItem[] {
  const seen = new Map<string, SearchResultItem>();
  for (const i of items) {
    const prev = seen.get(i.url);
    if (!prev || i.score > prev.score) seen.set(i.url, i);
  }
  return [...seen.values()].sort((a, b) => b.score - a.score);
}

// ── Strict JSON extraction ───────────────────────────────────────────────

export interface ExtractOptions {
  /** Byte-identical across calls so prefix caching engages. Put persona here. */
  staticPrefix: string;
  /** The per-request delta. Goes last, after the cacheable prefix. */
  userContent: string;
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
}

export interface ExtractOutcome<T> {
  data: T;
  usage: CallUsage;
}

/**
 * Constrained-decoding JSON. Strict mode requires every property to be listed
 * in `required` and every object to set `additionalProperties: false`; the
 * helper below enforces that so a malformed schema fails locally rather than
 * as an opaque 400.
 */
export async function extractJson<T>(opts: ExtractOptions): Promise<ExtractOutcome<T>> {
  assertStrictSchema(opts.schema, opts.schemaName);

  const { value, hit } = await cached(
    "llm-extract",
    { p: opts.staticPrefix, u: opts.userContent, s: opts.schema, n: opts.schemaName },
    async () =>
      withPool(
        "extract",
        async (spec) => {
          const body: Record<string, unknown> = {
            model: spec.id,
            messages: [
              { role: "system", content: opts.staticPrefix },
              { role: "user", content: opts.userContent },
            ],
            max_completion_tokens: opts.maxTokens ?? 4_096,
            temperature: 0.1,
          };

          if (spec.strictJson) {
            body.response_format = {
              type: "json_schema",
              json_schema: { name: opts.schemaName, strict: true, schema: opts.schema },
            };
          } else {
            // Fallback path: JSON object mode requires the word JSON in the prompt.
            body.response_format = { type: "json_object" };
            body.messages = [
              { role: "system", content: `${opts.staticPrefix}\n\nRespond with a single JSON object and nothing else.` },
              { role: "user", content: opts.userContent },
            ];
          }

          if (spec.supportsReasoningEffort) {
            body.reasoning_effort = opts.reasoningEffort ?? "low";
            body.reasoning_format = "hidden";
          }
          if (spec.provider === "nim") {
            // NVIDIA asks for these exact sampling values on nemotron.
            body.temperature = 1.0;
            body.top_p = 0.95;
          }

          const { json, latencyMs } = await post(spec, body);
          const content = json.choices?.[0]?.message?.content ?? "";
          const data = parseJsonLoose<T>(content);

          return {
            data,
            usage: {
              model: spec.id,
              provider: spec.provider,
              latencyMs,
              tokensIn: json.usage?.prompt_tokens ?? 0,
              tokensOut: json.usage?.completion_tokens ?? 0,
              tokensCached: json.usage?.cached_tokens ?? 0,
              cacheHit: false,
              attempts: 1,
            },
          } satisfies ExtractOutcome<T>;
        },
        { requireStrictJson: false },
      ),
  );

  return { ...value, usage: { ...value.usage, cacheHit: hit } };
}

// ── Prose (email copy) ───────────────────────────────────────────────────

export interface ProseOptions {
  staticPrefix: string;
  userContent: string;
  maxTokens?: number;
  temperature?: number;
  /** Enforce JSON Object Mode. Guarantees syntax, not schema. */
  json?: boolean;
}

export async function writeProse(opts: ProseOptions): Promise<{ text: string; usage: CallUsage }> {
  const { value, hit } = await cached(
    "llm-prose",
    { p: opts.staticPrefix, u: opts.userContent, t: opts.temperature ?? 0.65, j: opts.json ?? false },
    async () =>
      withPool("prose", async (spec) => {
        const body: Record<string, unknown> = {
          model: spec.id,
          messages: [
            { role: "system", content: opts.staticPrefix },
            { role: "user", content: opts.userContent },
          ],
          max_completion_tokens: opts.maxTokens ?? 900,
          temperature: opts.temperature ?? 0.65,
        };
        if (opts.json) {
          // JSON Object Mode guarantees parseable syntax. It requires the word
          // JSON to appear in the prompt, which the writer prefix already does.
          body.response_format = { type: "json_object" };
        }
        if (spec.supportsReasoningEffort) {
          body.reasoning_effort = "low";
          body.reasoning_format = "hidden";
        }
        if (spec.provider === "nim") {
          body.temperature = 1.0;
          body.top_p = 0.95;
        }

        const { json, latencyMs } = await post(spec, body);
        return {
          text: json.choices?.[0]?.message?.content ?? "",
          usage: {
            model: spec.id,
            provider: spec.provider,
            latencyMs,
            tokensIn: json.usage?.prompt_tokens ?? 0,
            tokensOut: json.usage?.completion_tokens ?? 0,
            tokensCached: json.usage?.cached_tokens ?? 0,
            cacheHit: false,
            attempts: 1,
          },
        };
      }),
  );
  return { ...value, usage: { ...value.usage, cacheHit: hit } };
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Strict mode is unforgiving; catch schema mistakes before the provider does. */
function assertStrictSchema(schema: Record<string, unknown>, name: string, path = "$"): void {
  if (schema.type === "object") {
    if (schema.additionalProperties !== false) {
      throw new Error(`Schema ${name} at ${path}: strict mode requires additionalProperties: false`);
    }
    const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = (schema.required ?? []) as string[];
    const keys = Object.keys(props);
    const missing = keys.filter((k) => !required.includes(k));
    if (missing.length) {
      throw new Error(
        `Schema ${name} at ${path}: strict mode requires every property in "required" (missing: ${missing.join(", ")})`,
      );
    }
    for (const [k, v] of Object.entries(props)) assertStrictSchema(v, name, `${path}.${k}`);
  } else if (schema.type === "array" && schema.items) {
    assertStrictSchema(schema.items as Record<string, unknown>, name, `${path}[]`);
  }
}

/** Models occasionally wrap JSON in prose or fences even in JSON mode. */
export function parseJsonLoose<T>(raw: string): T {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    /* fall through */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim()) as T;
    } catch {
      /* fall through */
    }
  }
  const first = trimmed.indexOf("{");
  const firstArr = trimmed.indexOf("[");
  const start = first === -1 ? firstArr : firstArr === -1 ? first : Math.min(first, firstArr);
  const lastObj = trimmed.lastIndexOf("}");
  const lastArr = trimmed.lastIndexOf("]");
  const end = Math.max(lastObj, lastArr);
  if (start !== -1 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1)) as T;
  }
  throw new Error(`Could not parse JSON from model output: ${trimmed.slice(0, 200)}`);
}

/** Model ids in play, surfaced in the UI so routing is inspectable. */
export function poolSummary(): { role: ModelRole; models: { id: string; provider: string; available: boolean }[] }[] {
  return (Object.keys(POOLS) as ModelRole[]).map((role) => ({
    role,
    models: POOLS[role].map((s) => ({ id: s.id, provider: s.provider, available: hasKey(s.provider) })),
  }));
}
