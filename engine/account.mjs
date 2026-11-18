// A synthetic Meta account joined to a synthetic CRM, built to match the client's own example:
// about $3,000 a day and about $2,000 per paying client. Every rate is an assumption, stated here,
// and replaced by the real Ads Manager export and GoHighLevel pipeline on day 1.

import { mulberry32, binomial, poisson } from './rng.mjs';

export const ACCOUNT_ASSUMPTIONS = {
  seed: 7101,
  start: '2026-09-17', // 60 days of data
  days: 60,
  asOf: '2026-11-17', // CRM snapshot date
  dailySpend: 3000,
  businessHours: { open: 8, close: 18 }, // sales floor hours, local time, Mon-Fri
  afterHoursContactFactor: 0.72, // leads that wait overnight are reached less often
  consultRate: 0.66, // contacted leads who hold a consultation
  investigationFee: 750, // collected at signing
  resolutionFeeMedian: 3600,
  installments: 6, // resolution fee paid monthly, starting 30 days after signing
  cancelAfterInvestigation: 0.15,
  refundRate: 0.03,
  signDelayMedianDays: 8,
};

// type: instant = Meta instant form; website = GoHighLevel funnel; call = click-to-call landing page.
export const CAMPAIGNS = [
  { id: 'C1', name: 'LF | Instant form | Broad | Leads', type: 'instant', share: 0.34, cpl: 46, junk: 0.27, dup: 0.09, contact: 0.5, qual: 0.45, close: 0.2, attributionLoss: 0, metaOvercount: 0 },
  { id: 'C2', name: 'LF | Instant form + 3 qualifying questions | Leads', type: 'instant', share: 0.16, cpl: 84, junk: 0.07, dup: 0.03, contact: 0.7, qual: 0.66, close: 0.26, attributionLoss: 0, metaOvercount: 0 },
  { id: 'C3', name: 'LP | GHL funnel | Website leads', type: 'website', share: 0.3, cpl: 92, junk: 0.05, dup: 0.04, contact: 0.67, qual: 0.66, close: 0.27, attributionLoss: 0.24, metaOvercount: 0.31 },
  { id: 'C4', name: 'LP | Call-first page | Calls', type: 'call', share: 0.1, cpl: 128, junk: 0.04, dup: 0.02, contact: 0.95, qual: 0.6, close: 0.29, attributionLoss: 0.1, metaOvercount: 0 },
  { id: 'C5', name: 'RT | Site visitors 30d | Leads', type: 'instant', share: 0.1, cpl: 58, junk: 0.09, dup: 0.12, contact: 0.64, qual: 0.56, close: 0.22, attributionLoss: 0, metaOvercount: 0 },
];

// Creative angles. Multipliers on cost per lead, qualification, close rate and fee size.
export const ANGLES = {
  notice: { label: 'IRS notice explained', cpl: 1.0, qual: 1.05, close: 1.05, fee: 1.0, risk: false },
  levy: { label: 'Wage garnishment and levy', cpl: 1.15, qual: 1.2, close: 1.15, fee: 1.15, risk: false },
  unfiled: { label: 'Unfiled returns for 1099 workers', cpl: 0.95, qual: 1.0, close: 1.0, fee: 0.95, risk: false },
  pennies: { label: '"Settle for pennies on the dollar"', cpl: 0.68, qual: 0.52, close: 0.6, fee: 0.85, risk: true },
  testimonial: { label: 'Client testimonial video', cpl: 1.1, qual: 1.15, close: 1.3, fee: 1.05, risk: false },
  payplan: { label: 'Payment plan explainer', cpl: 0.88, qual: 0.78, close: 0.9, fee: 0.7, risk: false },
  founder: { label: 'Founder: no gimmicks, real reviews', cpl: 1.05, qual: 1.1, close: 1.12, fee: 1.0, risk: false },
};

// Ads per campaign: [angle, weight]. Ad IDs are campaign + index.
export const ADS = {
  C1: [['pennies', 3.2], ['payplan', 1.6], ['notice', 1.2], ['unfiled', 1.0], ['levy', 0.6]],
  C2: [['notice', 1.4], ['levy', 1.2], ['testimonial', 1.0], ['unfiled', 0.8]],
  C3: [['levy', 1.6], ['testimonial', 1.4], ['notice', 1.2], ['founder', 0.9], ['pennies', 0.7]],
  C4: [['levy', 1.2], ['notice', 0.8]],
  C5: [['testimonial', 1.2], ['founder', 1.0], ['payplan', 0.6]],
};

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
export const dateOf = (ms) => iso(ms).slice(0, 10);

function lognormal(rand, median, sigma) {
  let u = 0;
  while (u === 0) u = rand();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  return median * Math.exp(sigma * z);
}

// Hour-of-day weights for lead creation (local time): evenings are busy on Meta.
const HOUR_W = [0.5, 0.3, 0.2, 0.2, 0.3, 0.6, 1, 1.6, 2.2, 2.6, 2.8, 2.8, 2.9, 2.9, 2.8, 2.7, 2.7, 2.9, 3.2, 3.5, 3.6, 3.2, 2.2, 1.1];
const HOUR_SUM = HOUR_W.reduce((a, b) => a + b, 0);
function pickHour(rand) {
  let r = rand() * HOUR_SUM;
  for (let h = 0; h < 24; h++) { r -= HOUR_W[h]; if (r < 0) return h; }
  return 23;
}

