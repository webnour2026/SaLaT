// Tests de la planification des rappels (jours blancs, début de mois, Aïds) envoyés au module Android.
// Les modules de js/ sont copiés dans un dossier temporaire « type: module » pour être importés tels quels.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'salat-rem-'));
fs.cpSync(path.join(root, 'js'), path.join(tmp, 'js'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
const load = f => import(pathToFileURL(path.join(tmp, 'js', f)).href);
const { setHabous, useHabous } = await load('hijri.js');
const { HABOUS_BUILTIN } = await load('habous.js');
const { planNativeReminders } = await load('reminders.js');

const MONTHS = ['Mouharram', 'Safar', 'Rabia al-Awal', 'Rabia ath-Thani', 'Joumada al-Oula', 'Joumada ath-Thania', 'Rajab', 'Chaabane', 'Ramadan', 'Chawwal', 'Dhou al-Qi’da', 'Dhou al-Hijja'];
const t = (k, v) => k === 'hijriMonths' ? MONTHS : `${k}${v ? JSON.stringify(v) : ''}`;
const DAY = 864e5, addDays = (k, n) => new Date(Date.parse(k + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const plan = (today, opts = {}) => {
  const limit = addDays(today, 42);
  return planNativeReminders({
    today, t, addDays, now: Date.parse(today + 'T00:00:00Z'),
    prefs: { eid: true, month: true, white: true, friday: false, ...(opts.prefs || {}) }, offset: opts.offset || 0,
    dayInfo: k => (k > limit ? null : { Sunrise: Date.parse(k + 'T05:30:00Z'), Maghrib: Date.parse(k + 'T18:40:00Z'), Isha: Date.parse(k + 'T20:00:00Z') }),   // UTC+1 : lever 06:30, Maghrib 19:40, Isha 21:00
  });
};
const ids = l => l.map(e => e.id).join(' ');

let ko = 0;
const eq = (n, g, e) => { if (g !== e) { ko++; console.error('ÉCHEC', n, '\n   obtenu :', g, '\n   attendu:', e); } else console.log('ok  ', n); };

setHabous(HABOUS_BUILTIN); useHabous(true);

// 30 septembre 2026 : Rabi' II a commencé le 13 sept (officiel). Le début de Joumada I n'est pas annoncé.
let p = plan('2026-09-30');
eq('30 sept : 2 veilles à surveiller (11 et 12 oct)', ids(p), '2026-10-11-month 2026-10-12-month');
eq('30 sept : la veille du 29 vise le 12 octobre', p[0].watch, '2026-10-12');
eq('30 sept : la veille du 30 vise le 13 octobre', p[1].watch, '2026-10-13');
eq('30 sept : envoi 20 min après le Maghrib (19:40 → 20:00 UTC+1 = 19:00 UTC)', new Date(p[0].at).toISOString(), '2026-10-11T19:00:00.000Z');
eq('30 sept : surveillance pendant 4 h', String((p[0].until - p[0].at) / 3600e3), '4');
eq('30 sept : titre du mois suivant (Joumada al-Oula)', p[0].title, 'monthNotifTitle{"m":"Joumada al-Oula"}');
eq('30 sept : le doua est dans le corps', String(p[0].body.startsWith('monthDua')), 'true');
eq('30 sept : pas de jours blancs prévus (mois non annoncé)', String(p.filter(e => e.kind === 'white').length), '0');

// 10 mars 2026 : Aïd al-Fitr (20 mars) et jours blancs de Chawwal (13, 14, 15)
p = plan('2026-03-10');
eq('10 mars : Aïd al-Fitr certain, veille = 19 mars', ids(p.filter(e => e.kind === 'eid')), '2026-03-19-eid');
eq('10 mars : Aïd al-Fitr sans surveillance (déjà annoncé)', String(p.find(e => e.kind === 'eid').watch), 'undefined');
eq('10 mars : titre de l\'Aïd al-Fitr', p.find(e => e.kind === 'eid').title, 'fitrNotifTitle');
eq('10 mars : corps = takbir + vœux + zakat', p.find(e => e.kind === 'eid').body, 'takbir\neidGreeting\nfitrZakat');
eq('10 mars : jours blancs de Chawwal (13, 14, 15 → veilles 31 mars, 1er et 2 avril)', ids(p.filter(e => e.kind === 'white')), '2026-03-31-white 2026-04-01-white 2026-04-02-white');
eq('10 mars : jours blancs envoyés 30 min après l\'Isha', new Date(p.find(e => e.kind === 'white').at).toISOString(), '2026-03-31T20:30:00.000Z');

// 20 mai 2026 : Aïd al-Adha le 27 mai ; jours blancs de Dhou al-Hijja sans le 13 (Tachriq)
p = plan('2026-05-20');
eq('20 mai : Aïd al-Adha, veille = 26 mai', ids(p.filter(e => e.kind === 'eid')), '2026-05-26-eid');
eq('20 mai : titre de l\'Aïd al-Adha', p.find(e => e.kind === 'eid').title, 'adhaNotifTitle');
eq('20 mai : jours blancs de Dhou al-Hijja sans le 13 (Tachriq)', ids(p.filter(e => e.kind === 'white' && e.id < '2026-06-10')), '2026-05-30-white 2026-05-31-white');
eq('20 mai : puis ceux de Mouharram (13 Mouharram = 29 juin)', String(p.some(e => e.id === '2026-06-28-white')), 'true');
eq('20 mai : Aïd al-Adha sans la zakat al-fitr', String(p.find(e => e.kind === 'eid').body.includes('fitrZakat')), 'false');

// réglages
eq('tout désactivé → aucun rappel', ids(plan('2026-03-10', { prefs: { eid: false, month: false, white: false } })), '');
eq('sans jours blancs', String(plan('2026-03-10', { prefs: { white: false } }).filter(e => e.kind === 'white').length), '0');
eq('Aïd désactivé, début de mois actif : 1er Chawwal → rappel de mois', ids(plan('2026-03-10', { prefs: { eid: false } }).filter(e => e.id === '2026-03-19-month')), '2026-03-19-month');
eq('début de mois désactivé : pas de veille à surveiller', ids(plan('2026-09-30', { prefs: { month: false } })), '');

// rappels périmés écartés (le 1er avril à 04:00 UTC : l'Aïd et le 31 mars sont passés, la fenêtre de 6 h du 31 mars est close)
const late = planNativeReminders({ today: '2026-03-10', t, addDays, now: Date.parse('2026-04-01T04:00:00Z'), prefs: { eid: true, month: true, white: true }, offset: 0,
  dayInfo: k => (k > '2026-04-20' ? null : { Maghrib: Date.parse(k + 'T18:40:00Z'), Isha: Date.parse(k + 'T20:00:00Z') }) });
eq('rappels expirés écartés', String(late.some(e => e.id === '2026-03-19-eid' || e.id === '2026-03-31-white')), 'false');
eq('rappels à venir conservés', String(late.some(e => e.id === '2026-04-01-white')), 'true');
const still = planNativeReminders({ today: '2026-03-10', t, addDays, now: Date.parse('2026-03-31T23:59:00Z'), prefs: { eid: true, month: true, white: true }, offset: 0,
  dayInfo: k => (k > '2026-04-20' ? null : { Maghrib: Date.parse(k + 'T18:40:00Z'), Isha: Date.parse(k + 'T20:00:00Z') }) });
eq('fenêtre de 6 h : le rappel du 31 mars est encore valable à 23:59 UTC', String(still.some(e => e.id === '2026-03-31-white')), 'true');

// hors Maroc : calcul, jamais de surveillance
useHabous(false);
p = plan('2026-09-30');
eq('hors Maroc : aucune surveillance', String(p.some(e => e.watch)), 'false');
eq('hors Maroc : le début de Joumada I est prévu par le calcul', String(p.some(e => e.kind === 'month')), 'true');
eq('hors Maroc : jours blancs présents (calcul)', String(plan('2026-09-20').filter(e => e.kind === 'white').length >= 2), 'true');

// vendredi : sans fuseau, rappel 15 min après le lever du soleil ; avec le fuseau du lieu, à 09:30 ; utile 3 h
p = plan('2026-09-30', { prefs: { friday: true, month: false } });
const fr = p.filter(e => e.kind === 'friday');
eq('vendredi : 6 vendredis dans les 40 jours', String(fr.length), '6');
eq('vendredi : le premier est le 2 octobre 2026', fr[0].id, '2026-10-02-friday');
eq('vendredi : tous sont des vendredis', String(fr.every(e => new Date(e.id.slice(0, 10) + 'T12:00:00Z').getUTCDay() === 5)), 'true');
eq('vendredi : envoi à 06:45 (heure du Maroc) = 05:45 UTC', new Date(fr[0].at).toISOString(), '2026-10-02T05:45:00.000Z');
eq('vendredi : valable 3 h', String((fr[0].until - fr[0].at) / 3600e3), '3');
eq('vendredi : titre et corps', `${fr[0].title} | ${fr[0].body}`, 'fridayNotifTitle | fridayNotifBody');
eq('vendredi : désactivé par défaut dans ce test', String(plan('2026-09-30').some(e => e.kind === 'friday')), 'false');
eq('vendredi : sans lever du soleil connu → pas de rappel', String(planNativeReminders({ today: '2026-09-30', t, addDays, now: Date.parse('2026-09-30T00:00:00Z'), prefs: { friday: true }, offset: 0, dayInfo: k => ({ Maghrib: Date.parse(k + 'T18:40:00Z') }) }).some(e => e.kind === 'friday')), 'false');
{
  const z = planNativeReminders({ today: '2026-09-30', t, addDays, now: Date.parse('2026-09-30T00:00:00Z'), prefs: { friday: true }, offset: 0, tz: 'Etc/GMT-1', dayInfo: k => ({ Maghrib: Date.parse(k + 'T18:40:00Z') }) }).filter(e => e.kind === 'friday');   // fuseau fixe : indépendant de la base des fuseaux installée
  eq('vendredi : 09:30 en UTC+1 = 08:30 UTC', new Date(z[0].at).toISOString(), '2026-10-02T08:30:00.000Z');
  const zu = planNativeReminders({ today: '2026-09-30', t, addDays, now: Date.parse('2026-09-30T00:00:00Z'), prefs: { friday: true }, offset: 0, tz: 'UTC', dayInfo: k => ({ Maghrib: 1 }) }).filter(e => e.kind === 'friday');
  eq('vendredi : 09:30 au Maroc (GMT, fuseau UTC de l\'appli) = 09:30 UTC', new Date(zu[0].at).toISOString(), '2026-10-02T09:30:00.000Z');
  eq('vendredi : un seul rappel par vendredi (pas de doublon)', String(new Set(z.map(e => e.id)).size === z.length), 'true');
  const pz = planNativeReminders({ today: '2026-09-30', t, addDays, now: Date.parse('2026-09-30T00:00:00Z'), prefs: { friday: true }, offset: 0, tz: 'Europe/Paris', dayInfo: k => ({ Maghrib: 1 }) }).filter(e => e.kind === 'friday');
  eq('vendredi : 09:30 à Paris en heure d\'été = 07:30 UTC', new Date(pz[0].at).toISOString(), '2026-10-02T07:30:00.000Z');
  const pw = pz.find(e => e.id === '2026-11-06-friday');
  eq('vendredi : 09:30 à Paris en heure d\'hiver = 08:30 UTC', new Date(pw.at).toISOString(), '2026-11-06T08:30:00.000Z');
}
eq('vendredi : coexiste avec les jours blancs (ids distincts)', String(new Set(plan('2026-09-20', { prefs: { friday: true } }).map(e => e.id)).size === plan('2026-09-20', { prefs: { friday: true } }).length), 'true');

// Mouharram, Ramadan, Chawwal, Dhou al-Hijja : « ce soir, observation » à l'Asr du 29, puis « croissant non vu » (surveillance du surlendemain)
{
  useHabous(true);
  const lastIs = (m, y, start) => setHabous({ updated: start, months: [{ y, m, start }] });
  const planA = (today, prefs = {}) => planNativeReminders({ today, t, addDays, now: Date.parse(today + 'T00:00:00Z'), offset: 0,
    prefs: { eid: true, month: true, white: false, friday: false, ...prefs },
    dayInfo: k => ({ Sunrise: Date.parse(k + 'T06:00:00Z'), Asr: Date.parse(k + 'T15:30:00Z'), Maghrib: Date.parse(k + 'T18:30:00Z'), Isha: Date.parse(k + 'T20:00:00Z') }) });
  lastIs(8, 1447, '2026-01-21');                         // Chaabane 1447 : 29 = 18 février
  let q = planA('2026-02-10');
  const obs = q.find(e => e.kind === 'obs'), no = q.find(e => e.kind === 'nosight');
  eq('Ramadan : observation annoncée le 29 Chaabane (18 févr.)', obs && obs.id, '2026-02-18-obs');
  eq('Ramadan : à l\'heure de l\'Asr', obs && new Date(obs.at).toISOString(), '2026-02-18T15:30:00.000Z');
  eq('Ramadan : observation sans réseau (pas de surveillance)', String(obs && obs.watch), 'undefined');
  eq('Ramadan : « non vu » le même soir', no && no.id, '2026-02-18-nosight');
  eq('Ramadan : « non vu » seulement si le mois commence le surlendemain (20 févr.)', no && no.watch, '2026-02-20');
  eq('Ramadan : « vu » toujours surveillé pour le lendemain (19 févr.)', q.find(e => e.id === '2026-02-18-month')?.watch, '2026-02-19');
  eq('Ramadan : ids distincts', String(new Set(q.map(e => e.id)).size === q.length), 'true');
  eq('Ramadan : texte « non vu »', no && no.body, 'nosightRamadanBody{"m":"Ramadan","p":"Chaabane"}');
  lastIs(9, 1447, '2026-02-19');                         // Ramadan → Chawwal (Aïd)
  q = planA('2026-03-10');
  eq('Aïd al-Fitr : observation + non vu', q.filter(e => e.kind === 'obs' || e.kind === 'nosight').map(e => e.id).join(' '), '2026-03-19-obs 2026-03-19-nosight');
  eq('Aïd al-Fitr : texte « jour de jeûne »', q.find(e => e.kind === 'nosight').body.startsWith('nosightFitrBody'), true);
  eq('Aïd al-Fitr : avec les seuls rappels des Aïds', String(planA('2026-03-10', { month: false }).some(e => e.kind === 'obs')), 'true');
  lastIs(12, 1447, '2026-05-18');                        // Dhou al-Hijja → Mouharram 1448
  q = planA('2026-06-10');
  eq('Mouharram : observation annoncée', String(q.some(e => e.id === '2026-06-15-obs')), 'true');
  eq('Mouharram : mois précédent au génitif', q.find(e => e.kind === 'nosight').body, 'nosightNotifBody{"m":"Mouharram","p":"Dhou al-Hijja"}');
  eq('Mouharram : titre « nouvel an » si vu', q.find(e => e.id === '2026-06-15-month')?.title, 'newYearNotifTitle{"y":1448}');
  eq('Mouharram : désactivé avec les rappels de mois', String(planA('2026-06-10', { month: false }).some(e => e.kind === 'obs')), 'false');
  lastIs(11, 1447, '2026-04-19');                        // Dhou al-Qi'da → Dhou al-Hijja
  eq('Dhou al-Hijja : observation annoncée', String(planA('2026-05-10').some(e => e.kind === 'obs')), 'true');
  lastIs(4, 1448, '2026-09-13');                         // Rabi' II → Joumada I : mois ordinaire
  eq('mois ordinaire (Joumada I) : ni observation ni « non vu »', String(planA('2026-10-05').some(e => e.kind === 'obs' || e.kind === 'nosight')), 'false');
  setHabous(HABOUS_BUILTIN);
}

// taille de la charge utile envoyée au module (limite 60 000 caractères une fois décodée, mais on reste très en dessous)
useHabous(true);
const size = JSON.stringify(plan('2026-09-30')).length;
eq('charge utile raisonnable (< 6 000 caractères)', String(size < 6000), 'true');

fs.rmSync(tmp, { recursive: true, force: true });
if (ko) { console.error(ko, 'échec(s)'); process.exit(1); }
console.log('Tous les tests réussis');
