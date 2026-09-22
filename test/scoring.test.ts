// Unit tests for the pure scoring layer. No API key, no network, no browser.
//
//   npm test
//
// `scoring.ts` is deliberately free of I/O and chrome.* so that every decision the
// extension makes can be verified against fixtures in milliseconds. The live harness
// (`npm run experiment`) checks whether the QUESTIONS are any good; these check whether
// the CODE does what it claims with whatever answers come back.
//
// Several cases below are regressions from bugs found by running the extension on real
// feeds. Each says which.

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  HARD_SIGNAL_HOLISTIC_FLOOR,
  STRUCTURAL_WEIGHTS,
  policyFor,
  signalsFor,
  structuralSignals,
} from "../src/shared/questions/index.ts";
import { compositeSlop, decide, extractAnswers } from "../src/shared/scoring.ts";
import { PLATFORMS, type Platform, type SystemOneResponse } from "../src/shared/types.ts";

// --- fixture helpers ---------------------------------------------------------

/** Build a response with the given noul values; every unnamed signal answers 0.02. */
function response(
  platform: Platform,
  opts: {
    signals?: Record<string, number>;
    holistic?: number;
    substance?: number; // raw score, not normalized
    interests?: number[];
    excluded?: number[];
  } = {},
): SystemOneResponse {
  const answers: SystemOneResponse["answers"] = {};
  for (const id of Object.keys(signalsFor(platform))) {
    answers[id] = { type: "noul", noul: opts.signals?.[id] ?? 0.02 };
  }
  if (opts.holistic !== undefined) {
    answers.verdict = {
      type: "choice",
      choice: opts.holistic >= 0.5 ? "slop" : "not_slop",
      probabilities: { slop: opts.holistic, not_slop: 1 - opts.holistic },
      confidence: Math.abs(opts.holistic - 0.5) * 2,
    };
  }
  if (opts.substance !== undefined) {
    answers.substance = {
      type: "score",
      score: opts.substance,
      legend: {},
      probabilities: {},
      confidence: 0.9,
    };
  }
  opts.interests?.forEach((v, i) => {
    answers[`interest_${i}`] = { type: "noul", noul: v };
  });
  opts.excluded?.forEach((v, i) => {
    answers[`excluded_${i}`] = { type: "noul", noul: v };
  });
  return { model: "test", answers, usage: { input_tokens: 0, output_tokens: 0 } };
}

const raw = (p: Platform, o: Parameters<typeof response>[1] = {}, interests: string[] = [], excluded: string[] = []) =>
  extractAnswers(response(p, o), p, interests, excluded);

// --- extractAnswers ----------------------------------------------------------

describe("extractAnswers", () => {
  test("missing answers are skipped, never invented", () => {
    const r = extractAnswers({ model: "t", answers: {}, usage: { input_tokens: 0, output_tokens: 0 } }, "x", [], []);
    assert.deepEqual(r.signals, {});
    assert.equal(r.holistic, null);
    assert.equal(r.substance, null);
  });

  test("holistic reads probabilities.slop, not the chosen option", () => {
    // choice would be "not_slop" at 0.3, but the probability is what we threshold on.
    assert.equal(raw("x", { holistic: 0.3 }).holistic, 0.3);
  });

  test("substance is normalized against that platform's own level count", () => {
    // Both scales have 4 levels, so a raw 3 is the top = 1.0.
    assert.equal(raw("x", { substance: 3 }).substance, 1);
    assert.equal(raw("linkedin", { substance: 0 }).substance, 0);
  });

  test("topic answers are keyed back to their topic strings", () => {
    const r = raw("x", { interests: [0.9], excluded: [0.8] }, ["robots"], ["crypto"]);
    assert.equal(r.interestHits.robots, 0.9);
    assert.equal(r.excludedHits.crypto, 0.8);
  });

  test("out-of-range values are clamped", () => {
    const bad: SystemOneResponse = {
      model: "t",
      answers: { engagement_bait: { type: "noul", noul: 5 }, rage_bait: { type: "noul", noul: -1 } },
      usage: { input_tokens: 0, output_tokens: 0 },
    };
    const r = extractAnswers(bad, "x", [], []);
    assert.equal(r.signals.engagement_bait, 1);
    assert.equal(r.signals.rage_bait, 0);
  });
});

