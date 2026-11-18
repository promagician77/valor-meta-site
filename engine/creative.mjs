// Creative testing: how much data 20 variations a week can buy, and which way of picking winners
// finds ads that produce paying clients rather than cheap form fills.

import { mulberry32, normal, poisson, binomial } from './rng.mjs';

export const TEST_DEFAULTS = {
  dailySpend: 3000,
  testShare: 0.15, // share of spend reserved for testing
  variants: 20,
  concepts: 4, // 5 variations per concept, one ad set per concept
  cpm: 16,
  baseCtr: 0.011,
  baseCpl: 75,
  baseQualRate: 0.17, // qualified leads per lead
  closeOfQualified: 0.3,
  // How fast lead quality falls as cost per lead falls (log-slope). 1.8 fits the angle table;
  // below 1, cheaper leads would also be cheaper clients.
  qualitySlope: 1.8,
};

// What one week of testing buys per variation and per concept.
export function testBudget(p = {}) {
  const a = { ...TEST_DEFAULTS, ...p };
  const weekly = a.dailySpend * a.testShare * 7;
  const perVariant = weekly / a.variants;
  const perConcept = weekly / a.concepts;
  const v = {
    spend: perVariant,
    impressions: (perVariant / a.cpm) * 1000,
    clicks: (perVariant / a.cpm) * 1000 * a.baseCtr,
    leads: perVariant / a.baseCpl,
    qualified: (perVariant / a.baseCpl) * a.baseQualRate,
    clients: (perVariant / a.baseCpl) * a.baseQualRate * a.closeOfQualified,
  };
  const c = {
    spend: perConcept,
    leads: perConcept / a.baseCpl,
    qualified: (perConcept / a.baseCpl) * a.baseQualRate,
    clients: (perConcept / a.baseCpl) * a.baseQualRate * a.closeOfQualified,
  };
  // Weeks a concept needs to collect enough qualified leads to compare (about 15).
  const weeksForQualified = 15 / Math.max(1e-9, c.qualified);
  return { weekly, perVariant: v, perConcept: c, weeksForQualified, ...a };
}

// The week's 20 variations: iterate on proven winners before inventing new concepts.
export const WEEK_PLAN = [
  { concept: 'Client testimonial (proven)', kind: 'iteration', variants: ['Same client, first 3 seconds re-cut to the outcome', 'Same story, captioned for sound-off', 'Second client, same structure', 'Static pull-quote from the video', 'Same video, 9:16 Reels edit'] },
  { concept: 'Wage garnishment and levy (proven)', kind: 'iteration', variants: ['Hook: what a levy notice means', 'Hook: how long a garnishment takes to stop', 'Carousel: 3 steps after a levy notice', 'Enrolled agent on camera, 20 seconds', 'Static: plain-language timeline'] },
  { concept: 'Founder: no gimmicks (promising)', kind: 'iteration', variants: ['Founder on why the firm won’t promise "pennies"', 'Founder answers the top objection from sales calls', 'Office walk-through, real staff', 'Static: what we will and won’t promise', 'Review screenshots montage'] },
  { concept: 'Unfiled returns for 1099 workers (new)', kind: 'new', variants: ['Hook: what happens when returns go unfiled', 'Contractor on camera: getting back into compliance', 'Static: checklist of documents to gather', 'Myth vs fact: substitute-for-return', 'Carousel: the first 30 days'] },
];

// Simulated weeks: each variation has true cost per lead, click-through and qualified rate.
// Cheap-lead concepts tend to attract unqualified people (the "pennies" pattern), so the variable
// that is easy to see (CPL) points the wrong way more often than it looks.
function makeWeek(rand, a) {
  const out = [];
  for (let ci = 0; ci < a.concepts; ci++) {
    const cheap = normal(rand) * 0.28; // log CPL shift for the concept
    // Fitted to the angle table: quality falls faster than cost (log-slope about 1.8), so a
    // concept that halves cost per lead roughly triples cost per client.
    const quality = a.qualitySlope * cheap + normal(rand) * 0.25;
    const hook = -0.6 * cheap + normal(rand) * 0.2; // cheaper concepts also get clicked more
    for (let vi = 0; vi < a.variants / a.concepts; vi++) {
      const cplMult = Math.exp(cheap + normal(rand) * 0.15);
      const qualMult = Math.exp(quality + normal(rand) * 0.12);
      const ctrMult = Math.exp(hook + normal(rand) * 0.15);
      const cpl = a.baseCpl * cplMult;
      const q = Math.min(0.6, a.baseQualRate * qualMult);
      out.push({ concept: ci, cpl, q, ctr: a.baseCtr * ctrMult, trueCostPerClient: cpl / (q * a.closeOfQualified) });
    }
  }
  return out;
}

function observe(rand, v, spend, a) {
  const impressions = Math.round((spend / a.cpm) * 1000);
  const clicks = binomial(rand, impressions, v.ctr);
  const leads = poisson(rand, spend / v.cpl);
  const qualified = binomial(rand, leads, v.q);
  return { spend, impressions, clicks, leads, qualified };
}

