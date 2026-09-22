// X-specific signals, substance scale, and thresholds.
//
// WHY X IS NOT LINKEDIN
//
// The LinkedIn battery leans on `no_substance`: a 300-word post that teaches you nothing
// is slop. That test is actively wrong on X, where brevity is the format — a good post is
// often eight words with no checkable fact in it. So X has no `no_substance` question, and
// its substance Score is re-levelled so that "a specific joke, opinion or observation in
// the author's own voice" is a GOOD level rather than a zero.

import type { Preset, ScoreQuestion } from "../types.ts";
import { noul, type SignalSet } from "./core.ts";
import type { Policy } from "./policy.ts";

export const X_SIGNALS: SignalSet = {
  bait_hook: {
    weight: 0.95,
    question: noul(
      {
        question:
          "Does `post.text` withhold its actual content and promise it elsewhere — in a thread, a reply, a DM, a link, or a bookmark-worthy list?",
        focus:
          "The tell is a promise of value that this post does not itself deliver. A post that simply IS the first of several, and still says something on its own, is not bait.",
      },
      "Promises value the post does not deliver: 'a thread 🧵', 'here are 10 tools, bookmark this', 'reply DEMO and I'll send it', 'full breakdown in the replies', 'most people don't know this — read on'",
      "The post delivers its own content, or links out without framing the link as withheld value",
    ),
  },

  hype_shill: {
    weight: 0.85,
    question: noul(
      {
        question:
          "Does `post.text` make breathless, superlative claims about a product, model, token, or tool, without specifics that a reader could check?",
        focus:
          "Judge the ratio of excitement to detail. Genuine enthusiasm WITH particulars — a benchmark, a version, a concrete thing it did — is not shilling.",
      },
      "Superlatives and no checkable detail: 'this changes everything', 'nobody is talking about this', 'we are so back', 'insane', '100x'",
      "Names specifics — a version, a number, a measured result, a concrete capability — or is not making promotional claims at all",
    ),
  },

  engagement_farm_format: {
    weight: 0.8,
    question: noul(
      {
        question:
          "Is `post.text` a listicle, ranked roundup, or 'X things that Y' inventory assembled mainly to be widely shared rather than to inform a specific reader?",
        focus:
          "Judge whether the list is doing real work. A curated list with genuine per-item detail is fine; a list of well-known names with one adjective each is not.",
      },
      "A roundup of obvious or barely-described items: '10 AI tools you're not using', '7 books that will change your life', each with a stock phrase and nothing specific",
      "Not a list, or a list whose items carry real, specific information",
    ),
  },
};

/**
 * NOTE the X calibration: level 2 ("a specific opinion, joke or observation") is a
 * perfectly good post. Only level 0 is real emptiness. LinkedIn's scale starts a notch
 * higher, because length there is not evidence of effort but it is evidence of intent.
 */
export const X_SUBSTANCE: ScoreQuestion = {
  type: "score",
  instructions: {
    question: "How much does `post.text` actually say?",
    focus:
      "Judge whether there is a real thought here, not the post's length, writing quality, or whether you agree. A short post can be substantive. Do not reward length.",
  },
  criteria: [
    {
      what: "Nothing: generic sentiment, a stock reaction, or pure engagement filler with no thought of its own",
      examples: ["This. 👇", "Massive if true.", "Consistency is everything."],
    },
    {
      what: "Thin: one vague or extremely familiar point that almost any reader already holds",
      examples: ["AI is going to change how we work.", "Ship fast and iterate."],
    },
    {
      what: "Real: a specific opinion, joke, observation, or question anchored to a particular thing — a normal good post",
      examples: [
        "every codebase has one file that everyone is scared to touch and it is always called utils.ts",
      ],
    },
    {
      what: "Substantial: a claim with support — numbers, a method, a named source, a result, or an argument a reader could check or act on",
      examples: [
        "Swapped our reranker for a 0.6B local model: p95 went 340ms → 41ms, recall@5 dropped 2 points.",
      ],
    },
  ],
};

/**
 * Tuned against samples/x.json (jev-1.13.0, 2026-09-22) with the holistic Choice leading.
 * Measured separation on that set: expected-good tops out at 0.43, expected-slop bottoms
 * out at 0.72.
 *
 * These numbers are meaningless on any other scale. They were re-derived from scratch when
 * the scorer changed from an averaged composite (gap 0.05) to the blended one (gap 0.29).
 */
export const X_POLICIES: Record<Preset, Policy> = {
  relaxed: {
    hideAt: 0.74,
    collapseAt: 0.64,
    hardSignalAt: 0.95,
    hardSignals: ["engagement_bait", "sells_something", "bait_hook"],
    interestAt: 0.7,
    excludeAt: 0.8,
  },
  balanced: {
    hideAt: 0.64,
    collapseAt: 0.52,
    hardSignalAt: 0.9,
    hardSignals: ["engagement_bait", "sells_something", "bait_hook", "ai_prose", "empty_wisdom"],
    interestAt: 0.65,
    excludeAt: 0.7,
  },
  strict: {
    hideAt: 0.56,
    collapseAt: 0.46,
    hardSignalAt: 0.8,
    hardSignals: [
      "engagement_bait",
      "sells_something",
      "bait_hook",
      "ai_prose",
      "empty_wisdom",
      "hype_shill",
      "rage_bait",
      "engagement_farm_format",
    ],
    interestAt: 0.6,
    excludeAt: 0.6,
  },
};
