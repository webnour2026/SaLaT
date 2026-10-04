// Cohérence des textes des cartes : « versets » = Coran seulement ; tout ce qui est rapporté du Prophète ﷺ est dans « hadith »,
// avec sa source ; pas de texte en double d'une catégorie à l'autre.
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const i = src.indexOf('const CARD_TEXTS = {');
let depth = 0, j = i + 'const CARD_TEXTS = '.length;
for (let k = j; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}' && --depth === 0) { j = k + 1; break; } }
const consts = ['JUMUAH_REF', 'JUMUAH_VERSE', 'MORNING_LEAD'].map(c => src.match(new RegExp(`const ${c} = ([^;]+);`))[0]).join('\n');
const T = new Function(`${consts}\n${src.slice(i, j)}\nreturn CARD_TEXTS;`)();

let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'ÉCHEC'} ${name}${ok ? '' : `\n     obtenu  : ${JSON.stringify(got)}\n     attendu : ${JSON.stringify(want)}`}`); };
const plain = s => s.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '').replace(/[ٱأإآ]/g, 'ا').replace(/\s+/g, ' ').trim();
const SOURCE = /^(رواه|متفق عليه|سيد الاستغفار)/;       // « رواه مسلم (…) », « متفق عليه (…) »
const VERSE_REF = /^\[[^\]:]+:\s*\d+(-\d+)?\]$/;          // « [البقرة: 238] »

eq('versets : 211 textes, tous coraniques (q)', [T.morning.length, T.morning.every(x => x.q)], [211, true]);
eq('versets : chaque référence est « [السورة: رقم] »', T.morning.filter(x => !VERSE_REF.test(x.r.trim())).map(x => x.r), []);
eq('versets : aucun hadith (aucune référence « رواه / متفق عليه »)', T.morning.filter(x => SOURCE.test(x.r) || /رواه|متفق/.test(x.r)).length, 0);
eq('hadiths : 28 textes (25 + 3 adhkar déplacés), aucun coranique', [T.hadith.length, T.hadith.some(x => x.q)], [28, false]);
eq('hadiths : chaque texte cite sa source (« رواه… » ou « متفق عليه… »)', T.hadith.filter(x => !SOURCE.test(x.r.trim())).map(x => x.r), []);
eq('hadiths : les adhkar déplacés sont présents (Muslim 2723, Tirmidhi 3391, Muslim 2692)', ['رواه مسلم (2723)', 'رواه الترمذي (3391)', 'رواه مسلم (2692)'].map(r => T.hadith.some(x => x.r === r)), [true, true, true]);
eq('hadiths : « كان رسول الله ﷺ إذا أصبح قال » seulement pour les deux récits de pratique, pas pour « من قال… »', T.hadith.map((x, k) => x.lead ? x.r : null).filter(Boolean), ['رواه مسلم (2723)', 'رواه الترمذي (3391)']);
const all = [...T.morning, ...T.hadith, ...T.dua].map(x => plain(x.t));
eq('aucun texte en double entre versets, douas et hadiths', all.filter((x, k) => all.indexOf(x) !== k).length, 0);
eq('douas : pas de verset sans q ni hadith sans source', T.dua.filter(x => !x.q && !SOURCE.test(x.r.trim())).map(x => x.r), []);
console.log(fails ? `\n${fails} échec(s)` : '\nTous les tests réussis');
process.exit(fails ? 1 : 0);
