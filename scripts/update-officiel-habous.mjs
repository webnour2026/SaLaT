// Complète data/officiel/<code>.json pour les localités ABSENTES du widget fm6oa.org (28 sur 191 : Sahara, petits centres),
// à partir du tableau mensuel publié par le site du ministère des Habous (« mawaqit-shahria?ville=<numéro> »).
// Mêmes garde-fous que update-officiel.mjs : robots.txt vérifié, chaque ligne contrôlée contre notre calcul (≤ 2 min),
// rien n'est écrit si trop de localités échouent. Si le site disparaît ou change, le travail échoue sans rien abîmer.
// Variables : HABOUS_BASE (adresse du site), DRY_RUN=1, FORCE=1, ONLY="305 319", DELAY_MS (2500 par défaut).
import fs from 'node:fs';
import { robotsAllows, parseHabousMonthly, habousSelected, analyse, mergeFile } from './officiel-lib.mjs';
import { allLocalities } from '../js/localites.js';

const env = (k, d = '') => process.env[k] ?? d;
const BASE = env('HABOUS_BASE', 'https://habous.synerticlab.com').replace(/\/$/, ''), PAGE = '/mawaqit-shahria';
const UA = 'SaLaTi-verification/1.0 (appli de prière ; github.com/webnour2026/SaLaT)';
const DRY = /^(1|true|oui)$/i.test(env('DRY_RUN')), FORCE = /^(1|true|oui)$/i.test(env('FORCE'));
const ONLY = env('ONLY').split(/[\s,]+/).filter(Boolean).map(Number), DELAY = Number(env('DELAY_MS', '2500'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lines = [];
const say = (s = '') => { console.log(s); lines.push(s); };
const summary = () => { if (env('GITHUB_STEP_SUMMARY')) fs.appendFileSync(env('GITHUB_STEP_SUMMARY'), lines.join('\n') + '\n'); };

async function get(path) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(BASE + path, { headers: { 'User-Agent': UA, 'Accept-Language': 'ar' }, signal: AbortSignal.timeout(30000) });
      if (res.ok || res.status === 404) return { status: res.status, body: res.ok ? await res.text() : '' };
      if (res.status === 403 || res.status === 429) throw new Error(`HTTP ${res.status} : le site refuse les requêtes automatiques`);
    } catch (e) { if (/refuse/.test(String(e.message)) || i === 2) throw e; }
    await sleep(3000 * (i + 1));
  }
  throw new Error('page inaccessible');
}
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const file = code => `data/officiel/${code}.json`;

async function fetchLocality(code) {
  const { status, body } = await get(`${PAGE}?ville=${code}`);
  if (status !== 200) return { ok: false, why: `HTTP ${status}` };
  if (habousSelected(body) !== code) return { ok: false, why: `la page affiche une autre ville (${habousSelected(body)})` };
  const rows = parseHabousMonthly(body);
  if (!rows.length) return { ok: false, why: 'aucun tableau lisible (la mise en page a peut-être changé)' };
  const a = analyse(code, rows);
  return a.ok ? { ok: true, ...a } : { ok: false, why: `lignes incohérentes avec le calcul : ${a.rejects.slice(0, 3).join(' ; ')}` };
}

const robots = await get('/robots.txt').catch(e => ({ status: 0, why: e.message }));
if (robots.status !== 200) { console.log(`Site des Habous injoignable (${robots.why || 'HTTP ' + robots.status}) : rien à faire.`); process.exit(0); }
if (!robotsAllows(robots.body, PAGE)) { console.log('robots.txt du site des Habous interdit ce chemin : aucune page lue.'); process.exit(0); }

const covered = new Set(readJson('data/fm6oa-villes.json').villes.map(v => v[1]));
let todo = allLocalities().filter(l => !covered.has(l.code)).map(l => ({ code: l.code, name: l.fr }));
if (ONLY.length) todo = todo.filter(l => ONLY.includes(l.code));
fs.mkdirSync('data/officiel', { recursive: true });

if (!FORCE && !ONLY.length && todo.length) {                     // une seule page si rien de nouveau (début de mois)
  const s = await fetchLocality(todo[0].code).catch(e => ({ ok: false, why: e.message }));
  if (!s.ok) { console.log(`Page de contrôle (${todo[0].name}) illisible : ${s.why}. Rien n'est écrit.`); process.exit(0); }
  if (!mergeFile(readJson(file(todo[0].code)), todo[0].code, s.days).changed) { console.log(`Rien de nouveau (${todo[0].name} est déjà à jour).`); process.exit(0); }
}

const results = [], failed = [];
for (const l of todo) {
  try { const r = await fetchLocality(l.code); (r.ok ? results : failed).push({ ...l, ...r }); }
  catch (e) { failed.push({ ...l, why: e.message }); if (/refuse/.test(e.message)) break; }
  await sleep(DELAY);
}
say(`## Horaires officiels (site des Habous) — ${new Date().toISOString().slice(0, 16)} UTC${DRY ? ' (essai : rien n\'est écrit)' : ''}`);
say(`Localités absentes de fm6oa.org, lues : ${results.length}/${todo.length}${failed.length ? ` · échecs : ${failed.length}` : ''}`);
say(''); say('| Localité | Jours | Identiques au calcul | Écart max |'); say('|---|---|---|---|');
for (const r of results) say(`| ${r.name} (${r.code}) | ${Object.keys(r.days).length} | ${r.stats.pct} % | ${r.stats.max} min |`);
if (failed.length) { say(''); say('**Échecs :**'); for (const f of failed) say(`- ${f.name} (${f.code}) : ${f.why}`); }
if (failed.length > Math.max(3, Math.round(todo.length * 0.15))) { say(''); say('**Trop d\'échecs : aucune donnée écrite.**'); summary(); process.exit(0); }
let changed = 0;
if (!DRY) for (const r of results) {
  const m = mergeFile(readJson(file(r.code)), r.code, r.days);
  if (m.changed) { fs.writeFileSync(file(r.code), JSON.stringify(m.file) + '\n'); changed++; }
}
say(''); say(DRY ? 'Essai terminé : aucun fichier modifié.' : `Fichiers mis à jour : ${changed}`);
summary();
