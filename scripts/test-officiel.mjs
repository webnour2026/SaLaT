// Tests de la lecture des horaires officiels : analyse d'une page, contrôle contre le calcul, fusion, garde-fous de l'appli.
import fs from 'node:fs';
import { parsePage, analyse, mergeFile, robotsAllows } from './officiel-lib.mjs';
import { computeDay } from '../js/prayer-calc.js';
import { localityByCode } from '../js/localites.js';

let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'ÉCHEC'} ${name}${ok ? '' : `\n     obtenu  : ${JSON.stringify(got)}\n     attendu : ${JSON.stringify(want)}`}`); };

// 1) Page au format du widget (extrait réel : Oujda, Mouharram 1448, 17 juin → 3 juillet 2026, heure légale GMT+1), étendue à 21 jours
const REAL = `17 Juin|04:00|05:48|13:14|16:56|20:30|22:02
18 Juin|04:00|05:48|13:14|16:56|20:30|22:03
19 Juin|04:01|05:49|13:14|16:56|20:30|22:03
20 Juin|04:01|05:49|13:14|16:56|20:31|22:03
21 Juin|04:01|05:49|13:15|16:56|20:31|22:03
22 Juin|04:01|05:49|13:15|16:57|20:31|22:04
23 Juin|04:01|05:49|13:15|16:57|20:31|22:04
24 Juin|04:02|05:50|13:15|16:57|20:31|22:04
25 Juin|04:02|05:50|13:15|16:57|20:31|22:04
26 Juin|04:02|05:50|13:16|16:57|20:32|22:04
27 Juin|04:03|05:51|13:16|16:58|20:32|22:04
28 Juin|04:03|05:51|13:16|16:58|20:32|22:04
29 Juin|04:04|05:51|13:16|16:58|20:32|22:04
30 Juin|04:04|05:52|13:16|16:58|20:32|22:04
1 Juil|04:05|05:52|13:17|16:58|20:32|22:03
2 Juil|04:06|05:53|13:17|16:59|20:31|22:03
3 Juil|04:06|05:53|13:17|16:59|20:31|22:03`.split('\n').map(l => l.split('|'));
const DJ = ['Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche', 'Lundi', 'Mardi'];
const html = rows => `<html><body><h3>Horaires de prières du mois de Mouharram de Oujda</h3><table><tr><th>Jours</th><th>Mouharram</th><th>Juin / Juillet</th><th>Fajr</th><th>Chorouq</th><th>Dhuhr</th><th>Asr</th><th>Maghrib</th><th>Ishae</th></tr>`
  + rows.map((r, i) => `<tr><td>${DJ[i % 7]}</td><td>${i + 1}</td><td>${r[0]}</td>${r.slice(1).map(c => `<td>${c}&nbsp;</td>`).join('')}</tr>`).join('') + '</table></body></html>';
// le tableau réel ne compte que 17 jours : on prolonge de 5 jours avec une progression raisonnable pour atteindre le minimum de 20
const more = [['4 Juil', '04:07', '05:54', '13:17', '16:59', '20:31', '22:02'], ['5 Juil', '04:08', '05:54', '13:17', '16:59', '20:30', '22:02'], ['6 Juil', '04:08', '05:55', '13:18', '16:59', '20:30', '22:01'], ['7 Juil', '04:09', '05:55', '13:18', '16:59', '20:29', '22:01']];
const rows20 = [...REAL, ...more];
const NOW = Date.UTC(2026, 5, 20);
const parsed = parsePage(html(rows20), NOW);
eq('page lue : 21 jours consécutifs, du 17 juin au 7 juillet 2026', [parsed.length, parsed[0].date, parsed.at(-1).date], [21, '2026-06-17', '2026-07-07']);
eq('première ligne : Fajr 04:00 … Isha 22:02 (en minutes)', parsed[0].t, [240, 348, 794, 1016, 1230, 1322]);
eq('« 1 Juil » : mois lu en abrégé, sans accent', parsed[14].date, '2026-07-01');

// 2) Contrôle contre le calcul : Oujda (31) en GMT+1 → fuseau détecté, heures renvoyées en UTC
const OUJDA = 31, lo = localityByCode(OUJDA);
const a = analyse(OUJDA, parsed);
eq('Oujda : analyse acceptée', a.ok, true);
eq('Oujda : décalage GMT+1 retiré (04:00 → 03:00 UTC)', a.days['2026-06-17'].split(' ')[0], '0300');
eq(`Oujda : ${lo.fr}, au moins 85 % d'heures identiques au calcul, 2 min au plus`, [a.stats.pct >= 85, a.stats.max <= 2], [true, true]);

