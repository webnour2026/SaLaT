// Tests de l'analyse des communiqués (textes réels du ministère et titres de presse).
import { extractStart, extractStartLatin, extractAny, decide, parseRss, parseWpJson, sources } from './update-habous.mjs';
const D = iso => Date.parse(iso + 'T00:00:00Z') / 864e5;
let ko = 0;
const eq = (nom, got, exp) => { if (got !== exp) { ko++; console.error('ÉCHEC', nom, '→', got, 'attendu', exp); } else console.log('ok  ', nom); };
const S = (txt, last, m) => { const r = extractStart(txt, D(last), m); return r === null ? null : new Date(r * 864e5).toISOString().slice(0, 10); };

eq('communiqué ربيع الآخر (date)', S('وعليه، فإن شهر ربيع الأول يكون قد استكمل الثلاثين يوما، ويكون فاتح شهر ربيع الآخر هو يوم الأحد 13 شتنبر 2026 م.', '2026-08-14', 4), '2026-09-13');
eq('titre sans date (jour seul)', S('فاتح شهر ربيع الآخر الأحد بالمغرب', '2026-08-14', 4), '2026-09-13');
eq('communiqué ربيع الأول + Mawlid', S('وعليه، فإن فاتح ربيع الأول هو يوم غد الجمعة 14 غشت 2026 م، وعيد المولد النبوي هو يوم الثلاثاء 12 ربيع الأول 1448 هـ موافق 25 غشت 2026 م.', '2026-07-16', 3), '2026-08-14');
eq('titre avec Mawlid (jours seuls)', S('وزارة الأوقاف: الجمعة فاتح شهر ربيع الأول وعيد المولد النبوي يوم الثلاثاء', '2026-07-16', 3), '2026-08-14');
eq('محرم : date d\'observation ignorée', S('راقبت هلال شهر محرم لعام 1448 هـ مساء يوم الإثنين 29 ذي الحجة 1447 ه موافق 15 يونيو 2026م. فإن شهر ذي الحجة يكون قد استكمل الثلاثين يوما، ويكون فاتح شهر محرم هو يوم الأربعاء 17 يونيو 2026 م', '2026-05-18', 1), '2026-06-17');
eq('رمضان', S('وعليه، فإن فاتح رمضان المعظم، هو يوم غد الخميس 19 فبراير 2026 م.', '2026-01-21', 9), '2026-02-19');
eq('ذي القعدة', S('ويكون فاتح شهر ذي القعدة هو يوم الأحد 19 أبريل 2026 م.', '2026-03-20', 11), '2026-04-19');
eq('mauvais mois → rien', S('فاتح شهر صفر لعام 1447 هجرية هو يوم غد السبت 26 يوليوز 2025', '2026-08-14', 4), null);
eq('jour de semaine faux → rien', S('فاتح شهر ربيع الآخر الاثنين', '2026-08-14', 4), null);
eq('deux dates plausibles différentes → rien (ambigu)', S('فاتح شهر ربيع الآخر هو 13 شتنبر 2026. وفاتح شهر ربيع الآخر هو 12 شتنبر 2026', '2026-08-14', 4), null);

const rss = `<rss><channel><item><title>وزارة الأوقاف تعلن الأحد فاتح شهر ربيع الآخر لعام 1448 هـ</title><description>&lt;a&gt;فاتح شهر ربيع الآخر&lt;/a&gt;</description><pubDate>Fri, 11 Sep 2026 21:15:00 GMT</pubDate></item></channel></rss>`;
const it = parseRss(rss);
eq('RSS : 1 article', String(it.length), '1');
eq('RSS : date de publication', new Date(it[0].pub).toISOString().slice(0, 10), '2026-09-11');
eq('RSS + extraction', S(it[0].text, '2026-08-14', 4), '2026-09-13');