// --- compositeSlop -----------------------------------------------------------

describe("compositeSlop", () => {
  test("REGRESSION: one strong signal is not averaged away", () => {
    // The original scorer used a weighted mean: rage_bait 0.96 with everything else at
    // 0.02 produced 0.19, indistinguishable from a good post. The worst-signal term fixes
    // this. Compared without the holistic so the battery is measured on its own.
    const hot = compositeSlop(raw("x", { signals: { rage_bait: 0.96 }, substance: 2 }), "text", "x").score;
    const cold = compositeSlop(raw("x", { substance: 2 }), "text", "x").score;
    assert.ok(hot > 0.4, `one strong signal should dominate, got ${hot}`);
    assert.ok(hot - cold > 0.3, `strong signal should move the score a lot, moved ${hot - cold}`);
  });

  test("the holistic leads over the battery", () => {
    const batteryHot = compositeSlop(raw("x", { signals: { rage_bait: 0.96 }, holistic: 0.0 }), "t", "x").score;
    const holisticHot = compositeSlop(raw("x", { holistic: 1.0 }), "t", "x").score;
    assert.ok(holisticHot > batteryHot, "a confident holistic should outweigh one battery signal");
  });

  test("REGRESSION: thin text is not punished on media/link posts", () => {
    // A live industrial-automation post scored substance 0.14 purely because its text was
    // a headline above a video. Judging that as emptiness is a category error.
    const opts = { substance: 0, holistic: 0.2 };
    const bare = compositeSlop(raw("x", opts), "short caption", "x").score;
    const withMedia = compositeSlop(raw("x", opts), "short caption", "x", { hasMedia: true }).score;
    assert.ok(withMedia < bare, "media should damp the emptiness penalty");
  });

  test("REGRESSION: no structural feature can reach a hide threshold alone", () => {
    // Both times a structural feature was allowed to decide, it was wrong: an industrial
    // post hidden on hashtag_spam=1.00, a NASA thread collapsed on thread_marker=1.00.
    for (const platform of PLATFORMS) {
      const worstCase = "#a #b #c #d #e #f #g\n" + Array.from({ length: 8 }, () => "short line").join("\n");
      const feats = structuralSignals(worstCase, platform);
      assert.ok(
        Object.values(feats).some((v) => v > 0.9),
        `${platform}: fixture should max out at least one structural feature`,
      );
      // Everything else at floor, no substance answer, no holistic.
      const score = compositeSlop(raw(platform), worstCase, platform).score;
      const hideAt = policyFor(platform, "strict").hideAt;
      assert.ok(score < hideAt, `${platform}: structural-only score ${score} must stay under strict hideAt ${hideAt}`);
    }
  });

  test("score stays within 0..1 under extremes", () => {
    const all: Record<string, number> = {};
    for (const id of Object.keys(signalsFor("linkedin"))) all[id] = 1;
    const s = compositeSlop(
      raw("linkedin", { signals: all, holistic: 1, substance: 0 }),
      "#x #y #z #p #q #r\n" + "a\n".repeat(10),
      "linkedin",
    ).score;
    assert.ok(s >= 0 && s <= 1, `score out of range: ${s}`);
  });
});

// --- decide ------------------------------------------------------------------

