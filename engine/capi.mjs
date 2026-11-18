// GoHighLevel pipeline stage -> Meta Conversions API event.
// Two paths, per Meta's documentation:
// - Instant-form leads (Meta lead ID on the contact): the Conversion Leads payload
//   (action_source system_generated, custom_data.event_source "crm", lead_event_source).
// - Website leads: the standard payload with the pixel's event ID for deduplication, then later
//   stages as server events matched on fbc, fbp, external_id and hashed contact details.
// Hashing uses Web Crypto, so the same code runs in a browser, Node 20+ and Cloudflare Workers.

export const GRAPH_VERSION = 'v26.0';
export const LEAD_EVENT_SOURCE = 'GoHighLevel';
export const MAX_AGE_SECONDS = 7 * 86400; // events older than 7 days are not used

// GoHighLevel pipeline stages and the Meta event each one sends.
export const STAGES = {
  new_lead: { event: 'Lead', label: 'New lead' },
  contacted: { event: 'Contact', label: 'Contacted' },
  consult_booked: { event: 'Schedule', label: 'Consultation booked' },
  qualified: { event: 'QualifiedLead', label: 'Qualified' },
  disqualified: { event: 'Disqualified', label: 'Disqualified' },
  signed: { event: 'ClientSigned', label: 'Client signed', value: true },
  payment: { event: 'Purchase', label: 'Payment collected', value: true },
};

// Keys to set in the GoHighLevel "Custom Webhook" action (Custom Data section).
export const WEBHOOK_KEYS = ['contact_id', 'email', 'phone', 'first_name', 'last_name', 'city', 'state', 'postal_code', 'country', 'stage', 'stage_changed_at', 'amount', 'payment_id', 'fb_lead_id', 'fbclid', 'fbc', 'fbp', 'click_time', 'client_ip', 'user_agent', 'page_url', 'lead_created_at'];

const US_STATES = { alabama: 'al', alaska: 'ak', arizona: 'az', arkansas: 'ar', california: 'ca', colorado: 'co', connecticut: 'ct', delaware: 'de', florida: 'fl', georgia: 'ga', hawaii: 'hi', idaho: 'id', illinois: 'il', indiana: 'in', iowa: 'ia', kansas: 'ks', kentucky: 'ky', louisiana: 'la', maine: 'me', maryland: 'md', massachusetts: 'ma', michigan: 'mi', minnesota: 'mn', mississippi: 'ms', missouri: 'mo', montana: 'mt', nebraska: 'ne', nevada: 'nv', 'new hampshire': 'nh', 'new jersey': 'nj', 'new mexico': 'nm', 'new york': 'ny', 'north carolina': 'nc', 'north dakota': 'nd', ohio: 'oh', oklahoma: 'ok', oregon: 'or', pennsylvania: 'pa', 'rhode island': 'ri', 'south carolina': 'sc', 'south dakota': 'sd', tennessee: 'tn', texas: 'tx', utah: 'ut', vermont: 'vt', virginia: 'va', washington: 'wa', 'west virginia': 'wv', wisconsin: 'wi', wyoming: 'wy', 'district of columbia': 'dc' };

export const normalize = {
  email: (v) => String(v || '').trim().toLowerCase(),
  // Digits only, with country code: a 10-digit US number gets a leading 1.
  phone: (v) => {
    const d = String(v || '').replace(/\D/g, '').replace(/^0+/, '');
    return d.length === 10 ? '1' + d : d;
  },
  name: (v) => String(v || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''),
  city: (v) => String(v || '').trim().toLowerCase().replace(/[^\p{L}]/gu, ''),
  state: (v) => {
    const s = String(v || '').trim().toLowerCase();
    if (/^[a-z]{2}$/.test(s)) return s;
    return US_STATES[s] || '';
  },
  zip: (v) => String(v || '').trim().toLowerCase().replace(/\s/g, '').split('-')[0].slice(0, 5),
  country: (v) => {
    const s = String(v || '').trim().toLowerCase();
    if (!s) return 'us';
    if (s === 'united states' || s === 'usa') return 'us';
    return s.slice(0, 2);
  },
};

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const toSeconds = (v) => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
};

