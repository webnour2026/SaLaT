// Calibrage : pour chaque prière, cherche le décalage (en secondes) de MA_MODEL.off qui maximise le nombre d'horaires
// identiques à la minute sur tous les jours officiels du ministère conservés (data/officiel, src 'habous', année glissante).
// N'écrit QUE data/calibration.json (proposition) : le modèle (js/prayer-calc.js + PrayerCalc.java) est modifié à la main,
// après vérification, pour ne jamais changer les horaires de l'appli sans contrôle.
import fs from 'node:fs';
import { computeDay, MA_MODEL } from '../js/prayer-calc.js';
import { localityByCode } from '../js/localites.js';
import { KEYS } from './officiel-lib.mjs';

const utc = key => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const STEPS = []; for (let s = -60; s <= 60; s += 5) STEPS.push(s);
const hits = Object.fromEntries(KEYS.map(k => [k, STEPS.map(() => 0)]));
let n = 0, days = 0;
const OFF0 = { ...MA_MODEL.off };
for (const f of fs.readdirSync('data/officiel').filter(f => f.endsWith('.json'))) {
  const j = JSON.parse(fs.readFileSync(`data/officiel/${f}`, 'utf8'));
  if (j.src !== 'habous') continue;
  const loc = localityByCode(j.code); if (!loc) continue;
  for (const [date, line] of Object.entries(j.j)) {
    const base = utc(date), off = line.split(' ').map(hm => +hm.slice(0, 2) * 60 + +hm.slice(2));
    STEPS.forEach((s, si) => {          // le calcul arrondit à la minute : on décale tous les offsets de s secondes et on recalcule
      for (const k of KEYS) MA_MODEL.off[k] = OFF0[k] + s;
      const model = computeDay({ lat: loc.lat, lng: loc.lng, code: j.code }, date, 21, 0);
      KEYS.forEach((k, i) => { if ((model[k] - base) / 60000 === off[i]) hits[k][si]++; });
    });
    n++; days++;
  }
}
Object.assign(MA_MODEL.off, OFF0);
const res = {};
for (const k of KEYS) {
  const z = STEPS.indexOf(0), mx = Math.max(...hits[k]), best = STEPS.map((x, i) => i).filter(i => hits[k][i] === mx).sort((a, b) => Math.abs(STEPS[a]) - Math.abs(STEPS[b]))[0];
  res[k] = { actuel_s: OFF0[k], identiques: Math.round(1000 * hits[k][z] / n) / 10,
    proposition_s: OFF0[k] + STEPS[best], identiques_proposition: Math.round(1000 * hits[k][best] / n) / 10 };
}
const out = { jours: days, mois: [...new Set(fs.readdirSync('data/officiel').flatMap(f => Object.keys(JSON.parse(fs.readFileSync(`data/officiel/${f}`, 'utf8')).j).map(d => d.slice(0, 7))))].sort(), prieres: res };
fs.writeFileSync('data/calibration.json', JSON.stringify(out, null, 1) + '\n');
const gains = KEYS.filter(k => res[k].identiques_proposition - res[k].identiques >= 0.5);
const md = ['## Calibrage proposé (secondes ajoutées au calcul)', '', '| Prière | Actuel | Identiques | Proposé | Identiques |', '|---|---|---|---|---|',
  ...KEYS.map(k => `| ${k} | ${res[k].actuel_s} s | ${res[k].identiques} % | ${res[k].proposition_s} s | ${res[k].identiques_proposition} % |`)].join('\n');
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Calibrage::${gains.length ? 'À revoir : ' + gains.map(k => `${k} ${res[k].actuel_s}→${res[k].proposition_s} s (${res[k].identiques}→${res[k].identiques_proposition} %)`).join(' · ') : 'modèle déjà au mieux (gain < 0,5 point)'}`);
