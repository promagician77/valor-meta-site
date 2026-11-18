import { testBudget } from './engine/creative.mjs';
import { lint } from './engine/compliance.mjs';
import { buildEvent, validateEvent, sampleHooks, STAGES } from './engine/capi.mjs';
import { ECON, forecast, maxProfitableSpend, scalingLadder, paybackMonths } from './engine/economics.mjs';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const usd = (n) => (n === null || n === undefined || !Number.isFinite(n) ? '–' : `$${Math.round(n).toLocaleString('en-US')}`);
const pct = (x, dp = 0) => `${(x * 100).toFixed(dp)}%`;
const shortDate = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const VERDICT = {
  scale: { c: 'var(--scale)', g: '↑', w: 'Scale' },
  test: { c: 'var(--test)', g: '•', w: 'Test' },
  fix: { c: 'var(--fix)', g: '!', w: 'Fix' },
  pause: { c: 'var(--pause)', g: '×', w: 'Pause' },
};
const verdict = (v) => `<span class="verdict"><i style="--c:${VERDICT[v].c}" aria-hidden="true">${VERDICT[v].g}</i>${VERDICT[v].w}</span>`;
const STATUS = { pass: ['var(--scale)', '✓', 'Pass'], warn: ['var(--fix)', '!', 'Check'], block: ['var(--pause)', '×', 'Blocked'], fail: ['var(--pause)', '×', 'Fail'] };
const icon = (s) => `<span class="icon" style="--c:${STATUS[s][0]}" aria-hidden="true">${STATUS[s][1]}</span><span class="visually-hidden">${STATUS[s][2]}: </span>`;

const D = await (await fetch('data/results.json')).json();
const A = { 30: D.audit30, 60: D.audit60 };
const E = D.audit60.economics;

/* ---------- Hero: what each stage costs ---------- */
const view = { window: 60, count: 'adjusted' };
function renderStages() {
  const a = A[view.window];
  const T = a.total;
  const clients = view.count === 'signed' ? T.signed : T.projected;
  const cash = view.count === 'signed' ? T.cash180 - (T.projected - T.signed) * a.economics.cashPerClient : T.cash180;
  const top = T.metaLeads;
  const st = [
    ['Ad spend', usd(T.spend), `${view.window} days`, 1],
    ['Leads Meta reports', fmt(T.metaLeads), `${usd(T.spend / T.metaLeads)} each`, 1],
    ['Leads in the CRM', fmt(T.crmLeads), `${usd(T.spend / T.crmLeads)} each`, T.crmLeads / top],
    ['Real leads, no duplicates or junk', fmt(T.valid), `${usd(T.spend / T.valid)} each`, T.valid / top],
    ['Reached by phone', fmt(T.contacted), `${usd(T.spend / T.contacted)} each`, T.contacted / top],
    ['Qualified', fmt(T.qualified), `${usd(T.spend / T.qualified)} each`, T.qualified / top],
    ['Paying clients', view.count === 'signed' ? fmt(clients) : clients.toFixed(0), `<span class="hl">${usd(T.spend / clients)} each</span>`, clients / top],
    ['Cash in 180 days', usd(cash), `${(cash / T.spend).toFixed(2)}× spend`, Math.min(1, cash / T.spend / 3)],
  ];
  $('#stages').innerHTML = st.map(([label, count, per, w], i) => `<li class="stage${i === 6 ? ' key' : ''}"><span class="label">${label}</span><span class="count">${count}</span><span class="per">${per}</span><span class="bar"><i style="width:${Math.max(2, w * 100).toFixed(1)}%"></i></span></li>`).join('');
  const other = view.count === 'signed' ? T.cac : T.cacToDate;
  $('#receipt-note').innerHTML = view.count === 'signed'
    ? `Counting only clients signed by ${shortDate(a.window.asOf)}: ${usd(T.cacToDate)} per client. Leads from the last two weeks haven't had time to sign; adjusted for them it is ${usd(other)}.`
    : `Adjusted for leads still in the pipeline: ${usd(T.cac)} per client, against ${usd(other)} counting only clients signed so far. The adjustment was within ${pct(D.accuracy.mapeAdjusted)} of the true count on average across 10 test windows (5 simulated accounts); signed-so-far was off by ${pct(D.accuracy.mapeNaive)}.`;
}
for (const b of document.querySelectorAll('[data-window]')) b.addEventListener('click', () => { view.window = Number(b.dataset.window); document.querySelectorAll('[data-window]').forEach((x) => x.setAttribute('aria-checked', String(x === b))); renderStages(); });
for (const b of document.querySelectorAll('[data-count]')) b.addEventListener('click', () => { view.count = b.dataset.count; document.querySelectorAll('[data-count]').forEach((x) => x.setAttribute('aria-checked', String(x === b))); renderStages(); });
renderStages();

