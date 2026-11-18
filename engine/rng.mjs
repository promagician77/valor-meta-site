// Seeded random numbers so every run of the model gives the same list and the same simulations.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// entries: [[value, weight], ...]; weights need not sum to 1
export function pickWeighted(rand, entries) {
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = rand() * total;
  for (const [v, w] of entries) {
    r -= w;
    if (r < 0) return v;
  }
  return entries[entries.length - 1][0];
}

export function normal(rand) {
  let u = 0;
  while (u === 0) u = rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Binomial draw. Exact for small n, Poisson for rare events, normal approximation otherwise.
export function binomial(rand, n, p) {
  if (n <= 0 || p <= 0) return 0;
  if (p >= 1) return n;
  if (n < 60) {
    let k = 0;
    for (let i = 0; i < n; i++) if (rand() < p) k++;
    return k;
  }
  const mean = n * p;
  if (mean < 40) {
    const L = Math.exp(-mean);
    let k = 0;
    let prod = rand();
    while (prod > L) {
      k++;
      prod *= rand();
    }
    return Math.min(k, n);
  }
  const sd = Math.sqrt(mean * (1 - p));
  return Math.max(0, Math.min(n, Math.round(mean + sd * normal(rand))));
}

export const round = (x, dp = 0) => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

export const sum = (arr) => arr.reduce((a, b) => a + b, 0);

export function poisson(rand, mean) {
  if (mean <= 0) return 0;
  if (mean < 30) {
    const L = Math.exp(-mean);
    let k = 0;
    let p = rand();
    while (p > L) { k++; p *= rand(); }
    return k;
  }
  return Math.max(0, Math.round(mean + Math.sqrt(mean) * normal(rand)));
}
