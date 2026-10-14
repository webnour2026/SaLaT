// Compare notre calcul aux tableaux des délégations transcrits dans scripts/fixtures/tableaux-saisons.txt.
// Fuseau du tableau détecté (GMT ou GMT+1) ; affiche, par tableau et par prière, % identiques et écarts.
import fs from 'node:fs';
import { computeDay } from '../js/prayer-calc.js';
import { localityByCode } from '../js/localites.js';
const K = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
const tables = [];
for (const line of fs.readFileSync(process.env.TABLEAUX || new URL('./fixtures/tableaux-saisons.txt', import.meta.url), 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue;
  if (line.startsWith('@')) { const [, code, debut, ...nom] = line.split(' '); tables.push({ code: +code, debut, nom: nom.join(' '), rows: [] }); continue; }
  tables.at(-1).rows.push(line.trim().split(/\s+/).map((t, i) => { let [h, m] = t.split(':').map(Number); if (i >= 2 && h < 12) h += 12; return h * 60 + m; }));
}
export function compare(t) {
  const loc = localityByCode(t.code), start = Date.parse(t.debut + 'T00:00:00Z');
  const diffs = t.rows.map((r, i) => { const ms = start + i * 864e5, d = new Date(ms).toISOString().slice(0, 10), mo = computeDay({ lat: loc.lat, lng: loc.lng, code: t.code }, d, 21, 0); return r.map((v, k) => v - Math.round((mo[K[k]] - ms) / 60000)); });
  // fuseau détecté ligne par ligne (un tableau peut chevaucher le passage GMT ↔ GMT+1, ex. fin de Ramadan)
  const offs = diffs.map(r => Math.round([...r].sort((a, b) => a - b)[3] / 60) * 60);
  return { loc, off: offs[0], offs, d: diffs.map((r, i) => r.map(x => x - offs[i])) };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  let n = 0, ok = 0; const per = Object.fromEntries(K.map(k => [k, [0, 0]]));
  for (const t of tables) {
    const { loc, off, d } = compare(t);
    const s = K.map((k, i) => { const col = d.map(r => r[i]); const id = col.filter(x => !x).length; per[k][0] += id; per[k][1] += col.length; const bad = col.filter(x => x); return `${k.slice(0, 4)} ${Math.round(100 * id / col.length)}%${bad.length ? `(${[...new Set(bad)].sort().join('/')})` : ''}`; });
    d.flat().forEach(x => { n++; if (!x) ok++; });
    console.log(`${t.nom.padEnd(34)} alt ${String(loc.alt).padStart(4)} GMT+${off / 60} | ${s.join(' ')}`);
  }
  console.log(`\nGlobal ${(100 * ok / n).toFixed(1)} % (${n} horaires) · ` + K.map(k => `${k} ${(100 * per[k][0] / per[k][1]).toFixed(1)} %`).join(' · '));
}
