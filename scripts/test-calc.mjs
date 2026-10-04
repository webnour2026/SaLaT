// Calcul de secours aux hautes latitudes (règle « angle ») et absence d'effet aux latitudes ordinaires.
import { computeDay } from '../js/prayer-calc.js';

let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'ÉCHEC'} ${name}${ok ? '' : `\n     obtenu  : ${JSON.stringify(got)}\n     attendu : ${JSON.stringify(want)}`}`); };
const hm = ts => ts == null ? null : new Date(ts).toISOString().slice(11, 16);
const MIN = 60000, H = 3600000;

// Berlin, solstice d'été, Ligue islamique (18°) : le Soleil ne descend pas à 18° → Fajr et Isha existent quand même
const b = computeDay({ lat: 52.52, lng: 13.4 }, '2026-06-21', 3, 0);
eq('Berlin 21 juin : Fajr et Isha présents', [b.Fajr != null, b.Isha != null], [true, true]);
eq('Berlin 21 juin : ordre Fajr < lever < Dhuhr < Asr < Maghrib < Isha', [b.Fajr < b.Sunrise, b.Sunrise < b.Dhuhr, b.Dhuhr < b.Asr, b.Asr < b.Maghrib, b.Maghrib < b.Isha], [true, true, true, true, true]);
const night = b.Sunrise - b.Sunset + 24 * H;
eq('Berlin : Fajr = lever − (18/60) de la nuit, à 1 min près', Math.abs((b.Sunrise - b.Fajr) - 0.3 * night) <= MIN, true);
eq('Berlin : Isha = coucher + (17/60) de la nuit (Isha à 17° pour la Ligue islamique), à 1 min près', Math.abs((b.Isha - b.Sunset) - (17 / 60) * night) <= MIN, true);

// Paris avec la méthode du Maroc (19° / 17°) en été
const p = computeDay({ lat: 48.8566, lng: 2.3522 }, '2026-06-21', 21, 0);
eq('Paris 21 juin, méthode du Maroc : Fajr, Isha, Imsak et minuit présents', [p.Fajr, p.Isha, p.Imsak, p.Midnight].every(v => v != null), true);
eq('Paris : Imsak = Fajr − 10 min', p.Fajr - p.Imsak, 10 * MIN);

// Umm al-Qura (Isha = Maghrib + 90 min) : la règle ne touche pas l'Isha « à durée fixe »
const q = computeDay({ lat: 52.52, lng: 13.4 }, '2026-06-21', 4, 0);
eq('Umm al-Qura à Berlin : Isha = Maghrib + 90 min', q.Isha - q.Maghrib, 90 * MIN);

// Latitudes ordinaires : jamais de valeur manquante, ordre correct, sur toute l'année et plusieurs méthodes
const places = { Rabat: [34.02, -6.84], Madrid: [40.42, -3.7], Mecque: [21.42, 39.83], Jakarta: [-6.2, 106.85], NewYork: [40.71, -74.0], Istanbul: [41.01, 28.98] };
let bad = 0, n = 0;
for (const [lat, lng] of Object.values(places)) for (const m of [21, 3, 5, 4, 1, 2, 13, 12, 19, 18, 8, 16]) for (let d = 0; d < 365; d += 7) {
  const date = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10); const r = computeDay({ lat, lng }, date, m, 0); n++;
  if (!['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].every((k, i, a) => r[k] != null && (!i || r[k] > r[a[i - 1]]))) bad++;
}
eq(`latitudes ordinaires : ${n} calculs sans valeur manquante ni désordre`, bad, 0);

// Pôle (Tromsø en janvier) : pas de lever → pas de plantage, valeurs manquantes assumées
const t = computeDay({ lat: 69.65, lng: 18.96 }, '2026-01-01', 3, 0);
eq('Tromsø en pleine nuit polaire : pas de plantage, lever absent', t.Sunrise, null);

console.log(fails ? `\n${fails} échec(s)` : '\nTous les tests réussis');
process.exit(fails ? 1 : 0);