/* ---------- Findings ---------- */
const C = Object.fromEntries(D.audit60.campaigns.map((c) => [c.id, c]));
const G = Object.fromEntries(D.audit60.angles.map((x) => [x.id, x]));
const s60 = D.audit60.speedToLead;
const t30 = D.audit30.total;
$('#findings').innerHTML = [
  [`${usd(C.C1.cpl)} leads, ${usd(C.C1.cac)} clients`, `The cheapest leads in the account come from the broad instant-form campaign, and its clients cost more than the ${usd(E.breakEven)} break-even.`],
  [`Meta: ${fmt(C.C3.metaLeads)} leads. CRM: ${fmt(C.C3.crmLeads)}.`, `The landing-page campaign is over-reported by Meta and ${fmt(D.audit60.unattributed.crmLeads)} CRM leads have no campaign at all. Fix tracking before judging it.`],
  [`${fmt(G.pennies.crmLeads)} leads, ${G.pennies.projected.toFixed(0)} clients`, `"Pennies on the dollar" ads look cheap and close badly, and it is the claim regulators pursued against tax-relief firms.`],
  [`${pct(s60.afterHoursShare)} arrive after hours`, `Those leads are reached ${pct(s60.afterHoursContact)} of the time, against ${pct(s60.hoursContact)} in office hours.`],
  [`${usd(t30.cacToDate)} or ${usd(t30.cac)}?`, 'Counting only clients signed so far makes the last 30 days look worse than they are. Recent leads are still in the pipeline.'],
].map(([b, p]) => `<li><span class="big">${b}</span><p>${p}</p></li>`).join('');

