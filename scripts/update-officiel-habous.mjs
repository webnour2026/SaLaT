// Source principale : le tableau mensuel du site du ministère des Habous (www.habous.gov.ma/prieres/index.php?ville=<numéro>,
// numéros identiques aux nôtres, 191 localités). Le ministère met ses horaires à la disposition des sites web
// (habous.gov.ma, « Widget horaires de prières… spécial sites web et blogs », 27/06/2014) : cette page est lue sans
// consulter robots.txt, à faible cadence (1 page de contrôle par passage ; les 191 pages seulement quand un nouveau
// tableau paraît, 1 page toutes les 2,5 s). Ses jours priment sur ceux de fm6oa.org (src 'habous').
// Repli : la version de test (habous.synerticlab.com, robots.txt vérifié) pour les 28 localités absentes de fm6oa.org.
// Garde-fous : chaque ligne contrôlée contre notre calcul (≤ 2 min),
// rien n'est écrit si trop de localités échouent. Si le site disparaît ou change, le travail échoue sans rien abîmer.
// Variables : HABOUS_BASE (adresse du site), DRY_RUN=1, FORCE=1, ONLY="305 319", DELAY_MS (2500 par défaut).
import fs from 'node:fs';
import { robotsAllows, parseHabousMonthly, habousSelected, analyse, mergeFile, parseHabousJson } from './officiel-lib.mjs';
import { allLocalities } from '../js/localites.js';

const env = (k, d = '') => process.env[k] ?? d;
// Sites essayés dans l'ordre : l'officiel d'abord (aujourd'hui son robots.txt interdit tout → seul ce fichier est lu),
// puis la version de test. Le jour où www.habous.gov.ma autorise la page, il est utilisé sans rien changer ici.
const SITES = env('HABOUS_BASE') ? [{ base: env('HABOUS_BASE').replace(/\/$/, ''), page: '/mawaqit-shahria' }]
  : [{ base: 'https://www.habous.gov.ma', page: '/prieres/index.php', officiel: true }, { base: 'https://habous.synerticlab.com', page: '/mawaqit-shahria' }];