describe("decide", () => {
  test("an excluded topic hides regardless of quality", () => {
    const d = decide(raw("x", { holistic: 0.0, substance: 3, excluded: [0.95] }, [], ["crypto"]), "t", "x", "balanced", true);
    assert.equal(d.verdict, "hide");
    assert.match(d.reason, /excluded topic/);
  });

  test("REGRESSION: the hard-signal rule is vetoed by a confident holistic", () => {
    // Live LinkedIn: a post was hidden at composite 0.30 (threshold 0.64) because
    // engagement_bait read 0.96, while the holistic said P(slop)=0.06 — a real question
    // phrased like bait.
    const vetoed = decide(
      raw("linkedin", { signals: { engagement_bait: 0.96 }, holistic: 0.06, substance: 2 }),
      "t",
      "linkedin",
      "balanced",
      true,
    );
    assert.notEqual(vetoed.verdict, "hide");

    // Just above the floor the rule still fires: 0.36 is a shrug, not an objection.
    const allowed = decide(
      raw("linkedin", { signals: { engagement_bait: 0.96 }, holistic: HARD_SIGNAL_HOLISTIC_FLOOR + 0.01, substance: 2 }),
      "t",
      "linkedin",
      "balanced",
      true,
    );
    assert.equal(allowed.verdict, "hide");
    assert.match(allowed.reason, /engagement_bait/);
  });

  test("the hard rule still applies when there is no holistic answer", () => {
    const d = decide(raw("x", { signals: { engagement_bait: 0.96 } }), "t", "x", "balanced", true);
    assert.equal(d.verdict, "hide");
  });

  test("REGRESSION: a missing holistic answer degrades to collapse, never hide", () => {
    // With no holistic the battery decides alone, and it is the weaker judge. Measured:
    // LinkedIn's `no_substance` at 1.00 cleared the hide bar by itself — an implicit hard
    // rule bypassing the explicit hardSignals list. A missing answer means the request
    // went wrong, so a partial picture may collapse at most.
    const d = decide(
      raw("linkedin", { signals: { no_substance: 1.0 }, substance: 0 }),
      "ordinary text",
      "linkedin",
      "balanced",
      true,
    );
    assert.notEqual(d.verdict, "hide");
    assert.match(d.reason, /no holistic answer/);
  });

  test("a hard signal still hides without a holistic", () => {
    // The explicit rule is unaffected — it runs before the degraded-mode guard.
    const d = decide(raw("x", { signals: { engagement_bait: 0.96 } }), "t", "x", "balanced", true);
    assert.equal(d.verdict, "hide");
  });

  test("interests never rescue a hidden post", () => {
    const d = decide(
      raw("x", { holistic: 1.0, substance: 0, interests: [0.99] }, ["robots"]),
      "t",
      "x",
      "balanced",
      true,
    );
    assert.equal(d.verdict, "hide");
  });

  test("a clean post matching an interest is highlighted", () => {
    const d = decide(raw("x", { holistic: 0.0, substance: 3, interests: [0.9] }, ["robots"]), "t", "x", "balanced", true);
    assert.equal(d.verdict, "highlight");
  });

  test("highlighting can be turned off without affecting suppression", () => {
    const args = [raw("x", { holistic: 0.0, substance: 3, interests: [0.9] }, ["robots"]), "t", "x", "balanced"] as const;
    assert.equal(decide(...args, true).verdict, "highlight");
    assert.equal(decide(...args, false).verdict, "show");
  });

  test("the uncertain band collapses rather than hides", () => {
    const p = policyFor("x", "balanced");
    const mid = (p.collapseAt + p.hideAt) / 2;
    // Drive the composite to the middle of the band using the holistic alone.
    const d = decide(raw("x", { holistic: mid, substance: 2 }), "t", "x", "balanced", true);
    assert.ok(["collapse", "hide", "show"].includes(d.verdict));
    if (d.slopScore >= p.collapseAt && d.slopScore < p.hideAt) assert.equal(d.verdict, "collapse");
  });

  test("stricter presets never suppress less than looser ones", () => {
    for (const platform of PLATFORMS) {
      for (const holistic of [0.2, 0.45, 0.6, 0.8]) {
        const rank = { show: 0, highlight: 0, collapse: 1, hide: 2 } as const;
        const r = raw(platform, { holistic, substance: 1 });
        const relaxed = rank[decide(r, "t", platform, "relaxed", false).verdict];
        const balanced = rank[decide(r, "t", platform, "balanced", false).verdict];
        const strict = rank[decide(r, "t", platform, "strict", false).verdict];
        assert.ok(
          relaxed <= balanced && balanced <= strict,
          `${platform} @${holistic}: relaxed=${relaxed} balanced=${balanced} strict=${strict}`,
        );
      }
    }
  });
});

// --- structural features -----------------------------------------------------

