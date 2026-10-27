// Textes et règles d'envoi de l'annonce du croissant (worker/src/messages.js).
import { lastAnnouncement, announcementText, relDay, testText, LANGS } from '../worker/src/messages.js';
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'ÉCHEC'} ${name}${ok ? '' : `\n     obtenu  : ${JSON.stringify(got)}\n     attendu : ${JSON.stringify(want)}`}`); };
const base = [{ y: 1448, m: 4, start: '2026-09-13' }, { y: 1448, m: 5, start: '2026-10-13' }];
const seen = lastAnnouncement({ months: [...base, { y: 1448, m: 6, start: '2026-11-11' }] });
const not = lastAnnouncement({ months: [...base, { y: 1448, m: 6, start: '2026-11-12' }] });
eq('vu : mois précédent de 29 jours', [seen.m, seen.seen], [6, true]);
eq('non vu : mois précédent de 30 jours', not.seen, false);
eq('mois précédent inconnu : ni vu ni non vu', lastAnnouncement({ months: [{ y: 1448, m: 6, start: '2026-11-11' }] }).seen, null);
eq('tri par année puis mois (Mouharram après Dhou al-Hijja)', lastAnnouncement({ months: [{ y: 1449, m: 1, start: '2027-06-06' }, { y: 1448, m: 12, start: '2027-05-08' }] }).m, 1);
eq('soir du 10/11 à 20 h : 1er demain', relDay(seen, new Date('2026-11-10T20:00:00Z')), 1);
eq('non vu le 10/11 : 1er après-demain', relDay(not, new Date('2026-11-10T20:00:00Z')), 2);
eq('rattrapage le matin du 1er', relDay(seen, new Date('2026-11-11T08:00:00Z')), 0);
eq('le 1er après midi : plus rien', relDay(seen, new Date('2026-11-11T13:00:00Z')), null);
eq('annonce ancienne : rien', relDay(seen, new Date('2026-11-20T20:00:00Z')), null);
const ar = announcementText(seen, 'ar', 1), fr = announcementText(not, 'fr', 2);
eq('titre arabe (vu)', ar.title, '🌙 ثبت هلال شهر جمادى الآخرة');
eq('texte arabe (vu)', ar.body, 'فاتح شهر جمادى الآخرة 1448هـ غدًا، الأربعاء 11 نونبر 2026، حسب بلاغ وزارة الأوقاف والشؤون الإسلامية.');
eq('titre français (non vu)', fr.title, '🌙 Croissant de Joumada ath-Thania non observé');
eq('texte français (non vu)', fr.body, 'Joumada al-Oula compte 30 jours. Le 1er Joumada ath-Thania 1448 est après-demain, jeudi 12 novembre 2026, selon le communiqué du ministère des Habous.');
eq('même étiquette pour toutes les langues (remplace un doublon)', LANGS.map(l => announcementText(seen, l, 1).tag), ['hilal-1448-6', 'hilal-1448-6', 'hilal-1448-6']);
const adha = announcementText({ y: 1448, m: 12, start: '2027-05-08', seen: true }, 'fr', 1);
eq('Dhou al-Hijja : date de l’Aïd al-Adha (10e jour)', adha.body.endsWith('L’Aïd al-Adha sera le lundi 17 mai 2027.'), true);
eq('Ramadan : vœux', announcementText({ y: 1448, m: 9, start: '2027-02-08', seen: false }, 'ar', 2).body.endsWith('رمضان مبارك.'), true);
eq('toutes les valeurs sont des chaînes (exigé par FCM)', LANGS.every(l => Object.values(announcementText(seen, l, 1)).every(v => typeof v === 'string')), true);
eq('notification d’essai dans les 3 langues', LANGS.every(l => testText(l)?.title), true);
// ── page privée d'annonce manuelle (worker/src/annonce.js) ──
{
  const { annonce } = await import('../worker/src/annonce.js');
  const kv = new Map(), KV = { get: async k => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v) };
  let calls = [];
  globalThis.fetch = async (url, o) => { calls.push({ url, body: JSON.parse(o.body) }); return new Response(null, { status: 204 }); };
  const env = { ANNONCE_KEY: 'code-tres-secret-123', GH_DISPATCH_TOKEN: 'x', KV };
  const post = (key, start, ip = '1.1.1.1') => { const f = new FormData(); f.set('key', key); f.set('start', start);
    return annonce(new Request('https://w/annonce', { method: 'POST', body: f, headers: { 'CF-Connecting-IP': ip } }), env); };
  const tom = new Date(Date.now() + 864e5).toISOString().slice(0, 10), far = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  eq('annonce : page non activée sans secrets', (await annonce(new Request('https://w/annonce'), { KV })).status, 503);
  eq('annonce : formulaire', (await annonce(new Request('https://w/annonce'), env)).status, 200);
  eq('annonce : mauvais code refusé', (await post('faux', tom)).status, 403);
  eq('annonce : date trop lointaine refusée', (await post(env.ANNONCE_KEY, far)).status, 400);
  eq('annonce : rien lancé avant un bon code et une bonne date', calls.length, 0);
  eq('annonce : bon code + demain → travail Habous lancé', (await post(env.ANNONCE_KEY, tom)).status, 200);
  eq('annonce : date transmise au travail', calls[0]?.body?.inputs?.start, tom);
  for (let i = 0; i < 5; i++) await post('faux', tom, '9.9.9.9');
  eq('annonce : bloqué après 5 mauvais codes (même avec le bon)', (await post(env.ANNONCE_KEY, tom, '9.9.9.9')).status, 429);
}

console.log(fails ? `\n${fails} échec(s)` : '\ntout passe');
process.exit(fails ? 1 : 0);
