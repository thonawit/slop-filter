// LinkedIn-specific signals, substance scale, and thresholds.
//
// WHY LINKEDIN IS NOT X
//
// On X, brevity is the format and absence of information proves nothing. On LinkedIn a
// post is long by default, so a long post that says nothing is evidence of intent — it
// took effort to write that much and still deliver nothing. `no_substance` therefore
// earns its place here and is deliberately absent from the X battery.
//
// The other LinkedIn native is the formulaic personal anecdote: setup, turn, numbered
// lessons for the reader. It has no real equivalent on X.

import type { Preset, ScoreQuestion } from "../types.ts";
import { noul, type SignalSet } from "./core.ts";
import type { Policy } from "./policy.ts";

export const LINKEDIN_SIGNALS: SignalSet = {
  bait_hook: {
    weight: 0.85,
    question: noul(
      {
        question:
          "Does `post.text` open with a short dramatic or curiosity-gap hook line that the rest of the post does not substantively pay off?",
        focus:
          "Judge the opening line against what follows. Also counts when the promised substance is deferred to the comments, a carousel, or a link.",
      },
      "Opens with a provocative or vague teaser ('I got fired. Best thing that ever happened.', 'Nobody talks about this.', 'Unpopular opinion:') and the body is thin, generic, or defers the point elsewhere",
      "Opens plainly, or the hook is followed by substantive, specific content that delivers on it",
    ),
  },

  formula_story: {
    weight: 0.8,
    question: noul(
      {
        question:
          "Does `post.text` follow the formulaic personal-anecdote template: a short setup event, a turn, and then a list of lessons or a moral aimed at the reader?",
        focus: "The template itself, regardless of whether the event was real.",
      },
      "A setup ('Last week a junior asked me...', 'I was rejected 47 times.'), a pivot, then 'Here's what I learned' / numbered lessons / a closing moral",
      "No such arc: it is news, analysis, a question, a plain announcement, or a story told without a lessons-for-you payload",
    ),
  },

  engagement_farm_format: {
    weight: 0.75,
    question: noul(
      {
        question:
          "Is `post.text` a numbered roundup or inventory — '10 tools', '7 lessons', '5 mistakes' — assembled mainly to be saved and shared rather than to inform a specific reader?",
        focus:
          "Counts whether the list is in the text itself OR announced here and delivered in an attached carousel, document or image (see `post.has_media`). Judge whether the list is doing real work: a roundup whose items carry genuine specifics is fine; a parade of well-known names with one stock phrase each is not. A post that happens to enumerate steps while making an argument is NOT a roundup.",
      },
      {
        what: "A shareable inventory with little per-item substance, or a teaser announcing one delivered in the carousel",
        examples: [
          "10 AI tools every marketer needs in 2026 👇 (swipe)",
          "7 books that will change how you lead. Save this post.",
          "I turned ten of my weekly jobs into reusable workflows. Full breakdown in the carousel.",
        ],
      },
      {
        what: "Not a roundup, or a list whose items carry real, checkable specifics",
        examples: [
          "We cut onboarding from 6 weeks to 2. Three things did it: a buddy per hire, a written first-sprint scope, and killing the shadowing week.",
          "Postgres 19 beta is out. The DDL replication change matters if you run logical replication.",
        ],
      },
    ),
  },

  no_substance: {
    // Justified on LinkedIn only. On X this question would fire on most of a normal
    // timeline, because a good post there is often eight words with no checkable fact.
    weight: 1.0,
    question: noul(
      {
        question:
          "Does `post.text` contain no specific, checkable information at all: no named tool, number, event, example, method, or concrete recommendation?",
        focus:
          "Presence of at least one specific, usable particular is enough for 'no'. Judge the post as written, not the topic it gestures at.",
      },
      "Nothing specific: a reader learns no fact, example, or method they did not already have",
      "Contains at least one specific particular: a named tool or company, a figure, a concrete example, a step, a date, a link with context",
    ),
  },
};

/**
 * LinkedIn's scale starts a notch above X's. Length is not evidence of effort, but on a
 * platform where posts are long by default it IS evidence of intent: a 300-word post that
 * lands on "be authentic" chose to take that much of your time.
 */
export const LINKEDIN_SUBSTANCE: ScoreQuestion = {
  type: "score",
  instructions: {
    question: "How much specific, useful content does `post.text` give a reader?",
    focus:
      "Judge information density and specificity, not writing quality or agreement with the author.",
  },
  criteria: [
    {
      what: "None: generic sentiment, motivation, or announcement with no particulars",
      examples: ["Hard work pays off. Keep going.", "Excited for what's next!"],
    },
    {
      what: "Thin: one vague point or a common tip most readers already know",
      examples: ["Tip: listen more than you talk in meetings."],
    },
    {
      what: "Some: a clear point with at least one concrete example, number, tool, or step",
      examples: [
        "We cut onboarding from 6 weeks to 2 by pairing every hire with a buddy for the first sprint.",
      ],
    },
    {
      what: "Substantial: several specifics, a method or analysis a reader could apply or verify",
      examples: [
        "Compared three vector DBs on 1M docs: p95 latency 42ms vs 61ms vs 118ms; here is the config that mattered.",
      ],
    },
  ],
};

/**
 * Tuned against samples/linkedin.json (jev-1.13.0, 2026-09-22).
 *
 * Measured separation on that set is wider than X's: expected-good tops out at 0.14 and
 * expected-slop bottoms out at 0.77. LinkedIn slop is more florid and more formulaic than
 * X slop, so the model commits harder — which is why the collapse band sits much lower
 * here than on X, where good and slop crowd together around 0.4.
 *
 * The X numbers were the starting point (same scorer) but did NOT transfer: they left
 * `humble_brag` at 0.46 showing when it should collapse, because X's collapse band starts
 * at 0.52 to cope with X's tighter distribution.
 */
export const LINKEDIN_POLICIES: Record<Preset, Policy> = {
  relaxed: {
    hideAt: 0.74,
    collapseAt: 0.55,
    hardSignalAt: 0.95,
    hardSignals: ["engagement_bait", "sells_something"],
    interestAt: 0.7,
    excludeAt: 0.8,
  },
  balanced: {
    hideAt: 0.64,
    collapseAt: 0.42,
    hardSignalAt: 0.9,
    hardSignals: ["engagement_bait", "sells_something", "empty_wisdom", "ai_prose"],
    interestAt: 0.65,
    excludeAt: 0.7,
  },
  strict: {
    hideAt: 0.56,
    collapseAt: 0.34,
    hardSignalAt: 0.8,
    hardSignals: [
      "engagement_bait",
      "sells_something",
      "empty_wisdom",
      "ai_prose",
      "no_substance",
      "formula_story",
      "rage_bait",
      "engagement_farm_format",
    ],
    interestAt: 0.6,
    excludeAt: 0.6,
  },
};
