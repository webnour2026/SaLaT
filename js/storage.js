// Paramètres utilisateur et cache des horaires (localStorage).
const SETTINGS_KEY = 'priere.settings.v1';
const CACHE_PREFIX = 'priere.month.';

export const PRAYERS = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

export const DEFAULTS = {
  lang: 'fr',
  theme: 'auto',                // light | dark | auto
  location: null,               // { lat, lng, name, country, tz, source: 'gps'|'manual', accuracy, ts }
  method: 21,                   // 21 = Maroc (AlAdhan)
  methodAuto: true,             // choisit la méthode selon le pays tant que l'utilisateur n'a rien changé
  school: 0,                    // 0 = Shafi/standard, 1 = Hanafi
  adjust: { Fajr: 0, Sunrise: 0, Dhuhr: 0, Asr: 0, Maghrib: 0, Isha: 0 },
  hijriOffset: 0,               // -2 … +2
  whiteDays: true,              // rappel des jours blancs
  silentUntil: 0,               // mode silencieux : timestamp de fin (Infinity = jusqu'à désactivation)
  declAuto: true,               // déclinaison calculée par WMM2025
  declination: 0,               // valeur manuelle (degrés, Est positif)
  adhan: {
    enabled: true,
    mode: 'global',             // global | perPrayer
    global: 'casablanca',
    perPrayer: { Fajr: 'casablanca', Dhuhr: 'casablanca', Asr: 'casablanca', Maghrib: 'casablanca', Isha: 'casablanca' },
    volume: 0.8,
    vibrate: true,
    notifyAt: false,
    notifyBefore: 0,            // 0 | 5 | 10 | 15
  },
};

function merge(base, over) {
  for (const k of Object.keys(over || {})) {
    const v = over[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') merge(base[k], v);
    else base[k] = v;
  }
  return base;
}

export function loadSettings() {
  try { return merge(structuredClone(DEFAULTS), JSON.parse(localStorage.getItem(SETTINGS_KEY))); }
  catch { return structuredClone(DEFAULTS); }
}
export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* quota / mode privé */ }
}

// Cache par mois : clé = position arrondie + méthode + madhab + mois
export function monthKey({ lat, lng }, method, school, ym) {
  return `${CACHE_PREFIX}${lat.toFixed(3)},${lng.toFixed(3)}|${method}|${school}|${ym}`;
}
export function readMonth(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
export function writeMonth(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { clearMonths(); try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
}
export function clearMonths(keep = []) {
  Object.keys(localStorage)
    .filter(k => k.startsWith(CACHE_PREFIX) && !keep.includes(k))
    .forEach(k => localStorage.removeItem(k));
}
