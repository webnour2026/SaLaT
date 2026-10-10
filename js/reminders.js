// Rappels de la veille au soir : jours blancs, début de mois, Aïds.
// Ce module ne touche ni au DOM ni au réseau : les mêmes textes servent à la notification du navigateur
// et à celle du module Android (appli fermée), qui reçoit la liste construite par planNativeReminders().
import { reminderFor, isWhiteDay, hijriOf, monthConfirmed } from './calendar.js';
import { habousActive, habousInfo } from './hijri.js';

const DAY = 864e5;
export const WINDOW_FIXED = 6 * 3600e3;    // rappel « certain » : on peut le recevoir jusqu'à 6 h après l'heure prévue
export const WINDOW_FRIDAY = 3 * 3600e3;   // rappel du vendredi (09:30) : utile jusqu'à la prière de la Joumou'a
export const WINDOW_WATCH = 4 * 3600e3;    // rappel « à surveiller » : le module interroge le calendrier pendant 4 h
export const WINDOW_OBS = 3 * 3600e3;      // « ce soir, observation du croissant » : jusqu'au Maghrib environ
/** Mois dont l'observation du croissant est annoncée à l'avance (et dont le « non vu » est signalé) : Mouharram, Ramadan, Chawwal, Dhou al-Hijja. */
export const WATCHED_MONTHS = [1, 9, 10, 12];
const iso = day => new Date(day * DAY).toISOString().slice(0, 10);
export const FRIDAY_AT = [9, 30];          // rappel du vendredi : 09:30, heure du lieu

