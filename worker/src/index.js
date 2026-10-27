// SaLaTi — serveur des notifications instantanées (Cloudflare Worker).
//  • POST /subscribe   {token, lang, prev}  inscrit un appareil (jeton Firebase, aucune donnée personnelle) au sujet hilal-<lang>
//  • POST /unsubscribe {token, lang}        le désinscrit
//  • POST /test        {token, lang}        envoie une notification d'essai à CE jeton seulement
//  • GET/POST /annonce                    page privée : annonce manuelle du croissant (code secret)
//  • POST /check                            relit data/habous.json et envoie l'annonce si elle est nouvelle (aussi par cron)
// Une annonce n'est envoyée qu'une fois (clé KV sent:<année>-<mois>) et seulement si le 1er du mois est dans 0–2 jours :
// /check peut donc être appelé par n'importe qui sans risque.
// Secret du Worker : FCM_SERVICE_ACCOUNT (clé JSON du compte de service Firebase), posé par le travail GitHub.
import { annonce, annonceEtat } from './annonce.js';
import { LANGS, lastAnnouncement, announcementText, relDay, testText } from './messages.js';

const TOKEN_RE = /^[\w:-]{60,400}$/;

export default {
  async fetch(req, env) {
    const url = new URL(req.url), origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const cors = { 'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] || '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
    if (url.pathname === '/annonce/etat') return annonceEtat(env);     // contrôle hebdomadaire du jeton (sans secret)
    if (url.pathname === '/annonce') return annonce(req, env);        // page privée d'annonce manuelle (voir annonce.js)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method === 'GET' && url.pathname === '/') return json({ ok: true, service: 'salati-push' });
    if (req.method === 'GET' && url.pathname === '/status') {          // contrôle après déploiement : la clé Firebase est-elle valable ?
      try { await accessToken(env); return json({ ok: true, projet: account(env).project_id }); } catch (e) { return json({ ok: false, error: String(e.message || e) }, 500); }
    }
    if (req.method !== 'POST') return json({ error: 'méthode' }, 405);
    try {
      if (url.pathname === '/check') return json(await check(env));
      if (['/subscribe', '/unsubscribe', '/test'].includes(url.pathname)) {
        if (origin && !allowed.includes(origin)) return json({ error: 'origine' }, 403);
        const b = await req.json().catch(() => null);
        const token = b && String(b.token || ''), lang = b && LANGS.includes(b.lang) ? b.lang : 'ar';
        if (!TOKEN_RE.test(token)) return json({ error: 'jeton' }, 400);
        if (url.pathname === '/test') return json(await send(env, { token, data: { ...testText(lang), tag: 'salati-test', url: './', lang } }));
        if (url.pathname === '/unsubscribe') return json(await topics(env, 'batchRemove', `hilal-${lang}`, token));
        const prev = b.prev && LANGS.includes(b.prev) && b.prev !== lang ? b.prev : null;
        if (prev) await topics(env, 'batchRemove', `hilal-${prev}`, token).catch(() => {});
        return json(await topics(env, 'batchAdd', `hilal-${lang}`, token));
      }
      return json({ error: 'adresse' }, 404);
    } catch (e) { return json({ error: String(e && e.message || e) }, 500); }
  },
  async scheduled(_ev, env, ctx) { ctx.waitUntil(check(env)); },
};

async function check(env) {
  const res = await fetch(`${env.HABOUS_URL}?t=${Date.now()}`, { cf: { cacheTtl: 0 } });
  if (!res.ok) return { status: 'calendrier illisible', http: res.status };
  const a = lastAnnouncement(await res.json());
  if (!a) return { status: 'calendrier vide' };
  const rel = relDay(a, new Date());
  if (rel === null) return { status: 'rien à annoncer', dernier: a.start };
  const key = `sent:${a.y}-${a.m}`;
  if (await env.KV.get(key)) return { status: 'déjà envoyé', mois: `${a.y}-${a.m}` };
  await env.KV.put(key, new Date().toISOString(), { expirationTtl: 120 * 86400 });   // avant l'envoi : un seul envoi même si deux relevés se croisent
  const out = {};
  for (const lang of LANGS) out[lang] = await send(env, { topic: `hilal-${lang}`, data: announcementText(a, lang, rel) }).catch(e => ({ error: String(e.message || e) }));
  if (LANGS.every(l => out[l].error)) await env.KV.delete(key);                       // tout a échoué : on retentera au prochain relevé
  return { status: 'envoyé', mois: `${a.y}-${a.m}`, vu: a.seen, rel, out };
}

// ---------- Firebase Cloud Messaging (API HTTP v1) ----------
async function send(env, { topic, token, data }) {
  const sa = account(env);
  const message = { data, webpush: { headers: { Urgency: 'high', TTL: '86400' } }, android: { priority: 'high', ttl: '86400s' } };
  if (topic) message.topic = topic; else message.token = token;
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST', headers: { Authorization: `Bearer ${await accessToken(env)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`FCM ${r.status} ${j.error?.status || ''}`);
  return { ok: true, id: j.name };
}

async function topics(env, op, topic, token) {
  const r = await fetch(`https://iid.googleapis.com/iid/v1:${op}`, {
    method: 'POST', headers: { Authorization: `Bearer ${await accessToken(env)}`, access_token_auth: 'true', 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: `/topics/${topic}`, registration_tokens: [token] }) });
  const j = await r.json().catch(() => ({}));
  const err = !r.ok ? `IID ${r.status}` : j.results?.[0]?.error;
  return err ? { ok: false, error: err } : { ok: true, topic };
}

const account = env => {
  if (!env.FCM_SERVICE_ACCOUNT) throw new Error('FCM_SERVICE_ACCOUNT absent');
  return JSON.parse(env.FCM_SERVICE_ACCOUNT);
};

let cached = { token: '', exp: 0 };
async function accessToken(env) {
  if (cached.token && Date.now() < cached.exp - 60e3) return cached.token;
  const sa = account(env), now = Math.floor(Date.now() / 1000);
  const b64 = s => btoa(String.fromCharCode(...new Uint8Array(typeof s === 'string' ? new TextEncoder().encode(s) : s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unsigned = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64(JSON.stringify({
    iss: sa.client_email, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/cloud-platform' }))}`;
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${b64(sig)}` });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`OAuth ${r.status} ${j.error || ''}`);
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}
