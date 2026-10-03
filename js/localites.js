// Localité officielle la plus proche d'une position (liste des Habous : coordonnées et altitude par localité).
import { LOCALITES } from './localites-data.js';

/**
 * Une position à moins de SNAP_KM d'une localité officielle prend l'horaire de cette localité (au plus ~1 min d'écart avec la
 * position exacte). Au-delà (village isolé, étranger), on garde la position exacte ; l'utilisateur peut choisir sa localité à la main.
 */
export const SNAP_KM = 25;

const R = 6371;
const rad = d => d * Math.PI / 180;
export function distanceKm(lat1, lng1, lat2, lng2) {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const toObj = ([code, ar, fr, lat, lng, alt]) => ({ code, ar, fr, lat, lng, alt });

/** Localité officielle la plus proche (n'importe quelle distance), avec la distance en km. */
export function nearestLocality(lat, lng) {
  let best = null, bk = Infinity;
  for (const row of LOCALITES) {
    const km = distanceKm(lat, lng, row[3], row[4]);
    if (km < bk) { bk = km; best = row; }
  }
  return best ? { ...toObj(best), km: bk } : null;
}

export const localityByCode = code => { const r = LOCALITES.find(x => x[0] === code); return r ? toObj(r) : null; };
export const allLocalities = () => LOCALITES.map(toObj);

/** Nom à afficher selon la langue de l'interface. */
export const localityName = (loc, lang) => (lang === 'ar' ? loc.ar : loc.fr);

/**
 * Point de référence du calcul pour le Maroc.
 * code : localité choisie à la main (réglages) → ses coordonnées et son altitude, quelle que soit la position.
 * snap = true : la localité officielle la plus proche si elle est à ≤ SNAP_KM, comme le tableau de la mosquée.
 * snap = false, ou trop loin : position exacte (altitude de la localité proche si elle est à ≤ SNAP_KM, sinon 0).
 */
export function moroccoReference(lat, lng, snap = true, code = null) {
  if (code != null) { const c = localityByCode(Number(code)); if (c) return { lat: c.lat, lng: c.lng, alt: c.alt, locality: c }; }
  const n = nearestLocality(lat, lng);
  if (!n) return { lat, lng, alt: 0, locality: null };
  const near = n.km <= SNAP_KM;
  if (snap && near) return { lat: n.lat, lng: n.lng, alt: n.alt, locality: n };
  return { lat, lng, alt: near ? n.alt : 0, locality: null };
}

const norm = t => String(t || '').normalize('NFD').replace(/[\u064B-\u065F\u0670\u0300-\u036F]/g, '')
  .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase().replace(/[^a-z\u0621-\u064A]/g, '');

/** Le lieu de l'utilisateur porte-t-il déjà le nom de cette localité officielle ? (Rabat ↔ Rabat-Salé, مراكش ↔ Marrakech…) */
export function sameLocalityName(name, loc) {
  const a = norm(name);
  if (!a || !loc) return false;
  return [loc.ar, loc.fr].some(v => { const b = norm(v); return !!b && (a === b || (a.length >= 4 && (b.startsWith(a) || a.startsWith(b)))); });
}
