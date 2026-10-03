// Récupère, met en cache et sert les horaires d'un jour donné.
import { getProvider } from './api.js';
import { computeDay } from './prayer-calc.js';
import { monthKey, readMonth, writeMonth, clearMonths, PRAYERS } from './storage.js';

export { PRAYERS };

// ---------- dates dans le fuseau du lieu ----------
export function dateKeyInTz(ts, tz) {
  // en-CA donne YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts);
}
export function addDays(dateKey, n) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function deviceTz() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

// ---------- récupération ----------
/**
 * S'assure que le mois du jour (et le suivant en fin de mois) est en cache.
 * Renvoie le fuseau horaire indiqué par l'API (ou null).
 */
export async function ensureMonths(settings, todayKey) {
  const loc = settings.location;
  const months = [todayKey.slice(0, 7)];
  if (Number(todayKey.slice(8, 10)) >= 25) months.push(addDays(todayKey, 10).slice(0, 7));

  let tz = null;
  const keep = [];
  for (const ym of months) {
    const key = monthKey(loc, settings.method, settings.school, ym);
    keep.push(key);
    const cached = readMonth(key);
    // on rafraîchit un mois en cache au plus une fois tous les 7 jours
    if (cached && Date.now() - cached.fetchedAt < 7 * 864e5) { tz = tz || cached.tz; continue; }
    const [year, month] = ym.split('-').map(Number);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const days = await getProvider().fetchMonth({
        lat: loc.lat, lng: loc.lng, year, month,
        method: settings.method, school: settings.school, signal: ctrl.signal,
      });
      const byDate = Object.fromEntries(days.map(d => [d.date, d.times]));
      tz = tz || days[0]?.tz || null;
      writeMonth(key, { fetchedAt: Date.now(), provider: getProvider().id, tz, days: byDate });
    } finally { clearTimeout(timer); }
  }
  // garde aussi le mois précédent (utile juste après minuit le 1er)
  keep.push(monthKey(loc, settings.method, settings.school, addDays(`${months[0]}-01`, -1).slice(0, 7)));
  clearMonths(keep);
  return tz;
}

/** Horaires d'un jour, ajustements utilisateur appliqués. */
export function getDay(settings, dateKey) {
  const loc = settings.location;
  const cached = readMonth(monthKey(loc, settings.method, settings.school, dateKey.slice(0, 7)));
  let raw, source, fetchedAt = null;
  if (Number(settings.method) === 21) {
    // Maroc : calcul identique aux horaires officiels des Habous (l'API décale le chourouq et arrondit autrement)
    raw = computeDay({ lat: loc.lat, lng: loc.lng, snap: settings.officialLocality !== false, code: settings.officialLocalityCode ?? null }, dateKey, 21, settings.school); source = 'habous';
  } else if (cached?.days?.[dateKey]) {
    raw = cached.days[dateKey]; source = 'api'; fetchedAt = cached.fetchedAt;
  } else {
    raw = computeDay(loc, dateKey, settings.method, settings.school); source = 'local';
  }
  const times = { ...raw };
  for (const [k, min] of Object.entries(settings.adjust || {})) {
    if (times[k] && min) times[k] += min * 60000;
  }
  if (times.Imsak && settings.adjust?.Fajr) times.Imsak += settings.adjust.Fajr * 60000;
  if (times.Sunset && settings.adjust?.Maghrib) times.Sunset += settings.adjust.Maghrib * 60000;
  return { date: dateKey, times, source, fetchedAt };
}

/**
 * Prochaine prière obligatoire après `t`, et prière en cours.
 * Après Isha, la prochaine est Fajr du lendemain.
 */
/** Prière dont l'heure vient de passer (depuis moins de `graceMs`), sinon null.
 *  Le temps du Fajr s'arrête au lever du soleil. */
export function findElapsed(today, t, graceMs) {
  for (const p of [...PRAYERS].reverse()) {
    const ts = today.times[p];
    if (ts > t) continue;
    let end = ts + graceMs;
    if (p === 'Fajr' && today.times.Sunrise) end = Math.min(end, today.times.Sunrise);
    return t < end ? { name: p, ts, end } : null;
  }
  return null;
}

export function findNext(today, tomorrow, t) {
  let current = null;
  for (const p of PRAYERS) {
    const ts = today.times[p];
    if (ts > t) return { name: p, ts, day: 'today', current };
    current = p;
  }
  return { name: 'Fajr', ts: tomorrow.times.Fajr, day: 'tomorrow', current: 'Isha' };
}

/** Charge (si besoin) un mois donné, pour consulter d'autres jours. Renvoie true si en cache. */
export async function ensureMonth(settings, ym) {
  const loc = settings.location; if (!loc) return false;
  const key = monthKey(loc, settings.method, settings.school, ym);
  const cached = readMonth(key);
  if (cached && Date.now() - cached.fetchedAt < 7 * 864e5) return true;
  const [year, month] = ym.split('-').map(Number);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const days = await getProvider().fetchMonth({ lat: loc.lat, lng: loc.lng, year, month,
      method: settings.method, school: settings.school, signal: ctrl.signal });
    writeMonth(key, { fetchedAt: Date.now(), provider: getProvider().id, tz: days[0]?.tz || null,
      days: Object.fromEntries(days.map(d => [d.date, d.times])) });
    return true;
  } catch { return !!cached; } finally { clearTimeout(timer); }
}
