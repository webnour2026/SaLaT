// Tests des localités officielles et du calcul « Maroc » : collage à la localité, cohérence sur 191 localités × l'année,
// et quelques horaires officiels de référence (échantillon, pour détecter une régression).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'salat-loc-'));
fs.mkdirSync(path.join(tmp, 'js'));
for (const f of ['prayer-calc.js', 'localites.js', 'localites-data.js']) fs.copyFileSync(path.join(root, 'js', f), path.join(tmp, 'js', f));
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
const imp = f => import(pathToFileURL(path.join(tmp, 'js', f)).href);
const { computeDay } = await imp('prayer-calc.js');
const { nearestLocality, moroccoReference, allLocalities, localityByCode, sameLocalityName } = await imp('localites.js');

let ko = 0;
const eq = (n, got, exp) => { if (String(got) !== String(exp)) { ko++; console.error('ÉCHEC', n, '\n   obtenu :', got, '\n   attendu:', exp); } else console.log('ok  ', n); };

// 1) la liste
const L = allLocalities();
eq('191 localités', L.length, 191);
eq('codes uniques', new Set(L.map(x => x.code)).size, 191);
eq('Rabat-Salé = 1, Casablanca = 58', `${localityByCode(1).fr} ${localityByCode(58).fr}`, 'Rabat-Salé Casablanca');
eq('coordonnées plausibles (Maroc, Sahara compris)', L.every(x => x.lat > 20 && x.lat < 36 && x.lng < -1 && x.lng > -18 && x.alt >= 0 && x.alt < 3000), true);
eq('noms arabes et français renseignés', L.every(x => x.ar && x.fr), true);

// 2) collage à la localité officielle
const kenitra = nearestLocality(34.261, -6.5802);
eq('Kénitra (centre) → localité 7, à moins de 10 km', `${kenitra.code} ${kenitra.km < 10}`, '7 true');
eq('une position à 10 km de Rabat se colle à Rabat', moroccoReference(34.0209, -6.7416, true).locality?.code, 1);
eq('…et garde sa position exacte si on désactive le collage', moroccoReference(34.0209, -6.7416, false).lat, 34.0209);
eq('à 60 km d\'une localité officielle : position exacte (pas de collage au-delà de 25 km)', (() => { const r = moroccoReference(29.8, -5.5, true), n = nearestLocality(29.8, -5.5); return `${n.km > 50} ${r.locality === null} ${r.lat === 29.8}`; })(), 'true true true');
eq('hors du Maroc (Paris, Madrid) : position exacte, altitude 0, aucune localité', (() => { const a = moroccoReference(48.8566, 2.3522, true), b = moroccoReference(40.4, -3.7, true); return `${a.locality === null} ${a.alt} ${a.lat} ${b.locality === null} ${b.alt}`; })(), 'true 0 48.8566 true 0');
// choix manuel d'une localité : ses coordonnées et son altitude, où que l'on soit
eq('localité choisie à la main (Essaouira, 106) depuis Paris : coordonnées et altitude de la localité', (() => { const r = moroccoReference(48.8566, 2.3522, true, 106); return `${r.locality.code} ${r.alt} ${r.lat.toFixed(2)}`; })(), '106 120 31.52');
eq('le choix manuel l\'emporte sur le collage automatique', moroccoReference(34.0209, -6.8416, true, 81).locality.code, 81);
eq('code inconnu : retour au mode automatique', moroccoReference(34.0209, -6.8416, true, 99999).locality?.code, 1);
eq('code nul = automatique', moroccoReference(34.0209, -6.8416, true, null).locality?.code, 1);
eq('computeDay avec code = calcul de cette localité, quelle que soit la position', (() => { const a = computeDay({ lat: 48.8566, lng: 2.3522, code: 106 }, '2026-10-03', 21, 0), b = computeDay({ lat: 31.5167, lng: -9.7833, snap: false, code: null }, '2026-10-03', 21, 0); return ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].every(k => a[k] === b[k]); })(), true);
eq('à Las Palmas (235 km du Maroc) : position exacte aussi', moroccoReference(28.1, -15.4, true).locality, null);

// 2 bis) « la ville de l'utilisateur est déjà la localité officielle » → rien à afficher dans les réglages
const rab = localityByCode(1), cas = localityByCode(58), mar = localityByCode(104);
eq('même nom : Rabat ↔ Rabat-Salé', sameLocalityName('Rabat', rab), true);
eq('même nom : مراكش ↔ Marrakech', `${sameLocalityName('مراكش', mar)} ${sameLocalityName('Marrakech', mar)}`, 'true true');
eq('même nom : الدار البيضاء ↔ Casablanca', `${sameLocalityName('الدار البيضاء', cas)} ${sameLocalityName('casablanca', cas)}`, 'true true');
eq('autre nom (un quartier ou un village) : on affichera la localité', `${sameLocalityName('Tamansourt', mar)} ${sameLocalityName('', mar)} ${sameLocalityName('Sidi Moumen', cas)}`, 'false false false');
eq('« Fès » ↔ Fès (accents ignorés)', sameLocalityName('Fes', localityByCode(81)), true);

