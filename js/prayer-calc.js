// Calcul astronomique local. Pour la méthode Maroc (21), c'est la source principale : il reproduit
// les tables du ministère des Habous (angles 19°/17°, marges, arrondi à la minute), ce que l'API ne fait pas.
// Pour les autres méthodes : secours si l'API est injoignable et qu'aucun horaire n'est en cache. Algorithme dérivé de PrayTimes.org.

// fajr / isha en degrés sous l'horizon ; ishaMin = minutes après le maghrib
const METHOD_PARAMS = {
  // Maroc : marges des tables des Habous (chourouq −5, dhuhr +5, maghrib +5 min) ; corrections fines ci-dessous
  21: { fajr: 19, isha: 17, offsets: { Sunrise: -5, Dhuhr: 5, Maghrib: 5 } },
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

// Étalonnage sur les tables des Habous : pour chaque ville, angle d'horizon (chourouq/maghrib, °)
// et corrections fines en secondes. Ajusté sur l'année 2021 complète (47 villes) et, en priorité,
// sur sept.–oct. 2026 (6 villes) : ~95 % d'horaires identiques, le reste à 1 min. Les Habous ont leurs propres
// repères par ville (altitude, horizon) : d'où un réglage par ville plutôt qu'une règle unique.
// [lat, lng, horizon, Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha]
const MA_CALIB = [
  [34.6814, -1.9086, 1.65, -25, 215, 5, 10, -165, 5], // Oujda
  [34.4073, -2.8973, 1.85, -35, 225, -5, -5, -200, 0], // Taourirt
  [35.1681, -2.9335, 1.25, -30, 215, 0, 0, -160, 0], // Nador
  [34.2257, -3.3536, 1.5, -25, 240, 5, 5, -180, 5], // Guercif
  [35.2517, -3.9372, 1.4, -30, 260, 0, 0, -210, 0], // Al Hoceima
  [34.21, -4.01, 1.75, -25, 255, 5, 5, -205, 5], // Taza
  [31.9314, -4.4247, 1.9, -25, 250, 5, 5, -205, 5], // Errachidia
  [34.5362, -4.6398, 1.75, -20, 260, 5, 5, -205, 10], // Taounate
  [32.6852, -4.7451, 2.05, -30, 205, 0, 0, -190, 0], // Midelt
  [33.8305, -4.8353, 1.8, -25, 215, 5, 5, -180, 5], // Sefrou
  [34.0331, -5.0003, 1.55, -25, 245, 5, 10, -185, 5], // Fès
  [33.5228, -5.11, 2.1, -25, 215, 0, 5, -200, 0], // Ifrane
  [35.1688, -5.2636, 2.2, -25, 205, 5, 5, -200, 5], // Chefchaouen
  [35.5785, -5.3684, 1.6, -25, 240, 5, 5, -190, 0], // Tétouan
  [33.8935, -5.5473, 1.6, -25, 240, 5, 5, -185, 5], // Meknès
  [34.7978, -5.579, 1.65, -25, 240, 5, 5, -185, 5], // Ouezzane
  [32.9394, -5.6675, 1.95, -25, 210, 5, 0, -185, 5], // Khénifra
  [34.226, -5.7079, 1.35, -25, 225, 5, 5, -165, 5], // Sidi Kacem
  [35.7595, -5.834, 0.45, -35, -50, 0, 5, 95, -5], // Tanger
  [30.3324, -5.8384, 1.55, -25, 230, 5, 5, -180, 5], // Zagora
  [34.2648, -5.9258, 1.15, -25, 230, 5, 5, -165, 5], // Sidi Slimane
  [33.824, -6.066, 1.5, -25, 225, 5, 5, -170, 0], // Khémisset
  [35.1932, -6.1557, 1.1, -20, 220, 10, 5, -145, 10], // Larache
  [32.3373, -6.3498, 1.95, -25, 235, 5, 5, -200, 5], // Béni Mellal
  [31.9617, -6.5718, 2.1, -30, 215, 5, 0, -200, 5], // Azilal
  [34.261, -6.5802, 1.25, -25, 220, 5, 5, -155, 5], // Kénitra
  [34.0209, -6.8416, 1.2, -30, 235, 5, 0, -170, 0], // Rabat
  [32.8811, -6.9063, 1.8, -25, 245, 5, 5, -200, 5], // Khouribga
  [30.9189, -6.8934, 1.95, -20, 245, 10, 5, -200, 10], // Ouarzazate
  [33.6866, -7.383, 1.15, -25, 230, 5, 5, -165, 5], // Mohammedia
  [32.0581, -7.41, 1.5, -25, 220, 0, 5, -165, 0], // Kelaat Sraghna
  [33.001, -7.6166, 1.55, -35, 245, -5, 0, -205, -5], // Settat
  [33.5731, -7.5898, 1.15, -10, 205, 20, 15, -115, 15], // Casablanca
  [31.6295, -7.9811, 1.35, -25, 165, 5, 5, -105, 5], // Marrakech
  [33.2316, -8.5007, 1.25, -25, 260, 5, 0, -195, 0], // El Jadida
  [32.2464, -8.5294, 1.6, -25, 255, 5, 5, -200, 5], // Youssoufia
  [30.4703, -8.877, 1.35, -30, 230, 0, 0, -175, 0], // Taroudant
  [32.2994, -9.2372, 1.3, -30, 255, 5, 0, -190, 0], // Safi
  [30.4278, -9.5981, 1.35, -25, 250, 5, 5, -185, 5], // Agadir
  [29.6974, -9.7316, 1.45, -25, 260, 5, 5, -195, 5], // Tiznit
  [31.5085, -9.7595, 1.25, -25, 260, 5, 10, -195, 5], // Essaouira
  [28.987, -10.0574, 1.65, -25, 240, 0, 0, -190, 5], // Guelmim
  [29.3797, -10.1729, 1.25, -30, 250, 0, 5, -190, 0], // Sidi Ifni
  [28.438, -11.103, 1.4, -25, 235, 5, 5, -175, 5], // Tan-Tan
  [26.7384, -11.6719, 1.5, -30, 260, 0, 5, -205, 0], // Smara
  [27.1253, -13.1625, 1.3, -15, 285, 15, 20, -195, 15], // Laâyoune
  [26.1253, -14.4847, 1.25, -20, 265, 10, 10, -185, 10], // Boujdour
  [23.6848, -15.958, 1.2, -25, 225, 5, 10, -160, 5], // Dakhla
];
const MA_KEYS = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
const MA_DEFAULT = [0, 0, 1.4, -25, 235, 5, 5, -180, 5];   // hors des villes étalonnées : valeurs typiques
/** Réglage de la ville étalonnée la plus proche (≤ 50 km), sinon valeurs typiques. */
function moroccoCalib(lat, lng) {
  let best = MA_DEFAULT, bestKm = 50;
  for (const c of MA_CALIB) {
    const km = Math.hypot((c[0] - lat) * 111, (c[1] - lng) * 111 * Math.cos(lat * Math.PI / 180));
    if (km <= bestKm) { bestKm = km; best = c; }
  }
  return best;
}

/** Renvoie { Imsak, Fajr, Sunrise, Dhuhr, Asr, Sunset, Maghrib, Isha, Midnight } en timestamps ms. */
export function computeDay({ lat, lng }, dateStr, method, school) {
  const p = METHOD_PARAMS[method] || METHOD_PARAMS[3];
  const ma = Number(method) === 21 ? moroccoCalib(lat, lng) : null;
  const horizon = ma ? ma[2] : 0.833;
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
    Sunrise: angleTime(horizon, 6 / 24, true),
    Dhuhr: midDay(12 / 24),
    Asr: asrTime(school === 1 ? 2 : 1, 13 / 24),
    Sunset: angleTime(horizon, 18 / 24),
  };
  h.Maghrib = h.Sunset;
  h.Isha = p.ishaMin ? h.Maghrib + p.ishaMin / 60 : angleTime(p.isha, 18 / 24);
  for (const [k, min] of Object.entries(p.offsets || {})) h[k] += min / 60;
  if (ma) MA_KEYS.forEach((k, i) => { h[k] += ma[3 + i] / 3600; });
  h.Imsak = h.Fajr - 10 / 60;
  h.Midnight = h.Sunset + (h.Fajr + 24 - h.Sunset) / 2;

  const base = Date.UTC(y, m - 1, d);
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    // v est en heure solaire locale -> UTC = v - lng/15
    // arrondi à la minute la plus proche, comme les tables officielles
    out[k] = Number.isFinite(v) ? Math.round((base + (v - lng / 15) * 3600000) / 60000) * 60000 : null;
  }
  return out;
}
