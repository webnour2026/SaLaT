// Met à jour data/officiel/<code>.json à partir des tableaux officiels du widget fm6oa.org (voir officiel-lib.mjs).
// Variables : DRY_RUN=1 (rien n'est écrit), FORCE=1 (ignore le test « rien de nouveau »), ONLY="1 40 78" (numéros de NOTRE liste),
//             LIMIT=n (premières localités seulement), DELAY_MS (pause entre deux pages, 2500 par défaut).
import fs from 'node:fs';
import { robotsAllows, parsePage, analyse, mergeFile } from './officiel-lib.mjs';

const BASE = 'https://fm6oa.org', PAGE = '/prieres/code/index-fr.php?ville=';
const UA = 'SaLaTi-verification/1.0 (appli de prière ; github.com/webnour2026/SaLaT)';
const env = (k, d = '') => process.env[k] ?? d;
const DRY = /^(1|true|oui)$/i.test(env('DRY_RUN')), FORCE = /^(1|true|oui)$/i.test(env('FORCE'));
const ONLY = env('ONLY').split(/[\s,]+/).filter(Boolean).map(Number), LIMIT = Number(env('LIMIT', '0')), DELAY = Number(env('DELAY_MS', '2500'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lines = [];
const say = (s = '') => { console.log(s); lines.push(s); };

async function get(path) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(BASE + path, { headers: { 'User-Agent': UA, 'Accept-Language': 'fr' }, signal: AbortSignal.timeout(30000) });
      if (res.status === 404) return { status: 404, body: '' };
      if (res.ok) return { status: res.status, body: await res.text() };
      if (res.status === 403 || res.status === 429) throw new Error(`HTTP ${res.status} : le site refuse les requêtes automatiques`);
    } catch (e) { if (/refuse/.test(String(e.message)) || i === 2) throw e; }
    await sleep(3000 * (i + 1));
  }
  throw new Error('page inaccessible');
}

const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const file = code => `data/officiel/${code}.json`;

async function fetchLocality(fm, code) {
  const { status, body } = await get(PAGE + fm);
  if (status !== 200) return { ok: false, why: `HTTP ${status}` };
  const rows = parsePage(body);
  if (!rows.length) return { ok: false, why: 'aucune table lisible (la mise en page a peut-être changé)' };
  const a = analyse(code, rows);
  return a.ok ? { ok: true, ...a, rows: rows.length } : { ok: false, why: `lignes incohérentes avec le calcul : ${a.rejects.slice(0, 3).join(' ; ')}`, ...a };
}

const robots = await get('/robots.txt').catch(e => { console.error('robots.txt inaccessible :', e.message); process.exit(1); });
if (robots.status === 200 && !robotsAllows(robots.body, PAGE)) { console.error('robots.txt de fm6oa.org interdit ce chemin : arrêt (aucune page lue).'); process.exit(2); }

const map = readJson('data/fm6oa-villes.json').villes;               // [codeVille fm6oa, notre code, nom]
const sentinel = map.find(v => v[1] === 1);
fs.mkdirSync('data/officiel', { recursive: true });

if (!FORCE && !ONLY.length) {
  const s = await fetchLocality(sentinel[0], sentinel[1]).catch(e => ({ ok: false, why: e.message }));
  if (!s.ok) { console.error('Échec de la page de contrôle (Rabat-Salé) :', s.why); process.exit(1); }
  if (!mergeFile(readJson(file(1)), 1, s.days).changed) { console.log('Rien de nouveau (la page de Rabat-Salé est déjà à jour).'); process.exit(0); }
  say('Nouveaux jours détectés sur la page de contrôle : mise à jour de toutes les localités.');
}

let todo = map.filter(v => !ONLY.length || ONLY.includes(v[1]));
if (LIMIT) todo = todo.slice(0, LIMIT);
const results = [], failed = [];
for (const [fm, code, name] of todo) {
  try {
    const r = await fetchLocality(fm, code);
    if (r.ok) results.push({ fm, code, name, ...r }); else failed.push({ fm, code, name, why: r.why });
  } catch (e) { failed.push({ fm, code, name, why: e.message }); if (/refuse/.test(e.message)) break; }
  await sleep(DELAY);
}

say(`## Horaires officiels — ${new Date().toISOString().slice(0, 16)} UTC${DRY ? ' (essai : rien n\'est écrit)' : ''}`);
say(`Localités lues : ${results.length}/${todo.length}${failed.length ? ` · échecs : ${failed.length}` : ''}`);
say('');
say('| Localité | Jours | Identiques au calcul | Écart max | Écart moyen |');
say('|---|---|---|---|---|');
for (const r of results) say(`| ${r.name} (${r.code}) | ${Object.keys(r.days).length} | ${r.stats.pct} % | ${r.stats.max} min | ${r.stats.moy} |`);
if (failed.length) { say(''); say('**Échecs :**'); for (const f of failed) say(`- ${f.name} (${f.code}) : ${f.why}`); }
const suspects = results.filter(r => r.stats.moy > 0.9);
if (suspects.length) { say(''); say(`**À examiner (écart moyen > 0,9 min) :** ${suspects.map(r => r.name).join(', ')}`); }

// Garde-fou : trop d'échecs = la page a changé ou le site nous bloque → on n'écrit rien.
if (failed.length > Math.max(3, Math.round(todo.length * 0.15))) {
  say(''); say('**Trop d\'échecs : aucune donnée écrite.**');
  if (env('GITHUB_STEP_SUMMARY')) fs.appendFileSync(env('GITHUB_STEP_SUMMARY'), lines.join('\n') + '\n');
  process.exit(1);
}
let changed = 0;
if (!DRY) for (const r of results) {
  const m = mergeFile(readJson(file(r.code)), r.code, r.days);
  if (m.changed) { fs.writeFileSync(file(r.code), JSON.stringify(m.file) + '\n'); changed++; }
}
say(''); say(DRY ? 'Essai terminé : aucun fichier modifié.' : `Fichiers mis à jour : ${changed}`);
if (env('GITHUB_STEP_SUMMARY')) fs.appendFileSync(env('GITHUB_STEP_SUMMARY'), lines.join('\n') + '\n');