// fbc from a click ID when the cookie wasn't captured: fb.1.<click time in ms>.<fbclid>
export function fbcFrom(fbclid, clickTime) {
  if (!fbclid) return null;
  const ms = typeof clickTime === 'number' ? (clickTime > 1e12 ? clickTime : clickTime * 1000) : Date.parse(clickTime);
  return Number.isFinite(ms) ? `fb.1.${ms}.${fbclid}` : null;
}

export async function buildEvent(hook) {
  const stage = STAGES[hook.stage];
  if (!stage) throw new Error(`Unknown stage "${hook.stage}". Expected one of: ${Object.keys(STAGES).join(', ')}`);
  const eventTime = toSeconds(hook.stage_changed_at);
  const ud = {};
  const put = async (key, raw, fn) => {
    const n = fn(raw);
    if (n) ud[key] = [await sha256Hex(n)];
  };
  await put('em', hook.email, normalize.email);
  await put('ph', hook.phone, normalize.phone);
  await put('fn', hook.first_name, normalize.name);
  await put('ln', hook.last_name, normalize.name);
  await put('ct', hook.city, normalize.city);
  await put('st', hook.state, normalize.state);
  await put('zp', hook.postal_code, normalize.zip);
  await put('country', hook.country, normalize.country);
  if (hook.contact_id) ud.external_id = [await sha256Hex(String(hook.contact_id))];
  const eventId = `ghl_${hook.contact_id}_${hook.stage}${hook.stage === 'payment' && hook.payment_id ? '_' + hook.payment_id : ''}`;
  const custom = {};
  if (stage.value) {
    custom.value = Number(hook.amount);
    custom.currency = 'USD';
  }
  let event;
  if (hook.fb_lead_id) {
    // Conversion Leads: lead ID is the strongest match key; contact details back it up.
    event = {
      event_name: stage.event,
      event_time: eventTime,
      action_source: 'system_generated',
      event_id: eventId,
      user_data: { lead_id: Number(hook.fb_lead_id), ...ud },
      custom_data: { event_source: 'crm', lead_event_source: LEAD_EVENT_SOURCE, ...custom },
    };
  } else {
    const fbc = hook.fbc || fbcFrom(hook.fbclid, hook.click_time);
    const browser = {};
    if (fbc) browser.fbc = fbc;
    if (hook.fbp) browser.fbp = hook.fbp;
    const isWebLead = hook.stage === 'new_lead';
    if (isWebLead) {
      if (hook.client_ip) browser.client_ip_address = hook.client_ip;
      if (hook.user_agent) browser.client_user_agent = hook.user_agent;
    }
    event = {
      event_name: stage.event,
      event_time: eventTime,
      action_source: isWebLead ? 'website' : 'system_generated',
      // The website lead reuses the ID the pixel fired with, so Meta keeps one of the two.
      event_id: isWebLead ? `ghl_${hook.contact_id}_new_lead` : eventId,
      ...(isWebLead && hook.page_url ? { event_source_url: hook.page_url } : {}),
      user_data: { ...ud, ...browser },
      ...(Object.keys(custom).length ? { custom_data: custom } : {}),
    };
  }
  return event;
}

const HEX64 = /^[0-9a-f]{64}$/;
const HASHED = ['em', 'ph', 'fn', 'ln', 'ct', 'st', 'zp', 'country', 'external_id'];