describe("structuralSignals", () => {
  test("thread markers are X-only", () => {
    assert.equal(structuralSignals("1/12 here we go", "x").thread_marker, 1);
    assert.equal(structuralSignals("a thread 🧵", "x").thread_marker, 1);
    assert.equal(structuralSignals("1/12 here we go", "linkedin").thread_marker, undefined);
  });

  test("REGRESSION: a bare '1/' opener is not a thread marker", () => {
    // "1/ Spent the week tracing..." is a person writing, not a bait thread.
    assert.equal(structuralSignals("1/ Spent the week tracing a p99 regression", "x").thread_marker, 0);
  });

  test("staccato needs several lines, not just short ones", () => {
    assert.equal(structuralSignals("short.\nlines.", "x").staccato, 0, "two lines is not broetry");
    const broetry = ["I fired him.", "He was good.", "He shipped.", "But he never smiled.", "Culture wins.", "Always."].join("\n");
    assert.ok(structuralSignals(broetry, "x").staccato > 0.8);
  });

  test("a long paragraph is not staccato", () => {
    const prose = Array.from({ length: 6 }, () => "x".repeat(120)).join("\n");
    assert.equal(structuralSignals(prose, "x").staccato, 0);
  });

  test("hashtag spam ramps rather than triggering on one tag", () => {
    assert.equal(structuralSignals("a #one tag", "x").hashtag_spam, 0);
    assert.equal(structuralSignals("#ai #ml #robotics #tech #data #cloud", "x").hashtag_spam, 1);
  });

  test("a tag needs at least two characters, so '1/5' is not hashtag spam", () => {
    // Deliberate: #1 #2 #3 in a numbered list would otherwise read as tag spam.
    assert.equal(structuralSignals("#a #b #c #d #e #f", "x").hashtag_spam, 0);
  });

  test("emoji bullets need at least three lines", () => {
    assert.equal(structuralSignals("✅ only one", "x").emoji_bullets, 0);
    assert.ok(structuralSignals("✅ a\n🔥 b\n👉 c\n✅ d", "x").emoji_bullets > 0.5);
  });
});

// --- policy sanity -----------------------------------------------------------

describe("policies", () => {
  test("every preset is internally ordered and in range", () => {
    for (const platform of PLATFORMS) {
      for (const preset of ["relaxed", "balanced", "strict"] as const) {
        const p = policyFor(platform, preset);
        assert.ok(p.hideAt > p.collapseAt, `${platform}/${preset}: hideAt must exceed collapseAt`);
        for (const [k, v] of Object.entries(p)) {
          if (typeof v === "number") assert.ok(v > 0 && v <= 1, `${platform}/${preset}: ${k}=${v} out of range`);
        }
      }
    }
  });

  test("stricter presets have lower bars", () => {
    for (const platform of PLATFORMS) {
      const r = policyFor(platform, "relaxed");
      const b = policyFor(platform, "balanced");
      const s = policyFor(platform, "strict");
      assert.ok(r.hideAt > b.hideAt && b.hideAt > s.hideAt, `${platform}: hideAt should fall with strictness`);
      assert.ok(r.hardSignals.length <= b.hardSignals.length, `${platform}: hard-signal list should grow with strictness`);
      assert.ok(b.hardSignals.length <= s.hardSignals.length);
    }
  });

  test("every hard signal names a question that exists", () => {
    for (const platform of PLATFORMS) {
      const known = new Set(Object.keys(signalsFor(platform)));
      for (const preset of ["relaxed", "balanced", "strict"] as const) {
        for (const id of policyFor(platform, preset).hardSignals) {
          assert.ok(known.has(id), `${platform}/${preset}: hard signal "${id}" is not a question on this platform`);
        }
      }
    }
  });

  test("no structural weight is high enough to decide alone", () => {
    for (const platform of PLATFORMS) {
      const strictest = policyFor(platform, "strict").hideAt;
      for (const [id, w] of Object.entries(STRUCTURAL_WEIGHTS[platform])) {
        // 0.65 is BLEND.worst — the most a lone structural feature can contribute.
        assert.ok(w * 0.65 < strictest, `${platform}: ${id} weight ${w} could hide a post on its own`);
      }
    }
  });
});