export function generateAccount(opts = {}) {
  const a = { ...ACCOUNT_ASSUMPTIONS, ...opts };
  const rand = mulberry32(a.seed);
  const start = Date.parse(a.start + 'T00:00:00Z');
  const asOf = Date.parse(a.asOf + 'T23:59:59Z');
  const ads = [];
  for (const c of CAMPAIGNS) {
    ADS[c.id].forEach(([angle, w], i) => ads.push({ id: `${c.id}-A${i + 1}`, campaign: c.id, angle, weight: w }));
  }
  const daily = []; // ad x day rows, like an Ads Manager export
  const leads = []; // CRM rows
  let leadSeq = 0;
  for (let d = 0; d < a.days; d++) {
    const dayMs = start + d * DAY;
    const dow = new Date(dayMs).getUTCDay();
    for (const c of CAMPAIGNS) {
      const campaignSpend = a.dailySpend * c.share * (0.88 + rand() * 0.24);
      const cAds = ads.filter((x) => x.campaign === c.id);
      const wsum = cAds.reduce((s, x) => s + x.weight, 0);
      for (const ad of cAds) {
        const ang = ANGLES[ad.angle];
        const spend = campaignSpend * ad.weight / wsum;
        // The biggest cheap ad fatigues: cost per lead creeps up as frequency climbs.
        const fatigue = ad.id === 'C1-A1' ? 1 + 0.012 * d : 1;
        const impressions = Math.round(spend / (14 + rand() * 6) * 1000);
        const freq = ad.id === 'C1-A1' ? 1.4 + 0.045 * d : 1.3 + rand() * 0.4;
        const expected = spend / (c.cpl * ang.cpl * fatigue);
        const n = poisson(rand, expected);
        const clicks = Math.round(impressions * (0.009 + 0.004 * rand()) / fatigue);
        let metaLeads = n;
        if (c.metaOvercount) metaLeads += binomial(rand, n, c.metaOvercount); // pixel + server both counted
        daily.push({ date: dateOf(dayMs), campaign: c.id, ad: ad.id, angle: ad.angle, spend, impressions, clicks, metaLeads, frequency: freq });
        for (let k = 0; k < n; k++) {
          const hour = pickHour(rand);
          const created = dayMs + hour * 3600000 + Math.floor(rand() * 3600000);
          const afterHours = dow === 0 || dow === 6 || hour < a.businessHours.open || hour >= a.businessHours.close;
          const lead = {
            id: `L${String(++leadSeq).padStart(5, '0')}`, created: iso(created), campaign: c.id, ad: ad.id, angle: ad.angle,
            attributed: rand() >= c.attributionLoss, afterHours,
            duplicate: rand() < c.dup, junk: false, contacted: false, contactHours: null, consult: false, qualified: false,
            signedTrue: false, signedDate: null, signed: false, fee: 0, cancelled: false, payments: [],
          };
          lead.junk = !lead.duplicate && rand() < c.junk;
          if (!lead.duplicate && !lead.junk) {
            const pContact = c.contact * (afterHours ? a.afterHoursContactFactor : 1);
            lead.contacted = rand() < pContact;
            if (lead.contacted) {
              lead.contactHours = afterHours ? lognormal(rand, 13, 0.5) : lognormal(rand, 0.35, 0.9);
              lead.consult = rand() < a.consultRate;
              if (lead.consult) {
                lead.qualified = rand() < Math.min(0.95, c.qual * ang.qual);
                if (lead.qualified && rand() < Math.min(0.9, c.close * ang.close)) {
                  lead.signedTrue = true;
                  const delay = Math.min(60, Math.max(1, lognormal(rand, a.signDelayMedianDays, 0.75)));
                  const signedMs = created + delay * DAY;
                  lead.signedDateTrue = dateOf(signedMs);
                  if (signedMs <= asOf) {
                    lead.signed = true;
                    lead.signedDate = dateOf(signedMs);
                  }
                  const resolution = lognormal(rand, a.resolutionFeeMedian * ang.fee, 0.35);
                  lead.cancelled = rand() < a.cancelAfterInvestigation;
                  lead.fee = Math.round(a.investigationFee + (lead.cancelled ? 0 : resolution));
                  const pay = [{ date: dateOf(signedMs), amount: a.investigationFee }];
                  if (!lead.cancelled) {
                    const inst = Math.round(resolution / a.installments);
                    for (let m = 1; m <= a.installments; m++) pay.push({ date: dateOf(signedMs + m * 30 * DAY), amount: inst });
                  }
                  lead.payments = pay;
                }
              }
            }
          }
          leads.push(lead);
        }
      }
    }
  }
  return { assumptions: a, campaigns: CAMPAIGNS, angles: ANGLES, ads, daily, leads };
}