// 3) Fuseau GMT (ligne par ligne) : le même jour décrit en GMT est reconnu
const m = computeDay({ lat: lo.lat, lng: lo.lng, code: OUJDA }, '2026-10-05', 21, 0), base = Date.UTC(2026, 9, 5);
const hh = ms => { const v = Math.round((ms - base) / 60000); return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`; };
const gmtRow = ['5 Oct', ...['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].map(k => hh(m[k]))];
const gmtRows = Array.from({ length: 22 }, (_, i) => { const d = new Date(Date.UTC(2026, 9, 5 + i)); const mm = computeDay({ lat: lo.lat, lng: lo.lng, code: OUJDA }, d.toISOString().slice(0, 10), 21, 0), b = d.getTime(); const h2 = ms => { const v = Math.round((ms - b) / 60000); return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`; }; return [`${d.getUTCDate()} Oct`.replace(/^(3[2-9]|[4-9]\d) Oct/, '$1 Nov'), ...['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].map(k => h2(mm[k]))]; });
// jours 27 → 31 octobre puis novembre : on construit les libellés proprement
const lab = i => { const d = new Date(Date.UTC(2026, 9, 5 + i)); return `${d.getUTCDate()} ${['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'][d.getUTCMonth()]}`; };
gmtRows.forEach((r, i) => { r[0] = lab(i); });
const g = analyse(OUJDA, parsePage(html(gmtRows), Date.UTC(2026, 9, 10)));
eq('Page en GMT : acceptée, heures inchangées, 100 % identiques', [g.ok, g.stats.pct, g.days['2026-10-05'].split(' ')[0] === gmtRow[1].replace(':', '')], [true, 100, true]);

// 4) Garde-fous
const bad = rows20.map((r, i) => (i % 3 === 0 ? [r[0], '04:00', '05:48', '13:14', '16:56', '21:40', '22:02'] : r));   // Maghrib faux de plus d'1 h sur 1 ligne sur 3
const b = analyse(OUJDA, parsePage(html(bad), NOW));
eq('Table abîmée (Maghrib faux) : refusée', [b.ok, b.rejects.length > 2], [false, true]);
eq('Page sans table : aucune ligne', parsePage('<html><body>maintenance</body></html>', NOW), []);
eq('Table de 10 jours : trop courte, ignorée', parsePage(html(REAL.slice(0, 10)), NOW), []);
eq('Jours non consécutifs : suites de moins de 20 jours ignorées', parsePage(html([...REAL.slice(0, 12), ...REAL.slice(14)]), NOW).length, 0);

// 5) Fusion : année glissante (de J−400 à J+45), rien n'est réécrit si rien n'a changé
const now2 = Date.UTC(2026, 9, 3);
const days = { '2025-01-01': '0600 0800 1200 1500 1700 1800', '2025-10-03': '0451 0610 1213 1530 1808 1918', '2026-09-20': '0301 0500 1200 1500 1800 1900', '2026-10-03': '0450 0609 1214 1531 1810 1920', '2026-10-04': '0451 0610 1213 1530 1808 1918', '2026-12-30': '0600 0800 1200 1500 1700 1800' };
const mf = mergeFile(null, 1, days, now2);
eq('fusion : jours de plus de 400 jours ou à plus de 45 jours écartés, le reste gardé', Object.keys(mf.file.j), ['2025-10-03', '2026-09-20', '2026-10-03', '2026-10-04']);
eq('fusion : une seconde fois avec les mêmes jours = aucun changement', mergeFile(mf.file, 1, days, now2).changed, false);
eq('fusion : une heure corrigée = changement', mergeFile(mf.file, 1, { ...days, '2026-10-04': '0452 0610 1213 1530 1808 1918' }, now2).changed, true);

// 6) robots.txt
eq('robots : tout permis', robotsAllows('User-agent: *\nDisallow:\n', '/prieres/code/index-fr.php'), true);
eq('robots : /prieres interdit', robotsAllows('User-agent: *\nDisallow: /prieres\n', '/prieres/code/index-fr.php'), false);
eq('robots : Allow plus précis que Disallow', robotsAllows('User-agent: *\nDisallow: /\nAllow: /prieres/code/\n', '/prieres/code/index-fr.php'), true);
eq('robots : règle d\'un autre robot ignorée', robotsAllows('User-agent: Googlebot\nDisallow: /\n', '/prieres/code/index-fr.php'), true);

// 7) Table de correspondance fm6oa → notre liste
const map = JSON.parse(fs.readFileSync(new URL('../data/fm6oa-villes.json', import.meta.url))).villes;
eq('correspondances : 163 localités, codes uniques, tous connus', [map.length, new Set(map.map(v => v[1])).size, map.every(v => localityByCode(v[1]))], [163, 163, true]);
eq('correspondance : Rabat-Salé présente (page de contrôle)', map.some(v => v[1] === 1), true);

// 8) Côté appli : les heures officielles ne sont utilisées que si elles sont cohérentes avec le calcul
globalThis.localStorage = { _: {}, getItem(k) { return this._[k] ?? null; }, setItem(k, v) { this._[k] = String(v); } };
const { officialDay, refreshOfficiel } = await import('../js/officiel.js');
const mod = computeDay({ lat: lo.lat, lng: lo.lng, code: OUJDA }, '2026-10-05', 21, 0);
const toStr = ms => { const v = Math.round((ms - base) / 60000); return `${String(Math.floor(v / 60)).padStart(2, '0')}${String(v % 60).padStart(2, '0')}`; };
const same = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].map(k => toStr(mod[k]));
localStorage.setItem('priere.officiel.31', JSON.stringify({ v: 1, code: 31, j: { '2026-10-05': same.join(' ') } }));
eq('appli : jour officiel identique au calcul → utilisé', Math.abs(officialDay(31, '2026-10-05', mod).Fajr - mod.Fajr) < 1, true);
const plus1 = same.map((x, i) => (i === 4 ? String(Number(x) + 1).padStart(4, '0') : x)).join(' ');
localStorage.setItem('priere.officiel.31', JSON.stringify({ v: 1, code: 31, j: { '2026-10-05': plus1 } }));
eq('appli : +1 min sur le Maghrib → les heures officielles remplacent le calcul', officialDay(31, '2026-10-05', mod).Maghrib - mod.Maghrib, 60000);
const plus9 = same.map((x, i) => (i === 4 ? String(Number(x) + 9).padStart(4, '0') : x)).join(' ');
localStorage.setItem('priere.officiel.31', JSON.stringify({ v: 1, code: 31, j: { '2026-10-05': plus9 } }));
eq('appli : +9 min sur une heure → fichier douteux, calcul conservé', officialDay(31, '2026-10-05', mod), null);
eq('appli : jour absent du fichier → calcul', officialDay(31, '2026-10-06', mod), null);
eq('appli : localité sans fichier → calcul', officialDay(40, '2026-10-05', mod), null);
localStorage.setItem('priere.officiel.31', '{pas du json');
eq('appli : fichier local illisible → calcul', officialDay(31, '2026-10-05', mod), null);
// téléchargement : un fichier mal formé n'est pas enregistré
globalThis.fetch = async () => ({ ok: true, json: async () => ({ v: 1, j: { '2026-10-05': 'n’importe quoi' } }) });
localStorage._ = {};
eq('téléchargement : fichier mal formé refusé', await refreshOfficiel(31, { force: true }), false);
globalThis.fetch = async () => ({ ok: true, json: async () => ({ v: 1, code: 31, j: { '2026-10-05': same.join(' ') } }) });
eq('téléchargement : bon fichier enregistré', await refreshOfficiel(31, { force: true }), true);
eq('téléchargement : même fichier une seconde fois → pas de changement', await refreshOfficiel(31, { force: true }), false);

console.log(fails ? `\n${fails} échec(s)` : '\nTous les tests réussis');
process.exit(fails ? 1 : 0);