// ---- français / anglais (MAP Express) ----
const L = (txt, last, m) => { const r = extractStartLatin(txt, D(last), m); return r === null ? null : new Date(r * 864e5).toISOString().slice(0, 10); };
eq('FR : date complète', L("Le ministère des Habous et des Affaires islamiques annonce que le 1er jour de Rabii Ath-Thani 1448 est le dimanche 13 septembre 2026.", '2026-08-14', 4), '2026-09-13');
eq('FR : « Rabii II » ne se confond pas avec « Rabii I »', L("Habous : le premier jour de Rabii II est le dimanche 13 septembre 2026", '2026-08-14', 4), '2026-09-13');
eq('FR : Rabii I ≠ Rabii II', L("Habous : le premier jour de Rabii II est le dimanche 13 septembre 2026", '2026-07-16', 3), null);
eq('FR : jour de semaine seul', L("Habous : le 1er Ramadan sera le jeudi", '2026-01-21', 9), '2026-02-19');
eq('FR : sans mention du ministère → rien', L("Le 1er Rabii Ath-Thani est le dimanche 13 septembre 2026", '2026-08-14', 4), null);
eq('EN : date', L("Ministry of Habous: the first day of Rabi al-Thani is 13 September 2026", '2026-08-14', 4), '2026-09-13');
eq('FR : Chaoual (apostrophes/accents)', L("Ministère des Habous — Chaoual : le 1er jour est le vendredi 20 mars 2026", '2026-02-19', 10), '2026-03-20');
eq('extractAny : arabe', (() => { const r = extractAny('وزارة الأوقاف: فاتح شهر ربيع الآخر هو يوم الأحد 13 شتنبر 2026', D('2026-08-14'), 4); return r === null ? null : new Date(r * 864e5).toISOString().slice(0, 10); })(), '2026-09-13');

// ---- décision : sources officielles vs presse ----
const d13 = D('2026-09-13'), d12 = D('2026-09-12');
const dd = c => { const r = decide(c); return r.day === null ? null : new Date(r.day * 864e5).toISOString().slice(0, 10); };
eq('MAP seule suffit', dd([{ day: d13, trust: 'official', host: 'mapexpress.ma' }]), '2026-09-13');
eq('un seul média de presse : refusé', dd([{ day: d13, trust: 'press', host: 'hespress.com' }]), null);
eq('même média deux fois : refusé', dd([{ day: d13, trust: 'press', host: 'hespress.com' }, { day: d13, trust: 'press', host: 'hespress.com' }]), null);
eq('2 médias différents : accepté', dd([{ day: d13, trust: 'press', host: 'hespress.com' }, { day: d13, trust: 'press', host: 'alyaoum24.com' }]), '2026-09-13');
eq('faux communiqué isolé contre MAP : MAP gagne', dd([{ day: d13, trust: 'official', host: 'mapexpress.ma' }, { day: d12, trust: 'press', host: 'faux.example' }]), '2026-09-13');
eq('2 médias contre 1 : accepté', dd([{ day: d13, trust: 'press', host: 'a.ma' }, { day: d13, trust: 'press', host: 'b.ma' }, { day: d12, trust: 'press', host: 'c.ma' }]), '2026-09-13');
eq('presse en désaccord (2 contre 2) : rien', dd([{ day: d13, trust: 'press', host: 'a.ma' }, { day: d13, trust: 'press', host: 'b.ma' }, { day: d12, trust: 'press', host: 'c.ma' }, { day: d12, trust: 'press', host: 'd.ma' }]), null);
eq('officiels en désaccord : rien', dd([{ day: d13, trust: 'official', host: 'mapexpress.ma' }, { day: d12, trust: 'official', host: 'snrtnews.com' }]), null);
eq('MAP + SNRT d\'accord', dd([{ day: d13, trust: 'official', host: 'mapexpress.ma' }, { day: d13, trust: 'official', host: 'snrtnews.com' }]), '2026-09-13');

// ---- API WordPress de MAP Express ----
const wp = parseWpJson([{ title: { rendered: 'الأوقاف: الأحد فاتح ربيع الآخر' }, excerpt: { rendered: '<p>فاتح شهر ربيع الآخر هو يوم الأحد 13 شتنبر 2026 م</p>' }, date_gmt: '2026-09-11T20:15:00', link: 'https://www.mapexpress.ma/ar/actualite/x/' }]);
eq('WP : 1 article', String(wp.length), '1');
eq('WP : hôte', wp[0].host, 'mapexpress.ma');
eq('WP : extraction', S(wp[0].text, '2026-08-14', 4), '2026-09-13');

// ---- liste des sources : MAP et SNRT d'abord, presse ensuite ----
const src = sources(4, 1448);
eq('sources : MAP est officielle', String(src.filter(x => x.url.includes('mapexpress.ma') && x.trust === 'official').length >= 4), 'true');
eq('sources : SNRT est officielle', String(src.some(x => x.url.includes('snrtnews.com') && x.trust === 'official')), 'true');
eq('sources : la presse est marquée « press »', String(src.filter(x => x.trust === 'press').length >= 2), 'true');
if (ko) { console.error(ko, 'échec(s)'); process.exit(1); }
console.log('Tous les tests réussis');
