// Calendrier hégirien officiel du Maroc (Ministère des Habous et des Affaires islamiques).
// Source : data/habous.json, mis à jour automatiquement par le workflow GitHub « Habous » chaque fois que le
// ministère annonce le début d'un mois. Copie gardée dans localStorage (hors ligne) ; liste intégrée en dernier recours.
import { setHabous } from './hijri.js';

const KEY = 'priere.habous.v1';
const THROTTLE = 3 * 3600e3;          // au plus une vérification toutes les 3 h

// Premiers jours de mois annoncés par le ministère (communiqués officiels)
export const HABOUS_BUILTIN = {
  updated: '2026-09-30',
  months: [
    { y: 1447, m: 8, start: '2026-01-21' }, { y: 1447, m: 9, start: '2026-02-19' }, { y: 1447, m: 10, start: '2026-03-20' },
    { y: 1447, m: 11, start: '2026-04-19' }, { y: 1447, m: 12, start: '2026-05-18' }, { y: 1448, m: 1, start: '2026-06-17' },
    { y: 1448, m: 2, start: '2026-07-16' }, { y: 1448, m: 3, start: '2026-08-14' }, { y: 1448, m: 4, start: '2026-09-13' },
  ],
};

/** Fusionne des tables : la dernière de la liste l'emporte pour un même mois. */
export function mergeTables(...tables) {
  const map = new Map(); let updated = '';
  for (const t of tables) {
    if (!t || !Array.isArray(t.months)) continue;
    if ((t.updated || '') > updated) updated = t.updated;
    for (const x of t.months) if (x && x.start) map.set(`${x.y}-${x.m}`, x);
  }
  return { updated, months: [...map.values()] };
}

const readCache = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };

/** Démarrage : liste intégrée + copie locale (immédiat, sans réseau). */
export function initHabous() { setHabous(mergeTables(HABOUS_BUILTIN, readCache())); }

/** Récupère data/habous.json. Renvoie true si la liste a changé. */
let busy = false;
export async function refreshHabous({ force = false, every = THROTTLE } = {}) {
  if (busy) return false;
  try {
    const at = Number(localStorage.getItem(KEY + '.at') || 0);
    if (!force && Date.now() - at < every) return false;
    busy = true;
    localStorage.setItem(KEY + '.at', String(Date.now()));      // même une tentative ratée patiente avant de recommencer
    const res = await fetch('data/habous.json', { cache: 'no-cache' });
    if (!res.ok) return false;
    const fresh = await res.json();
    if (!fresh || !Array.isArray(fresh.months) || !fresh.months.length) return false;
    const before = JSON.stringify(mergeTables(HABOUS_BUILTIN, readCache()));
    const merged = mergeTables(HABOUS_BUILTIN, readCache(), fresh);
    localStorage.setItem(KEY, JSON.stringify(merged));
    setHabous(merged);
    return JSON.stringify(merged) !== before;
  } catch { return false; } finally { busy = false; }
}