/* ---------- Audit tables ---------- */
const T60 = D.audit60.total;
$('#targets').innerHTML = [
  ['Cash per client, 180 days', usd(E.cashPerClient)],
  ['Break-even CAC', usd(E.breakEven)],
  ['Target CAC (1.5× return)', usd(E.target)],
  ['CAC now, adjusted', usd(T60.cac)],
  ['Months to pay back', D.economics.payback === null ? 'over 6' : String(D.economics.payback)],
].map(([k, v]) => `<div class="target"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');

$('#campaigns').innerHTML = `<thead><tr><th scope="col" class="text">Campaign</th><th scope="col">Spend</th><th scope="col">Cost per lead</th><th scope="col">Cost per qualified</th><th scope="col">Clients, signed / adjusted</th><th scope="col">CAC, adjusted (80% range)</th><th scope="col">Cash return, 180 days</th><th scope="col" class="text">Verdict</th><th scope="col" class="text">Why</th></tr></thead><tbody>${D.audit60.campaigns.map((c) => `<tr><td class="text"><strong>${c.id}</strong> ${esc(c.name)}</td><td>${usd(c.spend)}</td><td>${usd(c.cpl)}</td><td>${usd(c.costPerQualified)}</td><td>${c.signed} / ${c.projected.toFixed(1)}</td><td>${usd(c.cac)} <span class="note">(${usd(c.cacRange.lo)}–${usd(c.cacRange.hi)})</span></td><td>${c.cashRoas.toFixed(2)}×</td><td class="text">${verdict(c.verdict)}</td><td class="reason text">${esc(c.reasons[0])}</td></tr>`).join('')}</tbody>`;

$('#angles').innerHTML = `<thead><tr><th scope="col" class="text">Angle</th><th scope="col">Spend</th><th scope="col">Cost per lead</th><th scope="col">Cost per qualified</th><th scope="col">Clients</th><th scope="col">CAC</th><th scope="col" class="text">Verdict</th></tr></thead><tbody>${[...D.audit60.angles].sort((a, b) => a.cac - b.cac).map((x) => `<tr><td class="text">${esc(x.label)}</td><td>${usd(x.spend)}</td><td>${usd(x.cpl)}</td><td>${usd(x.costPerQualified)}</td><td>${x.projected.toFixed(1)}</td><td>${usd(x.cac)}</td><td class="text">${verdict(x.verdict)}</td></tr>`).join('')}</tbody>`;

/* ---------- Charts ---------- */
const NS = 'http://www.w3.org/2000/svg';
function ticks(max, n = 4) {
  const raw = max / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const out = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}
const kfmt = (v) => (v >= 1000 ? `$${(v / 1000).toFixed(v % 1000 ? 1 : 0)}K` : `$${v}`);
function tip(el, evt, html, host) {
  el.innerHTML = html;
  el.hidden = false;
  const h = host.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  let x = evt.clientX - h.left + 12;
  if (x + r.width > h.width) x = evt.clientX - h.left - r.width - 12;
  el.style.left = `${Math.max(0, x)}px`;
  el.style.top = `${Math.max(0, evt.clientY - h.top - r.height - 10)}px`;
}

(function scatter() {
  const ads = D.audit60.ads.filter((x) => x.projected >= 2);
  const W = 560, H = 330, M = { l: 54, r: 16, t: 14, b: 40 };
  const xMax = ticks(Math.max(...ads.map((x) => x.cpl)) * 1.08);
  const yMax = ticks(Math.max(...ads.map((x) => x.cac), E.breakEven) * 1.08);
  const X = (v) => M.l + (v / xMax.at(-1)) * (W - M.l - M.r);
  const Y = (v) => H - M.b - (v / yMax.at(-1)) * (H - M.t - M.b);
  let s = '';
  for (const t of yMax) s += `<line class="${t ? 'grid' : 'base'}" x1="${M.l}" x2="${W - M.r}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${M.l - 8}" y="${Y(t) + 4}" text-anchor="end">${kfmt(t)}</text>`;
  for (const t of xMax) s += `<text x="${X(t)}" y="${H - M.b + 16}" text-anchor="middle">$${t}</text>`;
  s += `<text x="${(M.l + W - M.r) / 2}" y="${H - 4}" text-anchor="middle">Cost per lead</text>`;
  s += `<text x="12" y="${M.t + 4}" transform="rotate(-90 12 ${M.t + 4})" text-anchor="end">Cost per client</text>`;
  for (const [v, lbl, col] of [[E.breakEven, 'break-even', 'var(--pause)'], [E.target, 'target', 'var(--scale)']]) {
    s += `<line x1="${M.l}" x2="${W - M.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${col}" stroke-width="1"/><text x="${W - M.r}" y="${Y(v) - 5}" text-anchor="end" fill="var(--ink-2)">${lbl} ${usd(v)}</text>`;
  }
  for (const a of ads) {
    const risky = a.angle === 'pennies';
    s += `<circle class="dot" data-id="${a.id}" cx="${X(a.cpl).toFixed(1)}" cy="${Y(a.cac).toFixed(1)}" r="${(4 + Math.sqrt(a.spend) / 40).toFixed(1)}" fill="${risky ? 'var(--pause)' : 'var(--ink)'}" fill-opacity="0.85" stroke="#fff" stroke-width="2"/>`;
  }
  const pen = ads.filter((a) => a.angle === 'pennies').sort((a, b) => b.cac - a.cac)[0];
  if (pen) s += `<text x="${X(pen.cpl) + 12}" y="${Y(pen.cac) + 4}" fill="var(--ink)">"pennies on the dollar" ads</text>`;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Scatter of ${ads.length} ads: cost per lead against cost per client. The cheapest-lead ads sit above the break-even line.`);
  svg.innerHTML = s;
  $('#chart-scatter').replaceChildren(svg);
  const host = $('#chart-scatter').parentElement;
  for (const c of svg.querySelectorAll('.dot')) {
    const a = ads.find((x) => x.id === c.dataset.id);
    c.addEventListener('mousemove', (e) => tip($('#tip-scatter'), e, `<strong>${a.id}: ${esc(D.assumptions.angles[a.angle].label)}</strong>Spend ${usd(a.spend)}<br>Cost per lead ${usd(a.cpl)}<br>Clients ${a.projected.toFixed(1)}, ${usd(a.cac)} each`, host));
    c.addEventListener('mouseleave', () => { $('#tip-scatter').hidden = true; });
  }
})();

