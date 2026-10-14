// Bilan de conformité : compare notre calcul à TOUS les jours officiels conservés dans data/officiel/*.json (année glissante)
// et écrit data/conformite.json (+ résumé du travail GitHub). Objectif : quand le calcul colle durablement aux tableaux du
// ministère sur une année complète, l'appli peut s'en passer.
// Usage : node scripts/rapport-conformite.mjs [--src habous]
import fs from 'node:fs';
import { computeDay } from '../js/prayer-calc.js';
import { localityByCode } from '../js/localites.js';
import { KEYS } from './officiel-lib.mjs';

const onlySrc = process.argv.includes('--src') ? process.argv[process.argv.indexOf('--src') + 1] : null;
const utc = key => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const acc = () => ({ n: 0, ident: 0, un: 0, plus: 0 });
const add = (a, d) => { a.n++; if (d === 0) a.ident++; else if (Math.abs(d) === 1) a.un++; else a.plus++; };
const pct = a => (a.n ? Math.round(1000 * a.ident / a.n) / 10 : 0);
const out = a => ({ n: a.n, identiques: pct(a), a1min: a.n ? Math.round(1000 * a.un / a.n) / 10 : 0, plus: a.plus });

const all = acc(), byKey = Object.fromEntries(KEYS.map(k => [k, acc()])), byMonth = {}, byLoc = {}, bySrc = {};
for (const f of fs.readdirSync('data/officiel').filter(f => f.endsWith('.json'))) {
  const j = JSON.parse(fs.readFileSync(`data/officiel/${f}`, 'utf8'));
  if (onlySrc && j.src !== onlySrc) continue;
  const loc = localityByCode(j.code); if (!loc) continue;
  for (const [date, line] of Object.entries(j.j)) {
    const model = computeDay({ lat: loc.lat, lng: loc.lng, code: j.code }, date, 21, 0), base = utc(date);
    line.split(' ').forEach((hm, i) => {
      const off = +hm.slice(0, 2) * 60 + +hm.slice(2), m = Math.round((model[KEYS[i]] - base) / 60000), d = off - m;
      for (const a of [all, byKey[KEYS[i]], byMonth[date.slice(0, 7)] ??= acc(), byLoc[j.code] ??= acc(), bySrc[j.src || '?'] ??= acc()]) add(a, d);
    });
  }
}
const pires = Object.entries(byLoc).sort(([, a], [, b]) => pct(a) - pct(b)).slice(0, 10).map(([c, a]) => ({ code: +c, nom: localityByCode(+c).fr, ...out(a) }));
const rapport = {
  jusquau: Object.keys(byMonth).sort().at(-1), source: onlySrc || 'toutes',
  global: out(all),
  parPriere: Object.fromEntries(KEYS.map(k => [k, out(byKey[k])])),
  parMois: Object.fromEntries(Object.entries(byMonth).sort().map(([m, a]) => [m, out(a)])),
  parSource: Object.fromEntries(Object.entries(bySrc).map(([s, a]) => [s, out(a)])),
  moinsConformes: pires,
};
if (!onlySrc) fs.writeFileSync('data/conformite.json', JSON.stringify(rapport, null, 1) + '\n');
const md = [`## Conformité du calcul aux tableaux officiels (${rapport.source})`,
  `Global : **${rapport.global.identiques} %** identiques à la minute, ${rapport.global.a1min} % à 1 min, ${rapport.global.plus} écart(s) > 1 min sur ${rapport.global.n} horaires`, '',
  '| Prière | Identiques | à 1 min | > 1 min |', '|---|---|---|---|', ...KEYS.map(k => `| ${k} | ${rapport.parPriere[k].identiques} % | ${rapport.parPriere[k].a1min} % | ${rapport.parPriere[k].plus} |`), '',
  '| Mois | Identiques | Horaires |', '|---|---|---|', ...Object.entries(rapport.parMois).map(([m, a]) => `| ${m} | ${a.identiques} % | ${a.n} |`)].join('\n');
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Conformité::${rapport.global.identiques} % identiques · ${KEYS.map(k => `${k} ${rapport.parPriere[k].identiques} %`).join(' · ')}`);
