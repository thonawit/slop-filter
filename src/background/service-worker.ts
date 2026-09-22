// MV3 service worker. Owns the API key, the per-post cache, and session stats for both
// platforms. The content script sends a PostState; this returns an Evaluation.

import { buildQuestions, buildState } from "../shared/questions/index.ts";
import { buildEvaluation } from "../shared/scoring.ts";
import { loadSettings, questionSetKey, saveSettings } from "../shared/storage.ts";
import { listModels, systemOne, TypeSafeError } from "../shared/typesafe.ts";
import {
  EMPTY_PLATFORM_STATS,
  EMPTY_STATS,
  PLATFORMS,
  type Evaluation,
  type Message,
  type MessageReply,
  type Platform,
  type PostState,
  type SessionStats,
  type Settings,
  type SystemOneResponse,
} from "../shared/types.ts";

const CACHE_PREFIX = "cache:";
const CACHE_MAX_ENTRIES = 800;
const RECENT_KEY = "recent";
const RECENT_MAX = 60;
const STATS_KEY = "stats";
const MAX_IN_FLIGHT = 4;

// ---- in-flight limiter ----
let inFlight = 0;
const waiters: (() => void)[] = [];
async function acquire(): Promise<void> {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight++;
    return;
  }
  await new Promise<void>((r) => waiters.push(r));
  inFlight++;
}
function release(): void {
  inFlight--;
  waiters.shift()?.();
}

// ---- session storage (cleared when the browser closes = "this session") ----
async function getStats(): Promise<SessionStats> {
  const got = await chrome.storage.session.get(STATS_KEY);
  const stored = (got[STATS_KEY] ?? {}) as Partial<SessionStats>;
  const byPlatform = {} as SessionStats["byPlatform"];
  for (const p of PLATFORMS) {
    byPlatform[p] = { ...EMPTY_PLATFORM_STATS, ...(stored.byPlatform?.[p] ?? {}) };
  }
  return { ...EMPTY_STATS, ...stored, byPlatform };
}
async function updateStats(mut: (s: SessionStats) => void): Promise<void> {
  const s = await getStats();
  mut(s);
  await chrome.storage.session.set({ [STATS_KEY]: s });
}
async function pushRecent(e: Evaluation): Promise<void> {
  const got = await chrome.storage.session.get(RECENT_KEY);
  const list = ((got[RECENT_KEY] ?? []) as Evaluation[]).filter((x) => x.id !== e.id);
  list.unshift(e);
  await chrome.storage.session.set({ [RECENT_KEY]: list.slice(0, RECENT_MAX) });
}

// ---- cache of raw responses ----
// Keyed on the TEXT, not just the id, so an edited post re-asks. NOT keyed on the preset,
// so moving the slider re-scores cached answers for free.
interface CacheEntry {
  response: SystemOneResponse;
  at: number;
}
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function cacheKey(post: PostState, settings: Settings, text: string): string {
  return `${CACHE_PREFIX}${post.platform}:${post.id}:${hash(text + "\u0000" + post.quotedText)}:${hash(
    questionSetKey(settings, post.platform),
  )}`;
}
async function cacheGet(key: string): Promise<CacheEntry | undefined> {
  const got = await chrome.storage.session.get(key);
  return got[key] as CacheEntry | undefined;
}
async function cacheSet(key: string, entry: CacheEntry): Promise<void> {
  await chrome.storage.session.set({ [key]: entry });
  if (Math.random() < 0.05) await trimCache();
}
async function trimCache(): Promise<void> {
  const all = await chrome.storage.session.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX));
  if (keys.length <= CACHE_MAX_ENTRIES) return;
  keys.sort((a, b) => ((all[a] as CacheEntry).at ?? 0) - ((all[b] as CacheEntry).at ?? 0));
  await chrome.storage.session.remove(keys.slice(0, keys.length - CACHE_MAX_ENTRIES));
}
async function clearCache(): Promise<void> {
  const all = await chrome.storage.session.get(null);
  await chrome.storage.session.remove(Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX)));
}