// Checks an event against Meta's rules before it is sent. `now` is Unix seconds.
export function validateEvent(ev, { now = Math.floor(Date.now() / 1000), leadCreatedAt = null } = {}) {
  const checks = [];
  const add = (id, ok, msg) => checks.push({ id, ok: !!ok, msg });
  add('name', typeof ev.event_name === 'string' && ev.event_name.length > 0, 'event_name is set');
  const t = ev.event_time;
  add('time-int', Number.isInteger(t), 'event_time is a whole number');
  add('time-seconds', Number.isInteger(t) && t < 1e11, 'event_time is in seconds, not milliseconds');
  add('time-future', Number.isInteger(t) && t <= now + 60, 'event_time is not in the future');
  add('time-age', Number.isInteger(t) && now - t <= MAX_AGE_SECONDS, 'event_time is within the last 7 days');
  const ud = ev.user_data || {};
  for (const k of HASHED) {
    if (ud[k] !== undefined) add(`hash-${k}`, Array.isArray(ud[k]) && ud[k].every((h) => HEX64.test(h)), `${k} is a SHA-256 hash, not raw text`);
  }
  if (ud.fbc !== undefined) add('fbc', /^fb\.1\.\d{13}\.\S+$/.test(ud.fbc), 'fbc looks like fb.1.<ms>.<fbclid>');
  if (ud.fbp !== undefined) add('fbp', /^fb\.1\.\d{13}\.\d+$/.test(ud.fbp), 'fbp looks like fb.1.<ms>.<random>');
  const keys = ['lead_id', 'em', 'ph', 'fbc', 'fbp', 'external_id'].filter((k) => ud[k] !== undefined);
  add('match-key', keys.length > 0, 'at least one match key is present');
  add('event-id', typeof ev.event_id === 'string' && ev.event_id.length > 0, 'event_id is set (retries are counted once)');
  const json = JSON.stringify(ev);
  add('no-raw-pii', !/[\w.+-]+@[\w-]+\.[\w.]+/.test(json.replace(/"event_source_url":"[^"]*"/, '')), 'no raw email address anywhere in the payload');
  if (ud.lead_id !== undefined) {
    add('cl-action', ev.action_source === 'system_generated', 'Conversion Leads: action_source is system_generated');
    add('cl-lead-id', Number.isSafeInteger(ud.lead_id) && String(ud.lead_id).length >= 15 && String(ud.lead_id).length <= 17, 'Conversion Leads: lead_id is the 15-17 digit Meta lead ID');
    add('cl-source', ev.custom_data?.event_source === 'crm' && !!ev.custom_data?.lead_event_source, 'Conversion Leads: custom_data has event_source "crm" and lead_event_source');
    if (leadCreatedAt !== null) add('cl-after', Number.isInteger(t) && t >= leadCreatedAt, 'Conversion Leads: stage time is after the lead was created');
  } else if (ev.action_source === 'website') {
    add('web-url', /^https:\/\//.test(ev.event_source_url || ''), 'website event: event_source_url is set');
    add('web-ua', !!ud.client_user_agent, 'website event: client_user_agent is set');
  }
  if (ev.event_name === 'Purchase' || ev.event_name === 'ClientSigned') {
    add('value', typeof ev.custom_data?.value === 'number' && ev.custom_data.value > 0 && ev.custom_data.currency === 'USD', 'value and currency are set');
  }
  return { ok: checks.every((c) => c.ok), checks, matchKeys: keys };
}

export function graphRequest(events, { datasetId = 'DATASET_ID', testEventCode = null, version = GRAPH_VERSION } = {}) {
  return {
    method: 'POST',
    url: `https://graph.facebook.com/${version}/${datasetId}/events`,
    body: { data: events, ...(testEventCode ? { test_event_code: testEventCode } : {}) },
  };
}

// Sample webhooks (fictional people) used by the site and the tests.
export function sampleHooks(now = Math.floor(Date.now() / 1000)) {
  const h = (s) => new Date((now - s) * 1000).toISOString();
  return {
    instant_qualified: {
      contact_id: 'cX81kQ2', email: '  Dana.Reyes@Example.com ', phone: '(714) 555-0142', first_name: 'Dana', last_name: 'Reyes',
      city: 'Huntington Beach', state: 'California', postal_code: '92649-1176', country: 'United States',
      stage: 'qualified', stage_changed_at: h(3600), lead_created_at: h(3 * 86400), fb_lead_id: '1234567890123456',
    },
    web_lead: {
      contact_id: 'cW55pL0', email: 'sam.ortiz@example.com', phone: '+1 949 555 0199', first_name: 'Sam', last_name: 'Ortiz',
      city: 'Irvine', state: 'CA', postal_code: '92618', country: 'US', stage: 'new_lead', stage_changed_at: h(120),
      fbclid: 'IwAR2xYz_Example', click_time: (now - 600) * 1000, fbp: `fb.1.${(now - 3600) * 1000}.1234567890`,
      client_ip: '203.0.113.7', user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', page_url: 'https://example.com/irs-help',
    },
    web_payment: {
      contact_id: 'cW55pL0', email: 'sam.ortiz@example.com', phone: '+1 949 555 0199', stage: 'payment', payment_id: 'inv_0003',
      amount: 600, stage_changed_at: h(86400), fbc: `fb.1.${(now - 40 * 86400) * 1000}.IwAR2xYz_Example`,
    },
  };
}