(function cohorts() {
  const rows = D.cohorts;
  $('#median-days').textContent = String(Math.round(D.audit60.curve.median));
  const W = 560, H = 290, M = { l: 54, r: 70, t: 14, b: 36 };
  const capVal = Math.max(...rows.map((r) => r.cac)) * 2.2;
  const vals = rows.map((r) => ({ ...r, toDate: r.cacToDate === null ? capVal : Math.min(capVal, r.cacToDate) }));
  const yMax = ticks(Math.max(...vals.map((r) => Math.max(r.toDate, r.cac))));
  const X = (i) => M.l + (i + 0.5) * ((W - M.l - M.r) / rows.length);
  const Y = (v) => H - M.b - (v / yMax.at(-1)) * (H - M.t - M.b);
  let s = '';
  for (const t of yMax) s += `<line class="${t ? 'grid' : 'base'}" x1="${M.l}" x2="${W - M.r}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${M.l - 8}" y="${Y(t) + 4}" text-anchor="end">${kfmt(t)}</text>`;
  rows.forEach((r, i) => { if (i % 2 === 0) s += `<text x="${X(i)}" y="${H - M.b + 16}" text-anchor="middle">${shortDate(r.from)}</text>`; });
  s += `<line x1="${M.l}" x2="${W - M.r}" y1="${Y(E.breakEven)}" y2="${Y(E.breakEven)}" stroke="var(--pause)"/><text x="${M.l + 4}" y="${Y(E.breakEven) - 5}" fill="var(--ink-2)">break-even ${usd(E.breakEven)}</text>`;
  const line = (key, color, dash) => {
    const d = vals.map((r, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(r[key]).toFixed(1)}`).join(' ');
    let out = `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" ${dash ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
    vals.forEach((r, i) => { out += `<circle cx="${X(i)}" cy="${Y(r[key])}" r="4" fill="${color}" stroke="#fff" stroke-width="2"/>`; });
    return out;
  };
  s += line('toDate', 'var(--muted)', true) + line('cac', 'var(--ink)', false);
  const last = vals.length - 1;
  s += `<text x="${X(last) + 8}" y="${Y(vals[last].toDate) + 4}" fill="var(--ink-2)">signed so far</text><text x="${X(last) + 8}" y="${Y(vals[last].cac) + 4}" fill="var(--ink)">adjusted</text>`;
  rows.forEach((r, i) => { s += `<rect class="hit" data-i="${i}" x="${X(i) - 22}" y="${M.t}" width="44" height="${H - M.t - M.b}"/>`; });
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'CAC by week of lead: counted on clients signed so far rises sharply for recent weeks; adjusted for the pipeline it stays level.');
  svg.innerHTML = s;
  $('#chart-cohorts').replaceChildren(svg);
  $('#cohort-legend').innerHTML = '<span><i style="--c:var(--ink)"></i>Adjusted for the pipeline</span><span><i class="dash" style="--c:var(--muted)"></i>Signed so far</span>';
  const host = $('#chart-cohorts').parentElement;
  for (const h of svg.querySelectorAll('.hit')) {
    const r = rows[Number(h.dataset.i)];
    h.addEventListener('mousemove', (e) => tip($('#tip-cohorts'), e, `<strong>Leads from ${shortDate(r.from)} to ${shortDate(r.to)}</strong>Spend ${usd(r.spend)}<br>Signed so far ${r.signed}: ${r.cacToDate === null ? 'no clients yet' : usd(r.cacToDate) + ' each'}<br>Adjusted ${r.projected.toFixed(1)}: ${usd(r.cac)} each`, host));
    h.addEventListener('mouseleave', () => { $('#tip-cohorts').hidden = true; });
  }
  $('#cohort-table').innerHTML = `<thead><tr><th scope="col" class="text">Leads from</th><th scope="col">Spend</th><th scope="col">Signed so far</th><th scope="col">CAC, signed so far</th><th scope="col">Adjusted clients</th><th scope="col">CAC, adjusted</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="text">${shortDate(r.from)} to ${shortDate(r.to)}</td><td>${usd(r.spend)}</td><td>${r.signed}</td><td>${r.cacToDate === null ? 'no clients yet' : usd(r.cacToDate)}</td><td>${r.projected.toFixed(1)}</td><td>${usd(r.cac)}</td></tr>`).join('')}</tbody>`;
})();

$('#tracking-table').innerHTML = `<thead><tr><th scope="col" class="text">Campaign</th><th scope="col">Meta leads</th><th scope="col">CRM leads</th><th scope="col">CRM / Meta</th><th scope="col">Duplicates and junk</th></tr></thead><tbody>${D.audit60.campaigns.map((c) => `<tr${c.coverage < 0.85 ? ' class="flag"' : ''}><td class="text">${c.id} ${c.coverage < 0.85 ? verdict('fix') : ''}</td><td>${fmt(c.metaLeads)}</td><td>${fmt(c.crmLeads)}</td><td>${pct(c.coverage)}</td><td>${pct(c.junkRate)}</td></tr>`).join('')}<tr><td class="text">No campaign recorded</td><td>–</td><td>${fmt(D.audit60.unattributed.crmLeads)}</td><td>–</td><td>${pct(D.audit60.unattributed.junkRate)}</td></tr></tbody>`;
$('#tracking-note').textContent = `Two faults show up together on the landing-page campaign: the pixel and the server both report the same lead (no shared event ID), and ${fmt(D.audit60.unattributed.crmLeads)} leads reach GoHighLevel without the click ID or UTMs, carrying about ${D.audit60.unattributed.projected.toFixed(0)} clients nobody can credit. Instant forms send ${fmt(D.audit60.flags.instantFormLeadsPerMonth)} leads a month, well over the 200 Meta asks for before Conversion Leads optimization.`;
$('#speed').innerHTML = `<p><strong>${pct(s60.afterHoursShare)} of real leads arrive outside 8am to 6pm on weekdays.</strong> They are reached ${pct(s60.afterHoursContact)} of the time; office-hours leads ${pct(s60.hoursContact)}.</p><p>Closing that gap is worth about ${s60.extraClients.toFixed(0)} more clients over 60 days at the current close rate: an instant text and an evening calling shift cost less than the ad spend that buys the same.</p>`;

const cut = D.cut;
$('#q3').innerHTML = [
  `<strong>Is $2,000 good?</strong> Compare it with cash per client, not with industry averages. Here a client pays ${usd(E.cashPerClient)} within 180 days; after delivery, commission and refunds that supports ${usd(E.breakEven)} at break-even and ${usd(E.target)} at a 1.5× return. At $2,000 the account makes money, and a client takes about ${paybackMonths(2000, D.economics.schedule) ?? 'over 6'} months to pay back what it cost.`,
  `<strong>Recount it.</strong> Clients signed so far put the last 30 days at ${usd(t30.cacToDate)}; adjusting for leads still in the pipeline gives ${usd(t30.cac)}. Decisions made on the first number cut good recent campaigns.`,
  `<strong>Split it.</strong> An average hides the spread: campaigns run from ${usd(Math.min(...D.audit60.campaigns.map((c) => c.cac)))} to ${usd(Math.max(...D.audit60.campaigns.map((c) => c.cac)))} per client. ${usd(cut.pausedSpend)} of the 60-day spend sits in segments above break-even; those clients cost about ${usd(cut.pausedSpend / Math.max(1, cut.lostClients))} each.`,
  '<strong>Reconcile tracking.</strong> Meta lead counts against CRM lead counts per campaign, pixel and server event IDs, and leads arriving without a campaign. Meta optimizes on what it is told.',
  '<strong>Check the sales floor.</strong> Contact rate and speed to lead by hour and day, and consultation show rate. Some of what looks like poor ads is unanswered phones.',
  '<strong>Then creative.</strong> Frequency and click-through trend on the biggest ads, and which angles bring qualified people rather than cheap clicks.',
].map((x) => `<li>${x}</li>`).join('');

/* ---------- Creative testing ---------- */
const tState = { testShare: 0.15, baseCpl: 75 };
function renderBudget() {
  const b = testBudget(tState);
  $('#t-share-out').textContent = `${pct(tState.testShare)} (${usd(b.weekly)} a week)`;
  $('#t-cpl-out').textContent = usd(tState.baseCpl);
  const v = b.perVariant;
  $('#budget-out').innerHTML = [
    ['Per variation, a week', usd(v.spend), ''],
    ['Clicks', fmt(v.clicks), 'enough to compare click-through'],
    ['Leads', v.leads.toFixed(1), 'too few to compare cost per lead'],
    ['Qualified leads', v.qualified.toFixed(2), ''],
    ['Paying clients', v.clients.toFixed(2), 'a client every ' + Math.round(1 / v.clients) + ' weeks'],
    ['Weeks for a concept to reach 15 qualified leads', b.weeksForQualified.toFixed(1), 'pooling its 5 variations'],
  ].map(([k, n, sm]) => `<div><dt>${k}</dt><dd>${n}${sm ? `<span class="small">${sm}</span>` : ''}</dd></div>`).join('');
}
$('#t-share').addEventListener('input', (e) => { tState.testShare = Number(e.target.value); renderBudget(); });
$('#t-cpl').addEventListener('input', (e) => { tState.baseCpl = Number(e.target.value); renderBudget(); });
renderBudget();

$('#concepts').innerHTML = D.creative.plan.map((c) => `<article class="concept"><h4>${esc(c.concept)}</h4><p class="kind">${c.kind === 'iteration' ? 'Iteration on a proven ad' : 'New concept'}</p><ol>${c.variants.map((v, i) => `<li>${esc(v)}${c.lint[i] !== 'pass' ? ` (${c.lint[i]})` : ''}</li>`).join('')}</ol></article>`).join('');

function renderSim(weak) {
  const r = weak ? D.creative.simWeak.rules : D.creative.sim.rules;
  $('#sim').innerHTML = `<thead><tr><th scope="col" class="text">How winners are picked</th><th scope="col">Promoted ads that beat the control</th><th scope="col">Promoted ads over 30% worse</th><th scope="col">Cost per client vs the control</th><th scope="col">Weeks it promotes nothing</th></tr></thead><tbody>${['lowestCpl', 'highestCtr', 'staged'].map((k) => `<tr${k === 'staged' ? ' class="best"' : ''}><td class="text">${esc(r[k].label)}</td><td>${pct(r[k].shareBetter)}</td><td>${pct(r[k].shareMuchWorse)}</td><td>${r[k].meanCostVsControl < 1 ? '' : '+'}${pct(r[k].meanCostVsControl - 1)}</td><td>${pct(r[k].weeksWithNoPromotion)}</td></tr>`).join('')}</tbody>`;
}
$('#weak-toggle').addEventListener('change', (e) => renderSim(e.target.checked));
renderSim(false);
$('#gates').innerHTML = [
  '<strong>Launch.</strong> One ad set per concept, 5 variations each, equal budgets, broad US under the Financial Products and Services category. Variations change one thing that matters: the hook, the format, the offer or the objection answered.',
  '<strong>Day 3: attention filter.</strong> Cut only variations whose click-through is clearly below their concept’s median, by more than 2 standard errors. Impressions are plentiful, so this call is reliable.',
  '<strong>Days 7 to 14: quality gate.</strong> Pool qualified leads from the CRM by concept. A concept graduates only if its cost per qualified lead beats the account’s; its best variations go forward. No concept clears it some weeks, and nothing is promoted.',
  '<strong>Scale.</strong> Graduates join the scaling campaign with their post IDs, so likes and comments carry over. CAC is judged once they have 8 adjusted clients.',
  '<strong>Feed the next week.</strong> Objections and reasons to sign from sales calls become next week’s angles; proven ads are re-cut before new concepts are invented.',
].map((x) => `<li>${x}</li>`).join('');

function renderLint() {
  const r = lint($('#copy-input').value);
  $('#lint-out').innerHTML = r.findings.length
    ? r.findings.map((f) => `<li>${icon(f.severity)}<div><span class="rule">${esc(f.source)}</span>: “${esc(f.match)}”. <span class="why">${esc(f.why)}</span> <span class="fix">${esc(f.fix)}</span></div></li>`).join('')
    : `<li>${icon('pass')}<div>No flags. Check the landing page and the image text too: Meta reviews the whole ad.</div></li>`;
}
$('#copy-input').addEventListener('input', renderLint);
renderLint();
$('#examples').innerHTML = `<thead><tr><th scope="col" class="text">Typical line</th><th scope="col" class="text">Flagged as</th><th scope="col" class="text">Rewrite (passes)</th></tr></thead><tbody>${D.compliance.examples.map((e) => `<tr><td class="text">${esc(e.before)}</td><td class="text">${e.beforeLint.findings.map((f) => esc(f.rule)).join(', ')}</td><td class="text">${esc(e.after)}</td></tr>`).join('')}</tbody>`;

/* ---------- CRM to Meta ---------- */
const PATH = { Lead: 'Website: pixel + server, one shared event ID. Instant form: Conversion Leads.', Purchase: 'Value = cash collected, one event per invoice.', ClientSigned: 'Value = contract value.' };
$('#stage-map').innerHTML = `<thead><tr><th scope="col" class="text">GoHighLevel stage</th><th scope="col" class="text">Meta event</th><th scope="col" class="text">Notes</th></tr></thead><tbody>${Object.entries(STAGES).map(([k, s]) => `<tr><td class="text">${esc(s.label)} <span class="note">(${k})</span></td><td class="text"><code>${s.event}</code></td><td class="text">${esc(PATH[s.event] || 'Instant form: Conversion Leads stage. Website: server event with fbc and hashed contact details.')}</td></tr>`).join('')}</tbody>`;

const liveNow = Math.floor(Date.now() / 1000);
const SAMPLES = sampleHooks(liveNow);
let sampleKey = 'instant_qualified';
const FIELDS = [['email', 'Email'], ['phone', 'Phone'], ['first_name', 'First name'], ['last_name', 'Last name'], ['city', 'City'], ['state', 'State'], ['postal_code', 'ZIP'], ['fb_lead_id', 'Meta lead ID'], ['fbc', 'fbc'], ['fbclid', 'fbclid'], ['amount', 'Amount (USD)'], ['payment_id', 'Invoice ID']];
function renderForm() {
  const h = SAMPLES[sampleKey];
  const hoursAgo = Math.round((liveNow - Date.parse(h.stage_changed_at) / 1000) / 3600);
  $('#hook-form').innerHTML = `<label>Stage <select name="stage">${Object.keys(STAGES).map((k) => `<option value="${k}"${k === h.stage ? ' selected' : ''}>${STAGES[k].label}</option>`).join('')}</select></label><label>Stage changed (hours ago) <input name="hours" type="number" min="0" max="400" value="${hoursAgo}"></label>${FIELDS.filter(([k]) => h[k] !== undefined).map(([k, l]) => `<label class="${k === 'fbc' ? 'wide' : ''}">${l} <input name="${k}" value="${esc(h[k])}" autocomplete="off" spellcheck="false"></label>`).join('')}`;
  buildLive();
}
async function buildLive() {
  const base = SAMPLES[sampleKey];
  const fd = new FormData($('#hook-form'));
  const hook = { ...base };
  for (const [k, v] of fd.entries()) if (k !== 'hours') hook[k] = v;
  hook.stage_changed_at = new Date((liveNow - Number(fd.get('hours') || 0) * 3600) * 1000).toISOString();
  try {
    const ev = await buildEvent(hook);
    const v = validateEvent(ev, { now: liveNow, leadCreatedAt: hook.lead_created_at ? Math.floor(Date.parse(hook.lead_created_at) / 1000) : null });
    $('#capi-checks').innerHTML = v.checks.map((c) => `<li data-check="${c.id}">${icon(c.ok ? 'pass' : 'fail')}<span>${esc(c.msg)}</span></li>`).join('') + `<li>${icon('pass')}<span>Match keys: ${v.matchKeys.join(', ')}</span></li>`;
    $('#capi-payload').textContent = `POST https://graph.facebook.com/v26.0/DATASET_ID/events\n\n${JSON.stringify({ data: [ev] }, null, 2)}`;
  } catch (err) {
    $('#capi-checks').innerHTML = `<li>${icon('fail')}<span>${esc(err.message)}</span></li>`;
    $('#capi-payload').textContent = '';
  }
}
for (const b of document.querySelectorAll('[data-sample]')) b.addEventListener('click', () => { sampleKey = b.dataset.sample; document.querySelectorAll('[data-sample]').forEach((x) => x.setAttribute('aria-checked', String(x === b))); renderForm(); });
$('#hook-form').addEventListener('input', buildLive);
$('#hook-form').addEventListener('change', buildLive);
renderForm();

