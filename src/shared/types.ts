// Wire types for POST https://api.typesafe.ai/v1/systemone (docs: https://docs.typesafe.ai/api)

export type EntryType = string | JsonValue[] | { [key: string]: JsonValue } | null;
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface NoulQuestion {
  type: "noul";
  instructions: EntryType;
  criteria?: { true?: EntryType; false?: EntryType } | null;
}
export interface ChoiceQuestion {
  type: "choice";
  instructions: EntryType;
  criteria: Record<string, EntryType>;
}
export interface ScoreQuestion {
  type: "score";
  instructions: EntryType;
  criteria: EntryType[];
}
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type Questions = Record<string, Question>;

export interface NoulAnswer {
  type: "noul";
  noul: number;
}
export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}
export interface ScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, EntryType>;
  probabilities: Record<string, number>;
  confidence: number;
}
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface SystemOneRequest {
  state: EntryType;
  model: string;
  questions: Questions;
}
export interface SystemOneResponse {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
}

// ---------------------------------------------------------------------------
// Platforms
// ---------------------------------------------------------------------------

export const PLATFORMS = ["x", "linkedin"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABEL: Record<Platform, string> = {
  x: "X",
  linkedin: "LinkedIn",
};

/**
 * One scraped post, in a shape both platforms can fill.
 *
 * Fields that only one platform can supply are optional and the questions that use them
 * are added per-platform, so neither side pays for the other's state.
 */
export interface PostState {
  platform: Platform;
  /** Stable per-post identity. X: status id from the permalink. LinkedIn: URN or SDUI key. */
  id: string;
  author: string;
  /** X: @handle. LinkedIn: "" (no stable handle in the feed markup). */
  handle: string;
  /** LinkedIn: the actor's headline line. X: "". */
  authorHeadline: string;
  text: string;
  /** X: quote-tweeted post's text. LinkedIn: "" (reposts carry their own card). */
  quotedText: string;
  hasMedia: boolean;
  hasLink: boolean;
  isRepost: boolean;
  isQuote: boolean;
  isReply: boolean;
  isPromoted: boolean;
}

export type Verdict = "hide" | "collapse" | "show" | "highlight";

export interface Evaluation {
  platform: Platform;
  id: string;
  verdict: Verdict;
  slopScore: number;
  /** P(slop) from the holistic Choice, or null. */
  holistic: number | null;
  signals: Record<string, number>;
  structural: Record<string, number>;
  substance: number | null;
  substanceConfidence: number | null;
  interestHits: Record<string, number>;
  excludedHits: Record<string, number>;
  reason: string;
  model: string;
  inputTokens: number;
  evaluatedAt: number;
  fromCache: boolean;
}

export type Preset = "relaxed" | "balanced" | "strict";

/** Settings that can differ between X and LinkedIn. */
export interface PlatformSettings {
  enabled: boolean;
  preset: Preset;
  /** Posts shorter than this are left alone. X posts are short; LinkedIn's are not. */
  minPostChars: number;
  /** Replies lose their parent's context, so judgments are unreliable. */
  skipReplies: boolean;
}

export interface Settings {
  /** Master switch; each platform also has its own. */
  enabled: boolean;
  apiKey: string;
  model: string;
  /** Shared across platforms — the same person cares about the same things on both. */
  interests: string[];
  excludedTopics: string[];
  allowHandles: string[];
  highlightInterests: boolean;
  hideMode: "placeholder" | "remove";
  showBadges: boolean;
  maxPostChars: number;
  platforms: Record<Platform, PlatformSettings>;
}

export const DEFAULT_PLATFORM_SETTINGS: Record<Platform, PlatformSettings> = {
  // X posts are short by nature; 80 chars cuts roughly the bottom quarter of a real
  // timeline (measured median 206 chars).
  x: { enabled: true, preset: "balanced", minPostChars: 80, skipReplies: true },
  // LinkedIn posts are long; almost nothing legitimate lands under 120 chars.
  linkedin: { enabled: true, preset: "balanced", minPostChars: 120, skipReplies: true },
};

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  apiKey: "",
  model: "jev-1.13.0",
  interests: [],
  excludedTopics: [],
  allowHandles: [],
  highlightInterests: true,
  hideMode: "placeholder",
  showBadges: true,
  maxPostChars: 4000,
  platforms: DEFAULT_PLATFORM_SETTINGS,
};

export interface PlatformStats {
  evaluated: number;
  hidden: number;
  collapsed: number;
  highlighted: number;
  excluded: number;
  skipped: number;
  cacheHits: number;
  inputTokens: number;
}

export const EMPTY_PLATFORM_STATS: PlatformStats = {
  evaluated: 0,
  hidden: 0,
  collapsed: 0,
  highlighted: 0,
  excluded: 0,
  skipped: 0,
  cacheHits: 0,
  inputTokens: 0,
};

export interface SessionStats {
  byPlatform: Record<Platform, PlatformStats>;
  errors: number;
  lastError: string | null;
  lastModel: string | null;
}

export const EMPTY_STATS: SessionStats = {
  byPlatform: { x: { ...EMPTY_PLATFORM_STATS }, linkedin: { ...EMPTY_PLATFORM_STATS } },
  errors: 0,
  lastError: null,
  lastModel: null,
};

/** Sum across platforms, for the popup's headline numbers. */
export function totalStats(s: SessionStats): PlatformStats {
  const out = { ...EMPTY_PLATFORM_STATS };
  for (const p of PLATFORMS) {
    const ps = s.byPlatform[p] ?? EMPTY_PLATFORM_STATS;
    for (const k of Object.keys(out) as (keyof PlatformStats)[]) out[k] += ps[k] ?? 0;
  }
  return out;
}

export type Message =
  | { kind: "evaluate"; post: PostState }
  | { kind: "outcome"; platform: Platform; verdict: Verdict; excluded: boolean }
  | { kind: "skipped"; platform: Platform }
  | { kind: "get-stats" }
  | { kind: "reset-stats" }
  | { kind: "get-settings" }
  | { kind: "set-settings"; patch: Partial<Settings> }
  | { kind: "test-key"; apiKey: string; model: string }
  | { kind: "clear-cache" }
  | { kind: "get-recent" };

export type MessageReply =
  | { ok: true; evaluation: Evaluation }
  | { ok: true; stats: SessionStats }
  | { ok: true; settings: Settings }
  | { ok: true; recent: Evaluation[] }
  | { ok: true }
  | { ok: false; error: string };