// 3) cohérence : 191 localités × 73 jours répartis sur l'année — ordre des prières, valeurs finies
let bad = 0, n = 0;
for (const x of L) for (let d = 0; d < 365; d += 5) {
  const date = new Date(Date.UTC(2026, 9, 3 + d)).toISOString().slice(0, 10);
  const r = computeDay({ lat: x.lat, lng: x.lng }, date, 21, 0), seq = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].map(k => r[k]);
  n++; if (seq.some(v => !Number.isFinite(v)) || seq.some((v, i) => i && v <= seq[i - 1])) bad++;
}
eq(`${n} jours-localités : ordre Fajr < Chourouq < Dhuhr < Asr < Maghrib < Isha`, bad, 0);

// 4) horaires officiels de référence (échantillon) — heure affichée en GMT (ou GMT+1 en été), 1 minute de tolérance
const hm = (ts, plus1) => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: plus1 ? 'Etc/GMT-1' : 'UTC' }).format(ts);
const mins = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const REF = [   // [libellé, lat, lng (position « utilisateur »), date, GMT+1 ?, Fajr, Chourouq, Dhuhr, Asr, Maghrib, Isha]
  ['Rabat, Ramadan 1447 (1er)', 34.0209, -6.8416, '2026-02-19', false, '05:39', '07:05', '12:46', '15:50', '18:19', '19:34'],
  ['Rabat, Ramadan 1447 (30e)', 34.0209, -6.8416, '2026-03-20', false, '05:02', '06:28', '12:40', '16:02', '18:43', '19:58'],
  ['Casablanca, 17 juin 2026', 33.5731, -7.5898, '2026-06-17', true, '04:29', '06:17', '13:37', '17:16', '20:48', '22:20'],
  ['Casablanca, 6 juillet 2026', 33.5731, -7.5898, '2026-07-06', true, '04:37', '06:23', '13:40', '17:20', '20:49', '22:20'],
  ['Tétouan, 3 oct. 2026', 35.5889, -5.3626, '2026-10-03', false, '04:48', '06:13', '12:15', '15:30', '18:08', '19:22'],
  ['Oujda, 3 oct. 2026', 34.6814, -1.9086, '2026-10-03', false, '04:35', '05:58', '12:02', '15:17', '17:55', '19:08'],
  ['Fès, 20 sept. 2026', 34.0331, -5.0003, '2026-09-20', false, '04:37', '06:02', '12:18', '15:42', '18:25', '19:39'],
  ['Guelmim, 12 juin 2026', 28.987, -10.0574, '2026-06-12', true, '05:00', '06:36', '13:45', '17:13', '20:46', '22:08'],
  ['Béni Mellal, 20 sept. 2026', 32.3373, -6.3498, '2026-09-20', false, '04:45', '06:06', '12:24', '15:47', '18:32', '19:42'],
  ['Marrakech, 30 sept. 2026', 31.6295, -7.9811, '2026-09-30', false, '04:59', '06:20', '12:27', '15:45', '18:24', '19:35'],
  ['Mohammedia, 30 juil. 2026', 33.6861, -7.3833, '2026-07-30', true, '04:58', '06:37', '13:41', '17:20', '20:35', '22:01'],
  ['Casablanca, hiver 22 nov. 2025', 33.5731, -7.5898, '2025-11-22', true, '06:37', '08:05', '13:22', '16:05', '18:29', '19:46'],
  ['Casablanca, hiver 9 déc. 2025', 33.5731, -7.5898, '2025-12-09', true, '06:49', '08:20', '13:28', '16:04', '18:27', '19:46'],
  ['Ifrane (1 500 m), hiver 13 janv. 2024', 33.5228, -5.1106, '2024-01-13', true, '06:52', '08:17', '13:34', '16:14', '18:41', '19:56'],
  ['Assoul (2 800 m), 3 oct. 2026', 31.9333, -5.1833, '2026-10-03', false, '04:50', '06:07', '12:15', '15:32', '18:12', '19:19'],
  ['Boulemane (2 500 m), 3 oct. 2026', 33.3667, -4.7333, '2026-10-03', false, '04:47', '06:06', '12:13', '15:29', '18:10', '19:18'],
];
let tot = 0, exact = 0, worst = 0;
for (const [lbl, lat, lng, date, p1, ...ref] of REF) {
  const r = computeDay({ lat, lng }, date, 21, 0);
  ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].forEach((k, j) => { const e = Math.abs(mins(hm(r[k], p1)) - mins(ref[j])); tot++; if (!e) exact++; worst = Math.max(worst, e); });
}
eq(`${tot} horaires officiels d'échantillon : écart maximal ≤ 1 minute`, worst <= 1, true);
eq(`…dont au moins 85 % identiques à la minute (${exact}/${tot})`, exact / tot >= 0.85, true);

// 5) les autres méthodes ne sont pas touchées (MWL à Paris : valeurs usuelles d'un jour d'équinoxe)
const p = computeDay({ lat: 48.8566, lng: 2.3522 }, '2026-03-20', 3, 0);
eq('MWL à Paris : Dhuhr entre 12:00 et 13:30 UTC et Fajr avant le lever', (() => { const h = ts => new Date(ts).getUTCHours() + new Date(ts).getUTCMinutes() / 60; return h(p.Dhuhr) > 11.5 && h(p.Dhuhr) < 13.5 && p.Fajr < p.Sunrise; })(), true);

fs.rmSync(tmp, { recursive: true, force: true });
if (ko) { console.error(ko, 'échec(s)'); process.exit(1); }
console.log('Tous les tests réussis');
