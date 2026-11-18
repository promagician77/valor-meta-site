// Joins Ads Manager rows to CRM leads and judges every campaign, angle and ad on paying clients and
// cash, not on form fills. Client counts are maturity-adjusted: recent leads haven't had time to sign.

import { cacTargets } from './economics.mjs';

const DAY = 86400000;
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY;
const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

// Completion curve F(t): share of eventual signings that happen within t days of the lead.
// Estimated from leads old enough to have finished (created at least `matureAfter` days before asOf).
export function signingCurve(leads, asOf, matureAfter = 45) {
  const asOfIso = asOf + 'T23:59:59Z';
  const delays = leads
    .filter((l) => l.signed && days(l.created, asOfIso) >= matureAfter)
    .map((l) => days(l.created, l.signedDate + 'T12:00:00Z'))
    .filter((d) => d <= matureAfter)
    .sort((a, b) => a - b);
  const n = delays.length;
  const F = (t) => {
    if (!n) return 1;
    if (t >= matureAfter) return 1;
    let lo = 0;
    let hi = n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (delays[m] <= t) lo = m + 1; else hi = m; }
    return lo / n;
  };
  return { F, n, median: n ? delays[Math.floor(n / 2)] : null };
}

function blank() {
  return { spend: 0, impressions: 0, clicks: 0, metaLeads: 0, crmLeads: 0, duplicates: 0, junk: 0, valid: 0, contacted: 0, consults: 0, qualified: 0, signed: 0, projected: 0, cashToDate: 0, cash180: 0, afterHours: 0, afterHoursContacted: 0, afterHoursValid: 0, hoursValidContacted: 0, hoursValid: 0 };
}

// For a qualified lead not yet signed at the point its cohort is F complete, with eventual close
// rate c among qualified leads: P(signs later) = c(1 - F) / (1 - cF).
export function remainingSignProbability(c, F) {
  if (F >= 1) return 0;
  return (c * (1 - F)) / (1 - c * F);
}

// 80% range on a client count (normal approximation to Poisson), turned into a CAC range.
export function cacRange(spend, clients) {
  if (clients <= 0) return { lo: spend, hi: Infinity };
  const z = 1.2816;
  const lo = Math.max(0.5, clients - z * Math.sqrt(clients));
  const hi = clients + z * Math.sqrt(clients);
  return { lo: spend / hi, hi: spend / lo };
}

