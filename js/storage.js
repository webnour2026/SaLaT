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
  hijriOffset: 0,               // -2 … +2 (correction manuelle, surtout utile hors du Maroc)
  hijriSource: 'auto',          // auto (Maroc → Habous, ailleurs → calcul) | habous | calc
  cardFrom: '',                 // nom affiché « من: … » sur les cartes partagées
  cardNoName: true,             // true (défaut) : cartes envoyées sans nom ; false : le nom de l'expéditeur est ajouté (case « إضافة اسم المُرسِل »)
  ongoing: true,                // notification permanente (prochaine prière + compte à rebours), module Android
  tzMode: 'auto',               // 'auto' (selon la ville) ou décalage fixe en heures : '0', '1', '-5'…
  whiteDays: true,              // rappel des jours blancs
  monthReminder: true,          // rappel « demain : 1er du mois » avec le doua de la nouvelle lune
  eidReminder: true,            // rappel de la veille des Aïds (takbir)
  officialLocality: true,       // Maroc : horaire de la localité officielle la plus proche (≤ 25 km), comme le tableau de la mosquée
  officialLocalityCode: null,   // Maroc : localité officielle choisie à la main (null = automatique)
  fridayReminder: true,         // vendredi matin : « أكثروا من الصلاة على النبي ﷺ »
  silentUntil: 0,               // mode silencieux : timestamp de fin (Infinity = jusqu'à désactivation)
  declAuto: true,               // déclinaison calculée par WMM2025
  declination: 0,               // valeur manuelle (degrés, Est positif)
  adhan: {
    enabled: true,
    mode: 'global',             // global | perPrayer
    global: 'aaqib',
    perPrayer: { Fajr: 'aaqib', Dhuhr: 'aaqib', Asr: 'aaqib', Maghrib: 'aaqib', Isha: 'aaqib' },
    volume: 0.8,
    vibrate: true,
    notifyAt: true,
    notifyBefore: 0,            // 0 | 5 | 10 | 15
    short: false,               // Adhan court (20 s)
    mute: {},                   // { Fajr: true, … } : cloche barrée = pas d'Adhan pour cette prière
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
