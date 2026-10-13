// Visibilité du croissant le soir du 29 — prévision astronomique, à titre indicatif (seul le communiqué du ministère fait foi).
// Positions : Soleil et Lune d'après Meeus (« Astronomical Algorithms », ch. 25 et 47, termes principaux : ~0,05° pour la Lune).
// Critères : ceux du manuel de « التوقيت » du ministère des Habous (3e année, leçon 22, « أوجه الحكم بإمكانية رؤية الهلال ») :
//   ولادة الهلال قبل الغروب · مدة المكث ≥ 48 min · ارتفاع القمر ≥ 7° · بعد السواء ≥ 10° (12° ممكنة، 14° واضحة).
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
const norm = a => ((a % 360) + 360) % 360;
const DAY = 864e5;
const jdOf = ts => ts / DAY + 2440587.5;

/** Soleil : { lon (° écliptique apparente), ra, dec (°), dist (UA) } */
function sun(ts) {
  const T = (jdOf(ts) - 2451545) / 36525;
  const L0 = 280.46646 + T * (36000.76983 + T * 0.0003032);
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const C = Math.sin(rad(M)) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * T) + Math.sin(rad(3 * M)) * 0.000289;
  const Om = 125.04 - 1934.136 * T;
  const lon = norm(L0 + C - 0.00569 - 0.00478 * Math.sin(rad(Om)));
  const eps = 23.439291 - 0.0130042 * T + 0.00256 * Math.cos(rad(Om));
  const ra = norm(deg(Math.atan2(Math.cos(rad(eps)) * Math.sin(rad(lon)), Math.cos(rad(lon)))));
  const dec = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lon))));
  return { lon, ra, dec, eps };
}

// Meeus, table 47.A / 47.B (termes ≥ 0,01° en longitude, ≥ 0,005° en latitude) : [D, M, M', F, coef]
const LON = [[0,0,1,0,6288774],[2,0,-1,0,1274027],[2,0,0,0,658314],[0,0,2,0,213618],[0,1,0,0,-185116],[0,0,0,2,-114332],[2,0,-2,0,58793],[2,-1,-1,0,57066],[2,0,1,0,53322],[2,-1,0,0,45758],[0,1,-1,0,-40923],[1,0,0,0,-34720],[0,1,1,0,-30383],[2,0,0,-2,15327],[0,0,1,2,-12528],[0,0,1,-2,10980],[4,0,-1,0,10675],[0,0,3,0,10034],[4,0,-2,0,8548],[2,1,-1,0,-7888],[2,1,0,0,-6766],[1,0,-1,0,-5163],[1,1,0,0,4987],[2,-1,1,0,4036],[2,0,2,0,3994],[4,0,0,0,3861],[2,0,-3,0,3665],[0,1,-2,0,-2689],[2,0,-1,2,-2602],[2,-1,-2,0,2390],[1,0,1,0,-2348],[2,-2,0,0,2236],[0,1,2,0,-2120],[0,2,0,0,-2069]];
const DIST = [[0,0,1,0,-20905355],[2,0,-1,0,-3699111],[2,0,0,0,-2955968],[0,0,2,0,-569925],[0,1,0,0,48888],[0,0,0,2,-3149],[2,0,-2,0,246158],[2,-1,-1,0,-152138],[2,0,1,0,-170733],[2,-1,0,0,-204586],[0,1,-1,0,-129620],[1,0,0,0,108743],[0,1,1,0,104755],[2,0,0,-2,10321],[0,0,1,-2,79661],[4,0,-1,0,-34782],[0,0,3,0,-23210],[4,0,-2,0,-21636],[2,1,-1,0,24208],[2,1,0,0,30824],[1,0,-1,0,-8379],[1,1,0,0,-16675],[2,-1,1,0,-12831],[2,0,2,0,-10445],[4,0,0,0,-11650],[2,0,-3,0,14403],[0,1,-2,0,-7003],[2,-1,-2,0,10056],[1,0,1,0,6322],[2,-2,0,0,-9884]];
const LAT = [[0,0,0,1,5128122],[0,0,1,1,280602],[0,0,1,-1,277693],[2,0,0,-1,173237],[2,0,-1,1,55413],[2,0,-1,-1,46271],[2,0,0,1,32573],[0,0,2,1,17198],[2,0,1,-1,9266],[0,0,2,-1,8822],[2,-1,0,-1,8216],[2,0,-2,-1,4324],[2,0,1,1,4200],[2,1,0,-1,-3359],[2,-1,-1,1,2463],[2,-1,0,1,2211],[2,-1,-1,-1,2065],[0,1,-1,-1,-1870],[4,0,-1,-1,1828],[0,1,0,1,-1794]];

