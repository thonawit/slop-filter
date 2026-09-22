// Minimal client for POST /v1/systemone with exponential backoff on 408/429/5xx/529.
// Mirrors the SDK's default RetryPolicy (2 retries, 500ms initial, 5s max, honors Retry-After).
// A plain fetch is used instead of @typesafe-ai/sdk so nothing needs bundling into a
// service worker and there is no Node env-var lookup.

import type { EntryType, Questions, SystemOneRequest, SystemOneResponse } from "./types.ts";

export const DEFAULT_BASE_URL = "https://api.typesafe.ai";

export interface ClientOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

export class TypeSafeError extends Error {
  readonly status?: number;
  readonly requestId?: string;
  readonly body?: unknown;
  constructor(message: string, status?: number, requestId?: string, body?: unknown) {
    super(message);
    this.name = "TypeSafeError";
    this.status = status;
    this.requestId = requestId;
    this.body = body;
  }
}

const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

function retryAfterMs(headers: Headers): number | undefined {
  const ms = headers.get("retry-after-ms");
  if (ms && Number.isFinite(Number(ms))) return Number(ms);
  const s = headers.get("retry-after");
  if (s && Number.isFinite(Number(s))) return Number(s) * 1000;
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function systemOne(
  opts: ClientOptions,
  state: EntryType,
  questions: Questions,
): Promise<SystemOneResponse> {
  const apiKey = opts.apiKey.trim();
  if (!apiKey) throw new TypeSafeError("Missing TypeSafe API key. Add it in the extension options.");
  if (!Object.keys(questions).length) throw new TypeSafeError("No questions to ask.");

  const url = `${(opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")}/v1/systemone`;
  const body: SystemOneRequest = { state, model: opts.model, questions };
  const payload = JSON.stringify(body);
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxRetries = opts.maxRetries ?? 2;
  const doFetch = opts.fetchImpl ?? fetch;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: payload,
        signal: controller.signal,
      });
      const requestId = res.headers.get("x-typesafe-request-id") ?? undefined;
      if (res.ok) {
        return (await res.json()) as SystemOneResponse;
      }
      let errBody: unknown;
      try {
        errBody = await res.json();
      } catch {
        errBody = await res.text().catch(() => undefined);
      }
      const err = new TypeSafeError(describeStatus(res.status, errBody), res.status, requestId, errBody);
      if (!RETRY_STATUSES.has(res.status) || attempt === maxRetries) throw err;
      lastError = err;
      const serverDelay = retryAfterMs(res.headers);
      await sleep(serverDelay !== undefined ? Math.min(serverDelay, 60_000) : backoff(attempt));
    } catch (e) {
      if (e instanceof TypeSafeError) throw e;
      // network / abort
      lastError = e;
      if (attempt === maxRetries) {
        const msg = (e as Error)?.name === "AbortError" ? `Request timed out after ${timeoutMs}ms` : `Connection error: ${(e as Error)?.message ?? e}`;
        throw new TypeSafeError(msg);
      }
      await sleep(backoff(attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new TypeSafeError("Request failed");
}

function backoff(attempt: number): number {
  const base = Math.min(500 * 2 ** attempt, 5000);
  const jitter = base * 0.25 * Math.random();
  return base - jitter;
}

function describeStatus(status: number, body: unknown): string {
  const detail =
    body && typeof body === "object" && "detail" in body
      ? JSON.stringify((body as { detail: unknown }).detail).slice(0, 300)
      : typeof body === "string"
        ? body.slice(0, 300)
        : "";
  switch (status) {
    case 401:
      return "401 Unauthorized: invalid TypeSafe API key.";
    case 403:
      return "403 Forbidden: this key is not allowed to call the API.";
    case 422:
      return `422 Unprocessable: the request failed validation. ${detail}`;
    case 429:
      return "429 Rate limited by TypeSafe.";
    case 529:
      return "529 TypeSafe is overloaded.";
    default:
      return `HTTP ${status} from TypeSafe. ${detail}`;
  }
}

/** GET /v1/models — used by the options page "Test key" button. */
export async function listModels(opts: Pick<ClientOptions, "apiKey" | "baseUrl" | "fetchImpl">) {
  const url = `${(opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")}/v1/models`;
  const res = await (opts.fetchImpl ?? fetch)(url, { headers: { Authorization: `Bearer ${opts.apiKey.trim()}` } });
  if (!res.ok) throw new TypeSafeError(describeStatus(res.status, await res.text().catch(() => "")), res.status);
  return (await res.json()) as { models: { name: string; description: string; release_date: string }[] };
}
