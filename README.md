# Meta Ads audit model for Valor Tax Relief

Prepared by Santiago.

A static, single-page demo. It joins a synthetic Meta account (about $3,000 a day) to a synthetic GoHighLevel pipeline, lead by lead, and judges every campaign and creative angle on paying clients and cash collected. It also shows the creative testing system for 20 variations a week, a live GoHighLevel-to-Meta Conversions API event builder, a scaling model and the first 30 days.

Deploy the folder as-is (Vercel: framework none, no build, output `.`). `vercel.json` sends `X-Robots-Tag: noindex, nofollow` and the page carries a robots noindex tag.

## Measured

- Engine: 50 of 50 tests pass; 25 of 25 bugs planted one at a time were caught by the tests.
- Funnel, last 60 days of the model account: $181,532 spend, 2,988 Meta leads, 2,797 CRM leads, 102 paying clients after the pipeline adjustment; $1,781 per client against $1,931 counting only clients signed so far.
- Pipeline adjustment: within 7.2% of the true client count on average across 10 test windows (5 accounts x 2 windows), against 20.0% for clients signed so far.
- Audit verdicts: cheapest-lead campaign C1 at $43 per lead costs $3,048 per client (pause); C2 at $1,303 (scale); C3 flagged to fix tracking first. Break-even CAC $2,405, target $1,603, from $3,814 cash per client in 180 days.
- Creative selection, 2,000 simulated weeks of 20 variations: picking by lowest cost per lead promoted ads that really beat the control 42% of the time; the staged method 77%. With a weaker cheap-lead effect: 62% and 72%.
- Conversions API: the email hash matches Meta's published example; all 3 sample events pass the checks (hashing, 7-day window, Conversion Leads fields, match keys); the webhook receiver is tested end to end against a fake Meta endpoint.
- Site: 42 of 42 headless-Chrome checks pass (interactions, payload builder, layout at 390px); 0 axe-core violations, desktop and mobile.
- Model run time: 0.4 s.

## Not measured

- The real account. Spend, leads, pipeline stages, fees and payments are synthetic; every assumption is in `src/engine/account.mjs`.
- How strongly cheap leads underperform in the real account. The simulation fits it to the model's angle table and is repeated with a weaker effect.
- Live calls to Meta or GoHighLevel. Events are built and validated against Meta's documented rules, not sent.
- Meta's Event Match Quality score: the builder lists which match keys are present; Meta does the scoring.
- The spend-response curve. Its shape (clients grow with spend to the power 0.8) is an assumption until budget steps give real points.
