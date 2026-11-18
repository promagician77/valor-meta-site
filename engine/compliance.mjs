// Pre-flight copy check for tax-relief ads. Two sources of rules:
// - Meta's personal attributes policy: copy may not assert or imply the viewer's financial status.
// - Claims regulators pursued against tax-relief firms: "pennies on the dollar", guarantees,
//   government impersonation. This flags copy for review; it is not legal advice.

const FIN = '(owe|owing|in debt|tax debt|irs debt|back taxes|behind on|struggling|drowning|buried|broke|bankrupt|garnish(?:ed|ment)?|levied|levy|lien|unfiled|can\'?t pay)';

export const RULES = [
  {
    id: 'personal-financial', severity: 'block', source: 'Meta personal attributes policy',
    test: new RegExp(`\\b(are you|do you|you'?re|you are|you have|you've|your)\\b[^.?!]{0,40}\\b${FIN}`, 'i'),
    why: 'Speaks to the viewer as someone with tax debt. Meta rejects copy that implies a viewer’s financial status.',
    fix: 'Describe the service or the situation in general terms: "Help for people with IRS back taxes."',
  },
  {
    id: 'personal-question', severity: 'block', source: 'Meta personal attributes policy',
    test: new RegExp(`(^|[.!?]\\s+)${FIN}\\b[^?]{0,60}\\?`, 'i'),
    why: 'A question like "Owe the IRS?" asks the viewer about their own finances.',
    fix: 'Turn the question into information: "What to do when the IRS says you owe" becomes "What happens when a tax balance goes unpaid."',
  },
  {
    id: 'personal-notice', severity: 'block', source: 'Meta personal attributes policy',
    test: /\b(got|received|get|getting)\b[^.?!]{0,25}\b(cp\s?\d{2,4}|lt\s?\d{2,4}|irs (letter|notice))\b/i,
    why: 'Asking whether the viewer received an IRS notice implies they owe taxes.',
    fix: 'Explain the notice instead: "What a CP504 notice means and the deadlines that follow."',
  },
  {
    id: 'pennies', severity: 'block', source: 'FTC and state enforcement against tax-relief firms',
    test: /pennies on the dollar|fraction of what (you|they) owe/i,
    why: 'The exact claim the FTC and Nevada pursued against a tax-relief operation settled in 2026.',
    fix: 'State what is possible without promising an outcome: "Settlement is one option; most cases end in a payment plan."',
  },
  {
    id: 'guarantee', severity: 'block', source: 'FTC Act Section 5 (deceptive claims)',
    test: /\bguarantee[ds]?\b|\b100% (success|approval|results)\b/i,
    why: 'No firm can guarantee what the IRS will accept.',
    fix: 'Promise the process, not the result: "You’ll know your options and our fee before you commit."',
  },
  {
    id: 'forgiveness', severity: 'block', source: 'FTC Act Section 5 (deceptive claims)',
    test: /\b(irs|tax|debt) forgiveness\b|\b(eliminate|erase|wipe out|forgive)\w*\b[^.]{0,30}\b(debt|taxes|balance)\b|\bnew (irs|government|federal) (program|relief)\b/i,
    why: 'Implies a blanket forgiveness program or a new government scheme.',
    fix: 'Name the real options plainly: payment plans, penalty relief, offers in compromise, currently-not-collectible status.',
  },
  {
    id: 'impersonation', severity: 'block', source: 'FTC Impersonation Rule',
    test: /\b(official|government|federal)\b[^.]{0,20}\b(program|notice|agency|relief)\b|\birs[- ]?(approved|endorsed|authorized)\b|\bon behalf of the irs\b|\bfinal notice\b/i,
    why: 'Reads as if the ad comes from, or is approved by, the IRS or another agency.',
    fix: 'Say who you are: "Independent tax resolution firm. Not affiliated with the IRS."',
  },
  {
    id: 'results', severity: 'warn', source: 'FTC endorsement and testimonial guides',
    test: /\b(saved|reduced|settled|cut)\b[^.]{0,30}\$\s?\d|\$\s?\d[\d,]*k?\s+(saved|settled|reduced)/i,
    why: 'A specific dollar result needs proof, and a note if it isn’t typical.',
    fix: 'Keep the result only with the case on file, plus "Results vary by case."',
  },
  {
    id: 'urgency', severity: 'warn', source: 'Meta advertising standards (misleading practices)',
    test: /\b(act now|last chance|before it'?s too late|limited time|expires today)\b/i,
    why: 'Manufactured urgency reads as pressure in a financial-hardship category.',
    fix: 'Use a real deadline from the notice itself, or none.',
  },
  {
    id: 'fresh-start', severity: 'warn', source: 'IRS program name',
    test: /fresh start/i,
    why: 'Fresh Start is the IRS’s own initiative; copy must not imply special access or affiliation.',
    fix: 'If used, describe it as an IRS initiative anyone can apply under.',
  },
];

export function lint(text) {
  const findings = [];
  for (const r of RULES) {
    const m = String(text).match(r.test);
    if (m) findings.push({ rule: r.id, severity: r.severity, source: r.source, match: m[0].trim(), why: r.why, fix: r.fix });
  }
  const status = findings.some((f) => f.severity === 'block') ? 'block' : findings.length ? 'warn' : 'pass';
  return { status, findings };
}

// Typical industry lines, with rewrites that keep the angle and pass the check.
export const EXAMPLES = [
  { before: 'Owe the IRS more than $10,000? Settle for pennies on the dollar.', after: 'Tax resolution from enrolled agents. We review the case before we quote a fee.' },
  { before: 'Are you facing wage garnishment? We stop it in 24 hours.', after: 'How wage garnishments work, and the steps that can release one.' },
  { before: 'Got a CP504 notice? Call before the IRS seizes your assets.', after: 'What a CP504 notice means and what to do in the next 30 days.' },
  { before: 'New IRS forgiveness program for 1099 workers.', after: 'Payment plans, penalty relief and settlements: what the IRS actually offers.' },
  { before: 'Guaranteed results or your money back.', after: 'A flat-fee investigation first, so the options and the fee are clear up front.' },
  { before: 'We saved a client $48,000 last month!', after: 'Real client stories. Results vary by case.' },
  { before: 'Behind on your taxes? You are not alone.', after: 'Thousands of 1099 workers end up with back taxes. Here is how people get current.' },
  { before: 'Official IRS relief program. Final notice for eligible taxpayers.', after: 'Independent tax resolution firm. Not affiliated with the IRS.' },
];