// Picking rules. Each returns the indices of up to `k` variations to promote.
export const RULES = {
  lowestCpl: {
    label: 'Lowest cost per lead',
    pick(obs, k) {
      return obs.map((o, i) => [i, o.leads ? o.spend / o.leads : Infinity]).sort((x, y) => x[1] - y[1]).slice(0, k).map((x) => x[0]);
    },
  },
  highestCtr: {
    label: 'Highest click-through',
    pick(obs, k) {
      return obs.map((o, i) => [i, o.clicks / o.impressions]).sort((x, y) => y[1] - x[1]).slice(0, k).map((x) => x[0]);
    },
  },
  staged: {
    label: 'Staged: attention filter, then cost per qualified lead',
    pick(obs, k, ctx) {
      // Stage 1: drop variations whose click-through is clearly below their concept's median.
      const keep = obs.map((o, i) => i).filter((i) => {
        const peers = obs.filter((o, j) => ctx.concept[j] === ctx.concept[i]).map((o) => o.clicks / o.impressions).sort((x, y) => x - y);
        const median = peers[Math.floor(peers.length / 2)];
        const o = obs[i];
        const ctr = o.clicks / o.impressions;
        const se = Math.sqrt(Math.max(median * (1 - median), 1e-9) / Math.max(1, o.impressions));
        return ctr >= median - 2 * se;
      });
      // Stage 2: pool qualified leads by concept (CRM feedback), shrink toward the account rate,
      // and promote the best variations of concepts that beat the account benchmark.
      const prior = { a: 3, b: 3 * ctx.accountCpq };
      const conceptScore = {};
      for (const c of new Set(ctx.concept)) {
        const idx = obs.map((o, i) => i).filter((i) => ctx.concept[i] === c);
        const q = idx.reduce((s, i) => s + obs[i].qualified, 0);
        const sp = idx.reduce((s, i) => s + obs[i].spend, 0);
        conceptScore[c] = (prior.b + sp) / (prior.a + q); // posterior mean cost per qualified lead
      }
      const ranked = keep
        .filter((i) => conceptScore[ctx.concept[i]] < ctx.accountCpq)
        .map((i) => {
          const o = obs[i];
          const own = (prior.b + o.spend) / (prior.a + o.qualified);
          return [i, 0.6 * conceptScore[ctx.concept[i]] + 0.4 * own];
        })
        .sort((x, y) => x[1] - y[1]);
      return ranked.slice(0, k).map((x) => x[0]);
    },
  },
};

// Run many simulated weeks; report how good the promoted ads really are.
export function simulateSelection({ weeks = 2000, seed = 5, k = 2, budget = {}, rules = Object.keys(RULES) } = {}) {
  const a = { ...TEST_DEFAULTS, ...budget };
  const rand = mulberry32(seed);
  const tb = testBudget(a);
  const control = a.baseCpl / (a.baseQualRate * a.closeOfQualified);
  const accountCpq = a.baseCpl / a.baseQualRate;
  const stats = Object.fromEntries(rules.map((r) => [r, { promoted: 0, worse: 0, muchWorse: 0, better: 0, sumRatio: 0, weeksNone: 0 }]));
  let bestPossible = 0;
  for (let w = 0; w < weeks; w++) {
    const week = makeWeek(rand, a);
    // Spend a bit more than a week on each variation: two weekly cycles of test budget
    // pooled, the most a 20-a-week cadence can give one variation before it must be judged.
    const obs = week.map((v) => observe(rand, v, tb.perVariant.spend * 2, a));
    const ctx = { concept: week.map((v) => v.concept), accountCpq };
    bestPossible += week.filter((v) => v.trueCostPerClient < control).length > 0 ? 1 : 0;
    for (const r of rules) {
      const picks = RULES[r].pick(obs, k, ctx);
      const s = stats[r];
      if (!picks.length) s.weeksNone++;
      for (const i of picks) {
        const ratio = week[i].trueCostPerClient / control;
        s.promoted++;
        s.sumRatio += ratio;
        if (ratio < 1) s.better++;
        if (ratio > 1) s.worse++;
        if (ratio > 1.3) s.muchWorse++;
      }
    }
  }
  const out = {};
  for (const r of rules) {
    const s = stats[r];
    out[r] = {
      label: RULES[r].label,
      promoted: s.promoted,
      shareBetter: s.promoted ? s.better / s.promoted : 0,
      shareMuchWorse: s.promoted ? s.muchWorse / s.promoted : 0,
      meanCostVsControl: s.promoted ? s.sumRatio / s.promoted : null,
      weeksWithNoPromotion: s.weeksNone / weeks,
    };
  }
  return { weeks, control, perVariantSpend: tb.perVariant.spend * 2, weeksWithAWinnerAvailable: bestPossible / weeks, rules: out };
}
