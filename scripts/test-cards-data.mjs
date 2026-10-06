// Cohérence des textes des cartes :
//  · « versets » = Coran seulement, en riwaya de WARSH 'an Nafi' ; chaque texte coranique de l'appli (versets, doua, Joumou'a, Ramadan, Nuit du Destin)
//    est comparé au texte Warsh du Complexe du Roi Fahd : le squelette des lettres doit se retrouver DANS les versets indiqués par la référence ;
//  · tout ce qui est rapporté du Prophète ﷺ est dans « hadith », avec sa source ; pas de texte en double d'une catégorie à l'autre.
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const W = JSON.parse(fs.readFileSync(new URL('./data/warsh-skeleton.json', import.meta.url), 'utf8'));
const i = src.indexOf('const CARD_TEXTS = {');
let depth = 0, j = i + 'const CARD_TEXTS = '.length;
for (let k = j; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}' && --depth === 0) { j = k + 1; break; } }
const consts = ['JUMUAH_REF', 'JUMUAH_VERSE', 'MORNING_LEAD'].map(c => src.match(new RegExp(`const ${c} = ([^;]+);`))[0]).join('\n');
const T = new Function(`${consts}\n${src.slice(i, j)}\nreturn CARD_TEXTS;`)();

let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'ÉCHEC'} ${name}${ok ? '' : `\n     obtenu  : ${JSON.stringify(got)}\n     attendu : ${JSON.stringify(want)}`}`); };
const plain = s => s.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '').replace(/[ٱأإآ]/g, 'ا').replace(/\s+/g, ' ').trim();
// même squelette que scripts/data/warsh-skeleton.json
const sk = s => s.normalize('NFKD').replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640\u08D3-\u08FF\uFDFA\u200C\u200D\u00A0]/g, '').replace(/[٠-٩0-9۰-۹\uFC00-\uFDFF\uFE70-\uFEFF]/g, '')
  .replace(/ٱ|أ|إ|آ/g, 'ا').replace(/ى|ئ/g, 'ي').replace(/ؤ/g, 'و').replace(/ة/g, 'ه').replace(/ء/g, '').replace(/[\u06D2\u06CC]/g, 'ي').replace(/ا/g, '').replace(/[^\u0621-\u064A]/g, '');
const SOURCE = /^(رواه|متفق عليه|سيد الاستغفار)/;       // « رواه مسلم (…) », « متفق عليه (…) »
const REF = /^\[([^\]:]+):\s*(\d+)(?:-(\d+))?\]$/;      // « [البقرة: 236] » ou « [طه: 24-25] »
const num = Object.fromEntries(Object.entries(W.names).map(([n, name]) => [name, Number(n)]));
const warshProblem = x => {
  const m = REF.exec(x.r.trim()); if (!m) return `référence illisible : ${x.r}`;
  const s = num[m[1]]; if (!s) return `sourate inconnue : ${m[1]}`;
  const a = Number(m[2]), b = Number(m[3] || m[2]); let acc = '';
  for (let k = a; k <= b; k++) { const v = W.verses[`${s}:${k}`]; if (v === undefined) return `verset inexistant en Warsh : ${s}:${k}`; acc += v; }
  const mine = sk(x.t);
  return mine && acc.includes(mine) ? null : `texte absent des versets ${s}:${a}${b !== a ? `-${b}` : ''} (Warsh)`;
};

const quran = [...T.morning, ...T.dua.filter(x => x.q), ...['jumuah', 'occRamadan', 'occQadr'].flatMap(k => T[k].filter(x => x.q))];
eq('versets : tous coraniques (q)', T.morning.every(x => x.q), true);
eq('versets : au moins 300 textes', T.morning.length >= 300, true);
eq('versets : chaque référence est « [السورة: رقم] » ou « [السورة: رقم-رقم] »', T.morning.filter(x => !REF.test(x.r.trim())).map(x => x.r), []);
eq('versets : aucun hadith (aucune référence « رواه / متفق عليه »)', T.morning.filter(x => /رواه|متفق/.test(x.r)).length, 0);
const bad = quran.map(x => [warshProblem(x), x.r]).filter(([p]) => p);
eq(`WARSH : les ${quran.length} textes coraniques (versets, doua, Joumou'a, Ramadan, Qadr) se retrouvent dans les versets Warsh de leur référence`, bad, []);
eq('WARSH : aucun verset de l\'appli n\'a un numéro absent du décompte médinois (6214 versets)', Object.keys(W.verses).length, 6214);
eq('hadiths : 28 textes (25 + 3 adhkar déplacés), aucun coranique', [T.hadith.length, T.hadith.some(x => x.q)], [28, false]);
eq('hadiths : chaque texte cite sa source (« رواه… » ou « متفق عليه… »)', T.hadith.filter(x => !SOURCE.test(x.r.trim())).map(x => x.r), []);
eq('hadiths : les adhkar déplacés sont présents (Muslim 2723, Tirmidhi 3391, Muslim 2692)', ['رواه مسلم (2723)', 'رواه الترمذي (3391)', 'رواه مسلم (2692)'].map(r => T.hadith.some(x => x.r === r)), [true, true, true]);
eq('hadiths : « كان رسول الله ﷺ إذا أصبح قال » seulement pour les deux récits de pratique, pas pour « من قال… »', T.hadith.map((x, k) => x.lead ? x.r : null).filter(Boolean), ['رواه مسلم (2723)', 'رواه الترمذي (3391)']);
const all = [...T.morning, ...T.hadith, ...T.dua].map(x => plain(x.t));
eq('aucun texte en double (mot pour mot) entre versets, douas et hadiths', all.filter((x, k) => all.indexOf(x) !== k).length, 0);
eq('douas : pas de verset sans q ni hadith sans source', T.dua.filter(x => !x.q && !SOURCE.test(x.r.trim())).map(x => x.r), []);
const i18n = fs.readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
const riw = [...i18n.matchAll(/riwayaWarsh: '((?:[^'\\]|\\.)*)'/g)].map(m => JSON.parse(`"${m[1]}"`));
eq('mention sur les cartes : « ورش عن نافع » + « العدّ المدني الأخير » + « المصحف المغربي » dans les 3 langues', riw.map(s => ['ورش عن نافع', 'العدّ المدني الأخير', 'المصحف المغربي'].every(w => s.includes(w))), [true, true, true]);
const monthDua = [...i18n.matchAll(/monthDua: '((?:[^'\\]|\\.)*)'/g)].map(m => JSON.parse(`"${m[1]}"`));
eq('doua du croissant : le texte de la carte = celui des rappels, dans les 3 langues', monthDua.map(s => plain(s) === plain(T.occMonth[0].t)), [true, true, true]);
eq('doua du croissant : formulation du Tirmidhi 3451 (« باليمن »), sans « هلال رشد وخير »', [/باليمن/.test(plain(T.occMonth[0].t)), /هلال رشد/.test(plain(T.occMonth[0].t)), T.occMonth[0].r], [true, false, 'رواه الترمذي (3451)']);
// introductions des doua : « مما دعا به » (il l'a dite), « مما علّمه » (il l'a enseignée), « قال … في سيد الاستغفار » ; aucune pour le Coran
const DUA_LEADS = ['مما دعا به رسول الله ﷺ', 'مما علّمه رسول الله ﷺ من الدعاء', 'قال رسول الله ﷺ في سيد الاستغفار'];
eq('doua prophétiques : chacune a une introduction parmi les 3 formules admises', T.dua.filter(x => !x.q && !DUA_LEADS.includes(x.lead)).map(x => x.r), []);
eq('doua coraniques : aucune introduction (le verset reste tel quel)', T.dua.filter(x => x.q && x.lead).length, 0);
eq('versets : aucune introduction, pas de basmala en tête', [T.morning.filter(x => x.lead).length, T.morning.filter(x => /^بسم الله الرحمن الرحيم/.test(plain(x.t))).length], [0, 0]);
console.log(fails ? `\n${fails} échec(s)` : '\nTous les tests réussis');
process.exit(fails ? 1 : 0);