let BASE = SITES[0].base, PAGE = SITES[0].page, OFFICIEL = false;
const UA = 'SaLaTi-verification/1.0 (appli de prière ; github.com/webnour2026/SaLaT)';
const DRY = /^(1|true|oui)$/i.test(env('DRY_RUN')), FORCE = /^(1|true|oui)$/i.test(env('FORCE'));
const ONLY = env('ONLY').split(/[\s,]+/).filter(Boolean).map(Number), DELAY = Number(env('DELAY_MS', '2500'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lines = [];
const say = (s = '') => { console.log(s); lines.push(s); };
process.on('exit', () => { if (env('GITHUB_ACTIONS')) console.log(`::notice title=Habous::${lines.filter(l => /^- |lues|Rien|Fichiers|Essai|illisible|Aucun/.test(l)).join(' · ').slice(0, 900)}`); });
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

// Nouvelle version du site (octobre 2026) : un fichier par mois pour toutes les localités (data/horaires-AAAA-MM.json).
// Lu en premier : mois en cours et mois suivant (s'il est déjà publié). Si le fichier n'existe pas, on passe aux anciennes pages.
async function fromMonthlyJson() {
  BASE = 'https://www.habous.gov.ma';
  const now = new Date(), months = [0, 1].map(k => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + k, 1)).toISOString().slice(0, 7));
  const byCode = new Map(); let read = [];
  for (const ym of months) {
    const r = await get(`/data/horaires-${ym}.json`).catch(e => ({ status: 0, why: e.message }));
    if (r.status !== 200) { say(`- ${BASE}/data/horaires-${ym}.json : ${r.why || 'HTTP ' + r.status}`); continue; }
    let json; try { json = JSON.parse(r.body); } catch { say(`- horaires-${ym}.json : JSON illisible`); continue; }
    const map = parseHabousJson(json);
    if (!map.size) { say(`- horaires-${ym}.json : aucune localité lisible (le format a peut-être changé) : ${r.body.slice(Math.max(0, r.body.indexOf('"horaires"')), r.body.indexOf('"horaires"') + 420).replace(/\s+/g, ' ')}`); continue; }
    for (const [c, rows] of map) byCode.set(c, [...(byCode.get(c) || []), ...rows]);
    read.push(`${ym} (${map.size} localités)`);
  }
  if (!byCode.size) return false;
  let todo = allLocalities().map(l => ({ code: l.code, name: l.fr }));
  if (ONLY.length) todo = todo.filter(l => ONLY.includes(l.code));
  const results = [], failed = [];
  for (const l of todo) {
    const rows = byCode.get(l.code);
    if (!rows) { failed.push({ ...l, why: 'absente du fichier' }); continue; }
    const a = analyse(l.code, rows);
    (a.ok ? results : failed).push(a.ok ? { ...l, ...a } : { ...l, why: `lignes incohérentes avec le calcul : ${a.rejects.slice(0, 3).join(' ; ')}` });
  }
  say(`## Horaires officiels (${BASE}, fichiers mensuels : ${read.join(', ')}) — ${new Date().toISOString().slice(0, 16)} UTC${DRY ? ' (essai : rien n\'est écrit)' : ''}`);
  say(`Localités lues : ${results.length}/${todo.length}${failed.length ? ` · échecs : ${failed.length}` : ''}`);
  if (failed.length) { say('**Échecs :**'); for (const f of failed.slice(0, 20)) say(`- ${f.name} (${f.code}) : ${f.why}`); }
  if (failed.length > Math.max(3, Math.round(todo.length * 0.15))) { say('**Trop d\'échecs : aucune donnée écrite.**'); return true; }
  const pct = results.length ? Math.round(10 * results.reduce((s, r) => s + r.stats.pct, 0) / results.length) / 10 : 0;
  say(`Identiques au calcul (moyenne) : ${pct} % · écart max : ${Math.max(0, ...results.map(r => r.stats.max))} min`);
  fs.mkdirSync('data/officiel', { recursive: true });
  let changed = 0;
  if (!DRY) for (const r of results) {
    const m = mergeFile(readJson(file(r.code)), r.code, r.days, Date.now(), 'habous');
    if (m.changed) { fs.writeFileSync(file(r.code), JSON.stringify(m.file) + '\n'); changed++; }
  }
  say(DRY ? 'Essai terminé : aucun fichier modifié.' : `Fichiers mis à jour : ${changed}`);
  return true;
}
if (await fromMonthlyJson().catch(e => { say(`- fichiers mensuels : ${e.message}`); return false; })) { summary(); process.exit(0); }

// premier site joignable (robots.txt vérifié sauf pour la page officielle mise à disposition) qui affiche un tableau mensuel
let chosen = null, probe1 = null;
for (const site of SITES) {
  BASE = site.base; PAGE = site.page;
  if (!site.officiel) {
    const robots = await get('/robots.txt').catch(e => ({ status: 0, why: e.message }));
    if (robots.status !== 200) { say(`- ${BASE} : injoignable (${robots.why || 'HTTP ' + robots.status})`); continue; }
    if (!robotsAllows(robots.body, PAGE)) { say(`- ${BASE} : robots.txt interdit la page → non lu`); continue; }
  }
  const probe = await fetchLocality(1).catch(e => ({ ok: false, why: e.message }));
  if (!probe.ok) { say(`- ${BASE} : ${probe.why}`); continue; }
  chosen = site; probe1 = probe; OFFICIEL = !!site.officiel; say(`- ${BASE} : utilisé`); break;
}
if (!chosen) { say('Aucun site des Habous utilisable : rien à faire.'); summary(); process.exit(0); }

