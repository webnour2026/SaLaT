// Direction de la Qibla, calculée sur l'ellipsoïde WGS84 (formule inverse de Vincenty),
// plus précise que le calcul sphérique (écart jusqu'à ~0,2°). Mesurée depuis le NORD GÉOGRAPHIQUE.
// Coordonnées du centre de la Kaaba.
export const KAABA = { lat: 21.422487, lng: 39.826206 };

const A = 6378137.0, F = 1 / 298.257223563, B = A * (1 - F);
const rad = d => d * Math.PI / 180;
const deg = r => r * 180 / Math.PI;

/** Géodésique inverse WGS84 : { azimuth (°), distanceKm } du point 1 vers le point 2. */
export function inverse(lat1, lon1, lat2, lon2) {
  const L = rad(lon2 - lon1);
  const U1 = Math.atan((1 - F) * Math.tan(rad(lat1)));
  const U2 = Math.atan((1 - F) * Math.tan(rad(lat2)));
  const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1), sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);
  let λ = L, λp, iter = 0, sinσ, cosσ, σ, sinα, cos2α, cos2σm, sinλ, cosλ;
  do {
    sinλ = Math.sin(λ); cosλ = Math.cos(λ);
    sinσ = Math.hypot(cosU2 * sinλ, cosU1 * sinU2 - sinU1 * cosU2 * cosλ);
    if (sinσ === 0) return { azimuth: 0, distanceKm: 0 };
    cosσ = sinU1 * sinU2 + cosU1 * cosU2 * cosλ;
    σ = Math.atan2(sinσ, cosσ);
    sinα = cosU1 * cosU2 * sinλ / sinσ;
    cos2α = 1 - sinα * sinα;
    cos2σm = cos2α ? cosσ - 2 * sinU1 * sinU2 / cos2α : 0;
    const C = F / 16 * cos2α * (4 + F * (4 - 3 * cos2α));
    λp = λ;
    λ = L + (1 - C) * F * sinα * (σ + C * sinσ * (cos2σm + C * cosσ * (-1 + 2 * cos2σm * cos2σm)));
  } while (Math.abs(λ - λp) > 1e-12 && ++iter < 200);
  if (iter >= 200) return sphericalInverse(lat1, lon1, lat2, lon2); // cas quasi antipodal

  const u2 = cos2α * (A * A - B * B) / (B * B);
  const Ak = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const Bk = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const Δσ = Bk * sinσ * (cos2σm + Bk / 4 * (cosσ * (-1 + 2 * cos2σm * cos2σm) -
    Bk / 6 * cos2σm * (-3 + 4 * sinσ * sinσ) * (-3 + 4 * cos2σm * cos2σm)));
  const s = B * Ak * (σ - Δσ);
  const az = Math.atan2(cosU2 * sinλ, cosU1 * sinU2 - sinU1 * cosU2 * cosλ);
  return { azimuth: (deg(az) + 360) % 360, distanceKm: s / 1000 };
}

function sphericalInverse(lat1, lon1, lat2, lon2) {
  const φ1 = rad(lat1), φ2 = rad(lat2), Δλ = rad(lon2 - lon1);
  const az = Math.atan2(Math.sin(Δλ) * Math.cos(φ2), Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ));
  const a = Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return { azimuth: (deg(az) + 360) % 360, distanceKm: 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a))) };
}

export const qiblaBearing = (lat, lng) => inverse(lat, lng, KAABA.lat, KAABA.lng).azimuth;
export const distanceToKaaba = (lat, lng) => inverse(lat, lng, KAABA.lat, KAABA.lng).distanceKm;
/** Index 0–15 de la rose des vents à 16 directions */
export const cardinalIndex = bearing => Math.round(bearing / 22.5) % 16;
