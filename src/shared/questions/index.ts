// Assembles the per-platform request: state, questions, signal set, policies.
//
// One post per request, every question for that post in it. Questions are evaluated in
// parallel against the same state, so adding one costs its own tokens and almost no
// latency — but batching several POSTS into one state is a different operation that
// degrades answers, and is not done here.

import type { Platform, PostState, Preset, Questions, ScoreQuestion } from "../types.ts";
import {
  CORE_SIGNALS,
  VERDICT_CHOICE,
  excludedTopicQuestions,
  interestQuestions,
  type SignalSet,
} from "./core.ts";
import { LINKEDIN_POLICIES, LINKEDIN_SIGNALS, LINKEDIN_SUBSTANCE } from "./linkedin.ts";
import type { Policy } from "./policy.ts";
import { X_POLICIES, X_SIGNALS, X_SUBSTANCE } from "./x.ts";

export * from "./core.ts";
export type { Policy } from "./policy.ts";

/** Core signals plus the platform's own. Platform keys win on collision (e.g. bait_hook). */
export function signalsFor(platform: Platform): SignalSet {
  return { ...CORE_SIGNALS, ...(platform === "x" ? X_SIGNALS : LINKEDIN_SIGNALS) };
}

export function substanceFor(platform: Platform): ScoreQuestion {
  return platform === "x" ? X_SUBSTANCE : LINKEDIN_SUBSTANCE;
}

export function policyFor(platform: Platform, preset: Preset): Policy {
  return (platform === "x" ? X_POLICIES : LINKEDIN_POLICIES)[preset];
}

// ---------------------------------------------------------------------------
// State. Only what the questions need.
//
// No engagement counts: numbers are noise to a semantic judge, and jev-1.13 is weak at
// arithmetic. Optional fields are omitted entirely when empty rather than sent as "", so
// neither platform pays tokens for the other's shape.
// ---------------------------------------------------------------------------

export interface JevState {
  post: {
    platform: string;
    text: string;
    is_repost: boolean;
    has_media: boolean;
    has_link: boolean;
    author_handle?: string;
    author_headline?: string;
    is_quote?: boolean;
  };
  quoted_post?: { text: string };
  interests?: string[];
  excluded_topics?: string[];
  [key: string]: unknown;
}

export function buildState(post: PostState, interests: string[], excludedTopics: string[]): JevState {
  const state: JevState = {
    post: {
      platform: post.platform === "x" ? "X (formerly Twitter)" : "LinkedIn",
      text: post.text,
      is_repost: post.isRepost,
      has_media: post.hasMedia,
      has_link: post.hasLink,
    },
  };
  if (post.handle) state.post.author_handle = post.handle;
  if (post.authorHeadline) state.post.author_headline = post.authorHeadline;
  if (post.platform === "x") state.post.is_quote = post.isQuote;
  if (post.quotedText) state.quoted_post = { text: post.quotedText };
  if (interests.length) state.interests = interests;
  if (excludedTopics.length) state.excluded_topics = excludedTopics;
  return state;
}

/** The full per-post request. */
export function buildQuestions(
  platform: Platform,
  interests: string[],
  excludedTopics: string[],
): Questions {
  const questions: Questions = {};
  for (const [id, signal] of Object.entries(signalsFor(platform))) questions[id] = signal.question;
  questions.substance = substanceFor(platform);
  questions.verdict = VERDICT_CHOICE;
  Object.assign(questions, interestQuestions(interests));
  Object.assign(questions, excludedTopicQuestions(excludedTopics));
  return questions;
}
