// Horaires officiels du ministère, copiés par le workflow « Officiel » dans data/officiel/<code>.json (un fichier par localité).
// L'appli les préfère au calcul quand ils existent ; en cas de doute, elle garde le calcul :
//   · un jour dont une heure s'écarte de plus de 3 minutes du calcul est ignoré (fichier abîmé) ;
//   · rien n'est utilisé hors Maroc ni pour une localité sans fichier.
const KEY = 'priere.officiel.';
const TOL_MIN = 3;
const HHMM = /^\d{4}( \d{4}){5}$/;
export const OFFICIEL_KEYS = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

export function readOfficiel(code) {
  try { return JSON.parse(localStorage.getItem(KEY + code) || 'null'); } catch { return null; }
}

/** Heures officielles (timestamps ms) d'un jour pour une localité, ou null si absentes / douteuses. `model` = calcul du même jour. */
export function officialDay(code, dateKey, model) {
  const v = readOfficiel(code)?.j?.[dateKey];
  if (!v || !HHMM.test(v) || !model) return null;
  const [y, m, d] = dateKey.split('-').map(Number), base = Date.UTC(y, m - 1, d), out = {};
  v.split(' ').forEach((p, i) => { out[OFFICIEL_KEYS[i]] = base + (Number(p.slice(0, 2)) * 60 + Number(p.slice(2))) * 60000; });
  for (const k of OFFICIEL_KEYS) if (!(Math.abs(out[k] - model[k]) <= TOL_MIN * 60000)) return null;
  return out;
}

const valid = f => f && f.v === 1 && f.j && typeof f.j === 'object'
  && Object.entries(f.j).every(([k, v]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && HHMM.test(v));

/** Garde la localité courante et les 3 consultées le plus récemment : un fichier fait ~13 Ko, le stockage du navigateur est limité. */
function prune(current) {
  try {
    const codes = Object.keys(localStorage).filter(k => k.startsWith(KEY) && !k.endsWith('.at')).map(k => k.slice(KEY.length));
    const at = c => Number(localStorage.getItem(KEY + c + '.at') || 0);
    codes.filter(c => String(c) !== String(current)).sort((a, b) => at(b) - at(a)).slice(3)
      .forEach(c => { localStorage.removeItem(KEY + c); localStorage.removeItem(KEY + c + '.at'); });
  } catch { /* stockage indisponible : sans conséquence */ }
}

let busy = false;
/** Télécharge data/officiel/<code>.json (au plus toutes les 6 h). Renvoie true si le contenu a changé. */
export async function refreshOfficiel(code, { force = false, every = 6 * 3600e3 } = {}) {
  if (busy || !code) return false;
  try {
    const at = Number(localStorage.getItem(KEY + code + '.at') || 0);
    if (!force && Date.now() - at < every) return false;
    busy = true;
    localStorage.setItem(KEY + code + '.at', String(Date.now()));      // même une tentative ratée patiente avant de recommencer
    const res = await fetch(`data/officiel/${code}.json`, { cache: 'no-cache' });
    if (!res.ok) return false;
    const fresh = await res.json();
    if (!valid(fresh)) return false;
    const before = localStorage.getItem(KEY + code);
    const next = JSON.stringify(fresh);
    if (before === next) return false;
    localStorage.setItem(KEY + code, next);
    prune(code);
    return true;
  } catch { return false; } finally { busy = false; }
}