export function audit(account, { from, to, asOf } = {}) {
  const a = account.assumptions;
  asOf = asOf || a.asOf;
  to = to || asOf;
  const asOfIso = asOf + 'T23:59:59Z';
  const curve = signingCurve(account.leads, asOf);
  const rows = account.daily.filter((r) => (!from || r.date >= from) && r.date <= to);
  const inWindow = (l) => (!from || l.created.slice(0, 10) >= from) && l.created.slice(0, 10) <= to;
  const leads = account.leads.filter(inWindow);

  // Average 180-day cash per signed client, from clients already signed (invoices are known).
  const signedAll = account.leads.filter((l) => l.signed);
  const cashOf = (l, horizonEnd) => l.payments.filter((p) => p.date <= horizonEnd).reduce((s, p) => s + p.amount, 0);
  const cash180 = (l) => cashOf(l, new Date(Date.parse(l.signedDate) + 180 * DAY).toISOString().slice(0, 10));
  const cashPerClient = signedAll.length ? signedAll.reduce((s, l) => s + cash180(l), 0) / signedAll.length : 0;
  const targets = cacTargets(cashPerClient);

  // Close rate among qualified leads, per campaign, from leads old enough to have finished.
  // Shrunk toward the account-wide rate so a campaign with little history isn't over-read.
  const mature = account.leads.filter((l) => l.qualified && days(l.created, asOfIso) >= 45);
  const cGlobal = mature.length ? mature.filter((l) => l.signed).length / mature.length : 0.25;
  const cBy = {};
  for (const c of account.campaigns) {
    const m = mature.filter((l) => l.campaign === c.id);
    const k = 20;
    cBy[c.id] = (m.filter((l) => l.signed).length + k * cGlobal) / (m.length + k);
  }
  // Expected eventual signing for one lead: 1 if signed; for a qualified lead not yet signed at age t,
  // P(signs later) = c(1 - F(t)) / (1 - c F(t)); otherwise 0.
  const expectedClient = (l, age) => {
    if (l.signed) return 1;
    if (!l.qualified) return 0;
    return remainingSignProbability(cBy[l.campaign] ?? cGlobal, curve.F(age));
  };

  const groups = { campaign: {}, angle: {}, ad: {}, total: { all: blank() } };
  const touch = (dim, key) => (groups[dim][key] ||= blank());
  for (const r of rows) {
    for (const g of [touch('campaign', r.campaign), touch('angle', r.angle), touch('ad', r.ad), groups.total.all]) {
      g.spend += r.spend; g.impressions += r.impressions; g.clicks += r.clicks; g.metaLeads += r.metaLeads;
    }
  }
  let unattributed = blank();
  for (const l of leads) {
    const age = days(l.created, asOfIso);
    const expect = expectedClient(l, age);
    const targetsFor = l.attributed ? [touch('campaign', l.campaign), touch('angle', l.angle), touch('ad', l.ad), groups.total.all] : [unattributed, groups.total.all];
    for (const g of targetsFor) {
      g.crmLeads++;
      if (l.duplicate) { g.duplicates++; continue; }
      if (l.junk) { g.junk++; continue; }
      g.valid++;
      if (l.afterHours) { g.afterHoursValid++; if (l.contacted) g.afterHoursContacted++; } else { g.hoursValid++; if (l.contacted) g.hoursValidContacted++; }
      if (l.afterHours) g.afterHours++;
      if (l.contacted) g.contacted++;
      if (l.consult) g.consults++;
      if (l.qualified) g.qualified++;
      g.projected += expect;
      if (l.signed) {
        g.signed++;
        g.cashToDate += cashOf(l, asOf);
        g.cash180 += cash180(l);
      }
    }
  }
  // Projected clients not yet signed bring average cash.
  const finish = (g) => {
    g.cash180 += Math.max(0, g.projected - g.signed) * cashPerClient;
    g.cpl = g.metaLeads ? g.spend / g.metaLeads : null;
    g.costPerValid = g.valid ? g.spend / g.valid : null;
    g.costPerQualified = g.qualified ? g.spend / g.qualified : null;
    g.cacToDate = g.signed ? g.spend / g.signed : null;
    g.cac = g.projected ? g.spend / g.projected : null;
    g.cacRange = cacRange(g.spend, g.projected);
    g.cashRoas = g.spend ? g.cash180 / g.spend : null;
    g.coverage = g.metaLeads ? g.crmLeads / g.metaLeads : null;
    g.junkRate = g.crmLeads ? (g.junk + g.duplicates) / g.crmLeads : 0;
    g.contactRate = g.valid ? g.contacted / g.valid : 0;
    g.qualifiedRate = g.valid ? g.qualified / g.valid : 0;
    g.closeRate = g.qualified ? g.projected / g.qualified : 0;
    return g;
  };
  for (const dim of ['campaign', 'angle', 'ad', 'total']) for (const g of Object.values(groups[dim])) finish(g);
  finish(unattributed);

  const T = groups.total.all;
  const qualToClient = T.qualified ? T.projected / T.qualified : 0;
  const targetCpq = targets.target * qualToClient;
  const enoughClients = 8;
  const angles = account.angles;

  const judge = (g, { risk = false, tracking = true } = {}) => {
    const reasons = [];
    let verdict;
    if (risk) {
      verdict = 'pause';
      reasons.push('Compliance risk: "pennies on the dollar" is the claim regulators pursued against tax-relief firms.');
    } else if (tracking && g.coverage !== null && g.coverage < 0.85) {
      verdict = 'fix';
      reasons.push(`Tracking: the CRM holds ${Math.round(g.coverage * 100)}% of the leads Meta reports, so Meta is optimizing on numbers that don't match sales.`);
    } else if (g.projected >= enoughClients) {
      if (g.cac <= targets.target) { verdict = 'scale'; reasons.push(`CAC ${usd(g.cac)} is under the ${usd(targets.target)} target.`); }
      else if (g.cac <= targets.breakEven) { verdict = 'test'; reasons.push(`CAC ${usd(g.cac)} is profitable but above target; iterate before scaling.`); }
      else if (g.costPerQualified <= targetCpq * 1.2) { verdict = 'fix'; reasons.push(`Qualified leads cost ${usd(g.costPerQualified)} (fine), but too few close: contact speed or sales handling.`); }
      else { verdict = 'pause'; reasons.push(`CAC ${usd(g.cac)} is above break-even (${usd(targets.breakEven)}) and qualified leads cost ${usd(g.costPerQualified)}.`); }
    } else if (g.costPerQualified !== null && g.costPerQualified <= targetCpq) {
      verdict = 'test'; reasons.push(`Too few clients to judge CAC; qualified leads at ${usd(g.costPerQualified)} are under the ${usd(targetCpq)} benchmark.`);
    } else if (g.costPerQualified === null || g.costPerQualified > targetCpq * 1.5) {
      verdict = 'pause'; reasons.push(`Too few clients to judge CAC, and qualified leads cost ${g.costPerQualified === null ? 'more than the spend' : usd(g.costPerQualified)}.`);
    } else {
      verdict = 'test'; reasons.push('Too few clients to judge yet; keep at test budget.');
    }
    return { verdict, reasons };
  };

  const campaigns = account.campaigns.map((c) => ({ id: c.id, name: c.name, type: c.type, ...groups.campaign[c.id], ...judge(groups.campaign[c.id]) }));
  const angleRows = Object.keys(angles).map((k) => ({ id: k, label: angles[k].label, ...groups.angle[k], ...judge(groups.angle[k], { risk: angles[k].risk, tracking: false }) }));
  const adRows = account.ads.map((ad) => ({ id: ad.id, campaign: ad.campaign, angle: ad.angle, ...groups.ad[ad.id] }));

  // Speed to lead: what reaching after-hours leads at the business-hours rate would add.
  const ahRate = T.afterHoursValid ? T.afterHoursContacted / T.afterHoursValid : 0;
  const bhRate = T.hoursValid ? T.hoursValidContacted / T.hoursValid : 0;
  const clientsPerContact = T.contacted ? T.projected / T.contacted : 0;
  const extraClients = T.afterHoursValid * (bhRate - ahRate) * clientsPerContact;

  // Spend on ads that sit in a paused campaign or use a paused angle (each ad counted once).
  const pausedC = new Set(campaigns.filter((c) => c.verdict === 'pause').map((c) => c.id));
  const pausedA = new Set(angleRows.filter((x) => x.verdict === 'pause').map((x) => x.id));
  const pauseSpend = adRows.filter((x) => pausedC.has(x.campaign) || pausedA.has(x.angle)).reduce((s, x) => s + (x.spend || 0), 0);

  return {
    window: { from: from || account.daily[0].date, to, asOf },
    total: T, unattributed, campaigns, angles: angleRows, ads: adRows,
    curve: { n: curve.n, median: curve.median, at7: curve.F(7), at14: curve.F(14), at30: curve.F(30), closeRateGlobal: cGlobal, closeRateByCampaign: cBy },
    economics: { cashPerClient, ...targets, targetCpq, qualToClient },
    speedToLead: { afterHoursShare: T.valid ? T.afterHoursValid / T.valid : 0, afterHoursContact: ahRate, hoursContact: bhRate, extraClients },
    flags: {
      overcount: campaigns.filter((c) => c.coverage !== null && c.coverage < 0.85).map((c) => ({ id: c.id, coverage: c.coverage })),
      unattributedLeads: unattributed.crmLeads,
      duplicates: T.duplicates,
      instantFormLeadsPerMonth: campaigns.filter((c) => c.type === 'instant').reduce((s, c) => s + c.crmLeads, 0) / Math.max(1, days(from || account.daily[0].date, to + 'T23:59:59Z')) * 30,
    },
    pauseSpend,
  };
}