/** Instant (ms) d'une heure locale « key hh:mm » dans le fuseau tz (heure d'été comprise). */
export function wallTime(key, h, m, tz) {
  const guess = Date.parse(`${key}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  if (!tz) return guess;
  const off = ts => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(ts).map(x => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ts;
  };
  try {
    let ts = guess - off(guess);
    const o2 = off(ts);
    if (guess - o2 !== ts) ts = guess - o2;
    return ts;
  } catch { return guess; }
}

/** Titre et corps d'un rappel { type: 'white' | 'month' | 'eid', kind?, h } */
export function reminderText(t, ev) {
  if (ev.type === 'friday') return { title: t('fridayNotifTitle'), body: t('fridayNotifBody') };
  const gen = x => String(x).replace(/^ذو /, 'ذي ');                         // « هلال شهر ذي الحجة » (génitif arabe)
  const month = t('hijriMonths')[ev.h.m - 1];
  const prev = gen(t('hijriMonths')[(ev.h.m + 10) % 12]);                   // mois en cours (celui qui se termine)
  // soir du 29 : le ministère observe le croissant ; puis, s'il n'est pas vu, le mois en cours compte 30 jours
  if (ev.type === 'obs') return { title: t('obsNotifTitle', { m: gen(month) }), body: t('obsNotifBody', { m: gen(month) }) };
  if (ev.type === 'nosight') return { title: t('nosightNotifTitle', { m: gen(month) }),
    body: t(ev.h.m === 10 ? 'nosightFitrBody' : ev.h.m === 9 ? 'nosightRamadanBody' : 'nosightNotifBody', { m: gen(month), p: prev }) };
  if (ev.type === 'white') return { title: t('whiteNotifTitle'), body: t('whiteNotifBody', { d: ev.h.d, m: month }) };
  if (ev.type === 'eid') {
    const fitr = ev.kind === 'fitr';
    return { title: t(fitr ? 'fitrNotifTitle' : 'adhaNotifTitle'), body: [t('takbir'), t('eidGreeting'), fitr ? t('fitrZakat') : ''].filter(Boolean).join('\n') };
  }
  return { title: ev.h.m === 9 ? t('ramadanNotifTitle') : ev.h.m === 1 ? t('newYearNotifTitle', { y: ev.h.y }) : t('monthNotifTitle', { m: month }), body: [t('monthDua'), t('monthDuaTr')].filter(Boolean).join('\n') };
}

/**
 * Rappels des `horizon` prochains jours pour le module Android.
 *  { id, kind, at, until, title, body, watch? }
 *  - at / until : heure d'envoi (ms) et fin de la période où l'envoi reste utile ;
 *  - watch : « AAAA-MM-JJ » = le module n'envoie que si le calendrier des Habous confirme que le mois commence ce jour-là
 *    (au Maroc, le début du mois suivant n'est connu que le soir du 29, après le communiqué du ministère).
 * today : clé « AAAA-MM-JJ » du jour local ; dayInfo(clé) → { Maghrib, Isha } en ms, ou null ; addDays(clé, n) → clé.
 */
export function planNativeReminders({ today, horizon = 40, dayInfo, addDays, offset = 0, prefs, t, now = Date.now(), tz = null }) {
  const out = [], seen = new Set();
  const push = e => { if (e.until > now && !seen.has(e.id)) { seen.add(e.id); out.push(e); } };
  for (let i = 0; i < horizon; i++) {
    const key = addDays(today, i), d = dayInfo(key);
    if (!d) continue;
    const tomorrow = Date.parse(`${key}T12:00:00Z`) + DAY;
    if (prefs.friday && new Date(`${key}T12:00:00Z`).getUTCDay() === 5 && (tz || d.Sunrise)) {   // vendredi : 09:30 (sans fuseau connu : 15 min après le lever)
      const at = tz ? wallTime(key, FRIDAY_AT[0], FRIDAY_AT[1], tz) : d.Sunrise + 15 * 60000;
      push({ id: `${key}-friday`, kind: 'friday', at, until: at + WINDOW_FRIDAY, ...reminderText(t, { type: 'friday' }) });
    }
    if (prefs.white && d.Isha) {                                      // jours blancs : 30 min après l'Isha, si le mois est officiel
      const h = hijriOf(tomorrow, offset);
      if (isWhiteDay(h) && monthConfirmed(tomorrow, offset)) {
        const at = d.Isha + 30 * 60000;
        push({ id: `${key}-white`, kind: 'white', at, until: at + WINDOW_FIXED, ...reminderText(t, { type: 'white', h }) });
      }
    }
    if (d.Maghrib) {                                                  // début de mois ou Aïd déjà officiel : 20 min après le Maghrib
      const rem = reminderFor(tomorrow, offset, prefs);
      if (rem) {
        const at = d.Maghrib + 20 * 60000;
        push({ id: `${key}-${rem.type}`, kind: rem.type, at, until: at + WINDOW_FIXED, ...reminderText(t, rem) });
      }
    }
  }
  // Maroc : début du mois suivant pas encore annoncé → deux veilles possibles (29 ou 30 jours après le dernier début officiel)
  const hb = habousActive() ? habousInfo() : null;
  if (hb && hb.last) {
    const nm = hb.last.m === 12 ? 1 : hb.last.m + 1, ny = hb.last.m === 12 ? hb.last.y + 1 : hb.last.y;
    const rem = nm === 10 && prefs.eid ? { type: 'eid', kind: 'fitr', h: { d: 1, m: nm, y: ny } }
      : prefs.month ? { type: 'month', h: { d: 1, m: nm, y: ny } } : null;
    if (rem) for (const c of [29, 30]) {
      const targetDay = hb.last.day + c, eveKey = iso(targetDay - 1), d = dayInfo(eveKey);
      if (!d || !d.Maghrib) continue;
      const at = d.Maghrib + 20 * 60000;
      push({ id: `${eveKey}-${rem.type}`, kind: rem.type, at, until: at + WINDOW_WATCH, watch: iso(targetDay), ...reminderText(t, rem) });
    }
    // Mouharram, Ramadan, Chawwal, Dhou al-Hijja : le 29 au soir, annonce de l'observation, puis « croissant non vu » s'il y a lieu
    const h = { d: 1, m: nm, y: ny };
    const on = nm === 10 || nm === 12 ? (prefs.eid || prefs.month) : prefs.month;
    if (WATCHED_MONTHS.includes(nm) && on) {
      const eveKey = iso(hb.last.day + 28), d = dayInfo(eveKey);
      if (d && d.Maghrib) {
        const obsAt = d.Asr || d.Maghrib - 90 * 60000;                     // à l'Asr : avant que l'observation commence
        push({ id: `${eveKey}-obs`, kind: 'obs', at: obsAt, until: d.Maghrib + 30 * 60000, ...reminderText(t, { type: 'obs', h }) });
        const at = d.Maghrib + 20 * 60000;                                 // le ministère annonce que le mois commence le SURLENDEMAIN
        push({ id: `${eveKey}-nosight`, kind: 'nosight', at, until: at + WINDOW_WATCH, watch: iso(hb.last.day + 30), ...reminderText(t, { type: 'nosight', h }) });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
