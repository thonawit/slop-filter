import {
  DEFAULT_PLATFORM_SETTINGS,
  DEFAULT_SETTINGS,
  PLATFORMS,
  type Platform,
  type PlatformSettings,
  type Settings,
} from "./types.ts";

const SETTINGS_KEY = "settings";

export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = (got[SETTINGS_KEY] ?? {}) as Partial<Settings>;

  // Merge per-platform settings one level deeper than a spread would.
  const platforms = {} as Record<Platform, PlatformSettings>;
  for (const p of PLATFORMS) {
    platforms[p] = { ...DEFAULT_PLATFORM_SETTINGS[p], ...(stored.platforms?.[p] ?? {}) };
  }

  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    interests: cleanList(stored.interests),
    excludedTopics: cleanList(stored.excludedTopics),
    allowHandles: cleanList(stored.allowHandles).map((h) => h.replace(/^@/, "").toLowerCase()),
    platforms,
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next: Settings = {
    ...current,
    ...patch,
    platforms: { ...current.platforms, ...(patch.platforms ?? {}) },
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export function cleanList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out.slice(0, 20); // keep the request small; 20 topics is plenty
}

/**
 * Settings that change which questions are asked — a cache-key ingredient.
 *
 * Deliberately excludes preset/thresholds/weights: those are applied in code over cached
 * raw answers, so moving the slider must NOT invalidate the cache. Platform is included
 * because the two batteries genuinely differ.
 */
export function questionSetKey(s: Settings, platform: Platform): string {
  return JSON.stringify({ p: platform, m: s.model, i: s.interests, x: s.excludedTopics, c: s.maxPostChars });
}
