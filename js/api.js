// Fournisseur d'horaires. Pour changer d'API, écrire un objet avec la même
// interface fetchMonth() et l'activer via setProvider().
//
// fetchMonth renvoie un tableau de jours normalisés :
// { date: 'YYYY-MM-DD', tz: 'Africa/Casablanca', times: { Fajr: <timestamp ms>, ... } }

export const TIME_KEYS = ['Imsak', 'Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Sunset', 'Maghrib', 'Isha', 'Midnight'];

const AlAdhan = {
  id: 'aladhan',
  base: 'https://api.aladhan.com/v1',

  async fetchMonth({ lat, lng, year, month, method, school, signal }) {
    const q = new URLSearchParams({
      latitude: lat.toFixed(6), longitude: lng.toFixed(6),
      method: String(method), school: String(school), iso8601: 'true',
    });
    const res = await fetch(`${this.base}/calendar/${year}/${month}?${q}`, { signal });
    if (!res.ok) throw new Error(`AlAdhan HTTP ${res.status}`);
    const json = await res.json();
    if (json.code !== 200 || !Array.isArray(json.data)) throw new Error('AlAdhan: réponse invalide');
    return json.data.map(d => this.normalize(d));
  },

  normalize(d) {
    const [dd, mm, yyyy] = d.date.gregorian.date.split('-');
    const date = `${yyyy}-${mm}-${dd}`;
    const times = {};
    for (const k of TIME_KEYS) {
      if (d.timings[k]) times[k] = parseTiming(d.timings[k], date);
    }
    return { date, tz: d.meta?.timezone, times };
  },
};

// Accepte "2026-09-24T05:12:00+01:00 (+01)" (iso8601) ou "05:12 (+01)"
function parseTiming(raw, date) {
  const s = String(raw).split(' ')[0];
  if (s.includes('T')) return Date.parse(s);
  const m = String(raw).match(/\(([+-]\d{2})(?::?(\d{2}))?\)/);
  const off = m ? `${m[1]}:${m[2] || '00'}` : 'Z';
  return Date.parse(`${date}T${s}:00${off}`);
}

let provider = AlAdhan;
export const getProvider = () => provider;
export function setProvider(p) { provider = p; }
