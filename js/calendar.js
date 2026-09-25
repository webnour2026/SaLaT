// Calendrier hégirien : mois complets, occasions et « jours blancs » (13, 14, 15).
import { hijriParts } from './hijri.js';

const DAY = 864e5;
// Occasions (mois, jour) → clé de traduction
export const OCCASIONS = [
  { m: 1, d: 1, key: 'occNewYear' },
  { m: 1, d: 10, key: 'occAshura' },
  { m: 3, d: 12, key: 'occMawlid' },
  { m: 7, d: 27, key: 'occIsra' },
  { m: 8, d: 15, key: 'occNisfShaban' },
  { m: 9, d: 1, key: 'occRamadan' },
  { m: 9, d: 27, key: 'occQadr' },
  { m: 10, d: 1, key: 'occFitr' },
  { m: 12, d: 9, key: 'occArafa' },
  { m: 12, d: 10, key: 'occAdha' },
];

/** Midi UTC de la date civile du lieu : sert de clé de jour stable (pas d'effet d'heure d'été). */
export function civilNoon(ts, timeZone) {
  const [Y, M, D] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(ts).split('-').map(Number);
  return Date.UTC(Y, M - 1, D, 12);
}

/** Date hégirienne d'un jour civil (midi UTC), correction utilisateur incluse. */
export const hijriOf = (noon, offsetDays = 0) => hijriParts(noon + offsetDays * DAY, 'UTC');

/** Jours blancs à jeûner : 13, 14, 15 — sauf le 13 Dhou al-Hijja (jour de Tachriq, jeûne interdit). */
export const isWhiteDay = h => [13, 14, 15].includes(h.d) && !(h.m === 12 && h.d === 13);

export const occasionOf = h => OCCASIONS.find(o => o.m === h.m && o.d === h.d) || null;

/** Tous les jours du mois hégirien contenant `anchorNoon`. */
export function hijriMonth(anchorNoon, offsetDays = 0) {
  let first = anchorNoon;
  for (let i = 0; i < 31 && hijriOf(first, offsetDays).d !== 1; i++) first -= DAY;
  const h0 = hijriOf(first, offsetDays);
  const days = [];
  for (let t = first; days.length < 31; t += DAY) {
    const h = hijriOf(t, offsetDays);
    if (h.m !== h0.m) break;
    days.push({ noon: t, h, dow: new Date(t).getUTCDay(), white: isWhiteDay(h), occasion: occasionOf(h) });
  }
  return { y: h0.y, m: h0.m, days };
}

/** Prochains jours blancs à partir d'aujourd'hui (jusqu'à `horizon` jours). */
export function upcomingWhiteDays(todayNoon, offsetDays = 0, horizon = 20) {
  const out = [];
  for (let i = 0; i <= horizon; i++) {
    const t = todayNoon + i * DAY, h = hijriOf(t, offsetDays);
    if (isWhiteDay(h)) out.push({ noon: t, h });
    else if (out.length) break; // on s'arrête à la fin de la série
  }
  return out;
}
