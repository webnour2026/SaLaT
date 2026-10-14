// Tableaux de délégations d'autres saisons (Muharram 1448, Rajab et Ramadan 1447) : le calcul doit rester à 1 min au plus
// de chaque horaire et garder un taux d'horaires identiques élevé (protège le modèle contre un réglage sur un seul mois).
import fs from 'node:fs';
import { compare } from './comparer-tableaux.mjs';
const tables = [];
for (const line of fs.readFileSync(new URL('./fixtures/tableaux-saisons.txt', import.meta.url), 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue;
  if (line.startsWith('@')) { const [, code, debut, ...nom] = line.split(' '); tables.push({ code: +code, debut, nom: nom.join(' '), rows: [] }); continue; }
  tables.at(-1).rows.push(line.trim().split(/\s+/).map((t, i) => { let [h, m] = t.split(':').map(Number); if (i >= 2 && h < 12) h += 12; return h * 60 + m; }));
}
let n = 0, ok = 0, mag = 0, magN = 0, max = 0, fail = 0;
for (const t of tables) { const { d } = compare(t); for (const r of d) r.forEach((x, i) => { n++; if (!x) ok++; if (i === 4) { magN++; if (!x) mag++; } max = Math.max(max, Math.abs(x)); }); }
const chk = (name, cond, got) => { console.log(`${cond ? 'ok  ' : 'ÉCHEC'} ${name} (${got})`); if (!cond) fail++; };
chk(`${tables.length} tableaux, ${n} horaires : écart maximal 1 min`, max <= 1, `${max} min`);
chk('horaires identiques à la minute ≥ 95 %', ok / n >= 0.95, `${(100 * ok / n).toFixed(1)} %`);
chk('Maghrib identiques ≥ 93 %', mag / magN >= 0.93, `${(100 * mag / magN).toFixed(1)} %`);
if (fail) { console.log(`\n${fail} échec(s)`); process.exit(1); } else console.log('\nTous les tests réussis');