/** Lune (géocentrique) : { lon, lat (° écliptiques), dist (km), ra, dec (°) } */
function moon(ts) {
  const T = (jdOf(ts) - 2451545) / 36525;
  const Lp = 218.3164477 + 481267.88123421 * T;
  const D = 297.8501921 + 445267.1114034 * T, M = 357.5291092 + 35999.0502909 * T;
  const Mp = 134.9633964 + 477198.8675055 * T, F = 93.2720950 + 483202.0175233 * T;
  const E = 1 - 0.002516 * T;
  const arg = ([d, m, mp, f]) => rad(d * D + m * M + mp * Mp + f * F);
  const ecc = m => (Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1);
  let sl = 0, sr = 0, sb = 0;
  for (const t of LON) sl += t[4] * ecc(t[1]) * Math.sin(arg(t));
  for (const t of DIST) sr += t[4] * ecc(t[1]) * Math.cos(arg(t));
  for (const t of LAT) sb += t[4] * ecc(t[1]) * Math.sin(arg(t));
  const A1 = 119.75 + 131.849 * T, A2 = 53.09 + 479264.29 * T, A3 = 313.45 + 481266.484 * T;
  sl += 3958 * Math.sin(rad(A1)) + 1962 * Math.sin(rad(Lp - F)) + 318 * Math.sin(rad(A2));
  sb += -2235 * Math.sin(rad(Lp)) + 382 * Math.sin(rad(A3)) + 175 * Math.sin(rad(A1 - F)) + 175 * Math.sin(rad(A1 + F)) + 127 * Math.sin(rad(Lp - Mp)) - 115 * Math.sin(rad(Lp + Mp));
  const Om = 125.04 - 1934.136 * T;
  const lon = norm(Lp + sl / 1e6 - 0.00478 * Math.sin(rad(Om))), lat = sb / 1e6, dist = 385000.56 + sr / 1000;
  const eps = 23.439291 - 0.0130042 * T + 0.00256 * Math.cos(rad(Om));
  const ra = norm(deg(Math.atan2(Math.sin(rad(lon)) * Math.cos(rad(eps)) - Math.tan(rad(lat)) * Math.sin(rad(eps)), Math.cos(rad(lon)))));
  const dec = deg(Math.asin(Math.sin(rad(lat)) * Math.cos(rad(eps)) + Math.cos(rad(lat)) * Math.sin(rad(eps)) * Math.sin(rad(lon))));
  return { lon, lat, dist, ra, dec };
}

/** Temps sidéral local (°). */
function lst(ts, lng) {
  const jd = jdOf(ts), T = (jd - 2451545) / 36525;
  return norm(280.46061837 + 360.98564736629 * (jd - 2451545) + T * T * 0.000387933 + lng);
}
/** Hauteur (°) d'un astre (ra, dec) vu de (lat, lng) à l'instant ts. */
function altitude(ts, lat, lng, ra, dec) {
  const H = rad(lst(ts, lng) - ra);
  return deg(Math.asin(Math.sin(rad(lat)) * Math.sin(rad(dec)) + Math.cos(rad(lat)) * Math.cos(rad(dec)) * Math.cos(H)));
}
const sunAlt = (ts, lat, lng) => { const s = sun(ts); return altitude(ts, lat, lng, s.ra, s.dec); };
/** Hauteur topocentrique du centre de la Lune (parallaxe retirée). */
function moonAlt(ts, lat, lng) {
  const m = moon(ts), h = altitude(ts, lat, lng, m.ra, m.dec);
  return h - deg(Math.asin(6378.14 / m.dist)) * Math.cos(rad(h));
}

