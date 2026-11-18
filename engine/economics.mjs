// Unit economics: what a signed client is worth in cash, what CAC that supports, and what happens to
// CAC as spend rises. Inputs are assumptions until the finance export replaces them.

export const ECON = {
  fulfillmentCost: 0.25, // tax-professional time per case, share of revenue
  salesCommission: 0.1,
  refundRate: 0.03,
  targetReturn: 1.5, // contribution per client should be 1.5x what it cost to acquire
  horizonDays: 180, // cash counted within this many days of signing
  spendElasticity: 0.8, // clients grow with spend^0.8: each extra dollar buys a little less
};

// Average contribution (cash after delivery cost, commission and refunds) per signed client.
export function contributionPerClient(cashPerClient, e = ECON) {
  return cashPerClient * (1 - e.refundRate) * (1 - e.fulfillmentCost - e.salesCommission);
}

export function cacTargets(cashPerClient, e = ECON) {
  const breakEven = contributionPerClient(cashPerClient, e);
  return { breakEven, target: breakEven / e.targetReturn };
}

// Months until cumulative contribution repays CAC, given a monthly cash schedule per client.
export function paybackMonths(cac, schedule, e = ECON) {
  const keep = (1 - e.refundRate) * (1 - e.fulfillmentCost - e.salesCommission);
  let cum = 0;
  for (let m = 0; m < schedule.length; m++) {
    cum += schedule[m] * keep;
    if (cum >= cac) return m;
  }
  return null; // never within the schedule
}

// Spend-response curve through today's point: clients = k * spend^b.
// Average CAC rises as spend^(1-b); the marginal client costs CAC / b.
export function forecast({ dailySpend, clientsPerDay, cashPerClient, leadsPerDay }, levels, e = ECON) {
  const b = e.spendElasticity;
  const k = clientsPerDay / dailySpend ** b;
  const kl = leadsPerDay / dailySpend ** b;
  const { breakEven, target } = cacTargets(cashPerClient, e);
  return levels.map((s) => {
    const clients = k * s ** b;
    const avgCac = s / clients;
    const marginalCac = avgCac / b;
    const monthly = { spend: s * 30, clients: clients * 30, leads: kl * s ** b * 30 };
    return {
      dailySpend: s, ...monthly, avgCac, marginalCac,
      contribution: monthly.clients * breakEven - monthly.spend,
      marginalOk: marginalCac <= breakEven, avgOk: avgCac <= target,
    };
  });
}

// Highest daily spend where the next dollar still pays back (marginal CAC = break-even).
export function maxProfitableSpend({ dailySpend, clientsPerDay, cashPerClient }, e = ECON) {
  const b = e.spendElasticity;
  const k = clientsPerDay / dailySpend ** b;
  const { breakEven } = cacTargets(cashPerClient, e);
  // marginal CAC = s^(1-b) / (k b)  ->  s = (breakEven * k * b)^(1/(1-b))
  return (breakEven * k * b) ** (1 / (1 - b));
}

// Budget steps that stay under Meta's significant-edit threshold (about 20%) and wait for data.
export function scalingLadder(fromDaily, toDaily, { step = 0.2, daysBetween = 4 } = {}) {
  const out = [];
  let s = fromDaily;
  let day = 0;
  while (s < toDaily - 1e-6) {
    s = Math.min(toDaily, s * (1 + step));
    day += daysBetween;
    out.push({ day, dailySpend: Math.round(s) });
  }
  return out;
}
