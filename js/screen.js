// Écran de mosquée (TV, tablette, PC) — règles pures, sans DOM (testées par scripts/test-screen.mjs).
// Pour chaque prière : heure de l'Adhan (horaires de l'appli, officiels au Maroc) et heure de l'Iqama = Adhan + délai réglé
// par la mosquée. Le vendredi, le Dhuhr devient la Joumou'a avec son propre délai (prêche).
// États : 'iqama' (entre Adhan et Iqama : compte à rebours de l'Iqama), 'prayer' (après l'Iqama : écran sombre pendant
// la prière), 'next' (compte à rebours du prochain Adhan).
export const MIN = 60000;
export const SCREEN_DEFAULTS = Object.freeze({ iq: { Fajr: 20, Dhuhr: 15, Asr: 15, Maghrib: 10, Isha: 15, Jumuah: 30 }, quiet: 10, msg: '' });
export const SCREEN_ROWS = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
const clampMin = (v, d, max = 90) => (Number.isFinite(+v) && +v >= 0 ? Math.min(max, Math.round(+v)) : d);

/** Réglages complets (valeurs manquantes ou invalides → défaut). */
export function screenConfig(cfg) {
  const c = cfg || {}, iq = {};
  for (const k of Object.keys(SCREEN_DEFAULTS.iq)) iq[k] = clampMin(c.iq?.[k], SCREEN_DEFAULTS.iq[k]);
  return { iq, quiet: clampMin(c.quiet, SCREEN_DEFAULTS.quiet, 60), msg: String(c.msg || '').slice(0, 280) };
}

/** Lignes du jour : [{ key, adhan, iqama (null pour le lever du soleil), jumuah }]. times : { Fajr: ms, … }. */
export function screenRows(times, friday, cfg) {
  const c = screenConfig(cfg);
  return SCREEN_ROWS.filter(k => times && times[k] != null).map(k => {
    const jumuah = friday && k === 'Dhuhr';
    const delay = k === 'Sunrise' ? null : jumuah ? c.iq.Jumuah : c.iq[k];
    return { key: k, adhan: times[k], iqama: delay == null ? null : times[k] + delay * MIN, jumuah };
  });
}

/** État à l'instant now. day/next : { times, friday } d'aujourd'hui et de demain. */
export function screenState(day, next, now, cfg) {
  const c = screenConfig(cfg);
  const rows = screenRows(day?.times, day?.friday, c).filter(r => r.iqama != null);
  for (const r of rows) {
    if (now >= r.adhan && now < r.iqama) return { mode: 'iqama', row: r, target: r.iqama };
    if (c.quiet > 0 && now >= r.iqama && now < r.iqama + c.quiet * MIN) return { mode: 'prayer', row: r, target: r.iqama + c.quiet * MIN };
  }
  const up = rows.find(r => r.adhan > now) || screenRows(next?.times, next?.friday, c).find(r => r.iqama != null);
  return up ? { mode: 'next', row: up, target: up.adhan } : { mode: 'none', row: null, target: 0 };
}

/** mm:ss (moins d'une heure) ou h:mm:ss. */
export function countdownText(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  const p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(x)}` : `${p(m)}:${p(x)}`;
}
