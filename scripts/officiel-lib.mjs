// Lecture des tableaux officiels de prière publiés par le widget de la Fondation Mohammed VI des Ouléma Africains
// (https://fm6oa.org/prieres/…) : analyse de la page, contrôle contre notre calcul, fusion dans data/officiel/<code>.json.
// Aucune décision « à l'aveugle » : une ligne qui s'écarte de plus de 2 minutes du calcul est refusée, et une localité
// dont plusieurs lignes sont refusées n'est pas écrite du tout.
import { computeDay } from '../js/prayer-calc.js';
import { localityByCode } from '../js/localites.js';

export const KEYS = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
export const TOL_ROW = 2;        // minutes d'écart maximal accepté entre une ligne du tableau et notre calcul
export const MAX_ROW_REJECTS = 2;
const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
/** « Oct », « Juil », « Févr. », « juin »… → numéro du mois (1-12), ou 0 si le mot est ambigu ou inconnu. */
const monthOf = tok => { const t = plain(tok).replace(/[^a-z]/g, ''); if (t.length < 3) return 0; const hit = MOIS.map((n, i) => (n.startsWith(t) ? i + 1 : 0)).filter(Boolean); return hit.length === 1 ? hit[0] : 0; };

const plain = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const decode = s => s.replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const text = h => decode(h.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const ymd = ms => new Date(ms).toISOString().slice(0, 10);
const utc = key => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d); };

/** robots.txt : le chemin est-il permis pour tous les robots (« User-agent: * ») ? */
export function robotsAllows(txt, path) {
  let applies = false, blocked = false, allowed = false, best = -1, verdict = true;
  for (const raw of String(txt || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { applies = v === '*'; continue; }
    if (!applies) continue;
    if ((k === 'disallow' || k === 'allow') && v && path.startsWith(v) && v.length > best) { best = v.length; verdict = k === 'allow'; }
  }
  return verdict;
}

/** Lignes d'un tableau : [{ date: 'AAAA-MM-JJ', t: [minutes × 6] }] dans l'ordre Fajr, Chourouq, Dhuhr, Asr, Maghrib, Isha. */
export function parsePage(html, now = Date.now()) {
  const found = [];
  for (const chunk of String(html).split(/<tr[\s>]/i).slice(1)) {
    const cells = [...chunk.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => text(m[1]));
    if (cells.length < 9) continue;
    const tail = cells.slice(-6);
    if (!tail.every(c => /^\d{1,2}:\d{2}$/.test(c))) continue;
    let day = 0, month = 0;
    for (const c of cells.slice(0, -6)) { const m = plain(c).match(/(\d{1,2})\s+([a-z]{3,})/); if (m && monthOf(m[2])) { day = +m[1]; month = monthOf(m[2]); } }
    if (!day) continue;
    found.push({ day, month, t: tail.map(c => { const [h, mi] = c.split(':').map(Number); return h * 60 + mi; }) });
  }
  const y0 = new Date(now).getUTCFullYear(), rows = [];
  for (const r of found) {
    let best = null;
    for (const y of [y0 - 1, y0, y0 + 1]) { const ms = Date.UTC(y, r.month - 1, r.day); if (new Date(ms).getUTCDate() !== r.day) continue; if (best === null || Math.abs(ms - now) < Math.abs(best - now)) best = ms; }
    if (best !== null) rows.push({ date: ymd(best), t: r.t });
  }
  // jours consécutifs uniquement : on garde les suites de 20 jours ou plus
  const runs = []; let cur = [];
  for (const r of rows) { if (cur.length && utc(r.date) - utc(cur[cur.length - 1].date) !== 864e5) { runs.push(cur); cur = []; } cur.push(r); }
  if (cur.length) runs.push(cur);
  return runs.filter(r => r.length >= 20).flat();
}

const hhmm = min => String(Math.floor(min / 60)).padStart(2, '0') + String(min % 60).padStart(2, '0');

/**
 * Compare chaque ligne à notre calcul (même localité), détecte le fuseau de la page (GMT ou GMT+1, ligne par ligne)
 * et renvoie les heures en UTC « HHMM ».
 */
export function analyse(code, rows) {
  const loc = localityByCode(code);
  const days = {}, rejects = [];
  let n = 0, ident = 0, sum = 0, max = 0;
  for (const r of rows) {
    const model = computeDay({ lat: loc.lat, lng: loc.lng, code }, r.date, 21, 0), base = utc(r.date);
    const m = KEYS.map(k => Math.round((model[k] - base) / 60000));
    const d = r.t.map((v, i) => v - m[i]), s = [...d].sort((a, b) => a - b), med = (s[2] + s[3]) / 2;
    const off = Math.round(med / 60) * 60;
    const resid = d.map(x => x - off);
    const ordered = r.t.every((v, i) => i === 0 || v > r.t[i - 1]);
    if (![0, 60].includes(off) || resid.some(x => Math.abs(x) > TOL_ROW) || !ordered) { rejects.push(`${r.date} (écart ${d.join('/')})`); continue; }
    days[r.date] = r.t.map(v => hhmm(v - off)).join(' ');
    for (const x of resid) { n++; if (!x) ident++; sum += Math.abs(x); max = Math.max(max, Math.abs(x)); }
  }
  const ok = rows.length >= 20 && rejects.length <= MAX_ROW_REJECTS;
  return { ok, days: ok ? days : {}, rejects, stats: { n, ident, pct: n ? Math.round(1000 * ident / n) / 10 : 0, max, moy: n ? Math.round(100 * sum / n) / 100 : 0 } };
}

/** Fusionne les jours reçus dans le fichier existant ; garde une année glissante (de J−400 à J+45). Renvoie { file, changed }. */
export function mergeFile(existing, code, days, now = Date.now()) {
  const j = { ...(existing?.j || {}), ...days };
  const lo = ymd(now - 400 * 864e5), hi = ymd(now + 45 * 864e5);
  const kept = Object.fromEntries(Object.entries(j).filter(([k]) => k >= lo && k <= hi).sort(([a], [b]) => (a < b ? -1 : 1)));
  const changed = JSON.stringify(kept) !== JSON.stringify(existing?.j || {});
  return { file: { v: 1, code, maj: changed ? ymd(now) : (existing?.maj || ymd(now)), j: kept }, changed };
}
