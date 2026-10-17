// Textes des notifications de l'annonce du croissant (ar / fr / en). Module pur : testé par scripts/test-push.mjs.
// Le ministère des Habous annonce le soir du 29 le début du mois suivant : le lendemain (croissant vu, mois de 29 jours)
// ou le surlendemain (non vu, 30 jours). data/habous.json donne ce début ; on en déduit vu / non vu par le mois précédent.

const H = {
  ar: ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'],
  fr: ['Mouharram', 'Safar', 'Rabia al-Awal', 'Rabia ath-Thani', 'Joumada al-Oula', 'Joumada ath-Thania', 'Rajab', 'Chaabane', 'Ramadan', 'Chawwal', 'Dhou al-Qi’da', 'Dhou al-Hijja'],
  en: ['Muharram', 'Safar', 'Rabi al-Awwal', 'Rabi al-Thani', 'Jumada al-Ula', 'Jumada al-Akhirah', 'Rajab', 'Shaban', 'Ramadan', 'Shawwal', 'Dhu al-Qadah', 'Dhu al-Hijjah'],
};
const G = {
  ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'ماي', 'يونيو', 'يوليوز', 'غشت', 'شتنبر', 'أكتوبر', 'نونبر', 'دجنبر'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const W = {
  ar: ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
  fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};
const REL = { ar: ['اليوم', 'غدًا', 'بعد غد'], fr: ['aujourd’hui', 'demain', 'après-demain'], en: ['today', 'tomorrow', 'the day after tomorrow'] };
export const LANGS = ['ar', 'fr', 'en'];

const utc = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const day = ms => new Date(ms);
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
const dateTxt = (lang, ms) => { const d = day(ms); return `${W[lang][d.getUTCDay()]} ${d.getUTCDate()} ${G[lang][d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

/** Dernier début de mois annoncé, et vu / non vu (null si le mois précédent est inconnu). */
export function lastAnnouncement(table) {
  const months = [...(table?.months || [])].filter(x => x && x.start).sort((a, b) => a.y - b.y || a.m - b.m);
  const last = months.at(-1); if (!last) return null;
  const pm = last.m === 1 ? { y: last.y - 1, m: 12 } : { y: last.y, m: last.m - 1 };
  const prev = months.find(x => x.y === pm.y && x.m === pm.m);
  const len = prev ? daysBetween(prev.start, last.start) : null;
  return { ...last, seen: len === 29 ? true : len === 30 ? false : null };
}

/** Notification dans une langue. rel = jours entre aujourd'hui et le 1er du mois (0, 1 ou 2). */
export function announcementText(a, lang, rel) {
  const m = H[lang][a.m - 1], p = H[lang][(a.m + 10) % 12], start = utc(a.start), d = dateTxt(lang, start), r = REL[lang][rel] ?? '';
  const eidAdha = dateTxt(lang, start + 9 * 864e5);
  let title, body;
  if (lang === 'ar') {
    title = a.seen === false ? `🌙 لم يثبت هلال شهر ${m}` : a.seen ? `🌙 ثبت هلال شهر ${m}` : `🌙 فاتح شهر ${m} ${a.y}`;
    body = (a.seen === false ? `يستوفي شهر ${p} ثلاثين يومًا. ` : '') + `فاتح شهر ${m} ${a.y}هـ ${r}، ${d}، حسب بلاغ وزارة الأوقاف والشؤون الإسلامية.`;
    if (a.m === 9) body += ' رمضان مبارك.';
    if (a.m === 10) body += ' عيد فطر مبارك سعيد.';
    if (a.m === 12) body += ` وعيد الأضحى يوم ${eidAdha}.`;
  } else if (lang === 'fr') {
    title = a.seen === false ? `🌙 Croissant de ${m} non observé` : a.seen ? `🌙 Croissant de ${m} observé` : `🌙 1er ${m} ${a.y}`;
    body = (a.seen === false ? `${p} compte 30 jours. ` : '') + `Le 1er ${m} ${a.y} est ${r}, ${d}, selon le communiqué du ministère des Habous.`;
    if (a.m === 9) body += ' Ramadan moubarak.';
    if (a.m === 10) body += ' Aïd moubarak.';
    if (a.m === 12) body += ` L’Aïd al-Adha sera le ${eidAdha}.`;
  } else {
    title = a.seen === false ? `🌙 ${m} crescent not sighted` : a.seen ? `🌙 ${m} crescent sighted` : `🌙 1st of ${m} ${a.y}`;
    body = (a.seen === false ? `${p} completes 30 days. ` : '') + `The 1st of ${m} ${a.y} AH is ${r}, ${d}, according to the Ministry of Habous.`;
    if (a.m === 9) body += ' Ramadan Mubarak.';
    if (a.m === 10) body += ' Eid Mubarak.';
    if (a.m === 12) body += ` Eid al-Adha will be on ${eidAdha}.`;
  }
  return { title, body, tag: `hilal-${a.y}-${a.m}`, url: './#calendar', lang };
}

export const testText = lang => ({
  ar: { title: '🌙 صلاتي: الإشعارات تعمل', body: 'ستصلك هنا نتيجة مراقبة الهلال فور صدور بلاغ وزارة الأوقاف.' },
  fr: { title: '🌙 SaLaTi : notifications actives', body: 'Le résultat de l’observation du croissant arrivera ici dès le communiqué du ministère.' },
  en: { title: '🌙 SaLaTi: notifications are on', body: 'The crescent sighting result will arrive here as soon as the Ministry announces it.' },
})[lang] || null;

/** Faut-il envoyer maintenant ? now = Date ; renvoie rel (0..2) ou null. */
export function relDay(a, now) {
  const today = now.toISOString().slice(0, 10), rel = daysBetween(today, a.start);
  if (rel < 0 || rel > 2) return null;
  if (rel === 0 && now.getUTCHours() >= 12) return null;      // le jour même : seulement le matin (rattrapage)
  return rel;
}