// ---- the evaluation itself ----
async function evaluate(post: PostState): Promise<Evaluation> {
  const settings = await loadSettings();
  if (!settings.apiKey.trim()) throw new TypeSafeError("No TypeSafe API key set. Open the extension options.");

  const text = post.text.slice(0, settings.maxPostChars);
  const trimmed: PostState = {
    ...post,
    text,
    quotedText: post.quotedText.slice(0, settings.maxPostChars),
  };
  const key = cacheKey(post, settings, text);
  const cached = await cacheGet(key);

  let response: SystemOneResponse;
  let fromCache = false;
  if (cached) {
    response = cached.response;
    fromCache = true;
  } else {
    const state = buildState(trimmed, settings.interests, settings.excludedTopics);
    const questions = buildQuestions(post.platform, settings.interests, settings.excludedTopics);
    await acquire();
    try {
      response = await systemOne({ apiKey: settings.apiKey, model: settings.model }, state as never, questions);
    } finally {
      release();
    }
    await cacheSet(key, { response, at: Date.now() });
  }

  const evaluation = buildEvaluation(
    trimmed,
    response,
    settings.interests,
    settings.excludedTopics,
    settings.platforms[post.platform].preset,
    settings.highlightInterests,
    fromCache,
  );

  await updateStats((s) => {
    const ps = s.byPlatform[post.platform];
    if (!fromCache) {
      ps.evaluated++;
      ps.inputTokens += evaluation.inputTokens;
      s.lastModel = evaluation.model;
    } else {
      ps.cacheHits++;
    }
  });
  await pushRecent(evaluation);
  return evaluation;
}

/** The content script reports what it actually did, so stats match the DOM. */
async function recordOutcome(platform: Platform, verdict: Evaluation["verdict"], excluded: boolean): Promise<void> {
  await updateStats((s) => {
    const ps = s.byPlatform[platform];
    if (verdict === "hide") ps.hidden++;
    if (verdict === "collapse") ps.collapsed++;
    if (verdict === "highlight") ps.highlighted++;
    if (excluded) ps.excluded++;
  });
}

// ---- message router ----
chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch((e: unknown) => {
      const error = e instanceof Error ? e.message : String(e);
      updateStats((s) => {
        s.errors++;
        s.lastError = error;
      }).finally(() => sendResponse({ ok: false, error } satisfies MessageReply));
    });
  return true; // keep the channel open for the async reply
});

async function handle(msg: Message): Promise<MessageReply> {
  switch (msg.kind) {
    case "evaluate":
      return { ok: true, evaluation: await evaluate(msg.post) };
    case "outcome":
      await recordOutcome(msg.platform, msg.verdict, msg.excluded);
      return { ok: true };
    case "skipped":
      await updateStats((s) => {
        s.byPlatform[msg.platform].skipped++;
      });
      return { ok: true };
    case "get-stats":
      return { ok: true, stats: await getStats() };
    case "reset-stats":
      await chrome.storage.session.set({ [STATS_KEY]: EMPTY_STATS, [RECENT_KEY]: [] });
      return { ok: true };
    case "get-settings":
      return { ok: true, settings: await loadSettings() };
    case "set-settings":
      return { ok: true, settings: await saveSettings(msg.patch) };
    case "clear-cache":
      await clearCache();
      return { ok: true };
    case "get-recent": {
      const got = await chrome.storage.session.get(RECENT_KEY);
      return { ok: true, recent: (got[RECENT_KEY] ?? []) as Evaluation[] };
    }
    case "test-key": {
      const models = await listModels({ apiKey: msg.apiKey });
      const names = models.models.map((m) => m.name);
      if (msg.model && !names.includes(msg.model) && !/^jev-\d/.test(msg.model)) {
        throw new TypeSafeError(`Key works, but model "${msg.model}" is not listed. Available: ${names.join(", ")}`);
      }
      return { ok: true };
    }
    default:
      throw new Error(`Unknown message kind ${(msg as { kind: string }).kind}`);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
});
