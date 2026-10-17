// Annonce du croissant instantanée, appli FERMÉE (navigateur Android, iPhone avec l'appli ajoutée à l'écran d'accueil, PC) :
// Web Push via Firebase Cloud Messaging. L'appareil reçoit un jeton Firebase (aucune donnée personnelle) que notre serveur
// (Cloudflare Worker, dossier worker/) inscrit au sujet « hilal-<langue> » ; le serveur envoie l'annonce dès que le
// calendrier des Habous (data/habous.json) change. L'appli Android (module natif) a déjà ses propres rappels : non concernée.
// Configuration publique (projet Firebase, clé VAPID, adresse du serveur) : data/push-config.json, écrit par le travail
// GitHub « Notifications (serveur) ». Bibliothèque Firebase : vendor/firebase-messaging.js (copie locale, aucun script tiers).
const KEY = 'priere.push.v1';
const REFRESH = 7 * 864e5;          // réinscription hebdomadaire (jeton renouvelé, sujet confirmé)

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const write = v => { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch { /* mode privé */ } };

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
export const pushActive = () => !!read()?.token;

let cfgP = null, fbP = null;
const config = () => (cfgP ??= fetch('data/push-config.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null)
  .then(c => (c && c.firebase?.apiKey && c.firebase?.projectId && c.vapidKey && /^https:\/\//.test(c.worker || '') ? c : (cfgP = null))));

async function messaging(cfg) {
  fbP ??= import('../vendor/firebase-messaging.js');
  const fb = await fbP;
  if (!(await fb.isSupported())) return null;
  const app = fb.getApps()[0] || fb.initializeApp(cfg.firebase);
  return { fb, m: fb.getMessaging(app) };
}

const post = (cfg, path, body) => fetch(cfg.worker.replace(/\/$/, '') + path, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) })
  .then(r => r.json().catch(() => ({}))).catch(() => ({ ok: false }));

let busy = false;
/** Met l'inscription en accord avec les réglages. want : l'utilisateur veut l'annonce ; lang : ar | fr | en. Silencieux. */
export async function syncPush({ want, lang, force = false }) {
  if (busy) return false;
  busy = true;
  try {
    const st = read();
    if (!want || !pushSupported() || Notification.permission !== 'granted') {
      if (st?.token) { const cfg = await config(); if (cfg) await post(cfg, '/unsubscribe', { token: st.token, lang: st.lang }); write(null); }
      return false;
    }
    if (!force && st?.token && st.lang === lang && Date.now() - st.at < REFRESH) return true;
    const cfg = await config(); if (!cfg) return false;
    const fm = await messaging(cfg); if (!fm) return false;
    const reg = await navigator.serviceWorker.ready;
    const token = await fm.fb.getToken(fm.m, { vapidKey: cfg.vapidKey, serviceWorkerRegistration: reg });
    if (!token) return false;
    const r = await post(cfg, '/subscribe', { token, lang, prev: st?.token === token ? st.lang : null });
    if (!r.ok) return false;
    write({ token, lang, at: Date.now() });
    return true;
  } catch (e) { console.warn('push', e); return false; } finally { busy = false; }
}

/** Notification d'essai envoyée par le serveur à cet appareil seulement (vérifie toute la chaîne, appli fermée comprise). */
export async function testPush(lang) {
  const st = read(), cfg = await config();
  if (!st?.token || !cfg) return false;
  const r = await post(cfg, '/test', { token: st.token, lang });
  return !!r.ok;
}
