// Position du soleil (algorithme NOAA, précision ~0,01° pour 1900–2100).
// Sert à vérifier la Qibla SANS boussole : le soleil n'est pas perturbé par le métal.
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;

/** { azimuth (° depuis le nord géographique, sens horaire), elevation (°) } */
export function sunPosition(ts, lat, lng) {
  const jd = ts / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(rad(M)) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * T) + Math.sin(rad(3 * M)) * 0.000289;
  const trueLong = L0 + C;
  const Ω = 125.04 - 1934.136 * T;
  const λ = trueLong - 0.00569 - 0.00478 * Math.sin(rad(Ω));
  const ε0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const ε = ε0 + 0.00256 * Math.cos(rad(Ω));
  const decl = deg(Math.asin(Math.sin(rad(ε)) * Math.sin(rad(λ))));
  const y = Math.tan(rad(ε / 2)) ** 2;
  const eqTime = 4 * deg(y * Math.sin(2 * rad(L0)) - 2 * e * Math.sin(rad(M)) +
    4 * e * y * Math.sin(rad(M)) * Math.cos(2 * rad(L0)) - 0.5 * y * y * Math.sin(4 * rad(L0)) -
    1.25 * e * e * Math.sin(2 * rad(M))); // minutes

  const minutesUTC = ((ts % 86400000) + 86400000) % 86400000 / 60000;
  let tst = (minutesUTC + eqTime + 4 * lng) % 1440;
  if (tst < 0) tst += 1440;
  let ha = tst / 4 - 180; // angle horaire
  if (ha < -180) ha += 360;

  const φ = rad(lat), δ = rad(decl), H = rad(ha);
  const cosZ = Math.sin(φ) * Math.sin(δ) + Math.cos(φ) * Math.cos(δ) * Math.cos(H);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZ)));
  let elevation = 90 - deg(zen);
  // réfraction atmosphérique
  if (elevation > -0.575) {
    const te = Math.tan(rad(elevation));
    const refr = elevation > 85 ? 0 : elevation > 5 ? 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5
      : 1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)));
    elevation += refr / 3600;
  }
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(φ) - Math.tan(δ) * Math.cos(φ));
  return { azimuth: (deg(az) + 180 + 360) % 360, elevation };
}

/**
 * Instants de la journée où le soleil (hauteur > minElev) est exactement à l'azimut `target`.
 * dayStart/dayEnd en timestamps ms. Renvoie un tableau de timestamps.
 */
export function timesAtAzimuth(target, lat, lng, dayStart, dayEnd, minElev = 3) {
  const diff = ts => ((sunPosition(ts, lat, lng).azimuth - target + 540) % 360) - 180;
  const out = [];
  const step = 5 * 60000;
  let t0 = dayStart, d0 = diff(t0);
  for (let t1 = dayStart + step; t1 <= dayEnd; t1 += step) {
    const d1 = diff(t1);
    if (Math.sign(d0) !== Math.sign(d1) && Math.abs(d0 - d1) < 180) {
      let lo = t0, hi = t1, dlo = d0;
      for (let i = 0; i < 30; i++) {           // dichotomie à la seconde
        const mid = (lo + hi) / 2, dm = diff(mid);
        if (Math.sign(dm) === Math.sign(dlo)) { lo = mid; dlo = dm; } else hi = mid;
      }
      const t = Math.round((lo + hi) / 2);
      if (sunPosition(t, lat, lng).elevation > minElev) out.push(t);
    }
    t0 = t1; d0 = d1;
  }
  return out;
}