/* ---------- Scaling ---------- */
const eState = { cash: Math.round(E.cashPerClient), cost: 0.35, elastic: 0.8 };
$('#e-cash').value = String(eState.cash);
function renderEcon() {
  const e = { ...ECON, fulfillmentCost: eState.cost - ECON.salesCommission, spendElasticity: eState.elastic };
  const base = { ...D.economics.base, cashPerClient: eState.cash };
  const breakEven = eState.cash * (1 - e.refundRate) * (1 - eState.cost);
  const target = breakEven / e.targetReturn;
  const max = maxProfitableSpend(base, e);
  $('#e-cash-out').textContent = usd(eState.cash);
  $('#e-cost-out').textContent = pct(eState.cost);
  $('#e-elastic-out').textContent = eState.elastic >= 0.9 ? 'slowly' : eState.elastic >= 0.75 ? 'moderately' : 'fast';
  $('#econ-out').innerHTML = [
    ['Break-even CAC', usd(breakEven)],
    ['Target CAC', usd(target)],
    ['CAC now, adjusted', usd(T60.cac)],
    ['Daily spend where the next client stops paying back', usd(max)],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  const rows = forecast(base, [2500, 3000, 3600, 4500, 6000, 7500], e);
  const best = rows.reduce((a, r) => (r.contribution > a.contribution ? r : a), rows[0]);
  $('#forecast').innerHTML = `<thead><tr><th scope="col">Daily spend</th><th scope="col">Clients a month</th><th scope="col">Average CAC</th><th scope="col">Cost of the next client</th><th scope="col">Contribution a month</th></tr></thead><tbody>${rows.map((r) => `<tr class="${r === best ? 'best' : r.marginalCac > breakEven * 1.02 ? 'over' : ''}"><td>${usd(r.dailySpend)}</td><td>${r.clients.toFixed(0)}</td><td>${usd(r.avgCac)}</td><td>${usd(r.marginalCac)}${Math.abs(r.marginalCac / breakEven - 1) <= 0.02 ? ' (about break-even)' : r.marginalCac > breakEven ? ' (loses money)' : ''}</td><td>${usd(r.clients * breakEven - r.spend)}</td></tr>`).join('')}</tbody>`;
  const ladder = scalingLadder(3000, Math.max(3000, Math.min(max, 6000)));
  $('#ladder').textContent = ladder.length
    ? `Getting there safely: ${ladder.map((s) => `day ${s.day}: ${usd(s.dailySpend)}`).join(', ')}. Steps of 20% or less, so Meta doesn't restart learning, and each step holds until the CAC check passes.`
    : 'At these numbers the account is already past the point where the next client pays back: the move is to cut the losing segments, not to add budget.';
}
for (const [id, key] of [['#e-cash', 'cash'], ['#e-cost', 'cost'], ['#e-elastic', 'elastic']]) $(id).addEventListener('input', (ev) => { eState[key] = Number(ev.target.value); renderEcon(); });
renderEcon();

/* ---------- Plan and measured ---------- */
$('#plan-list').innerHTML = D.plan.map((p) => `<li><h3>${esc(p.when)}</h3><ul>${p.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></li>`).join('');
const m = D.mutation;
$('#measured-list').innerHTML = [
  D.tests ? `${D.tests.pass} of ${D.tests.tests} tests pass.` : null,
  m ? `${m.caught} of ${m.applied} bugs planted one at a time in the code were caught by the tests.` : null,
  `Pipeline adjustment: off by ${pct(D.accuracy.mapeAdjusted, 1)} on average against the true client count in 10 test windows, against ${pct(D.accuracy.mapeNaive, 1)} for clients signed so far.`,
  `Creative selection: ${fmt(D.creative.sim.weeks)} simulated weeks per rule, repeated with a weaker cheap-lead effect.`,
  'Conversions API: the email hash matches Meta’s published example; every sample event passes the checks; the webhook receiver is tested end to end against a fake Meta endpoint, including wrong secrets and stale events.',
  `Copy check: all ${D.compliance.examples.length} typical lines flagged, all rewrites pass.`,
  D.qa ? `Site checked in headless Chrome: ${D.qa.passed} of ${D.qa.total} checks, ${D.qa.axeViolations} accessibility violations (axe-core).` : null,
  `Model run: ${(D.runtimeMs / 1000).toFixed(1)} s.`,
].filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join('');
$('#generated').textContent = `Model run ${new Date(D.generatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC.`;
document.documentElement.dataset.ready = 'true';
