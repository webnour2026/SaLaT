// Date hégirienne fiable sur tous les téléphones.
// Certains navigateurs Android n'ont pas les noms des mois hégiriens en français/anglais
// (ils affichent « 14 avril 1448 av. J.-C. »). On ne prend donc que les NOMBRES à Intl,
// et on met nos propres noms de mois. Sans calendrier Umm al-Qura : calcul arithmétique.
const MONTHS = {
  fr: ['Mouharram', 'Safar', 'Rabia al-Awal', 'Rabia ath-Thani', 'Joumada al-Oula', 'Joumada ath-Thania', 'Rajab', 'Chaabane', 'Ramadan', 'Chawwal', 'Dhou al-Qi’da', 'Dhou al-Hijja'],
  ar: ['محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'],
  en: ['Muharram', 'Safar', 'Rabi al-Awwal', 'Rabi al-Thani', 'Jumada al-Ula', 'Jumada al-Akhirah', 'Rajab', 'Shaban', 'Ramadan', 'Shawwal', 'Dhu al-Qadah', 'Dhu al-Hijjah'],
};
const ERA = { fr: 'H', ar: 'هـ', en: 'AH' };

function viaIntl(ts, timeZone) {
  const f = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone });
  if (!/^islamic/.test(f.resolvedOptions().calendar)) return null;
  const p = Object.fromEntries(f.formatToParts(ts).map(x => [x.type, x.value]));
  const d = parseInt(p.day, 10), m = parseInt(p.month, 10), y = parseInt(p.year || p.relatedYear, 10);
  if (!(d >= 1 && d <= 30 && m >= 1 && m <= 12 && y > 1300 && y < 1600)) return null;
  return { d, m, y };
}

// Calendrier hégirien tabulaire (algorithme dit « koweïtien »), à partir de la date civile
function tabular(ts, timeZone) {
  const [Y, M, D] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(ts).split('-').map(Number);
  const a = Math.floor((14 - M) / 12), yy = Y + 4800 - a, mm = M + 12 * a - 3;
  const jd = D + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
  let l = jd - 1948440 + 10632;
  const n = Math.floor((l - 1) / 10631);
  l = l - 10631 * n + 354;
  const j = Math.floor((10985 - l) / 5316) * Math.floor((50 * l) / 17719) + Math.floor(l / 5670) * Math.floor((43 * l) / 15238);
  l = l - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) - Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29;
  const m = Math.floor((24 * l) / 709);
  return { d: l - Math.floor((709 * m) / 24), m, y: 30 * n + j - 30 };
}

// Calcul « astronomique » (Umm al-Qura, ou tabulaire si le téléphone ne l'a pas)
function calcParts(ts, timeZone) {
  try { const r = viaIntl(ts, timeZone); if (r) return r; } catch {}
  return tabular(ts, timeZone);
}

// ---- Calendrier officiel du Maroc (Ministère des Habous et des Affaires islamiques) ----
// Le ministère annonce chaque mois, le soir du 29, le début du mois suivant (observation du croissant).
// On garde la liste des 1ers jours annoncés ; après le dernier annoncé, on prolonge le calcul en
// l'alignant sur ce dernier début de mois (l'annonce suivante corrigera d'un jour si besoin).
const DAYMS = 864e5;
let HB = null;          // { starts: [{ y, m, day }], updated }
let HB_ON = false;

const civilDay = (ts, timeZone) => {
  const [Y, M, D] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(ts).split('-').map(Number);
  return Date.UTC(Y, M - 1, D) / DAYMS;
};
const calcAt = day => calcParts(day * DAYMS + 12 * 36e5, 'UTC');

/** table = { updated, months: [{ y, m, start: 'AAAA-MM-JJ' }] } */
export function setHabous(table) {
  const list = (table && table.months || [])
    .filter(x => x && x.start && /^\d{4}-\d{2}-\d{2}$/.test(x.start) && x.m >= 1 && x.m <= 12)
    .map(x => ({ y: x.y, m: x.m, day: Date.parse(x.start + 'T00:00:00Z') / DAYMS }))
    .sort((a, b) => a.day - b.day);
  HB = list.length ? { starts: list, updated: table.updated || '' } : null;
}
export const useHabous = on => { HB_ON = !!on; };
export const habousActive = () => HB_ON && !!HB;
export const habousInfo = () => HB && { updated: HB.updated, last: HB.starts.at(-1), count: HB.starts.length };

function alignedCalc(day, s) {
  if (s.a === undefined) {
    s.a = 0;
    for (const c of [0, -1, 1, -2, 2]) {
      const p = calcAt(s.day + c);
      if (p.d === 1 && p.m === s.m && p.y === s.y) { s.a = c; break; }
    }
  }
  return calcAt(day + s.a);
}

function viaHabous(day) {
  const S = HB.starts; let i = -1;
  for (let k = 0; k < S.length; k++) { if (S[k].day <= day) i = k; else break; }
  if (i < 0) return alignedCalc(day, S[0]);                                  // avant la table
  const s = S[i], next = S[i + 1];
  if (next) return { d: day - s.day + 1, m: s.m, y: s.y };                   // mois annoncé en entier
  return alignedCalc(day, s);                                                // après le dernier annoncé
}

/** Ce jour civil (midi UTC) est-il un début de mois officiellement annoncé par le ministère ? */
export const isConfirmedStart = noonTs => !!HB && HB.starts.some(s => s.day === Math.floor(noonTs / DAYMS));

export function hijriParts(ts, timeZone) {
  if (HB_ON && HB) { try { return viaHabous(civilDay(ts, timeZone)); } catch {} }
  return calcParts(ts, timeZone);
}

export function formatHijri(ts, timeZone, lang) {
  const { d, m, y } = hijriParts(ts, timeZone);
  const L = MONTHS[lang] ? lang : 'fr';
  return `${d} ${MONTHS[L][m - 1]} ${y} ${ERA[L]}`;
}
