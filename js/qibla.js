// Direction de la Qibla : cap initial orthodromique (great-circle bearing)
// depuis la position vers la Kaaba, mesuré depuis le NORD GÉOGRAPHIQUE.
export const KAABA = { lat: 21.4225, lng: 39.8262 };
const R = 6371.0088; // rayon terrestre moyen (km)
const rad = d => d * Math.PI / 180;
const deg = r => r * 180 / Math.PI;

export function qiblaBearing(lat, lng) {
  const φ1 = rad(lat), φ2 = rad(KAABA.lat), Δλ = rad(KAABA.lng - lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function distanceToKaaba(lat, lng) {
  const φ1 = rad(lat), φ2 = rad(KAABA.lat);
  const a = Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(rad(KAABA.lng - lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Index 0–15 de la rose des vents à 16 directions */
export const cardinalIndex = bearing => Math.round(bearing / 22.5) % 16;
