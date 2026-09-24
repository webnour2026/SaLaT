// Calcul astronomique local, utilisé seulement si l'API est injoignable et qu'aucun
// horaire n'est en cache pour le jour demandé. Algorithme dérivé de PrayTimes.org.
// Précision : ±1–2 min par rapport à l'API (qui applique parfois des ajustements officiels).

// fajr / isha en degrés sous l'horizon ; ishaMin = minutes après le maghrib
const METHOD_PARAMS = {
  21: { fajr: 19, isha: 17, offsets: { Dhuhr: 5, Maghrib: 5 } }, // Maroc (marges des tables des Habous)
  3:  { fajr: 18, isha: 17 },      // MWL
  5:  { fajr: 19.5, isha: 17.5 },  // Égypte
  4:  { fajr: 18.5, ishaMin: 90 }, // Umm Al-Qura
  1:  { fajr: 18, isha: 18 },      // Karachi
  2:  { fajr: 15, isha: 15 },      // ISNA
  13: { fajr: 18, isha: 17 },      // Diyanet
  12: { fajr: 12, isha: 12 },      // UOIF
  19: { fajr: 18, isha: 17 },      // Algérie
  18: { fajr: 18, isha: 18 },      // Tunisie
  8:  { fajr: 19.5, ishaMin: 90 }, // Golfe
  16: { fajr: 18.2, isha: 18.2 },  // Dubaï
  15: { fajr: 18, isha: 18 },      // Moonsighting (approx.)
};

const rad = d => d * Math.PI / 180;
const deg = r => r * 180 / Math.PI;
const fix = (a, b) => { a = a - b * Math.floor(a / b); return a < 0 ? a + b : a; };
const dsin = d => Math.sin(rad(d)), dcos = d => Math.cos(rad(d)), dtan = d => Math.tan(rad(d));
const darcsin = x => deg(Math.asin(x)), darccos = x => deg(Math.acos(x));
const darctan2 = (y, x) => deg(Math.atan2(y, x)), darccot = x => deg(Math.atan(1 / x));

function julian(y, m, d) {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}
function sunPosition(jd) {
  const D = jd - 2451545.0;
  const g = fix(357.529 + 0.98560028 * D, 360);
  const q = fix(280.459 + 0.98564736 * D, 360);
  const L = fix(q + 1.915 * dsin(g) + 0.020 * dsin(2 * g), 360);
  const e = 23.439 - 0.00000036 * D;
  const RA = darctan2(dcos(e) * dsin(L), dcos(L)) / 15;
  return { decl: darcsin(dsin(e) * dsin(L)), eqt: q / 15 - fix(RA, 24) };
}

/** Renvoie { Imsak, Fajr, Sunrise, Dhuhr, Asr, Sunset, Maghrib, Isha, Midnight } en timestamps ms. */
export function computeDay({ lat, lng }, dateStr, method, school) {
  const p = METHOD_PARAMS[method] || METHOD_PARAMS[3];
  const [y, m, d] = dateStr.split('-').map(Number);
  const jd = julian(y, m, d) - lng / (15 * 24);

  const midDay = t => fix(12 - sunPosition(jd + t).eqt, 24);
  const angleTime = (angle, t, ccw) => {
    const { decl } = sunPosition(jd + t);
    const T = darccos((-dsin(angle) - dsin(decl) * dsin(lat)) / (dcos(decl) * dcos(lat))) / 15;
    return midDay(t) + (ccw ? -T : T);
  };
  const asrTime = (factor, t) => {
    const { decl } = sunPosition(jd + t);
    return angleTime(-darccot(factor + dtan(Math.abs(lat - decl))), t);
  };

  // heures solaires locales (première estimation / 24)
  const h = {
    Fajr: angleTime(p.fajr, 5 / 24, true),
    Sunrise: angleTime(0.833, 6 / 24, true),
    Dhuhr: midDay(12 / 24),
    Asr: asrTime(school === 1 ? 2 : 1, 13 / 24),
    Sunset: angleTime(0.833, 18 / 24),
  };
  h.Maghrib = h.Sunset;
  h.Isha = p.ishaMin ? h.Maghrib + p.ishaMin / 60 : angleTime(p.isha, 18 / 24);
  for (const [k, min] of Object.entries(p.offsets || {})) h[k] += min / 60;
  h.Imsak = h.Fajr - 10 / 60;
  h.Midnight = h.Sunset + (h.Fajr + 24 - h.Sunset) / 2;

  const base = Date.UTC(y, m - 1, d);
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    // v est en heure solaire locale -> UTC = v - lng/15
    out[k] = Number.isFinite(v) ? Math.round(base + (v - lng / 15) * 3600000) : null;
  }
  return out;
}
