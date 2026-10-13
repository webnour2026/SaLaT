// Asr du calcul (Maroc) contre 820 Asr relevés sur 23 tableaux officiels du ministère et des délégations
// (Chawwal 1446 → Joumada I 1448 : Rabat, Casablanca, Oujda, Agadir, Guelmim, Tanger, Tétouan, Chefchaouen, Fès, Meknès, Marrakech, Taza…).
// Fixture : { code, ds (jour civil), v (minutes UTC de l'Asr officiel) }.
import fs from 'node:fs';
import { computeDay } from '../js/prayer-calc.js';
const pts = JSON.parse(fs.readFileSync(new URL('./fixtures/asr-ministere.json', import.meta.url)));
let ok = 0, max = 0;
for (const p of pts) {
  const c = computeDay({ lat: 0, lng: 0, code: p.code }, p.ds, 21, 0);
  const d = new Date(c.Asr), df = Math.abs(d.getUTCHours() * 60 + d.getUTCMinutes() - p.v);
  if (!df) ok++; max = Math.max(max, df);
}
const pct = 100 * ok / pts.length;
if (pct >= 95 && max <= 1) console.log(`Tous les tests réussis (${ok}/${pts.length} Asr identiques, ${pct.toFixed(1)} %, écart max ${max} min)`);
else { console.error(`ÉCHEC Asr ministère : ${ok}/${pts.length} (${pct.toFixed(1)} %), écart max ${max} min — attendu ≥ 95 %, ≤ 1 min`); process.exit(1); }