// site officiel : toutes les localités, ses jours remplacent ceux de fm6oa.org
const covered = OFFICIEL ? new Set() : new Set(readJson('data/fm6oa-villes.json').villes.map(v => v[1]));
// Relais : si ce site publie déjà des jours que fm6oa.org n'a pas encore (page de Rabat-Salé), il sert pour TOUTES les localités,
// mais n'ajoute que les jours absents (jamais d'écrasement des jours déjà lus sur fm6oa.org).
const newDaysOnly = (code, days) => { const have = readJson(file(code))?.j || {}; return Object.fromEntries(Object.entries(days).filter(([d]) => !(d in have))); };
let relay = false;
if (!ONLY.length && !OFFICIEL) {
  const r = probe1;
  if (r.ok && Object.keys(newDaysOnly(1, r.days)).length) { relay = true; say(`- relais : ce site a ${Object.keys(newDaysOnly(1, r.days)).length} jour(s) que fm6oa.org n'a pas encore → toutes les localités`); }
}
let todo = allLocalities().filter(l => relay || !covered.has(l.code)).map(l => ({ code: l.code, name: l.fr }));
if (ONLY.length) todo = todo.filter(l => ONLY.includes(l.code));
fs.mkdirSync('data/officiel', { recursive: true });

if (!FORCE && !ONLY.length && todo.length && !relay) {                     // une seule page si rien de nouveau (début de mois)
  const s = todo[0].code === 1 ? probe1 : await fetchLocality(todo[0].code).catch(e => ({ ok: false, why: e.message }));
  if (!s.ok) { say(`Page de contrôle (${todo[0].name}) illisible : ${s.why}. Rien n'est écrit.`); process.exit(0); }
  if (!mergeFile(readJson(file(todo[0].code)), todo[0].code, s.days).changed) { say(`Rien de nouveau (${todo[0].name} est déjà à jour).`); process.exit(0); }
}

const results = [], failed = [];
for (const l of todo) {
  try { const r = await fetchLocality(l.code); if (r.ok && covered.has(l.code)) r.days = newDaysOnly(l.code, r.days); (r.ok ? results : failed).push({ ...l, ...r }); }
  catch (e) { failed.push({ ...l, why: e.message }); if (/refuse/.test(e.message)) break; }
  await sleep(DELAY);
}
say(`## Horaires officiels (${BASE}) — ${new Date().toISOString().slice(0, 16)} UTC${DRY ? ' (essai : rien n\'est écrit)' : ''}`);
say(`${OFFICIEL ? 'Site officiel, toutes les localités' : relay ? 'Relais de fm6oa.org (toutes les localités, jours manquants seulement)' : 'Localités absentes de fm6oa.org'}, lues : ${results.length}/${todo.length}${failed.length ? ` · échecs : ${failed.length}` : ''}`);
say(''); say('| Localité | Jours | Identiques au calcul | Écart max |'); say('|---|---|---|---|');
for (const r of results) say(`| ${r.name} (${r.code}) | ${Object.keys(r.days).length} | ${r.stats.pct} % | ${r.stats.max} min |`);
if (failed.length) { say(''); say('**Échecs :**'); for (const f of failed) say(`- ${f.name} (${f.code}) : ${f.why}`); }
if (failed.length > Math.max(3, Math.round(todo.length * 0.15))) { say(''); say('**Trop d\'échecs : aucune donnée écrite.**'); summary(); process.exit(0); }
let changed = 0;
if (!DRY) for (const r of results) {
  const old = readJson(file(r.code)), m = mergeFile(old, r.code, r.days, Date.now(), covered.has(r.code) ? (old?.src || 'fm6oa') : 'habous');
  if (m.changed) { fs.writeFileSync(file(r.code), JSON.stringify(m.file) + '\n'); changed++; }
}
say(''); say(DRY ? 'Essai terminé : aucun fichier modifié.' : `Fichiers mis à jour : ${changed}`);
summary();
