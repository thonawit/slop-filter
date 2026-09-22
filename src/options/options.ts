import { PLATFORMS, type Platform, type PlatformSettings, type Preset, type Settings } from "../shared/types.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function send<T>(msg: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (reply: T & { ok: boolean; error?: string }) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!reply?.ok) return reject(new Error(reply?.error ?? "Unknown error"));
      resolve(reply);
    });
  });
}

function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function setStatus(el: HTMLElement, text: string, kind: "ok" | "err" | ""): void {
  el.textContent = text;
  el.className = `status ${kind}`;
}

async function load(): Promise<void> {
  const { settings } = await send<{ settings: Settings }>({ kind: "get-settings" });
  $<HTMLInputElement>("apiKey").value = settings.apiKey;
  $<HTMLInputElement>("model").value = settings.model;
  $<HTMLTextAreaElement>("interests").value = settings.interests.join("\n");
  $<HTMLTextAreaElement>("excludedTopics").value = settings.excludedTopics.join("\n");
  $<HTMLTextAreaElement>("allowHandles").value = settings.allowHandles.map((h) => `@${h}`).join("\n");
  $<HTMLSelectElement>("hideMode").value = settings.hideMode;
  $<HTMLInputElement>("showBadges").checked = settings.showBadges;
  $<HTMLInputElement>("maxPostChars").value = String(settings.maxPostChars);

  for (const p of PLATFORMS) {
    const ps = settings.platforms[p];
    $<HTMLInputElement>(`${p}-enabled`).checked = ps.enabled;
    $<HTMLSelectElement>(`${p}-preset`).value = ps.preset;
    $<HTMLInputElement>(`${p}-minPostChars`).value = String(ps.minPostChars);
    $<HTMLInputElement>(`${p}-skipReplies`).checked = ps.skipReplies;
  }
}

function readPlatform(p: Platform): PlatformSettings {
  return {
    enabled: $<HTMLInputElement>(`${p}-enabled`).checked,
    preset: $<HTMLSelectElement>(`${p}-preset`).value as Preset,
    minPostChars: Math.max(0, Math.min(500, Number($<HTMLInputElement>(`${p}-minPostChars`).value) || 0)),
    skipReplies: $<HTMLInputElement>(`${p}-skipReplies`).checked,
  };
}

async function save(): Promise<void> {
  const platforms = {} as Record<Platform, PlatformSettings>;
  for (const p of PLATFORMS) platforms[p] = readPlatform(p);

  const patch: Partial<Settings> = {
    apiKey: $<HTMLInputElement>("apiKey").value.trim(),
    model: $<HTMLInputElement>("model").value.trim() || "jev-1.13.0",
    interests: linesOf($<HTMLTextAreaElement>("interests").value),
    excludedTopics: linesOf($<HTMLTextAreaElement>("excludedTopics").value),
    allowHandles: linesOf($<HTMLTextAreaElement>("allowHandles").value).map((h) => h.replace(/^@/, "").toLowerCase()),
    hideMode: $<HTMLSelectElement>("hideMode").value as Settings["hideMode"],
    showBadges: $<HTMLInputElement>("showBadges").checked,
    maxPostChars: Math.max(500, Math.min(12000, Number($<HTMLInputElement>("maxPostChars").value) || 4000)),
    platforms,
  };
  try {
    await send({ kind: "set-settings", patch });
    setStatus($("saveStatus"), "Saved. Open X or LinkedIn and the feed will re-evaluate.", "ok");
  } catch (e) {
    setStatus($("saveStatus"), (e as Error).message, "err");
  }
}

$("save").addEventListener("click", () => void save());
$("toggleKey").addEventListener("click", () => {
  const input = $<HTMLInputElement>("apiKey");
  input.type = input.type === "password" ? "text" : "password";
  $("toggleKey").textContent = input.type === "password" ? "Show" : "Hide";
});
$("testKey").addEventListener("click", async () => {
  const status = $("keyStatus");
  setStatus(status, "Testing…", "");
  try {
    await send({
      kind: "test-key",
      apiKey: $<HTMLInputElement>("apiKey").value.trim(),
      model: $<HTMLInputElement>("model").value.trim(),
    });
    setStatus(status, "Key works.", "ok");
  } catch (e) {
    setStatus(status, (e as Error).message, "err");
  }
});

void load();