/** Instant (ms) où f passe sous `h0` en descendant, entre t0 et t1 (pas de 2 min puis dichotomie), ou null. */
function setting(f, h0, t0, t1) {
  let a = t0, fa = f(a) - h0;
  for (let b = t0 + 120000; b <= t1; b += 120000) {
    const fb = f(b) - h0;
    if (fa > 0 && fb <= 0) { let lo = a, hi = b; for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (f(m) - h0 > 0) lo = m; else hi = m; } return hi; }
    a = b; fa = fb;
  }
  return null;
}

/** Instant (ms) de la conjonction (nouvelle lune) la plus proche avant `ts`. */
export function conjunctionBefore(ts) {
  let t = ts;
  for (let i = 0; i < 8; i++) {                       // Newton sur l'élongation en longitude (~12,2°/jour)
    const d = ((moon(t).lon - sun(t).lon + 540) % 360) - 180;
    t -= (d / 12.19) * DAY;
  }
  return t <= ts ? t : t - 29.530589 * DAY;
}

/**
 * Le soir du jour `dateKey` (« AAAA-MM-JJ », jour civil du lieu), vu de (lat, lng) :
 * { grade: 'impossible' | 'difficult' | 'possible' | 'clear', born, lagMin, alt, elong, sunset, moonset }
 */
export function crescent(dateKey, lat, lng) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const noon = Date.UTC(y, m - 1, d, 12) - (lng / 15) * 3600e3;          // midi solaire approximatif
  const sunset = setting(t => sunAlt(t, lat, lng), -0.833, noon, noon + 10 * 3600e3);
  if (!sunset) return null;
  const moonset = setting(t => moonAlt(t, lat, lng), 0.125, sunset - 3 * 3600e3, sunset + 6 * 3600e3);
  const conj = conjunctionBefore(sunset);
  const born = sunset - conj < 2 * DAY;                                   // conjonction de ce cycle avant le coucher
  const s = sun(sunset), mo = moon(sunset);
  const elong = deg(Math.acos(Math.cos(rad(mo.lat)) * Math.cos(rad(mo.lon - s.lon))));   // « بعد السواء » (arc de lumière)
  const alt = moonAlt(sunset, lat, lng);
  const lagMin = moonset && moonset > sunset ? (moonset - sunset) / 60000 : 0;
  let grade;
  if (!born || lagMin <= 0 || elong < 10) grade = 'impossible';
  else if (elong < 12 || lagMin < 48 || alt < 7) grade = 'difficult';
  else if (elong < 14) grade = 'possible';
  else grade = 'clear';
  return { grade, born, lagMin: Math.round(lagMin), alt: Math.round(alt * 10) / 10, elong: Math.round(elong * 10) / 10, sunset, moonset, conj };
}

/** Pour tout le Maroc : la meilleure visibilité parmi quelques lieux d'observation (le ministère retient toute observation du royaume). */
export const MA_SITES = [[34.02, -6.84], [31.63, -8.0], [30.42, -9.6], [27.15, -13.2], [23.7, -15.95], [35.77, -5.8]];
const RANK = { impossible: 0, difficult: 1, possible: 2, clear: 3 };
export function crescentMorocco(dateKey) {
  let best = null;
  for (const [la, lo] of MA_SITES) { const r = crescent(dateKey, la, lo); if (r && (!best || RANK[r.grade] > RANK[best.grade] || (r.grade === best.grade && r.lagMin > best.lagMin))) best = r; }
  return best;
}
