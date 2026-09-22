import type { Platform } from "../shared/types.ts";
import { linkedinAdapter } from "./linkedin.ts";
import type { PlatformAdapter } from "./types.ts";
import { xAdapter } from "./x.ts";

export type { PlatformAdapter } from "./types.ts";
export { xAdapter } from "./x.ts";
export { linkedinAdapter } from "./linkedin.ts";

export const ADAPTERS: Record<Platform, PlatformAdapter> = {
  x: xAdapter,
  linkedin: linkedinAdapter,
};

/**
 * Which feed are we on?
 *
 * One content script is registered for both hosts and picks its adapter at runtime, so
 * there is a single scan loop, a single set of CSS class names, and no duplicated
 * messaging code.
 */
export function detectPlatform(host = location.hostname): Platform | null {
  if (/(^|\.)x\.com$/.test(host) || /(^|\.)twitter\.com$/.test(host)) return "x";
  if (/(^|\.)linkedin\.com$/.test(host)) return "linkedin";
  return null;
}
