// Tests de l'analyse des communiqués (textes réels du ministère et titres de presse).
import { extractStart, parseRss } from './update-habous.mjs';
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
if (ko) { console.error(ko, 'échec(s)'); process.exit(1); }
console.log('Tous les tests réussis');
