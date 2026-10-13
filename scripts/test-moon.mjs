// Prévision de visibilité du croissant (js/moon.js) : conjonction du manuel du ministère, et accord avec les derniers mois annoncés au Maroc.
import fs from 'node:fs';
import { conjunctionBefore, crescent, crescentMorocco } from '../js/moon.js';
let ko = 0;
const eq = (n, g, e) => { if (g !== e) { ko++; console.error('ÉCHEC', n, '\n   obtenu :', g, '\n   attendu:', e); } else console.log('ok  ', n); };
const iso = t => new Date(t).toISOString().slice(0, 16);

// manuel de « التوقيت » (3e année, leçon 22) : conjonction du 1er avril 2022 à 06 h 25 GMT ; ce soir-là, croissant de Ramadan 1443 invisible
eq('conjonction du 1er avril 2022 (manuel : 06:25 GMT)', iso(conjunctionBefore(Date.parse('2022-04-01T20:00Z'))), '2022-04-01T06:25');
eq('Rabat, 1er avril 2022 : visibilité impossible (manuel : « فالرؤية ممتنعة »)', crescent('2022-04-01', 34.0167, -6.85).grade, 'impossible');
eq('conjonction du 10 octobre 2026', iso(conjunctionBefore(Date.parse('2026-10-11T20:00Z'))).slice(0, 13), '2026-10-10T15');

// mois annoncés par le ministère (data/habous.json) : « impossible » → 30 jours, « possible / bonne » → 29 jours ; « difficile » = incertain
const D = 864e5, day = s => Date.parse(s + 'T00:00:00Z') / D, key = d => new Date(d * D).toISOString().slice(0, 10);
const ms = JSON.parse(fs.readFileSync(new URL('../data/habous.json', import.meta.url))).months.filter(m => m.start <= '2026-10-13');
let firm = 0, right = 0;
for (let i = 1; i < ms.length; i++) {
  const P = day(ms[i - 1].start), len = day(ms[i].start) - P, g = crescentMorocco(key(P + 28)).grade;
  if (g === 'difficult') continue;
  firm++; if ((g === 'impossible') === (len === 30)) right++;
}
eq(`prévisions franches (impossible / possible / bonne) : toutes conformes au ministère (${right}/${firm})`, right === firm && firm >= 5, true);

console.log(ko ? `\n${ko} échec(s)` : '\nTous les tests réussis');
process.exit(ko ? 1 : 0);
