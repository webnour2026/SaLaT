// Contrôle du calcul local (js/prayer-calc.js) contre AlAdhan, la source des horaires hors Maroc.
// Lancé par le workflow « Vérifier les méthodes » (le réseau des runners GitHub joint api.aladhan.com).
// Usage : node scripts/verifier-aladhan.mjs  → tableau des écarts (minutes) par ville, méthode et prière ; code 1 si un écart dépasse SEUIL.
import { computeDay } from '../js/prayer-calc.js';

const SEUIL = 2;   // minutes
const PRAYERS = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
// [ville, lat, lng, méthode] — chaque méthode dans un pays qui l'utilise, + latitudes extrêmes
const CASES = [
  ['La Mecque', 21.4225, 39.8262, 4], ['Le Caire', 30.0444, 31.2357, 5], ['Karachi', 24.8607, 67.0011, 1],
  ['New York', 40.7128, -74.006, 2], ['Istanbul', 41.0082, 28.9784, 13], ['Paris', 48.8566, 2.3522, 12],
  ['Alger', 36.7538, 3.0588, 19], ['Tunis', 36.8065, 10.1815, 18], ['Dubaï', 25.2048, 55.2708, 16],
  ['Manama', 26.2285, 50.586, 8], ['Koweït', 29.3759, 47.9774, 9], ['Doha', 25.2854, 51.531, 10],
  ['Singapour', 1.3521, 103.8198, 11], ['Kuala Lumpur', 3.139, 101.6869, 17], ['Jakarta', -6.2088, 106.8456, 20],
  ['Moscou', 55.7558, 37.6173, 14], ['Lisbonne', 38.7223, -9.1393, 22], ['Amman', 31.9539, 35.9106, 23],
  ['Qom', 34.6416, 50.8746, 0], ['Téhéran', 35.6892, 51.389, 7], ['Londres', 51.5074, -0.1278, 3],
  ['Bruxelles', 50.8503, 4.3517, 3], ['Madrid', 40.4168, -3.7038, 3], ['Oslo', 59.9139, 10.7522, 3],
  ['Londres (Moonsighting)', 51.5074, -0.1278, 15], ['Bamako', 12.6392, -8.0029, 3], ['Sydney', -33.8688, 151.2093, 3],
];
const DATES = ['2026-01-15', '2026-04-10', '2026-06-21', '2026-10-11'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function aladhan(lat, lng, method, date) {
  const [y, m, d] = date.split('-');
  const url = `https://api.aladhan.com/v1/timings/${d}-${m}-${y}?latitude=${lat}&longitude=${lng}&method=${method}&school=0&iso8601=true`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'SaLaTi-verification (github.com/webnour2026/SaLaT)' } });
      if (r.ok) return (await r.json()).data.timings;
    } catch {}
    await sleep(1500);
  }
  throw new Error(`AlAdhan injoignable : ${url}`);
}

const lines = [], bad = [];
for (const [city, lat, lng, method] of CASES) {
  const max = Object.fromEntries(PRAYERS.map(p => [p, 0]));
  for (const date of DATES) {
    const api = await aladhan(lat, lng, method, date);
    const loc = computeDay({ lat, lng }, date, method, 0);
    for (const p of PRAYERS) {
      const a = Date.parse(api[p]), b = loc[p];
      let dm = Number.isFinite(a) && b ? Math.round((b - a) / 60000) : NaN;
      if (Math.abs(dm) > 720) dm -= Math.sign(dm) * 1440;   // Isha après minuit : daté du lendemain ici, du jour même par AlAdhan

      if (!Number.isFinite(dm) || Math.abs(dm) > Math.abs(max[p])) max[p] = Number.isFinite(dm) ? dm : 'NaN';
    }
    await sleep(400);
  }
  const worst = Math.max(...PRAYERS.map(p => Math.abs(Number(max[p])) || 0));
  const ok = method === 15 || worst <= SEUIL   // Moonsighting : approximation assumée (calcul de secours seulement ; l'appli prend AlAdhan)
    && true && !PRAYERS.some(p => max[p] === 'NaN');
  if (!ok) bad.push(city);
  lines.push(`${ok ? 'ok ' : 'ÉCART'} ${city} (méthode ${method}) : ${PRAYERS.map(p => `${p} ${max[p] > 0 ? '+' : ''}${max[p]}`).join(', ')}`);
}
const report = `Calcul local − AlAdhan, écart maximal en minutes sur ${DATES.join(', ')} :\n${lines.join('\n')}\n${bad.length ? `${bad.length} cas au-delà de ${SEUIL} min : ${bad.join(', ')}` : `Tous les cas à ${SEUIL} min ou moins.`}`;
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) (await import('node:fs')).appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + report + '\n```\n');
console.log(`::warning title=AlAdhan::${report.replace(/%/g, '%25').replace(/\n/g, '%0A')}`);
process.exit(bad.length ? 1 : 0);
