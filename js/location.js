// Géolocalisation GPS + recherche manuelle de ville (OpenStreetMap Nominatim).
export const PRESET_CITIES = [
  { name: 'Casablanca', ar: 'الدار البيضاء', lat: 33.5731, lng: -7.5898, country: 'ma' },
  { name: 'Rabat', ar: 'الرباط', lat: 34.0209, lng: -6.8416, country: 'ma' },
  { name: 'Marrakech', ar: 'مراكش', lat: 31.6295, lng: -7.9811, country: 'ma' },
  { name: 'Fès', ar: 'فاس', lat: 34.0181, lng: -5.0078, country: 'ma' },
  { name: 'Tanger', ar: 'طنجة', lat: 35.7595, lng: -5.8340, country: 'ma' },
  { name: 'Meknès', ar: 'مكناس', lat: 33.8935, lng: -5.5473, country: 'ma' },
  { name: 'Agadir', ar: 'أكادير', lat: 30.4278, lng: -9.5981, country: 'ma' },
  { name: 'Oujda', ar: 'وجدة', lat: 34.6814, lng: -1.9086, country: 'ma' },
  { name: 'Kénitra', ar: 'القنيطرة', lat: 34.2610, lng: -6.5802, country: 'ma' },
  { name: 'Tétouan', ar: 'تطوان', lat: 35.5889, lng: -5.3626, country: 'ma' },
  { name: 'El Jadida', ar: 'الجديدة', lat: 33.2316, lng: -8.5007, country: 'ma' },
  { name: 'Safi', ar: 'آسفي', lat: 32.2994, lng: -9.2372, country: 'ma' },
  { name: 'Béni Mellal', ar: 'بني ملال', lat: 32.3373, lng: -6.3498, country: 'ma' },
  { name: 'Nador', ar: 'الناظور', lat: 35.1681, lng: -2.9335, country: 'ma' },
  { name: 'Laâyoune', ar: 'العيون', lat: 27.1253, lng: -13.1625, country: 'ma' },
  { name: 'Dakhla', ar: 'الداخلة', lat: 23.6848, lng: -15.9580, country: 'ma' },
  { name: 'La Mecque', ar: 'مكة المكرمة', lat: 21.4225, lng: 39.8262, country: 'sa' },
  { name: 'Médine', ar: 'المدينة المنورة', lat: 24.4672, lng: 39.6112, country: 'sa' },
  { name: 'Paris', ar: 'باريس', lat: 48.8566, lng: 2.3522, country: 'fr' },
  { name: 'Bruxelles', ar: 'بروكسل', lat: 50.8503, lng: 4.3517, country: 'be' },
];

// Méthode de calcul conseillée par pays (utilisée tant que l'utilisateur n'a pas choisi)
// Méthode proposée d'office selon le pays (code ISO) ; ailleurs : Ligue islamique mondiale (3). L'utilisateur peut toujours la changer.
export const METHOD_BY_COUNTRY = {
  ma: 21,                                                         // Maroc : horaires des Habous
  sa: 4, ye: 4,                                                   // Umm Al-Qura
  eg: 5, sd: 5, ly: 5, sy: 5, lb: 5, ps: 5, iq: 5,                // Autorité égyptienne (usage courant au Machrek et en Libye)
  ae: 16, kw: 9, qa: 10, bh: 8, om: 8,                            // Golfe
  jo: 23,                                                         // Jordanie
  dz: 19, tn: 18, mr: 3,                                          // Maghreb
  tr: 13, az: 13,                                                 // Diyanet
  pk: 1, in: 1, bd: 1, af: 1,                                     // Karachi
  ir: 7,                                                          // Téhéran
  my: 17, id: 20, sg: 11, bn: 17,                                 // Asie du Sud-Est
  ru: 14,                                                         // Russie
  us: 2, ca: 2,                                                   // ISNA
  fr: 12,                                                         // UOIF
  pt: 22,                                                         // Lisbonne
};

export function getGpsPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('unsupported'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      err => reject(err),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

const NOMINATIM = 'https://nominatim.openstreetmap.org';

export async function reverseGeocode(lat, lng, lang) {
  const q = new URLSearchParams({ format: 'jsonv2', lat, lon: lng, zoom: '10', 'accept-language': lang });
  const res = await fetch(`${NOMINATIM}/reverse?${q}`);
  if (!res.ok) throw new Error('geocode');
  const j = await res.json();
  const a = j.address || {};
  return { name: a.city || a.town || a.village || a.municipality || a.county || a.state || '', country: (a.country_code || '').toLowerCase() };
}

export async function searchCity(query, lang, signal) {
  const q = new URLSearchParams({ format: 'jsonv2', q: query, limit: '6', addressdetails: '1', 'accept-language': lang });
  const res = await fetch(`${NOMINATIM}/search?${q}`, { signal });
  if (!res.ok) throw new Error('search');
  const list = await res.json();
  return list.map(r => {
    const a = r.address || {};
    return {
      name: a.city || a.town || a.village || r.name || r.display_name.split(',')[0],
      detail: r.display_name,
      lat: Number(r.lat), lng: Number(r.lon),
      country: (a.country_code || '').toLowerCase(),
    };
  });
}
