import { t, setLang, locale, getLang, AR_STRINGS } from './i18n.js';
import { loadSettings, saveSettings, clearMonths, PRAYERS } from './storage.js';
import { now, syncClock, getOffset } from './clock.js';
import { ensureMonths, ensureMonth, getDay, findNext, findElapsed, dateKeyInTz, addDays, deviceTz } from './prayer-times.js';
import { Countdown, formatHMS } from './countdown.js';
import { qiblaBearing, distanceToKaaba, cardinalIndex } from './qibla.js';
import { Compass } from './compass.js';
import { formatHijri, useHabous, habousActive, habousInfo } from './hijri.js';
import { initHabous, refreshHabous } from './habous.js';
import { refreshOfficiel } from './officiel.js';
import { planNativeReminders, reminderText } from './reminders.js';
import { hasWaqf, drawArabicLine } from './waqf.js';
import { nearestLocality, moroccoReference, localityName, allLocalities, localityByCode, sameLocalityName, SNAP_KM } from './localites.js';
import { declination as wmmDeclination } from './wmm.js';
import { sunPosition, timesAtAzimuth } from './sun.js';
import { ADHANS, playAdhan, stopAdhan, unlockAudio, playBeep, vibrate, notify, requestNotifPermission, notifPermission, availableAdhans, importCustomAdhan, removeCustomAdhan, loadCustomAdhans, customAdhans, loadSiteAdhans, DEFAULT_ADHAN, RETIRED } from './adhan.js';
import { hijriMonth, upcomingWhiteDays, civilNoon, hijriOf, OCCASIONS, isWhiteDay, reminderFor } from './calendar.js';
import { PRESET_CITIES, METHOD_BY_COUNTRY, getGpsPosition, reverseGeocode, searchCity } from './location.js';

const $ = sel => document.querySelector(sel);
// branche un écouteur sans planter si l'élément n'existe pas (ancien index.html en cache, etc.)
function on(sel, ev, fn, opts) {
  const el = document.querySelector(sel);
  if (el) el.addEventListener(ev, fn, opts); else console.warn('Élément absent :', sel);
}
const METHOD_IDS = [21, 3, 5, 4, 1, 2, 13, 12, 19, 18, 8, 16, 15];
const LIST_ROWS = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
// Le vendredi, la prière du Dhuhr est la prière de la Joumou'a
const isFridayKey = dateKey => new Date(`${dateKey}T12:00:00Z`).getUTCDay() === 5;
const prayerLabel = (k, dateKey) => (k === 'Dhuhr' && dateKey && isFridayKey(dateKey) ? t('Jumuah') : t(k));
const EXTRA_ROWS = ['Imsak', 'Midnight'];

const state = {
  settings: loadSettings(),
  today: null, tomorrow: null, next: null, dayKey: null,
  online: navigator.onLine, fetchFailed: false,
  fired: new Set(JSON.parse(sessionStorage.getItem('priere.fired') || '[]')),
  qibla: null,
  decl: 0,
};
const S = () => state.settings;
const save = () => saveSettings(state.settings);
// Maroc : retour définitif à GMT le 20/09/2026 à 2 h (décret n° 2.26.530).
// Certains navigateurs ont encore l'ancienne base de fuseaux (GMT+1) : on force UTC.
const MOROCCO_GMT_FROM = Date.UTC(2026, 8, 20, 1, 0);
function effectiveTz(name) {
  if ((name === 'Africa/Casablanca' || name === 'Africa/El_Aaiun') && Date.now() >= MOROCCO_GMT_FROM) return 'UTC';
  return name;
}
// Fuseau choisi à la main (décalage fixe) : prioritaire sur le fuseau de la ville.
// Utile si la base des fuseaux du téléphone n'est pas à jour (changement d'heure légale récent).
function fixedTz(mode) {
  const h = Number(mode);
  if (mode == null || mode === 'auto' || !Number.isFinite(h)) return null;
  return h === 0 ? 'UTC' : `Etc/GMT${h > 0 ? '-' : '+'}${Math.abs(h)}`;   // Etc/GMT-1 = UTC+1
}
const tz = () => fixedTz(S().tzMode) || effectiveTz(S().location?.tz || deviceTz());

// ================= Formatage =================
const fmtTime = ts => ts == null ? '--:--'
  : new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz() }).format(ts);
const fmtClock = ts => new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: tz() }).format(ts);

function fmtDates(ts) {
  const greg = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz() }).format(ts);
  const shifted = ts + S().hijriOffset * 864e5;
  let hijri = '';
  try { hijri = formatHijri(shifted, tz(), getLang()); } catch { /* sans date hégirienne */ }
  return { greg, hijri };
}

function toast(msg, ms = 3200) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), ms);
}

// ================= Thème / langue =================
function applyTheme() {
  const th = S().theme;
  if (th === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = th;
}
function applyLang() {
  setLang(S().lang);
  if ($('#roseLabels')) renderDialLabels();
  const next = { fr: 'ع', ar: 'EN', en: 'FR' }[getLang()];
  $('#langBtn').textContent = next;
  state.sensorQ = null; // retraduit le texte du capteur
}

// ================= Navigation =================
// Le mode « fit » ajuste Horaires, Qibla et Calendrier à la hauteur de l'écran. Si le contenu ne tient pas (petit téléphone, texte agrandi
// à 150-200 %), on le coupe : l'écran défile normalement au lieu de superposer des lignes.
function setFit() {
  const body = document.body, want = state.view !== 'settings' && state.view !== 'cards';
  body.classList.toggle('fit', want);
  if (!want) return;
  const v = document.querySelector('.view:not([hidden])');
  const pl = v && v.id === 'view-home' ? v.querySelector('.prayers') : null;          // la liste des prières doit tenir sans que ses lignes se chevauchent
  // tolérance de 12 px : les lignes peuvent se tasser un peu (36 → 30 px) ; au-delà elles se chevaucheraient
  if (v && (v.scrollHeight > v.clientHeight + 12 || (pl && pl.scrollHeight > pl.clientHeight + 12))) body.classList.remove('fit');
}
window.addEventListener('resize', () => requestAnimationFrame(setFit));
function go(view) {
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== `view-${view}`; });
  document.querySelectorAll('.tabbar button').forEach(b => {
    if (b.dataset.goto === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  if (view !== 'qibla') stopWalk();
  state.view = view; setFit();                                                       // écran ajusté, sans défilement, s'il tient
  document.body.classList.toggle('no-top', view !== 'home' && view !== 'settings');  // barre du haut (ville, langue, cloche, réglages) : seulement sur Horaires et Réglages
  $('#settingsBtn')?.classList.toggle('active', view === 'settings');
  requestAnimationFrame(() => document.querySelectorAll('main, .view').forEach(el => { el.scrollLeft = 0; }));
  if (view !== 'qibla') compass.stop();
  if (view === 'qibla') {
    renderQibla();
    // démarrage automatique ; sur iPhone, un toucher n'est demandé que si Safari ne l'a pas déjà autorisé
    setCompassMsg(t('compassSearching'), '');
    compass.start({ ask: !Compass.needsPermission() });
  }
  if (view === 'settings') { showSettingsPage(state.pendingPage || null, { silent: true }); state.pendingPage = null; renderSettings(); }
  if (view === 'cards') renderCards();
  if (view === 'calendar') { state.calAnchor = null; renderCalendar(); }
  window.scrollTo({ top: 0 });
  requestAnimationFrame(() => { if (view !== 'settings' && view !== 'cards') document.body.classList.add('fit'); setFit(); });   // après le rendu : mesure réelle
  if (!(view === 'settings' && state.spage)) history.replaceState(null, '', `#${view}`);
}

// ================= Réglages : menu et sous-pages =================
const SPAGES = ['loc', 'calc', 'adhan', 'look', 'adv', 'about'];
state.spage = null;
function showSettingsPage(name, { push = false, silent = false } = {}) {
  if (name && !SPAGES.includes(name)) name = null;
  state.spage = name;
  if (!name) renderSettingsHub();                              // résumés à jour à chaque retour au menu
  const hub = $('#settingsHubBox'); if (hub) hub.hidden = !!name;
  SPAGES.forEach(p => { const el = $(`#spage-${p}`); if (el) el.hidden = p !== name; });
  if (push && name) history.pushState({ spage: name }, '', `#settings/${name}`);
  else if (!silent) history.replaceState(null, '', name ? `#settings/${name}` : '#settings');
  if (!silent) window.scrollTo({ top: 0 });
}
function renderSettingsHub() {
  const s = S(), a = s.adhan, loc = s.location, set = (id, txt) => { const el = $(`#hub-${id}`); if (el) el.textContent = txt || ''; };
  set('loc', loc ? (loc.name || t('chooseCity')) : t('chooseCity'));
  set('calc', t('methods')[s.method] || '');
  const snd = a.enabled ? [t('hubOn'), a.mode === 'perPrayer' ? t('perPrayer') : (a.global === 'none' ? t('none') : '')].filter(Boolean) : [t('hubOff')];
  set('adhan', snd.join(' \u00b7 '));
  set('look', `${{ fr: 'Fran\u00e7ais', ar: '\u0627\u0644\u0639\u0631\u0628\u064a\u0629', en: 'English' }[s.lang] || ''} \u00b7 ${t(s.theme === 'auto' ? 'auto' : s.theme)}`);
  set('adv', '');
  set('about', `Version ${APP_VERSION}`);
}

// ================= Position =================
async function useGps() {
  $('#gpsError').hidden = true;
  $('#placeName').textContent = t('locating');
  try {
    const p = await getGpsPosition();
    setLocation({ ...p, name: '', tz: deviceTz(), source: 'gps' });
    $('#locDialog').open && $('#locDialog').close();
    try {
      const r = await reverseGeocode(p.lat, p.lng, getLang());
      S().location.name = r.name; S().location.country = r.country;
      autoMethod(r.country);
      save(); renderHeader(); refresh();
    } catch { /* nom de ville facultatif */ }
  } catch {
    $('#gpsError').textContent = t('gpsDenied');
    $('#gpsError').hidden = false;
    renderHeader();
    if (!$('#locDialog').open) $('#locDialog').showModal();
  }
}

// Calendrier hégirien : dates officielles du Maroc (Habous) au Maroc, calcul + correction manuelle ailleurs
const inMorocco = () => {
  const l = S().location;
  if (l && l.country) return String(l.country).toLowerCase() === 'ma';
  return /^Africa\/(Casablanca|El_Aaiun)$/.test((l && l.tz) || deviceTz() || '');
};
function applyHijriSource() {
  const src = S().hijriSource || 'auto';
  useHabous(src === 'habous' || (src === 'auto' && inMorocco()));
}
function rerenderHijri() {
  applyHijriSource();
  renderAll();
  if ($('#view-calendar') && !$('#view-calendar').hidden) renderCalendar();
  if ($('#view-cards') && !$('#view-cards').hidden) renderCards();      // dates des occasions : recalculées dès qu'un nouveau début de mois est annoncé
}
function checkHabous(force = false, every) {
  refreshHabous({ force, every }).then(changed => { if (changed) { rerenderHijri(); if (!$('#view-settings').hidden) renderSettings(); requestNativeSync(); } });
}

// horaires officiels de la localité (Maroc) : un petit fichier par localité, mis à jour chaque mois par le workflow « Officiel »
function checkOfficiel(force = false) {
  const s = S(); if (Number(s.method) !== 21 || !s.location) return;
  const ref = moroccoReference(s.location.lat, s.location.lng, s.officialLocality !== false, s.officialLocalityCode ?? null);
  if (!ref.locality) return;
  refreshOfficiel(ref.locality.code, { force }).then(changed => { if (changed) { refresh(); requestNativeSync(); } });
}

function setLocation(loc) {
  const old = S().location;
  S().location = { ...loc, ts: Date.now() };
  // un changement de lieu important invalide le fuseau connu
  if (old && Math.abs(old.lng - loc.lng) > 3) S().location.tz = loc.tz || deviceTz();
  save(); applyHijriSource(); renderHeader(); refresh(); checkOfficiel(true);
  if (!$('#view-qibla').hidden) renderQibla();
  if (nativeActive()) localStorage.setItem('priere.nativeDirty', '1');
}

function autoMethod(country) {
  if (!S().methodAuto || !country) return;
  const m = METHOD_BY_COUNTRY[country] ?? 3;
  if (m !== S().method) { S().method = m; save(); }
}

function openLocationDialog() {
  const list = $('#presetList');
  list.replaceChildren(...PRESET_CITIES.map(c => cityItem(getLang() === 'ar' ? c.ar : c.name, null, () => pickCity(c))));
  $('#cityResults').replaceChildren();
  $('#citySearch').value = '';
  $('#gpsError').hidden = true;
  $('#locDialog').showModal();
}
function cityItem(name, detail, onClick) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = name;
  if (detail) { const s = document.createElement('small'); s.textContent = detail; b.append(s); }
  b.addEventListener('click', onClick);
  li.append(b); return li;
}
function pickCity(c) {
  $('#locDialog').close();
  autoMethod(c.country);
  // fuseau inconnu tant que l'API n'a pas répondu : on garde le précédent
  setLocation({ lat: c.lat, lng: c.lng, name: getLang() === 'ar' && c.ar ? c.ar : c.name, country: c.country, source: 'manual', tz: null });
}
let searchCtrl, searchTimer;
function onSearch(e) {
  const q = e.target.value.trim();
  clearTimeout(searchTimer);
  if (q.length < 3) { $('#cityResults').replaceChildren(); return; }
  searchTimer = setTimeout(async () => {
    searchCtrl?.abort(); searchCtrl = new AbortController();
    try {
      const res = await searchCity(q, getLang(), searchCtrl.signal);
      $('#cityResults').replaceChildren(...(res.length
        ? res.map(r => cityItem(r.name, r.detail, () => pickCity(r)))
        : [Object.assign(document.createElement('li'), { textContent: t('noResult'), className: 'note' })]));
    } catch (err) { if (err.name !== 'AbortError') $('#cityResults').replaceChildren(); }
  }, 500);
}

// ================= Horaires =================
async function refresh() {
  if (!S().location) return;
  state.fetchFailed = false;
  const todayKey = dateKeyInTz(now(), tz());
  try {
    const apiTz = await ensureMonths(S(), todayKey);
    if (apiTz && apiTz !== S().location.tz) { S().location.tz = apiTz; save(); }
  } catch (e) {
    console.warn(e);
    state.fetchFailed = true;
  }
  loadDays();
  renderAll();
}

function loadDays() {
  const key = dateKeyInTz(now(), tz());
  state.dayKey = key;
  state.today = getDay(S(), key);
  state.tomorrow = getDay(S(), addDays(key, 1));
  computeNext();
}

// Après l'heure d'une prière, on reste sur elle pendant GRACE_MIN minutes (temps écoulé « +mm:ss »),
// puis on passe au compte à rebours de la suivante.
const GRACE_MIN = 30;
function computeNext() {
  const t = now();
  state.next = findNext(state.today, state.tomorrow, t);
  state.elapsed = findElapsed(state.today, t, GRACE_MIN * 60000);
  countdown.setTarget(state.elapsed ? state.elapsed.end : state.next.ts);
}

function skyFor(t) {
  const d = state.today?.times; if (!d) return 'day';
  if (t < d.Fajr || t >= d.Isha) return 'night';
  if (t < d.Sunrise + 30 * 60000) return 'fajr';
  if (t < d.Asr) return 'day';
  if (t < d.Maghrib - 20 * 60000) return 'asr';
  return 'maghrib';
}

function renderAll() { renderHeader(); renderHome(); renderWhite(); renderOccChip(); renderSilent(); renderCta(); requestAnimationFrame(setFit); }

// ================= Consulter d'autres jours =================
// state.viewKey : date consultée ('YYYY-MM-DD'), null = aujourd'hui (avec compte à rebours)
const viewing = () => !!state.viewKey && state.viewKey !== state.dayKey;
const shownDay = () => (viewing() ? state.viewDay : state.today);
function showDay(key) {
  if (!key || key === state.dayKey) { state.viewKey = null; state.viewDay = null; }
  else {
    state.viewKey = key;
    state.viewDay = getDay(S(), key);                 // cache ou calcul local, tout de suite
    ensureMonth(S(), key.slice(0, 7)).then(ok => {    // puis horaires officiels si besoin
      if (ok && state.viewKey === key) { state.viewDay = getDay(S(), key); renderHeader(); renderHome(); }
    });
  }
  renderHeader(); renderHome();
}
function shiftDay(n) {
  const base = state.viewKey || state.dayKey; if (!base) return;
  const key = addDays(base, n);
  const span = Math.abs((Date.parse(key) - Date.parse(state.dayKey)) / 864e5);
  if (span > 400) return;                              // un peu plus d'un an dans chaque sens
  showDay(key);
}
function bindSwipe() {
  const el = $('#view-home'); if (!el) return;
  let x0 = null, y0 = 0;
  el.addEventListener('touchstart', e => { if (e.touches.length === 1) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; } }, { passive: true });
  el.addEventListener('touchend', e => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < 1.5 * Math.abs(dy)) return;
    let dir = dx < 0 ? 1 : -1;                         // glisser vers la gauche = jour suivant
    if (document.documentElement.dir === 'rtl') dir = -dir;
    shiftDay(dir);
  }, { passive: true });
}

function renderNoLoc() {
  const none = !S().location;
  const box = $('#noLoc'); if (box) box.hidden = !none;
  const arch = $('#arch'); if (arch) arch.hidden = none;
}

function renderHeader() {
  renderNoLoc();
  const loc = S().location;
  $('#placeName').textContent = loc ? (loc.name || `${loc.lat.toFixed(3)}, ${loc.lng.toFixed(3)}`) : t('chooseCity');
  const chip = $('#officialChip'); if (chip) chip.hidden = !loc || Number(S().method) !== 21;   // calcul selon les critères des Habous (Maroc)
  const day = shownDay();
  const { greg, hijri } = fmtDates(viewing() && day ? (day.times.Dhuhr || now()) : now());
  $('#gregDate').textContent = greg;
  $('#hijriDate').textContent = hijri;
}

// Icônes simples (trait) pour chaque moment de la journée
const PRAYER_ICONS = {
  Fajr: '<path d="M3 17h18M6 17a6 6 0 0 1 12 0"/><path d="M12 4v2M5.6 7.6l1.4 1.4M18.4 7.6 17 9"/><path d="M8 21h8"/>',
  Sunrise: '<path d="M3 18h18M7 18a5 5 0 0 1 10 0"/><path d="M12 3v6M9 6l3-3 3 3"/>',
  Dhuhr: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  Asr: '<circle cx="13" cy="10" r="4"/><path d="M13 2.5v1.5M20.5 10H19M18.3 4.7l-1 1M7.7 4.7l1 1M3 20h18M6 17h12"/>',
  Maghrib: '<path d="M3 17h18M7 17a5 5 0 0 1 10 0"/><path d="M12 3v6M9 6l3 3 3-3"/><path d="M8 21h8"/>',
  Isha: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/><path d="M17 4v3M15.5 5.5h3"/>',
};
const prayerIcon = k => `<svg class="pi" viewBox="0 0 24 24" aria-hidden="true">${PRAYER_ICONS[k] || ''}</svg>`;

const BELL_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path class="slash" d="M4 4l16 16"/></svg>';

// Barre de progression du héros : de la dernière étape (lever, prière…) à la prochaine prière ; elle clignote doucement sous 10 min
function renderBar(tNow) {
  const bar = $('#archBar'), arch = $('#arch'); if (!bar) return;
  const nx = state.next;
  if (state.elapsed || !nx || !state.today || viewing()) { bar.hidden = true; arch.classList.remove('soon'); return; }
  const d = state.today.times; let prev = null;
  for (const k of LIST_ROWS) { const ts = d[k]; if (ts != null && ts <= tNow && (!prev || ts > prev.ts)) prev = { name: k, ts, date: state.today.date }; }
  if (!prev) {                                    // avant le Fajr : on part de l'Isha de la veille
    try { const y = getDay(S(), addDays(state.today.date, -1)); if (y?.times?.Isha) prev = { name: 'Isha', ts: y.times.Isha, date: addDays(state.today.date, -1) }; } catch { /* sans la veille, pas de barre */ }
  }
  if (!prev || nx.ts <= prev.ts) { bar.hidden = true; return; }
  const frac = Math.min(1, Math.max(0, (tNow - prev.ts) / (nx.ts - prev.ts)));
  $('#archBarFill').style.width = `${(frac * 100).toFixed(1)}%`;
  $('#barPrev').textContent = `${prayerLabel(prev.name, prev.date)} ${fmtTime(prev.ts)}`;
  $('#barNext').textContent = `${prayerLabel(nx.name, nx.day === 'today' ? state.today.date : addDays(state.today.date, 1))} ${fmtTime(nx.ts)}`;
  bar.hidden = false;
  arch.classList.toggle('soon', nx.ts - tNow > 0 && nx.ts - tNow < 10 * 60000);
}

// Seule action contextuelle de l'accueil : l'Adhan est désactivé → une ligne pour le réactiver
const fmtSpan = ms => { const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h} ${t('hShort')} ${m} ${t('minShort')}` : `${m} ${t('minShort')} ${s % 60} s`; };
// Fermeture du bandeau d'horloge : mémorisée 24 h (et rouverte si l'écart change de plus de 5 min, par ex. si le téléphone se remet à l'heure)
const CW_KEY = 'priere.clockWarnClosed';
function clockWarnDismissed(off) {
  try { const v = JSON.parse(localStorage.getItem(CW_KEY) || 'null'); return !!v && Date.now() - v.at < 864e5 && Math.abs(v.off - off) < 300000; } catch { return false; }
}
function renderCta() {
  const cw = $('#clockWarn');
  if (cw) {                                              // téléphone déréglé (≥ 1 min) : la cause n°1 d'un Adhan décalé
    const off = getOffset(); cw.hidden = Math.abs(off) < 60000 || clockWarnDismissed(off);
    if (!cw.hidden) {
      // écart d'un nombre rond d'heures (± 3 min) : l'horloge interne est faussée par le fuseau que le réseau mobile impose, l'affichage est juste ;
      // « activer la date automatique » serait un mauvais conseil (c'est elle la cause) : l'appli et le module corrigent d'eux-mêmes
      const half = 1800000, networkTz = Math.abs(off) >= half && Math.abs(Math.abs(off) - Math.round(Math.abs(off) / half) * half) <= 180000;
      const words = { ar: ['متأخرة', 'متقدمة'], fr: ['retarde', 'avance'], en: ['behind', 'ahead'] }[getLang()] || ['behind', 'ahead'];
      $('#clockWarnTxt').textContent = networkTz ? t('clockNet', { d: fmtSpan(Math.abs(off)), w: words[off > 0 ? 0 : 1] })
        : t(off > 0 ? 'clockBehind' : 'clockAhead', { d: fmtSpan(Math.abs(off)) });
    }
  }
  const box = $('#ctaAdhan'); if (!box) return;
  box.hidden = viewing() || !S().location || !!S().adhan.enabled;
}
function enableAdhan() {
  const c = $('#sAdhanOn'); if (!c) return;
  c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true }));   // même chemin que dans les réglages (son, droits, module Android)
}

function renderOtherDay(day) {
  const ts = day.times.Dhuhr || now();
  $('#nextLabel').textContent = t('timesOf');
  $('#nextName').textContent = new Intl.DateTimeFormat(locale(), { weekday: 'long', timeZone: tz() }).format(ts);
  $('#nextTime').textContent = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: tz() }).format(ts);
  $('#arch').dataset.sky = 'day';
  const rows = LIST_ROWS.map(k => {
    const li = document.createElement('li');
    li.className = PRAYERS.includes(k) ? '' : 'minor';
    li.innerHTML = `<span class="mark">${prayerIcon(k)}</span><span class="name"></span><time class="time"></time>`;
    li.querySelector('.name').textContent = prayerLabel(k, day.date);
    li.querySelector('.time').textContent = fmtTime(day.times[k]);
    return li;
  });
  $('#prayerList').replaceChildren(...rows);
  $('#extraTimes').replaceChildren(...EXTRA_ROWS.map(k => {
    const sp = document.createElement('span');
    sp.innerHTML = '<b></b> <time></time>';
    sp.firstChild.textContent = t(k);
    sp.lastChild.textContent = fmtTime(day.times[k]);
    return sp;
  }));
  const st = $('#status');
  st.textContent = day.source === 'local' ? t('localCalc') : '';
}

function renderHome() {
  if (!state.today) return;
  const tNow = now();
  const { next } = state;
  const other = viewing() && state.viewDay;
  const arch = $('#arch');
  arch.classList.toggle('other-day', !!other);
  $('#dayToday').hidden = !other;
  if (other) return renderOtherDay(state.viewDay);
  let current = next.current;
  if (current === 'Fajr' && tNow >= state.today.times.Sunrise) current = null; // le temps du Fajr s'arrête au lever

  const el = state.elapsed;   // heure de la prière tout juste arrivée : on reste dessus un moment
  $('#nextLabel').textContent = el ? t('prayerNow') : t('nextPrayer');
  const nextDate = el || next.day === 'today' ? state.today.date : addDays(state.today.date, 1);
  $('#nextName').textContent = prayerLabel(el ? el.name : next.name, nextDate);
  $('#nextTime').textContent = el ? fmtTime(el.ts) : fmtTime(next.ts) + (next.day === 'tomorrow' ? ` · ${t('tomorrow')}` : '');
  $('#nextAt').textContent = fmtTime(el ? el.ts : next.ts);
  $('#arch').classList.toggle('elapsed', !!el);
  $('#archIn').textContent = t(el ? 'since' : 'in');   // « منذ » pendant la prière, « بعد » avant
  $('#arch').dataset.sky = skyFor(tNow);

  const rows = LIST_ROWS.map(k => {
    const ts = state.today.times[k];
    const li = document.createElement('li');
    const isPrayer = PRAYERS.includes(k);
    const isNext = el ? el.name === k : next.day === 'today' && next.name === k;
    const past = ts <= tNow && !isNext;
    li.className = [past ? 'past' : '', isNext ? 'next' : '', !isPrayer ? 'minor' : '', current === k ? 'current' : ''].filter(Boolean).join(' ');
    li.innerHTML = `<span class="mark">${prayerIcon(k)}</span><span class="name"></span><time class="time"></time>${isPrayer ? '<button type="button" class="bell"></button>' : ''}`;
    li.querySelector('.name').textContent = prayerLabel(k, state.today.date);
    if (current === k) li.querySelector('.name').dataset.badge = t('inProgress');
    li.querySelector('.time').textContent = fmtTime(ts);
    if (isPrayer) {
      const b = li.querySelector('.bell'), off = !S().adhan.enabled || !!(S().adhan.mute && S().adhan.mute[k]);
      b.dataset.k = k; b.innerHTML = BELL_SVG; b.classList.toggle('off', off); b.setAttribute('aria-pressed', String(!off));
      b.setAttribute('aria-label', t(off ? 'bellOff' : 'bellOn', { name: prayerLabel(k, state.today.date) }));
    }
    if (isNext) li.setAttribute('aria-current', 'time');
    return li;
  });
  $('#prayerList').replaceChildren(...rows);
  renderBar(tNow);

  $('#extraTimes').replaceChildren(...EXTRA_ROWS.map(k => {
    const sp = document.createElement('span');
    sp.innerHTML = '<b></b> <time></time>';
    sp.firstChild.textContent = t(k);
    sp.lastChild.textContent = fmtTime(state.today.times[k]);
    return sp;
  }));

  // « Dernière mise à jour » n'apparaît que si c'est utile : hors ligne, calcul local ou données anciennes
  const st = $('#status');
  const offline = state.fetchFailed || !navigator.onLine;
  const stale = state.today.fetchedAt && Date.now() - state.today.fetchedAt > 3 * 864e5;
  st.classList.add('warn-s');
  if (state.today.source === 'local') st.textContent = t('localCalc');
  else if (state.today.source !== 'habous' && (offline || stale)) {
    const when = new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short', timeZone: tz() }).format(state.today.fetchedAt);
    st.textContent = `${offline ? t('offline') + ' · ' : ''}${t('lastUpdate')} ${when}`;
  } else st.textContent = '';
}

// ================= Mode silencieux =================
const isSilent = () => { const u = S().silentUntil; return u === -1 || (u > 0 && now() < u); };
function renderSilent() {
  const btn = $('#silentBtn'); if (!btn) return;
  const on = isSilent();
  btn.classList.toggle('on', on);
  const u = S().silentUntil;
  const st = $('#silentState');
  if (st) st.textContent = !on ? '' : u === -1 ? t('silentOn') : t('silentUntil', { t: fmtTime(u) });
  const off = $('#silentOff'); if (off) off.hidden = !on;
}
function setSilent(mode) {
  if (mode === 'off') S().silentUntil = 0;
  else if (mode === 'forever') S().silentUntil = -1;
  else if (mode === 'nextFajr') {
    const f = state.today && now() < state.today.times.Fajr ? state.today.times.Fajr : state.tomorrow?.times.Fajr;
    S().silentUntil = (f || now() + 8 * 36e5) + 60000;
  } else S().silentUntil = now() + Number(mode) * 60000;
  save(); renderSilent();
  if (mode !== 'off') { stopAdhan(); hideAdhanAlert(); }
  toast(mode === 'off' ? t('silentOffMsg') : t('silentOn'));
}
function hideAdhanAlert() { const al = $('#adhanAlert'); if (al) al.hidden = true; }

// ================= Jours blancs =================
function hijriLabel(h) { return `${h.d} ${t('hijriMonths')[h.m - 1]}`; }
function renderWhite() {
  const card = $('#whiteCard'); if (!card) return;
  if (!S().whiteDays) { card.hidden = true; return; }
  const today = civilNoon(now(), tz());
  const h = hijriOf(today, S().hijriOffset);
  const list = upcomingWhiteDays(today, S().hijriOffset, 4);
  if (!list.length) { card.hidden = true; return; }
  card.hidden = false;
  if (list[0].noon === today) { $('#whiteText').textContent = t('whiteToday', { d: h.d, m: t('hijriMonths')[h.m - 1] }); return; }
  const fmt = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  $('#whiteText').textContent = t('whiteSoon', { list: list.map(x => `${fmt.format(x.noon)} (${hijriLabel(x.h)})`).join(' · ') });
}

// ================= Calendrier hégirien =================
function renderCalendar() {
  const grid = $('#calGrid'); if (!grid) return;
  const off = S().hijriOffset;
  const todayNoon = civilNoon(now(), tz());
  state.calAnchor = state.calAnchor || todayNoon;
  const mon = hijriMonth(state.calAnchor, off);
  state.calMonth = mon;
  $('#calTitle2').textContent = `${t('hijriMonths')[mon.m - 1]} ${mon.y} ${t('hijriEra')}`;
  const gf = new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const a = gf.format(mon.days[0].noon), b = gf.format(mon.days.at(-1).noon);
  $('#calSub').textContent = a === b ? a : `${a} – ${b}`;
  const mbt = $('#calMonthTableTxt'); if (mbt) { mbt.textContent = mon.m === 9 ? t('imsakiya') : t('monthTimesShort'); $('#calMonthTable').setAttribute('aria-label', mon.m === 9 ? t('imsakiya') : t('calTable')); }
  const tb = $('#calToday'); if (tb) tb.hidden = mon.days.some(d => d.noon === todayNoon);   // « اليوم » seulement quand on regarde un autre mois
  // en-têtes : semaine du samedi au vendredi en arabe, du lundi au dimanche sinon
  const first = getLang() === 'ar' ? 6 : 1;
  const wd = new Intl.DateTimeFormat(locale(), { weekday: getLang() === 'ar' ? 'long' : 'short', timeZone: 'UTC' });
  const heads = Array.from({ length: 7 }, (_, i) => {
    const el = document.createElement('div'); el.className = 'cal-dow';
    const dayIdx = (first + i) % 7; // 0 = dimanche ; 4 janv. 1970 était un dimanche
    el.textContent = wd.format(Date.UTC(1970, 0, 4 + dayIdx, 12)).replace(/^ال/, '');
    return el;
  });
  const lead = (mon.days[0].dow - first + 7) % 7;
  const blanks = Array.from({ length: lead }, () => document.createElement('div'));
  const gd = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const cells = mon.days.map(d => {
    const el = document.createElement('div');
    el.className = 'cal-day' + (d.white ? ' white' : '') + (d.occasion ? ' occ' : '') + (d.noon === todayNoon ? ' today' : '') + (d.dow === 5 ? ' fri' : '');
    el.setAttribute('role', 'gridcell');
    el.tabIndex = 0;
    const key = new Date(d.noon).toISOString().slice(0, 10);
    const open = () => { go('home'); showDay(key); };
    el.addEventListener('click', open);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    el.innerHTML = '<span class="hd"></span><span class="gd"></span>';
    el.firstChild.textContent = d.h.d;
    el.lastChild.textContent = gd.format(d.noon);
    if (d.occasion) el.title = occTitle(d.occasion, d.h);
    return el;
  });
  grid.replaceChildren(...heads, ...blanks, ...cells);
  grid.dataset.rows = String(Math.ceil((blanks.length + cells.length) / 7));      // 5 ou 6 lignes : le mode « un écran » réduit les cases des mois de 6 lignes
  const df = new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  renderNextOcc();
  // seulement ce qui reste à venir (aujourd'hui compris) : les événements passés du mois ne sont plus listés
  const events = mon.days.filter(d => d.occasion && d.noon >= todayNoon).map(d => [occTitle(d.occasion, d.h), d]);
  const whites = mon.days.filter(d => d.white && d.noon >= todayNoon);
  if (whites.length) events.push([t('whiteDays'), whites[0], null, whites]);
  events.sort((x, y) => x[1].noon - y[1].noon);
  const and = new Intl.ListFormat(locale(), { type: 'conjunction' });
  const wdl = new Intl.DateTimeFormat(locale(), { weekday: 'long', timeZone: 'UTC' });
  const mf = new Intl.DateTimeFormat(locale(), { month: 'long', timeZone: 'UTC' });
  $('#calEvents').replaceChildren(...events.map(([name, d1, , list]) => {
    const li = document.createElement('li');
    li.innerHTML = '<span></span><span></span>';
    if (list) {   // jours blancs : « 13، 14 و15 ربيع الآخر — الموافق للخميس 24 والجمعة 25 والسبت 26 شتنبر »
      const oneMonth = new Set(list.map(x => mf.format(x.noon))).size === 1;
      li.firstChild.textContent = `${name} — ${and.format(list.map(x => String(x.h.d)))} ${t('hijriMonths')[mon.m - 1]}`;
      const days = list.map(x => `${wdl.format(x.noon)} ${new Date(x.noon).getUTCDate()}${oneMonth ? '' : ' ' + mf.format(x.noon)}`);
      if (getLang() === 'ar' && days[0].startsWith('ال')) days[0] = 'ل' + days[0].slice(1);   // الموافق للخميس
      li.lastChild.textContent = `${t('matching')} ${and.format(days)}${oneMonth ? ' ' + mf.format(list[0].noon) : ''}`;
    } else {
      li.firstChild.textContent = `${name} — ${d1.h.d} ${t('hijriMonths')[mon.m - 1]}`;
      li.lastChild.textContent = df.format(d1.noon);
    }
    return li;
  }));
  requestAnimationFrame(setFit);                          // la hauteur change d'un mois à l'autre (5 ou 6 lignes) : on re-vérifie que tout tient
}
/** Bloc « prochaine occasion » du calendrier : la plus proche à partir d'aujourd'hui (jours blancs et occasions, pas le vendredi) */
function renderNextOcc() {
  const box = $('#nextOcc'); if (!box) return;
  const sp = cardSpecs().find(x => !x.evergreen && x.key !== 'jumuah' && x.key !== 'imsakiya');
  box.hidden = !sp; if (!sp) return;
  const df = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  $('#noName').textContent = cardTitleOf(sp);
  $('#noWhen').textContent = `${df.format(sp.noon)} \u00b7 ${whenLabel(sp.noon)}${isExpected(sp) ? ` \u00b7 ${t('expectedDate')}` : ''}`;
  $('#noShare').onclick = () => openCardPreview(sp);
}
// ================= Horaires du mois (mois hégirien affiché dans le calendrier) =================
// Mois grégoriens couverts par un mois hégirien, en toutes lettres
function gregSpan(mon) {
  const gf = new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const a = gf.format(mon.days[0].noon), b = gf.format(mon.days.at(-1).noon);
  return a === b ? a : `${a} – ${b}`;
}
const tableCols = () => (state.tableMode === 'ramadan'
  ? ['Imsak', 'Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']
  : ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']);
const colLabel = c => (c === 'Sunrise' ? t('shortSunrise') : c === 'Maghrib' && state.tableMode === 'ramadan' ? t('iftar') : t(c));
const tableTitle = mon => (state.tableMode === 'ramadan'
  ? `${t('imsakiya')} ${mon.y} ${t('hijriEra')}`
  : `${t('monthTimes')} · ${t('hijriMonths')[mon.m - 1]} ${mon.y}`);

async function openMonthTable(mon = state.calMonth, mode = null) {
  if (!mon || !S().location) return;
  state.tableMon = mon;
  state.tableMode = mode || (mon.m === 9 ? 'ramadan' : 'month');
  const dlg = $('#monthDialog');
  dlg.classList.toggle('ramadan', state.tableMode === 'ramadan');
  $('#monthTitle').textContent = tableTitle(mon);
  $('#monthSub').textContent = `${S().location.name || ''} · ${gregSpan(mon)}`;
  renderMonthTable(mon);
  if (!dlg.open) dlg.showModal();
  const yms = [...new Set(mon.days.map(d => new Date(d.noon).toISOString().slice(0, 7)))];
  const oks = await Promise.all(yms.map(ym => ensureMonth(S(), ym)));
  if (oks.some(Boolean) && state.tableMon === mon) renderMonthTable(mon);
}
function renderMonthTable(mon) {
  const cols = tableCols(), ram = state.tableMode === 'ramadan';
  const todayNoon = civilNoon(now(), tz());
  const wd = new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone: 'UTC' });
  const dn = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'numeric', timeZone: 'UTC' });
  const cc = c => (ram && c === 'Maghrib' ? ' class="iftar"' : '');
  const head = `<thead><tr><th>${t('colDay')}</th>${cols.map(c => `<th${cc(c)}>${colLabel(c)}</th>`).join('')}</tr></thead>`;
  const rows = mon.days.map(d => {
    const day = getDay(S(), new Date(d.noon).toISOString().slice(0, 10));
    const cls = [d.noon === todayNoon ? 'today' : '', !ram && d.white ? 'white' : '', ram && d.h.d === 27 ? 'qadr' : '', d.dow === 5 ? 'friday' : ''].filter(Boolean).join(' ');
    return `<tr class="${cls}"><th scope="row"><b>${d.h.d}</b> <small>${wd.format(d.noon)} ${dn.format(d.noon)}</small></th>${cols.map(c => `<td${cc(c)}>${fmtTime(day.times[c])}</td>`).join('')}</tr>`;
  }).join('');
  $('#monthTable').innerHTML = head + `<tbody>${rows}</tbody>`;
}
// Lien affiché dans les messages partagés. Mettez ici votre lien court (TinyURL, ou votre domaine).
const SHARE_URL = 'https://tinyurl.com/salati-app';
const PLAY_URL = SHARE_URL;

// Les polices Google sont découpées en sous-ensembles (latin, arabe) : sans texte d'exemple, document.fonts.load()
// n'amène que le latin, et la 1re image dessinée peut utiliser une police de secours (tashkeel décalé, graisse différente).
const FONT_SAMPLE = 'Aa ابتثجحخدذرزسشصضطظعغفقكلمنهويءآأؤإئةىﷺ َُِّْ';
async function ensureCardFonts() {
  try {
    await Promise.all([
      document.fonts.load('700 60px Amiri', FONT_SAMPLE), document.fonts.load('400 40px Amiri', FONT_SAMPLE),
      document.fonts.load('400 60px WarshQ', FONT_SAMPLE),
      document.fonts.load('700 60px "Reem Kufi"', FONT_SAMPLE),
      document.fonts.load('400 32px "IBM Plex Sans Arabic"', FONT_SAMPLE), document.fonts.load('500 36px "IBM Plex Sans Arabic"', FONT_SAMPLE),
    ]);
    await document.fonts.ready;
  } catch { /* on dessine quand même */ }
}

// Image PNG du tableau du mois (pour WhatsApp, etc.), avec la mention de SaLaTi en bas
async function buildMonthImage(mon) {
  await ensureCardFonts();
  const rtl = document.documentElement.dir === 'rtl';
  const cols = tableCols(), ram = state.tableMode === 'ramadan';
  const W = 1080, M = 44, RH = 50, HEAD = 250, TH = 64, FOOT = 190;
  const H = HEAD + TH + mon.days.length * RH + FOOT;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const F = w => `${w} FONT "IBM Plex Sans Arabic", system-ui, sans-serif`;
  const font = (w, px) => F(w).replace('FONT', `${px}px`);
  g.direction = rtl ? 'rtl' : 'ltr';
  const X = (x, w = 0) => (rtl ? W - x - w : x);             // miroir pour l'arabe
  // fond
  g.fillStyle = '#F4F7F8'; g.fillRect(0, 0, W, H);
  // bandeau
  const grad = g.createLinearGradient(0, 0, 0, HEAD);
  grad.addColorStop(0, ram ? '#1B2A4A' : '#0E6B58'); grad.addColorStop(1, ram ? '#3B2F63' : '#138a70');
  g.fillStyle = grad; g.fillRect(0, 0, W, HEAD - 20);
  if (ram) {                                              // croissant et étoiles
    g.fillStyle = '#E9C46A'; g.beginPath(); g.arc(X(W - M - 70), 105, 52, 0, Math.PI * 2); g.fill();
    g.fillStyle = grad; g.beginPath(); g.arc(X(W - M - 50), 90, 46, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#E9C46A'; [[W - 250, 60], [W - 190, 180], [W - 330, 150]].forEach(([x, yy]) => { g.beginPath(); g.arc(X(x), yy, 4, 0, 7); g.fill(); });
  }
  g.fillStyle = ram ? '#F3DDB0' : '#fff'; g.textAlign = rtl ? 'right' : 'left'; g.textBaseline = 'alphabetic';
  g.font = font(700, 52); g.fillText(ram ? tableTitle(mon) : `${t('hijriMonths')[mon.m - 1]} ${mon.y} ${t('hijriEra')}`, X(M), 92);
  g.fillStyle = '#fff';
  g.font = font(500, 32); g.fillText(`${t('shareTitle')} · ${S().location?.name || ''}`, X(M), 146);
  g.font = font(400, 28); g.globalAlpha = .85; g.fillText(gregSpan(mon), X(M), 192); g.globalAlpha = 1;
  // colonnes
  const dayW = 250, colW = (W - 2 * M - dayW) / cols.length;
  const colX = i => M + dayW + i * colW;
  let y = HEAD;
  g.fillStyle = ram ? '#2A2350' : '#0A4F41'; g.fillRect(M, y, W - 2 * M, TH);
  if (ram) { const i = cols.indexOf('Maghrib'); g.fillStyle = '#B7791F'; g.fillRect(X(colX(i), colW), y, colW, TH); }
  g.fillStyle = '#fff'; g.font = font(600, 26); g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(t('colDay'), X(M, dayW) + dayW / 2, y + TH / 2);
  cols.forEach((c, i) => g.fillText(colLabel(c), X(colX(i), colW) + colW / 2, y + TH / 2));
  y += TH;
  const todayNoon = civilNoon(now(), tz());
  const wd = new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone: 'UTC' });
  const dn = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'numeric', timeZone: 'UTC' });
  mon.days.forEach((d, r) => {
    const day = getDay(S(), new Date(d.noon).toISOString().slice(0, 10));
    const qadr = ram && d.h.d === 27;
    g.fillStyle = d.noon === todayNoon ? '#D5EDE6' : qadr ? '#EDE3F7' : (!ram && d.white) ? '#F6ECD6' : r % 2 ? '#FFFFFF' : '#FAFBFC';
    g.fillRect(M, y, W - 2 * M, RH);
    if (ram) { const i = cols.indexOf('Maghrib'); g.fillStyle = 'rgba(183,121,31,.12)'; g.fillRect(X(colX(i), colW), y, colW, RH); }
    const bold = d.dow === 5 || d.noon === todayNoon || qadr;
    g.fillStyle = '#17222B'; g.textAlign = rtl ? 'right' : 'left';
    g.font = font(700, 26); g.fillText(String(d.h.d), X(M + 14), y + RH / 2);
    g.font = font(bold ? 600 : 400, 22); g.fillStyle = '#5A6B78';
    g.fillText(`${wd.format(d.noon)} ${dn.format(d.noon)}`, X(M + 62), y + RH / 2);
    g.textAlign = 'center'; g.fillStyle = '#17222B'; g.font = font(bold ? 700 : 400, 25);
    cols.forEach((c, i) => g.fillText(fmtTime(day.times[c]), X(colX(i), colW) + colW / 2, y + RH / 2));
    g.fillStyle = '#E3E9ED'; g.fillRect(M, y + RH - 1, W - 2 * M, 1);
    y += RH;
  });
  // mention de l'application
  y += 30;
  const icon = await new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = 'icons/icon-192.png?v=190'; });
  if (icon) g.drawImage(icon, X(M, 96), y, 96, 96);
  g.textAlign = rtl ? 'right' : 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = '#0E6B58';
  g.font = font(700, 38); g.fillText('SaLaTi – صلاتي', X(M + 116), y + 42);
  g.fillStyle = '#5A6B78'; g.font = font(400, 24);
  g.fillText(t('shareFooter').split(':').slice(1).join(':').trim() || '', X(M + 116), y + 80);
  g.font = font(400, 20); g.fillText('Google Play : SaLaTi', X(M + 116), y + 112);
  return cv;
}

function monthShareText(mon) {
  if (state.tableMode === 'ramadan') {
    const wd = new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });
    return `🌙 ${tableTitle(mon)} · ${S().location?.name || ''}\n(${t('Imsak')} · ${t('iftar')})\n\n`
      + mon.days.map(d => { const x = getDay(S(), new Date(d.noon).toISOString().slice(0, 10)).times;
        return `${d.h.d} (${wd.format(d.noon)}) : ${fmtTime(x.Imsak)} · ${fmtTime(x.Maghrib)}`; }).join('\n')
      + `\n\n📱 ${t('shareFooter')}\n${PLAY_URL}`;
  }
  const wd = new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });
  const lines = mon.days.map(d => {
    const x = getDay(S(), new Date(d.noon).toISOString().slice(0, 10)).times;
    return `${d.h.d} (${wd.format(d.noon)}) : ${['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].map(k => fmtTime(x[k])).join(' · ')}`;
  });
  return `🕌 ${t('shareTitle')} — ${t('hijriMonths')[mon.m - 1]} ${mon.y} · ${S().location?.name || ''}\n`
    + `(${['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].map(k => t(k)).join(' · ')})\n\n`
    + lines.join('\n') + `\n\n📱 ${t('shareFooter')}\n${PLAY_URL}`;
}

async function shareMonthTable() {
  const mon = state.tableMon || state.calMonth; if (!mon) return;
  const btn = $('#monthShare'); if (btn) btn.disabled = true;
  try {
    const text = shortShareText();
    const cv = await buildMonthImage(mon);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    const file = blob && new File([blob], `SaLaTi-${state.tableMode === 'ramadan' ? 'Imsakiya' : t('hijriMonths')[mon.m - 1]}-${mon.y}.png`.replace(/\s+/g, '-'), { type: 'image/png' });
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: `SaLaTi – ${t('shareTitle')}`, text });
    } else if (navigator.share) {
      await navigator.share({ title: `SaLaTi – ${t('shareTitle')}`, text: monthShareText(mon) });
    } else if (file) {                                   // ordinateur : on enregistre l'image
      const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      toast(t('shareImgOk'));
    } else {
      await navigator.clipboard.writeText(monthShareText(mon)); toast(t('copied'));
    }
  } catch (e) {
    if (e && e.name !== 'AbortError') {
      try { await navigator.clipboard.writeText(monthShareText(mon)); toast(t('copied')); } catch {}
    }
  } finally { if (btn) btn.disabled = false; }
}

// ================= Partager les horaires d'un jour =================
function svgIcon(k, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PRAYER_ICONS[k]}</svg>`;
  return new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = 'data:image/svg+xml,' + encodeURIComponent(svg); });
}
async function buildDayImage(day, isToday) {
  await ensureCardFonts();
  const rtl = document.documentElement.dir === 'rtl';
  const W = 1080, H = 1350, M = 56;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'); g.direction = rtl ? 'rtl' : 'ltr';
  const font = (w, px) => `${w} ${px}px "IBM Plex Sans Arabic", system-ui, sans-serif`;
  const kufi = (px) => `700 ${px}px "Reem Kufi", "IBM Plex Sans Arabic", system-ui, sans-serif`;
  const X = (x, w = 0) => (rtl ? W - x - w : x);
  const ts = day.times.Dhuhr || now();
  g.fillStyle = '#F4F7F8'; g.fillRect(0, 0, W, H);
  // en-tête
  const grad = g.createLinearGradient(0, 0, 0, 400);
  grad.addColorStop(0, '#0E6B58'); grad.addColorStop(1, '#16937a');
  g.fillStyle = grad; g.beginPath(); g.roundRect(0, 0, W, 400, [0, 0, 48, 48]); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = font(500, 34); g.globalAlpha = .9; g.fillText(t('shareTitle'), W / 2, 90); g.globalAlpha = 1;
  g.font = kufi(86); g.fillText(S().location?.name || '', W / 2, 200);
  const greg = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz() }).format(ts);
  g.font = font(500, 36); g.fillText(greg, W / 2, 275);
  g.font = font(400, 32); g.globalAlpha = .9; g.fillText(fmtDates(ts).hijri, W / 2, 330); g.globalAlpha = 1;
  // lignes
  const next = isToday ? state.next : null;
  let y = 436; const RH = 104, gap = 12;
  for (const k of LIST_ROWS) {
    const isNext = next && next.day === 'today' && next.name === k;
    const minor = !PRAYERS.includes(k);
    g.fillStyle = isNext ? '#E3F3EE' : '#FFFFFF';
    g.beginPath(); g.roundRect(M, y, W - 2 * M, RH, 26); g.fill();
    if (isNext) { g.strokeStyle = '#0E6B58'; g.lineWidth = 4; g.stroke(); }
    const color = isNext ? '#0E6B58' : minor ? '#8FA2AF' : '#5A6B78';
    const icon = await svgIcon(k, color);
    if (icon) g.drawImage(icon, X(M + 34, 60), y + (RH - 60) / 2, 60, 60);
    g.textBaseline = 'middle'; g.textAlign = rtl ? 'right' : 'left';
    g.fillStyle = isNext ? '#0E6B58' : minor ? '#5A6B78' : '#17222B';
    g.font = font(isNext ? 700 : minor ? 400 : 600, minor ? 38 : 44); g.fillText(prayerLabel(k, day.date), X(M + 124), y + RH / 2);
    if (isNext) {
      g.font = font(600, 24); const tag = t('nextPrayer'); const tw = g.measureText(tag).width + 28;
      const nx = M + 124 + g.measureText(t(k)).width * 0 + 0;
      g.font = font(700, 44); const nw = g.measureText(t(k)).width;
      g.font = font(600, 24);
      g.fillStyle = '#0E6B58'; g.beginPath(); g.roundRect(X(nx + nw + 18, tw), y + RH / 2 - 20, tw, 40, 20); g.fill();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(tag, X(nx + nw + 18, tw) + tw / 2, y + RH / 2 + 1);
    }
    g.textAlign = rtl ? 'left' : 'right'; g.fillStyle = isNext ? '#0E6B58' : minor ? '#5A6B78' : '#17222B';
    g.font = font(isNext ? 700 : 600, minor ? 44 : 54); g.fillText(fmtTime(day.times[k]), X(W - M - 36), y + RH / 2);
    y += RH + gap;
  }
  // mention de l'application
  y = H - 150;
  g.fillStyle = '#E3E9ED'; g.fillRect(M, y - 26, W - 2 * M, 2);
  const icon = await new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = 'icons/icon-192.png?v=190'; });
  if (icon) { g.save(); g.beginPath(); g.roundRect(X(M, 96), y, 96, 96, 22); g.clip(); g.drawImage(icon, X(M, 96), y, 96, 96); g.restore(); }
  g.textAlign = rtl ? 'right' : 'left'; g.textBaseline = 'alphabetic';
  g.fillStyle = '#0E6B58'; g.font = font(700, 40); g.fillText('SaLaTi – صلاتي', X(M + 118), y + 44);
  g.fillStyle = '#5A6B78'; g.font = font(400, 26);
  g.fillText(t('shareFooter').split(':').slice(1).join(':').trim(), X(M + 118), y + 84);
  g.font = font(400, 22); g.fillText('Google Play : SaLaTi', X(M + 118), y + 116);
  return cv;
}
function dayShareText(day) {
  const ts = day.times.Dhuhr || now();
  const greg = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz() }).format(ts);
  return `🕌 ${t('shareTitle')} — ${S().location?.name || ''}\n${greg} · ${fmtDates(ts).hijri}\n\n`
    + LIST_ROWS.map(k => `${prayerLabel(k, day.date)} : ${fmtTime(day.times[k])}`).join('\n')
    + `\n\n📱 ${t('shareFooter')}\n${PLAY_URL}`;
}
async function shareDay() {
  const day = shownDay(); if (!day) return;
  const btn = $('#dayShare'); if (btn) btn.disabled = true;
  const text = dayShareText(day);
  try {
    const cv = await buildDayImage(day, !viewing());
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    const file = blob && new File([blob], `SaLaTi-${day.date}.png`, { type: 'image/png' });
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: `SaLaTi – ${t('shareTitle')}`, text: shortShareText() });
    } else if (navigator.share) {
      await navigator.share({ title: `SaLaTi – ${t('shareTitle')}`, text });
    } else if (file) {
      const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      toast(t('shareImgOk'));
    } else { await navigator.clipboard.writeText(text); toast(t('copied')); }
  } catch (e) {
    if (e && e.name !== 'AbortError') { try { await navigator.clipboard.writeText(text); toast(t('copied')); } catch {} }
  } finally { if (btn) btn.disabled = false; }
}

function printMonthTable() {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<!doctype html><html lang="${getLang()}" dir="${document.documentElement.dir}"><head><meta charset="utf-8"><title>${esc($('#monthTitle').textContent)}</title>
<style>body{font:12px system-ui,sans-serif;margin:16px;color:#111}h1{font-size:17px;margin:0 0 4px}p{margin:0 0 10px;color:#555}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:4px 6px;text-align:center;font-variant-numeric:tabular-nums}
thead th{background:#0E6B58;color:#fff}tr.friday{font-weight:700}tr.white{background:#f6ecd6}tbody th{text-align:start;white-space:nowrap}</style></head>
<body><h1>${esc($('#monthTitle').textContent)}</h1><p>${esc($('#monthSub').textContent)}</p><table>${$('#monthTable').innerHTML}</table><p style="margin-top:10px">${t('shareFooter')} — ${PLAY_URL}</p></body></html>`;
  const fr = document.createElement('iframe');
  fr.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.append(fr);
  fr.contentDocument.open(); fr.contentDocument.write(html); fr.contentDocument.close();
  setTimeout(() => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch {} setTimeout(() => fr.remove(), 60000); }, 300);
}

// Texte joint à une image partagée : l'image dit déjà tout, on ne garde que l'invitation et le lien
const shortShareText = () => `📲 ${t('shareShort')}\n${PLAY_URL}`;

// ================= Cartes à partager (Joumou'a, jours blancs, occasions, Imsakiya) =================
const DAY_MS = 864e5;
const JUMUAH_VERSE = '\u0627\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0648\u064e\u0645\u064e\u0644\u064e\u0670\u0653\u0626\u0650\u0643\u064e\u062a\u064e\u0647\u064f\u06e5 \u064a\u064f\u0635\u064e\u0644\u0651\u064f\u0648\u0646\u064e \u0639\u064e\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0646\u0651\u064e\u0628\u0650\u06d2\u0653\u0621\u0650\u06d6 \u064a\u064e\u0670\u0653\u0623\u064e\u064a\u0651\u064f\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0635\u064e\u0644\u0651\u064f\u0648\u0627\u0652 \u0639\u064e\u0644\u064e\u064a\u0652\u0647\u0650 \u0648\u064e\u0633\u064e\u0644\u0651\u0650\u0645\u064f\u0648\u0627\u0652 \u062a\u064e\u0633\u0652\u0644\u0650\u064a\u0645\u0627\u064b';
const JUMUAH_REF = '[\u0627\u0644\u0623\u062d\u0632\u0627\u0628: 56]';
// Textes des cartes : uniquement Coran et hadiths authentiques, avec leur référence.
// q = verset (entre ﴿ ﴾), sinon hadith/dhikr (entre « »).
// Amorce des deux adhkar rapportés sous la forme « كان رسول الله ﷺ إذا أصبح قال » (au lieu de « قال رسول الله ﷺ ») : fidèle à la narration
const MORNING_LEAD = '\u0643\u0627\u0646 \u0631\u0633\u0648\u0644 \u0627\u0644\u0644\u0647 \ufdfa \u0625\u0630\u0627 \u0623\u0635\u0628\u062d \u0642\u0627\u0644';
const CARD_TEXTS = {
  jumuah: [   // change chaque vendredi
    { q: true, t: JUMUAH_VERSE, r: JUMUAH_REF },
    { lead: '\u0642\u0627\u0644 \u0631\u0633\u0648\u0644 \u0627\u0644\u0644\u0647 \ufdfa', t: 'مَنْ قَرَأَ سُورَةَ الْكَهْفِ فِي يَوْمِ الْجُمُعَةِ أَضَاءَ لَهُ مِنَ النُّورِ مَا بَيْنَ الْجُمُعَتَيْنِ', r: 'رواه الحاكم والبيهقي، وصححه الألباني' },
    { lead: '\u0642\u0627\u0644 \u0631\u0633\u0648\u0644 \u0627\u0644\u0644\u0647 \ufdfa', t: 'إِنَّ مِنْ أَفْضَلِ أَيَّامِكُمْ يَوْمَ الْجُمُعَةِ … فَأَكْثِرُوا عَلَيَّ مِنَ الصَّلَاةِ فِيهِ', r: 'رواه أبو داود (1047)' },
  ],
  occRamadan: [{ q: true, t: '\u0634\u064e\u0647\u0652\u0631\u064f \u0631\u064e\u0645\u064e\u0636\u064e\u0627\u0646\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u06d2\u0653 \u0623\u064f\u0646\u0632\u0650\u0644\u064e \u0641\u0650\u064a\u0647\u0650 \u0627\u0650\u06ec\u0644\u0652\u0642\u064f\u0631\u0652\u0621\u064e\u0627\u0646\u064f \u0647\u064f\u062f\u0649\u0657 \u0644\u0651\u0650\u0644\u0646\u0651\u064e\u0627\u0633\u0650 \u0648\u064e\u0628\u064e\u064a\u0651\u0650\u0646\u064e\u0670\u062a\u0656 \u0645\u0651\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0652\u0647\u064f\u062f\u06ea\u0649\u0670 \u0648\u064e\u0627\u0644\u0652\u0641\u064f\u0631\u0652\u0642\u064e\u0627\u0646\u0650', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 184]' }],
  occQadr: [{ q: true, t: '\u0644\u064e\u064a\u0652\u0644\u064e\u0629\u064f \u0627\u064f\u06ec\u0644\u0652\u0642\u064e\u062f\u0652\u0631\u0650 \u062e\u064e\u064a\u0652\u0631\u065e \u0645\u0651\u0650\u0646\u064e \u0627\u064e\u0644\u0652\u0641\u0650 \u0634\u064e\u0647\u0652\u0631\u0656', r: '[\u0627\u0644\u0642\u062f\u0631: 3]' },
            { lead: '\u0645\u0645\u0627 \u0639\u0644\u0651\u0645\u0647 \u0631\u0633\u0648\u0644 \u0627\u0644\u0644\u0647 \ufdfa \u0645\u0646 \u0627\u0644\u062f\u0639\u0627\u0621', t: 'اللَّهُمَّ إِنَّكَ عَفُوٌّ تُحِبُّ الْعَفْوَ فَاعْفُ عَنِّي', r: 'رواه الترمذي (3513)' }],
  occMonth: [{ lead: '\u0643\u0627\u0646 \u0631\u0633\u0648\u0644 \u0627\u0644\u0644\u0647 \ufdfa \u0625\u0630\u0627 \u0631\u0623\u0649 \u0627\u0644\u0647\u0644\u0627\u0644 \u0642\u0627\u0644', t: '\u0627\u0644\u0644\u064e\u0651\u0647\u064f\u0645\u064e\u0651 \u0623\u064e\u0647\u0650\u0644\u064e\u0651\u0647\u064f \u0639\u064e\u0644\u064e\u064a\u0652\u0646\u064e\u0627 \u0628\u0650\u0627\u0644\u0652\u064a\u064f\u0645\u0652\u0646\u0650 \u0648\u064e\u0627\u0644\u0625\u0650\u064a\u0645\u064e\u0627\u0646\u0650\u060c \u0648\u064e\u0627\u0644\u0633\u064e\u0651\u0644\u064e\u0627\u0645\u064e\u0629\u0650 \u0648\u064e\u0627\u0644\u0625\u0650\u0633\u0652\u0644\u064e\u0627\u0645\u0650\u060c \u0631\u064e\u0628\u0650\u0651\u064a \u0648\u064e\u0631\u064e\u0628\u064f\u0651\u0643\u064e \u0627\u0644\u0644\u064e\u0651\u0647\u064f', r: '\u0631\u0648\u0627\u0647 \u0627\u0644\u062a\u0631\u0645\u0630\u064a (3451)' }],   // doua du croissant : Tirmidhi 3451, texte d'après le Tirmidhi (« باليمن ») ; identique à celui des rappels (i18n monthDua), vérifié par test-cards-data
  occArafa: [{ lead: '\u0642\u0627\u0644 \u0631\u0633\u0648\u0644 \u0627\u0644\u0644\u0647 \ufdfa', t: 'صِيَامُ يَوْمِ عَرَفَةَ أَحْتَسِبُ عَلَى اللَّهِ أَنْ يُكَفِّرَ السَّنَةَ الَّتِي قَبْلَهُ وَالسَّنَةَ الَّتِي بَعْدَهُ', r: 'رواه مسلم (1162)' }],
  occAshura: [{ lead: '\u0642\u0627\u0644 \u0631\u0633\u0648\u0644 \u0627\u0644\u0644\u0647 \ufdfa', t: 'صِيَامُ يَوْمِ عَاشُورَاءَ أَحْتَسِبُ عَلَى اللَّهِ أَنْ يُكَفِّرَ السَّنَةَ الَّتِي قَبْلَهُ', r: 'رواه مسلم (1162)' }],
  morning: [  // versets coraniques uniquement, RIWAYA DE WARSH ʿAN NĀFIʿ (décompte médinois récent, comme le Mushaf Mohammedi) ; les adhkar prophétiques sont dans « hadith »
    // Thèmes alternés : tawhid, bonne nouvelle et Paradis, louange, patience, espérance, miséricorde. Source : KFGQPC Warsh v10, contrôlée par scripts/test-cards-data.mjs
    { q: true, t: '\u0634\u064e\u0647\u0650\u062f\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0623\u064e\u0646\u0651\u064e\u0647\u064f\u06e5 \u0644\u064e\u0627\u0653 \u0625\u0650\u0644\u064e\u0670\u0647\u064e \u0625\u0650\u0644\u0651\u064e\u0627 \u0647\u064f\u0648\u064e \u0648\u064e\u0627\u0644\u0652\u0645\u064e\u0644\u064e\u0670\u0653\u0626\u0650\u0643\u064e\u0629\u064f \u0648\u064e\u0623\u064f\u0648\u0652\u0644\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0652\u0639\u0650\u0644\u0652\u0645\u0650 \u0642\u064e\u0627\u0653\u0626\u0650\u0645\u0627\u064e\u06e2 \u0628\u0650\u0627\u0644\u0652\u0642\u0650\u0633\u0652\u0637\u0650\u06d6 \u0644\u064e\u0627\u0653 \u0625\u0650\u0644\u064e\u0670\u0647\u064e \u0625\u0650\u0644\u0651\u064e\u0627 \u0647\u064f\u0648\u064e\u06d6 \u0627\u064e\u06ec\u0644\u0652\u0639\u064e\u0632\u0650\u064a\u0632\u064f \u0627\u064f\u06ec\u0644\u0652\u062d\u064e\u0643\u0650\u064a\u0645\u064f', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 18]' },
    { q: true, t: '\u0648\u064e\u0628\u064e\u0634\u0651\u0650\u0631\u0650 \u0627\u0650\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0648\u064e\u0639\u064e\u0645\u0650\u0644\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0635\u0651\u064e\u0670\u0644\u0650\u062d\u064e\u0670\u062a\u0650 \u0623\u064e\u0646\u0651\u064e \u0644\u064e\u0647\u064f\u0645\u0652 \u062c\u064e\u0646\u0651\u064e\u0670\u062a\u0656 \u062a\u064e\u062c\u0652\u0631\u0650\u06d2 \u0645\u0650\u0646 \u062a\u064e\u062d\u0652\u062a\u0650\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u064e\u0627\u0646\u0652\u0647\u064e\u0670\u0631\u064f', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 24]' },
    { q: true, t: '\u0627\u0650\u06ec\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f \u0644\u0650\u0644\u0647\u0650 \u0631\u064e\u0628\u0651\u0650 \u0627\u0650\u06ec\u0644\u0652\u0639\u064e\u0670\u0644\u064e\u0645\u0650\u064a\u0646\u064e \u0627\u064e\u06ec\u0644\u0631\u0651\u064e\u062d\u0652\u0645\u064e\u0670\u0646\u0650 \u0627\u0650\u06ec\u0644\u0631\u0651\u064e\u062d\u0650\u064a\u0645\u0650 \u0645\u064e\u0644\u0650\u0643\u0650 \u064a\u064e\u0648\u0652\u0645\u0650 \u0627\u0650\u06ec\u0644\u062f\u0651\u0650\u064a\u0646\u0650', r: '[\u0627\u0644\u0641\u0627\u062a\u062d\u0629: 1-3]' },
    { q: true, t: '\u0648\u064e\u0628\u064e\u0634\u0651\u0650\u0631\u0650 \u0627\u0650\u06ec\u0644\u0635\u0651\u064e\u0670\u0628\u0650\u0631\u0650\u064a\u0646\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0625\u0650\u0630\u064e\u0627\u0653 \u0623\u064e\u0635\u064e\u0670\u0628\u064e\u062a\u0652\u0647\u064f\u0645 \u0645\u0651\u064f\u0635\u0650\u064a\u0628\u064e\u0629\u065e \u0642\u064e\u0627\u0644\u064f\u0648\u0653\u0627\u0652 \u0625\u0650\u0646\u0651\u064e\u0627 \u0644\u0650\u0644\u0647\u0650 \u0648\u064e\u0625\u0650\u0646\u0651\u064e\u0627\u0653 \u0625\u0650\u0644\u064e\u064a\u0652\u0647\u0650 \u0631\u064e\u0670\u062c\u0650\u0639\u064f\u0648\u0646\u064e\u06d6 \u0623\u064f\u0648\u0652\u0644\u064e\u0670\u0653\u0626\u0650\u0643\u064e \u0639\u064e\u0644\u064e\u064a\u0652\u0647\u0650\u0645\u0652 \u0635\u064e\u0644\u064e\u0648\u064e\u0670\u062a\u065e \u0645\u0651\u0650\u0646 \u0631\u0651\u064e\u0628\u0651\u0650\u0647\u0650\u0645\u0652 \u0648\u064e\u0631\u064e\u062d\u0652\u0645\u064e\u0629\u065e\u06d6 \u0648\u064e\u0623\u064f\u0648\u0652\u0644\u064e\u0670\u0653\u0626\u0650\u0643\u064e \u0647\u064f\u0645\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u064f\u0647\u0652\u062a\u064e\u062f\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 154-156]' },
    { q: true, t: '\u0644\u064e\u0627 \u062a\u064e\u062d\u0652\u0632\u064e\u0646\u0650 \u0627\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0645\u064e\u0639\u064e\u0646\u064e\u0627\u06d6 \u0641\u064e\u0623\u064e\u0646\u0632\u064e\u0644\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0633\u064e\u0643\u0650\u064a\u0646\u064e\u062a\u064e\u0647\u064f\u06e5 \u0639\u064e\u0644\u064e\u064a\u0652\u0647\u0650\u06d6 \u0648\u064e\u0623\u064e\u064a\u0651\u064e\u062f\u064e\u0647\u064f\u06e5 \u0628\u0650\u062c\u064f\u0646\u064f\u0648\u062f\u0656 \u0644\u0651\u064e\u0645\u0652 \u062a\u064e\u0631\u064e\u0648\u0652\u0647\u064e\u0627', r: '[\u0627\u0644\u062a\u0648\u0628\u0629: 40]' },
    { q: true, t: '\u0642\u064f\u0644\u0652 \u064a\u064e\u0670\u0639\u0650\u0628\u064e\u0627\u062f\u0650\u064a\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0623\u064e\u0633\u0652\u0631\u064e\u0641\u064f\u0648\u0627\u0652 \u0639\u064e\u0644\u064e\u0649\u0670\u0653 \u0623\u064e\u0646\u0641\u064f\u0633\u0650\u0647\u0650\u0645\u0652 \u0644\u064e\u0627 \u062a\u064e\u0642\u0652\u0646\u064e\u0637\u064f\u0648\u0627\u0652 \u0645\u0650\u0646 \u0631\u0651\u064e\u062d\u0652\u0645\u064e\u0629\u0650 \u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u0650\u06d6 \u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u064a\u064e\u063a\u0652\u0641\u0650\u0631\u064f \u0627\u064f\u06ec\u0644\u0630\u0651\u064f\u0646\u064f\u0648\u0628\u064e \u062c\u064e\u0645\u0650\u064a\u0639\u0627\u064b\u06d6 \u0627\u0650\u0646\u0651\u064e\u0647\u064f\u06e5 \u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0652\u063a\u064e\u0641\u064f\u0648\u0631\u064f \u0627\u064f\u06ec\u0644\u0631\u0651\u064e\u062d\u0650\u064a\u0645\u064f', r: '[\u0627\u0644\u0632\u0645\u0631: 50]' },
    { q: true, t: '\u064a\u064e\u0670\u0653\u0623\u064e\u064a\u0651\u064f\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0627\u064f\u06ea\u0633\u0652\u062a\u064e\u0639\u0650\u064a\u0646\u064f\u0648\u0627\u0652 \u0628\u0650\u0627\u0644\u0635\u0651\u064e\u0628\u0652\u0631\u0650 \u0648\u064e\u0627\u0644\u0635\u0651\u064e\u0644\u064e\u0648\u0670\u0629\u0650\u06d6 \u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0645\u064e\u0639\u064e \u0627\u064e\u06ec\u0644\u0635\u0651\u064e\u0670\u0628\u0650\u0631\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 152]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0635\u0651\u064e\u0644\u064e\u0648\u0670\u0629\u064e \u0643\u064e\u0627\u0646\u064e\u062a\u0652 \u0639\u064e\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0652\u0645\u064f\u0648\u0645\u0650\u0646\u0650\u064a\u0646\u064e \u0643\u0650\u062a\u064e\u0670\u0628\u0627\u0657 \u0645\u0651\u064e\u0648\u0652\u0642\u064f\u0648\u062a\u0627\u0657', r: '[\u0627\u0644\u0646\u0633\u0627\u0621: 102]' },
    { q: true, t: '\u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0644\u064e\u0627\u0653 \u0625\u0650\u0644\u064e\u0670\u0647\u064e \u0625\u0650\u0644\u0651\u064e\u0627 \u0647\u064f\u0648\u064e\u06d6 \u0627\u064e\u06ec\u0644\u0652\u062d\u064e\u064a\u0651\u064f \u0627\u064f\u06ec\u0644\u0652\u0642\u064e\u064a\u0651\u064f\u0648\u0645\u064f', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 1]' },
    { q: true, t: '\u0648\u064e\u0627\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0648\u064e\u0639\u064e\u0645\u0650\u0644\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0635\u0651\u064e\u0670\u0644\u0650\u062d\u064e\u0670\u062a\u0650 \u0623\u064f\u0648\u0652\u0644\u064e\u0670\u0653\u0626\u0650\u0643\u064e \u0623\u064e\u0635\u0652\u062d\u064e\u0670\u0628\u064f \u0627\u064f\u06ec\u0644\u0652\u062c\u064e\u0646\u0651\u064e\u0629\u0650 \u0647\u064f\u0645\u0652 \u0641\u0650\u064a\u0647\u064e\u0627 \u062e\u064e\u0670\u0644\u0650\u062f\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 81]' },
    { q: true, t: '\u0625\u0650\u064a\u0651\u064e\u0627\u0643\u064e \u0646\u064e\u0639\u0652\u0628\u064f\u062f\u064f \u0648\u064e\u0625\u0650\u064a\u0651\u064e\u0627\u0643\u064e \u0646\u064e\u0633\u0652\u062a\u064e\u0639\u0650\u064a\u0646\u064f', r: '[\u0627\u0644\u0641\u0627\u062a\u062d\u0629: 4]' },
    { q: true, t: '\u0648\u064e\u0627\u0633\u0652\u062a\u064e\u0639\u0650\u064a\u0646\u064f\u0648\u0627\u0652 \u0628\u0650\u0627\u0644\u0635\u0651\u064e\u0628\u0652\u0631\u0650 \u0648\u064e\u0627\u0644\u0635\u0651\u064e\u0644\u064e\u0648\u0670\u0629\u0650\u06d6 \u0648\u064e\u0625\u0650\u0646\u0651\u064e\u0647\u064e\u0627 \u0644\u064e\u0643\u064e\u0628\u0650\u064a\u0631\u064e\u0629\u064c \u0627\u0650\u0644\u0651\u064e\u0627 \u0639\u064e\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0652\u062e\u064e\u0670\u0634\u0650\u0639\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 44]' },
    { q: true, t: '\u0642\u064e\u0627\u0644\u064e \u0644\u064e\u0627 \u062a\u064e\u062e\u064e\u0627\u0641\u064e\u0627\u0653 \u0625\u0650\u0646\u0651\u064e\u0646\u0650\u06d2 \u0645\u064e\u0639\u064e\u0643\u064f\u0645\u064e\u0627\u0653 \u0623\u064e\u0633\u0652\u0645\u064e\u0639\u064f \u0648\u064e\u0623\u064e\u0631\u06ea\u0649\u0670', r: '[\u0637\u0647: 45]' },
    { q: true, t: '\u0648\u064e\u0645\u064e\u0646\u0652 \u064a\u0651\u064e\u0639\u0652\u0645\u064e\u0644\u0652 \u0633\u064f\u0648\u0653\u0621\u0627\u064b \u0627\u064e\u0648\u0652 \u064a\u064e\u0638\u0652\u0644\u0650\u0645\u0652 \u0646\u064e\u0641\u0652\u0633\u064e\u0647\u064f\u06e5 \u062b\u064f\u0645\u0651\u064e \u064a\u064e\u0633\u0652\u062a\u064e\u063a\u0652\u0641\u0650\u0631\u0650 \u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u064a\u064e\u062c\u0650\u062f\u0650 \u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u063a\u064e\u0641\u064f\u0648\u0631\u0627\u0657 \u0631\u0651\u064e\u062d\u0650\u064a\u0645\u0627\u0657', r: '[\u0627\u0644\u0646\u0633\u0627\u0621: 109]' },
    { q: true, t: '\u0648\u064e\u0627\u0630\u0652\u0643\u064f\u0631 \u0631\u0651\u064e\u0628\u0651\u064e\u0643\u064e \u0643\u064e\u062b\u0650\u064a\u0631\u0627\u0657 \u0648\u064e\u0633\u064e\u0628\u0651\u0650\u062d\u0652 \u0628\u0650\u0627\u0644\u0652\u0639\u064e\u0634\u0650\u064a\u0651\u0650 \u0648\u064e\u0627\u0644\u0650\u0627\u0628\u0652\u0643\u06ea\u0670\u0631\u0650', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 41]' },
    { q: true, t: '\u062d\u064e\u0670\u0641\u0650\u0638\u064f\u0648\u0627\u0652 \u0639\u064e\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0635\u0651\u064e\u0644\u064e\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0627\u0644\u0635\u0651\u064e\u0644\u064e\u0648\u0670\u0629\u0650 \u0627\u0650\u06ec\u0644\u0652\u0648\u064f\u0633\u0652\u0637\u06ea\u0649\u0670 \u0648\u064e\u0642\u064f\u0648\u0645\u064f\u0648\u0627\u0652 \u0644\u0650\u0644\u0647\u0650 \u0642\u064e\u0670\u0646\u0650\u062a\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 236]' },
    { q: true, t: '\u0644\u0651\u064e\u0627 \u062a\u064f\u062f\u0652\u0631\u0650\u0643\u064f\u0647\u064f \u0627\u064f\u06ec\u0644\u064e\u0627\u0628\u0652\u0635\u064e\u0670\u0631\u064f\u06d6 \u0648\u064e\u0647\u064f\u0648\u064e \u064a\u064f\u062f\u0652\u0631\u0650\u0643\u064f \u0627\u064f\u06ec\u0644\u064e\u0627\u0628\u0652\u0635\u064e\u0670\u0631\u064e\u06d6 \u0648\u064e\u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0637\u0650\u064a\u0641\u064f \u0627\u064f\u06ec\u0644\u0652\u062e\u064e\u0628\u0650\u064a\u0631\u064f', r: '[\u0627\u0644\u0623\u0646\u0639\u0627\u0645: 104]' },
    { q: true, t: '\u0633\u064e\u0627\u0631\u0650\u0639\u064f\u0648\u0653\u0627\u0652 \u0625\u0650\u0644\u064e\u0649\u0670 \u0645\u064e\u063a\u0652\u0641\u0650\u0631\u064e\u0629\u0656 \u0645\u0651\u0650\u0646 \u0631\u0651\u064e\u0628\u0651\u0650\u0643\u064f\u0645\u0652 \u0648\u064e\u062c\u064e\u0646\u0651\u064e\u0629\u064d \u0639\u064e\u0631\u0652\u0636\u064f\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u064f \u0648\u064e\u0627\u0644\u064e\u0627\u0631\u0652\u0636\u064f \u0623\u064f\u0639\u0650\u062f\u0651\u064e\u062a\u0652 \u0644\u0650\u0644\u0652\u0645\u064f\u062a\u0651\u064e\u0642\u0650\u064a\u0646\u064e', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 133]' },
    { q: true, t: '\u0633\u064e\u0628\u0651\u064e\u062d\u064e \u0644\u0650\u0644\u0647\u0650 \u0645\u064e\u0627 \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0627\u0644\u064e\u0627\u0631\u0652\u0636\u0650\u06d6 \u0648\u064e\u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0652\u0639\u064e\u0632\u0650\u064a\u0632\u064f \u0627\u064f\u06ec\u0644\u0652\u062d\u064e\u0643\u0650\u064a\u0645\u064f\u06d6 \u0644\u064e\u0647\u064f\u06e5 \u0645\u064f\u0644\u0652\u0643\u064f \u0627\u064f\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0627\u0644\u064e\u0627\u0631\u0652\u0636\u0650 \u064a\u064f\u062d\u0652\u064a\u0650\u06e6 \u0648\u064e\u064a\u064f\u0645\u0650\u064a\u062a\u064f\u06d6 \u0648\u064e\u0647\u064f\u0648\u064e \u0639\u064e\u0644\u064e\u0649\u0670 \u0643\u064f\u0644\u0651\u0650 \u0634\u064e\u06d2\u0652\u0621\u0656 \u0642\u064e\u062f\u0650\u064a\u0631\u064c', r: '[\u0627\u0644\u062d\u062f\u064a\u062f: 1-2]' },
    { q: true, t: '\u0643\u064e\u0645 \u0645\u0651\u0650\u0646 \u0641\u0650\u064a\u0654\u064e\u0629\u0656 \u0642\u064e\u0644\u0650\u064a\u0644\u064e\u0629\u064d \u063a\u064e\u0644\u064e\u0628\u064e\u062a\u0652 \u0641\u0650\u064a\u0654\u064e\u0629\u0657 \u0643\u064e\u062b\u0650\u064a\u0631\u064e\u0629\u064e\u06e2 \u0628\u0650\u0625\u0650\u0630\u0652\u0646\u0650 \u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u0650\u06d6 \u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u0645\u064e\u0639\u064e \u0627\u064e\u06ec\u0644\u0635\u0651\u064e\u0670\u0628\u0650\u0631\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 247]' },
    { q: true, t: '\u0642\u064e\u0627\u0644\u064e \u0643\u064e\u0644\u0651\u064e\u0627\u0653\u06d6 \u0625\u0650\u0646\u0651\u064e \u0645\u064e\u0639\u0650\u06d2 \u0631\u064e\u0628\u0651\u0650\u06d2 \u0633\u064e\u064a\u064e\u0647\u0652\u062f\u0650\u064a\u0646\u0650', r: '[\u0627\u0644\u0634\u0639\u0631\u0627\u0621: 62]' },
    { q: true, t: '\u0643\u064e\u062a\u064e\u0628\u064e \u0631\u064e\u0628\u0651\u064f\u0643\u064f\u0645\u0652 \u0639\u064e\u0644\u064e\u0649\u0670 \u0646\u064e\u0641\u0652\u0633\u0650\u0647\u0650 \u0627\u0650\u06ec\u0644\u0631\u0651\u064e\u062d\u0652\u0645\u064e\u0629\u064e \u0623\u064e\u0646\u0651\u064e\u0647\u064f\u06e5 \u0645\u064e\u0646\u0652 \u0639\u064e\u0645\u0650\u0644\u064e \u0645\u0650\u0646\u0643\u064f\u0645\u0652 \u0633\u064f\u0648\u0653\u0621\u0627\u064e\u06e2 \u0628\u0650\u062c\u064e\u0647\u064e\u0670\u0644\u064e\u0629\u0656 \u062b\u064f\u0645\u0651\u064e \u062a\u064e\u0627\u0628\u064e \u0645\u0650\u0646\u06e2 \u0628\u064e\u0639\u0652\u062f\u0650\u0647\u0650\u06e6 \u0648\u064e\u0623\u064e\u0635\u0652\u0644\u064e\u062d\u064e \u0641\u064e\u0625\u0650\u0646\u0651\u064e\u0647\u064f\u06e5 \u063a\u064e\u0641\u064f\u0648\u0631\u065e \u0631\u0651\u064e\u062d\u0650\u064a\u0645\u065e', r: '[\u0627\u0644\u0623\u0646\u0639\u0627\u0645: 55]' },
    { q: true, t: '\u0648\u064e\u0642\u064e\u0627\u0644\u064e \u0631\u064e\u0628\u0651\u064f\u0643\u064f\u0645\u064f \u0627\u064f\u06df\u062f\u0652\u0639\u064f\u0648\u0646\u0650\u06d2\u0653 \u0623\u064e\u0633\u0652\u062a\u064e\u062c\u0650\u0628\u0652 \u0644\u064e\u0643\u064f\u0645\u064f\u06e5\u0653', r: '[\u063a\u0627\u0641\u0631: 60]' },
    { q: true, t: '\u0642\u064e\u062f\u064e \u0627\u064e\u0641\u0652\u0644\u064e\u062d\u064e \u0627\u064e\u06ec\u0644\u0652\u0645\u064f\u0648\u0645\u0650\u0646\u064f\u0648\u0646\u064e\u06d6 \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0647\u064f\u0645\u0652 \u0641\u0650\u06d2 \u0635\u064e\u0644\u064e\u0627\u062a\u0650\u0647\u0650\u0645\u0652 \u062e\u064e\u0670\u0634\u0650\u0639\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0645\u0624\u0645\u0646\u0648\u0646: 1-2]' },
    { q: true, t: '\u0648\u064e\u0645\u064e\u0627\u0653 \u0623\u064e\u0631\u0652\u0633\u064e\u0644\u0652\u0646\u064e\u0627 \u0645\u0650\u0646 \u0642\u064e\u0628\u0652\u0644\u0650\u0643\u064e \u0645\u0650\u0646 \u0631\u0651\u064e\u0633\u064f\u0648\u0644\u064d \u0627\u0650\u0644\u0651\u064e\u0627 \u064a\u064f\u0648\u062d\u06ea\u0649\u0670\u0653 \u0625\u0650\u0644\u064e\u064a\u0652\u0647\u0650 \u0623\u064e\u0646\u0651\u064e\u0647\u064f\u06e5 \u0644\u064e\u0627\u0653 \u0625\u0650\u0644\u064e\u0670\u0647\u064e \u0625\u0650\u0644\u0651\u064e\u0627\u0653 \u0623\u064e\u0646\u064e\u0627 \u0641\u064e\u0627\u0639\u0652\u0628\u064f\u062f\u064f\u0648\u0646\u0650', r: '[\u0627\u0644\u0623\u0646\u0628\u064a\u0627\u0621: 25]' },
    { q: true, t: '\u0623\u064f\u0648\u0652\u0644\u064e\u0670\u0653\u0626\u0650\u0643\u064e \u062c\u064e\u0632\u064e\u0627\u0653\u0624\u064f\u0647\u064f\u0645 \u0645\u0651\u064e\u063a\u0652\u0641\u0650\u0631\u064e\u0629\u065e \u0645\u0651\u0650\u0646 \u0631\u0651\u064e\u0628\u0651\u0650\u0647\u0650\u0645\u0652 \u0648\u064e\u062c\u064e\u0646\u0651\u064e\u0670\u062a\u065e \u062a\u064e\u062c\u0652\u0631\u0650\u06d2 \u0645\u0650\u0646 \u062a\u064e\u062d\u0652\u062a\u0650\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u064e\u0627\u0646\u0652\u0647\u064e\u0670\u0631\u064f \u062e\u064e\u0670\u0644\u0650\u062f\u0650\u064a\u0646\u064e \u0641\u0650\u064a\u0647\u064e\u0627\u06d6 \u0648\u064e\u0646\u0650\u0639\u0652\u0645\u064e \u0623\u064e\u062c\u0652\u0631\u064f \u0627\u064f\u06ec\u0644\u0652\u0639\u064e\u0670\u0645\u0650\u0644\u0650\u064a\u0646\u064e', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 136]' },
    { q: true, t: '\u064a\u064f\u0633\u064e\u0628\u0651\u0650\u062d\u064f \u0644\u0650\u0644\u0647\u0650 \u0645\u064e\u0627 \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0645\u064e\u0627 \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u064e\u0627\u0631\u0652\u0636\u0650\u06d6 \u0644\u064e\u0647\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u064f\u0644\u0652\u0643\u064f \u0648\u064e\u0644\u064e\u0647\u064f \u0627\u064f\u06ec\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f\u06d6 \u0648\u064e\u0647\u064f\u0648\u064e \u0639\u064e\u0644\u064e\u0649\u0670 \u0643\u064f\u0644\u0651\u0650 \u0634\u064e\u06d2\u0652\u0621\u0656 \u0642\u064e\u062f\u0650\u064a\u0631\u064c', r: '[\u0627\u0644\u062a\u063a\u0627\u0628\u0646: 1]' },
    { q: true, t: '\u0641\u064e\u0645\u064e\u0627 \u0648\u064e\u0647\u064e\u0646\u064f\u0648\u0627\u0652 \u0644\u0650\u0645\u064e\u0627\u0653 \u0623\u064e\u0635\u064e\u0627\u0628\u064e\u0647\u064f\u0645\u0652 \u0641\u0650\u06d2 \u0633\u064e\u0628\u0650\u064a\u0644\u0650 \u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0648\u064e\u0645\u064e\u0627 \u0636\u064e\u0639\u064f\u0641\u064f\u0648\u0627\u0652 \u0648\u064e\u0645\u064e\u0627 \u0627\u064e\u06ea\u0633\u0652\u062a\u064e\u0643\u064e\u0627\u0646\u064f\u0648\u0627\u0652\u06d6 \u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u064a\u064f\u062d\u0650\u0628\u0651\u064f \u0627\u064f\u06ec\u0644\u0635\u0651\u064e\u0670\u0628\u0650\u0631\u0650\u064a\u0646\u064e', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 146]' },
    { q: true, t: '\u0648\u064e\u0625\u0650\u0630\u064e\u0627 \u0633\u064e\u0623\u064e\u0644\u064e\u0643\u064e \u0639\u0650\u0628\u064e\u0627\u062f\u0650\u06d2 \u0639\u064e\u0646\u0651\u0650\u06d2 \u0641\u064e\u0625\u0650\u0646\u0651\u0650\u06d2 \u0642\u064e\u0631\u0650\u064a\u0628\u064c\u06d6 \u0627\u06df\u062c\u0650\u064a\u0628\u064f \u062f\u064e\u0639\u0652\u0648\u064e\u0629\u064e \u0627\u064e\u06ec\u0644\u062f\u0651\u064e\u0627\u0639\u0650\u06e6\u0653 \u0625\u0650\u0630\u064e\u0627 \u062f\u064e\u0639\u064e\u0627\u0646\u0650\u06e6\u06d6 \u0641\u064e\u0644\u0652\u064a\u064e\u0633\u0652\u062a\u064e\u062c\u0650\u064a\u0628\u064f\u0648\u0627\u0652 \u0644\u0650\u06d2 \u0648\u064e\u0644\u0652\u064a\u064f\u0648\u0645\u0650\u0646\u064f\u0648\u0627\u0652 \u0628\u0650\u064a\u064e \u0644\u064e\u0639\u064e\u0644\u0651\u064e\u0647\u064f\u0645\u0652 \u064a\u064e\u0631\u0652\u0634\u064f\u062f\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 185]' },
    { q: true, t: '\u0641\u064e\u0623\u064f\u0648\u0652\u0644\u064e\u0670\u0653\u0626\u0650\u0643\u064e \u064a\u064f\u0628\u064e\u062f\u0651\u0650\u0644\u064f \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0633\u064e\u064a\u0651\u0650\u0640\u0654\u064e\u0627\u062a\u0650\u0647\u0650\u0645\u0652 \u062d\u064e\u0633\u064e\u0646\u064e\u0670\u062a\u0656\u06d6 \u0648\u064e\u0643\u064e\u0627\u0646\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u063a\u064e\u0641\u064f\u0648\u0631\u0627\u0657 \u0631\u0651\u064e\u062d\u0650\u064a\u0645\u0627\u0657', r: '[\u0627\u0644\u0641\u0631\u0642\u0627\u0646: 70]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e \u0631\u064e\u0628\u0651\u0650\u06d2 \u0642\u064e\u0631\u0650\u064a\u0628\u065e \u0645\u0651\u064f\u062c\u0650\u064a\u0628\u065e', r: '[\u0647\u0648\u062f: 60]' },
    { q: true, t: '\u0648\u064e\u0623\u064e\u0642\u0650\u0645\u0650 \u0627\u0650\u06ec\u0644\u0635\u0651\u064e\u0644\u064e\u0648\u0670\u0629\u064e \u0644\u0650\u0630\u0650\u0643\u0652\u0631\u0650\u064a\u064e', r: '[\u0637\u0647: 13]' },
    { q: true, t: '\u0648\u064e\u0627\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0648\u064e\u0639\u064e\u0645\u0650\u0644\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0635\u0651\u064e\u0670\u0644\u0650\u062d\u064e\u0670\u062a\u0650 \u0633\u064e\u0646\u064f\u062f\u0652\u062e\u0650\u0644\u064f\u0647\u064f\u0645\u0652 \u062c\u064e\u0646\u0651\u064e\u0670\u062a\u0656 \u062a\u064e\u062c\u0652\u0631\u0650\u06d2 \u0645\u0650\u0646 \u062a\u064e\u062d\u0652\u062a\u0650\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u064e\u0627\u0646\u0652\u0647\u064e\u0670\u0631\u064f \u062e\u064e\u0670\u0644\u0650\u062f\u0650\u064a\u0646\u064e \u0641\u0650\u064a\u0647\u064e\u0627\u0653 \u0623\u064e\u0628\u064e\u062f\u0627\u0657\u06d6 \u0644\u0651\u064e\u0647\u064f\u0645\u0652 \u0641\u0650\u064a\u0647\u064e\u0627\u0653 \u0623\u064e\u0632\u0652\u0648\u064e\u0670\u062c\u065e \u0645\u0651\u064f\u0637\u064e\u0647\u0651\u064e\u0631\u064e\u0629\u065e\u06d6 \u0648\u064e\u0646\u064f\u062f\u0652\u062e\u0650\u0644\u064f\u0647\u064f\u0645\u0652 \u0638\u0650\u0644\u0651\u0627\u0657 \u0638\u064e\u0644\u0650\u064a\u0644\u0627\u064b', r: '[\u0627\u0644\u0646\u0633\u0627\u0621: 56]' },
    { q: true, t: '\u064a\u064f\u0633\u064e\u0628\u0651\u0650\u062d\u064f \u0644\u064e\u0647\u064f \u0627\u064f\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u064f \u0627\u064f\u06ec\u0644\u0633\u0651\u064e\u0628\u0652\u0639\u064f \u0648\u064e\u0627\u0644\u064e\u0627\u0631\u0652\u0636\u064f \u0648\u064e\u0645\u064e\u0646 \u0641\u0650\u064a\u0647\u0650\u0646\u0651\u064e\u06d6 \u0648\u064e\u0625\u0650\u0646 \u0645\u0651\u0650\u0646 \u0634\u064e\u06d2\u0652\u0621\u064d \u0627\u0650\u0644\u0651\u064e\u0627 \u064a\u064f\u0633\u064e\u0628\u0651\u0650\u062d\u064f \u0628\u0650\u062d\u064e\u0645\u0652\u062f\u0650\u0647\u0650\u06e6\u06d6 \u0648\u064e\u0644\u064e\u0670\u0643\u0650\u0646 \u0644\u0651\u064e\u0627 \u062a\u064e\u0641\u0652\u0642\u064e\u0647\u064f\u0648\u0646\u064e \u062a\u064e\u0633\u0652\u0628\u0650\u064a\u062d\u064e\u0647\u064f\u0645\u064f\u06e5\u0653\u06d6 \u0625\u0650\u0646\u0651\u064e\u0647\u064f\u06e5 \u0643\u064e\u0627\u0646\u064e \u062d\u064e\u0644\u0650\u064a\u0645\u0627\u064b \u063a\u064e\u0641\u064f\u0648\u0631\u0627\u0657', r: '[\u0627\u0644\u0625\u0633\u0631\u0627\u0621: 44]' },
    { q: true, t: '\u0648\u064e\u0627\u0635\u0652\u0628\u0650\u0631\u064f\u0648\u0653\u0627\u0652\u06d6 \u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0645\u064e\u0639\u064e \u0627\u064e\u06ec\u0644\u0635\u0651\u064e\u0670\u0628\u0650\u0631\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0623\u0646\u0641\u0627\u0644: 47]' },
    { q: true, t: '\u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0648\u064e\u062a\u064e\u0637\u0652\u0645\u064e\u0626\u0650\u0646\u0651\u064f \u0642\u064f\u0644\u064f\u0648\u0628\u064f\u0647\u064f\u0645 \u0628\u0650\u0630\u0650\u0643\u0652\u0631\u0650 \u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u0650\u06d6 \u0623\u064e\u0644\u064e\u0627 \u0628\u0650\u0630\u0650\u0643\u0652\u0631\u0650 \u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u062a\u064e\u0637\u0652\u0645\u064e\u0626\u0650\u0646\u0651\u064f \u0627\u064f\u06ec\u0644\u0652\u0642\u064f\u0644\u064f\u0648\u0628\u064f', r: '[\u0627\u0644\u0631\u0639\u062f: 29]' },
    { q: true, t: '\u0648\u064e\u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u06d2 \u064a\u064e\u0642\u0652\u0628\u064e\u0644\u064f \u0627\u064f\u06ec\u0644\u062a\u0651\u064e\u0648\u0652\u0628\u064e\u0629\u064e \u0639\u064e\u0646\u0652 \u0639\u0650\u0628\u064e\u0627\u062f\u0650\u0647\u0650\u06e6 \u0648\u064e\u064a\u064e\u0639\u0652\u0641\u064f\u0648\u0627\u0652 \u0639\u064e\u0646\u0650 \u0627\u0650\u06ec\u0644\u0633\u0651\u064e\u064a\u0651\u0650\u0640\u0654\u064e\u0627\u062a\u0650 \u0648\u064e\u064a\u064e\u0639\u0652\u0644\u064e\u0645\u064f \u0645\u064e\u0627 \u064a\u064e\u0641\u0652\u0639\u064e\u0644\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0634\u0648\u0631\u0649: 23]' },
    { q: true, t: '\u0641\u064e\u0625\u0650\u0646\u0651\u064e \u0645\u064e\u0639\u064e \u0627\u064e\u06ec\u0644\u0652\u0639\u064f\u0633\u0652\u0631\u0650 \u064a\u064f\u0633\u0652\u0631\u0627\u064b \u0627\u0650\u0646\u0651\u064e \u0645\u064e\u0639\u064e \u0627\u064e\u06ec\u0644\u0652\u0639\u064f\u0633\u0652\u0631\u0650 \u064a\u064f\u0633\u0652\u0631\u0627\u0657', r: '[\u0627\u0644\u0634\u0631\u062d: 5-6]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0635\u0651\u064e\u0644\u064e\u0648\u0670\u0629\u064e \u062a\u064e\u0646\u0652\u0647\u06ea\u0649\u0670 \u0639\u064e\u0646\u0650 \u0627\u0650\u06ec\u0644\u0652\u0641\u064e\u062d\u0652\u0634\u064e\u0627\u0653\u0621\u0650 \u0648\u064e\u0627\u0644\u0652\u0645\u064f\u0646\u0643\u064e\u0631\u0650', r: '[\u0627\u0644\u0639\u0646\u0643\u0628\u0648\u062a: 45]' },
    { q: true, t: '\u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0652\u062d\u064e\u064a\u0651\u064f\u06d6 \u0644\u064e\u0627\u0653 \u0625\u0650\u0644\u064e\u0670\u0647\u064e \u0625\u0650\u0644\u0651\u064e\u0627 \u0647\u064f\u0648\u064e\u06d6 \u0641\u064e\u0627\u062f\u0652\u0639\u064f\u0648\u0647\u064f \u0645\u064f\u062e\u0652\u0644\u0650\u0635\u0650\u064a\u0646\u064e \u0644\u064e\u0647\u064f \u0627\u064f\u06ec\u0644\u062f\u0651\u0650\u064a\u0646\u064e\u06d6 \u0627\u064e\u06ec\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f \u0644\u0650\u0644\u0647\u0650 \u0631\u064e\u0628\u0651\u0650 \u0627\u0650\u06ec\u0644\u0652\u0639\u064e\u0670\u0644\u064e\u0645\u0650\u064a\u0646\u064e', r: '[\u063a\u0627\u0641\u0631: 65]' },
    { q: true, t: '\u0642\u064e\u0627\u0644\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0647\u064e\u0670\u0630\u064e\u0627 \u064a\u064e\u0648\u0652\u0645\u064e \u064a\u064e\u0646\u0641\u064e\u0639\u064f \u0627\u064f\u06ec\u0644\u0635\u0651\u064e\u0670\u062f\u0650\u0642\u0650\u064a\u0646\u064e \u0635\u0650\u062f\u0652\u0642\u064f\u0647\u064f\u0645\u0652\u06d6 \u0644\u064e\u0647\u064f\u0645\u0652 \u062c\u064e\u0646\u0651\u064e\u0670\u062a\u065e \u062a\u064e\u062c\u0652\u0631\u0650\u06d2 \u0645\u0650\u0646 \u062a\u064e\u062d\u0652\u062a\u0650\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u064e\u0627\u0646\u0652\u0647\u064e\u0670\u0631\u064f \u062e\u064e\u0670\u0644\u0650\u062f\u0650\u064a\u0646\u064e \u0641\u0650\u064a\u0647\u064e\u0627\u0653 \u0623\u064e\u0628\u064e\u062f\u0627\u0657\u06d6 \u0631\u0651\u064e\u0636\u0650\u064a\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0639\u064e\u0646\u0652\u0647\u064f\u0645\u0652 \u0648\u064e\u0631\u064e\u0636\u064f\u0648\u0627\u0652 \u0639\u064e\u0646\u0652\u0647\u064f\u06d6 \u0630\u064e\u0670\u0644\u0650\u0643\u064e \u0627\u064e\u06ec\u0644\u0652\u0641\u064e\u0648\u0652\u0632\u064f \u0627\u064f\u06ec\u0644\u0652\u0639\u064e\u0638\u0650\u064a\u0645\u064f', r: '[\u0627\u0644\u0645\u0627\u0626\u062f\u0629: 121]' },
    { q: true, t: '\u0633\u064f\u0628\u0652\u062d\u064e\u0670\u0646\u064e \u0631\u064e\u0628\u0651\u0650\u0643\u064e \u0631\u064e\u0628\u0651\u0650 \u0627\u0650\u06ec\u0644\u0652\u0639\u0650\u0632\u0651\u064e\u0629\u0650 \u0639\u064e\u0645\u0651\u064e\u0627 \u064a\u064e\u0635\u0650\u0641\u064f\u0648\u0646\u064e\u06d6 \u0648\u064e\u0633\u064e\u0644\u064e\u0670\u0645\u064c \u0639\u064e\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0652\u0645\u064f\u0631\u0652\u0633\u064e\u0644\u0650\u064a\u0646\u064e\u06d6 \u0648\u064e\u0627\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f \u0644\u0650\u0644\u0647\u0650 \u0631\u064e\u0628\u0651\u0650 \u0627\u0650\u06ec\u0644\u0652\u0639\u064e\u0670\u0644\u064e\u0645\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0635\u0627\u0641\u0627\u062a: 180-182]' },
    { q: true, t: '\u0648\u064e\u0627\u0635\u0652\u0628\u0650\u0631\u0652\u06d6 \u0641\u064e\u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0644\u064e\u0627 \u064a\u064f\u0636\u0650\u064a\u0639\u064f \u0623\u064e\u062c\u0652\u0631\u064e \u0627\u064e\u06ec\u0644\u0652\u0645\u064f\u062d\u0652\u0633\u0650\u0646\u0650\u064a\u0646\u064e', r: '[\u0647\u0648\u062f: 115]' },
    { q: true, t: '\u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u06d2 \u064a\u064f\u0635\u064e\u0644\u0651\u0650\u06d2 \u0639\u064e\u0644\u064e\u064a\u0652\u0643\u064f\u0645\u0652 \u0648\u064e\u0645\u064e\u0644\u064e\u0670\u0653\u0626\u0650\u0643\u064e\u062a\u064f\u0647\u064f\u06e5 \u0644\u0650\u064a\u064f\u062e\u0652\u0631\u0650\u062c\u064e\u0643\u064f\u0645 \u0645\u0651\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0638\u0651\u064f\u0644\u064f\u0645\u064e\u0670\u062a\u0650 \u0625\u0650\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0646\u0651\u064f\u0648\u0631\u0650\u06d6 \u0648\u064e\u0643\u064e\u0627\u0646\u064e \u0628\u0650\u0627\u0644\u0652\u0645\u064f\u0648\u0645\u0650\u0646\u0650\u064a\u0646\u064e \u0631\u064e\u062d\u0650\u064a\u0645\u0627\u0657', r: '[\u0627\u0644\u0623\u062d\u0632\u0627\u0628: 43]' },
    { q: true, t: '\u0648\u064e\u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u06d2 \u064a\u064f\u0646\u064e\u0632\u0651\u0650\u0644\u064f \u0627\u064f\u06ec\u0644\u0652\u063a\u064e\u064a\u0652\u062b\u064e \u0645\u0650\u0646\u06e2 \u0628\u064e\u0639\u0652\u062f\u0650 \u0645\u064e\u0627 \u0642\u064e\u0646\u064e\u0637\u064f\u0648\u0627\u0652 \u0648\u064e\u064a\u064e\u0646\u0634\u064f\u0631\u064f \u0631\u064e\u062d\u0652\u0645\u064e\u062a\u064e\u0647\u064f\u06e5\u06d6 \u0648\u064e\u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0652\u0648\u064e\u0644\u0650\u064a\u0651\u064f \u0627\u064f\u06ec\u0644\u0652\u062d\u064e\u0645\u0650\u064a\u062f\u064f', r: '[\u0627\u0644\u0634\u0648\u0631\u0649: 26]' },
    { q: true, t: '\u0633\u064e\u064a\u064e\u062c\u0652\u0639\u064e\u0644\u064f \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0628\u064e\u0639\u0652\u062f\u064e \u0639\u064f\u0633\u0652\u0631\u0656 \u064a\u064f\u0633\u0652\u0631\u0627\u0657', r: '[\u0627\u0644\u0637\u0644\u0627\u0642: 7]' },
    { q: true, t: '\u0648\u064e\u0644\u064e\u0630\u0650\u0643\u0652\u0631\u064f \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0623\u064e\u0643\u0652\u0628\u064e\u0631\u064f', r: '[\u0627\u0644\u0639\u0646\u0643\u0628\u0648\u062a: 45]' },
    { q: true, t: '\u0644\u064e\u064a\u0652\u0633\u064e \u0643\u064e\u0645\u0650\u062b\u0652\u0644\u0650\u0647\u0650\u06e6 \u0634\u064e\u06d2\u0652\u0621\u065e\u06d6 \u0648\u064e\u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0633\u0651\u064e\u0645\u0650\u064a\u0639\u064f \u0627\u064f\u06ec\u0644\u0652\u0628\u064e\u0635\u0650\u064a\u0631\u064f', r: '[\u0627\u0644\u0634\u0648\u0631\u0649: 9]' },
    { q: true, t: '\u064a\u064f\u0628\u064e\u0634\u0651\u0650\u0631\u064f\u0647\u064f\u0645\u0652 \u0631\u064e\u0628\u0651\u064f\u0647\u064f\u0645 \u0628\u0650\u0631\u064e\u062d\u0652\u0645\u064e\u0629\u0656 \u0645\u0651\u0650\u0646\u0652\u0647\u064f \u0648\u064e\u0631\u0650\u0636\u0652\u0648\u064e\u0670\u0646\u0656 \u0648\u064e\u062c\u064e\u0646\u0651\u064e\u0670\u062a\u0656 \u0644\u0651\u064e\u0647\u064f\u0645\u0652 \u0641\u0650\u064a\u0647\u064e\u0627 \u0646\u064e\u0639\u0650\u064a\u0645\u065e \u0645\u0651\u064f\u0642\u0650\u064a\u0645\u064c \u062e\u064e\u0670\u0644\u0650\u062f\u0650\u064a\u0646\u064e \u0641\u0650\u064a\u0647\u064e\u0627\u0653 \u0623\u064e\u0628\u064e\u062f\u0627\u064b\u06d6 \u0627\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0639\u0650\u0646\u062f\u064e\u0647\u064f\u06e5\u0653 \u0623\u064e\u062c\u0652\u0631\u064c \u0639\u064e\u0638\u0650\u064a\u0645\u065e', r: '[\u0627\u0644\u062a\u0648\u0628\u0629: 21-22]' },
    { q: true, t: '\u0641\u064e\u0633\u064f\u0628\u0652\u062d\u064e\u0670\u0646\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u062d\u0650\u064a\u0646\u064e \u062a\u064f\u0645\u0652\u0633\u064f\u0648\u0646\u064e \u0648\u064e\u062d\u0650\u064a\u0646\u064e \u062a\u064f\u0635\u0652\u0628\u0650\u062d\u064f\u0648\u0646\u064e \u0648\u064e\u0644\u064e\u0647\u064f \u0627\u064f\u06ec\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0627\u0644\u064e\u0627\u0631\u0652\u0636\u0650 \u0648\u064e\u0639\u064e\u0634\u0650\u064a\u0651\u0627\u0657 \u0648\u064e\u062d\u0650\u064a\u0646\u064e \u062a\u064f\u0638\u0652\u0647\u0650\u0631\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0631\u0648\u0645: 16-17]' },
    { q: true, t: '\u0641\u064e\u0627\u0635\u0652\u0628\u0650\u0631\u0650\u06d6 \u0627\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0652\u0639\u064e\u0670\u0642\u0650\u0628\u064e\u0629\u064e \u0644\u0650\u0644\u0652\u0645\u064f\u062a\u0651\u064e\u0642\u0650\u064a\u0646\u064e', r: '[\u0647\u0648\u062f: 49]' },
    { q: true, t: '\u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0648\u064e\u0644\u0650\u064a\u0651\u064f \u0627\u064f\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u064a\u064f\u062e\u0652\u0631\u0650\u062c\u064f\u0647\u064f\u0645 \u0645\u0651\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0638\u0651\u064f\u0644\u064f\u0645\u064e\u0670\u062a\u0650 \u0625\u0650\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0646\u0651\u064f\u0648\u0631\u0650', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 256]' },
    { q: true, t: '\u0648\u064e\u0645\u064e\u0646\u0652 \u064a\u0651\u064e\u0642\u0652\u0646\u064e\u0637\u064f \u0645\u0650\u0646 \u0631\u0651\u064e\u062d\u0652\u0645\u064e\u0629\u0650 \u0631\u064e\u0628\u0651\u0650\u0647\u0650\u06e6\u0653 \u0625\u0650\u0644\u0651\u064e\u0627 \u0627\u064e\u06ec\u0644\u0636\u0651\u064e\u0627\u0653\u0644\u0651\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u062d\u062c\u0631: 56]' },
    { q: true, t: '\u0641\u064e\u0627\u0635\u0652\u0628\u0650\u0631\u0652 \u0635\u064e\u0628\u0652\u0631\u0627\u0657 \u062c\u064e\u0645\u0650\u064a\u0644\u0627\u064b', r: '[\u0627\u0644\u0645\u0639\u0627\u0631\u062c: 5]' },
    { q: true, t: '\u0648\u064e\u0627\u0633\u0652\u062c\u064f\u062f\u0652 \u0648\u064e\u0627\u0642\u0652\u062a\u064e\u0631\u0650\u0628\u0650', r: '[\u0627\u0644\u0639\u0644\u0642: 20]' },
    { q: true, t: '\u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0627\u064f\u06ec\u0644\u0630\u0650\u06d2 \u0644\u064e\u0627\u0653 \u0625\u0650\u0644\u064e\u0670\u0647\u064e \u0625\u0650\u0644\u0651\u064e\u0627 \u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0652\u0645\u064e\u0644\u0650\u0643\u064f \u0627\u064f\u06ec\u0644\u0652\u0642\u064f\u062f\u0651\u064f\u0648\u0633\u064f \u0627\u064f\u06ec\u0644\u0633\u0651\u064e\u0644\u064e\u0670\u0645\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u064f\u0648\u0645\u0650\u0646\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u064f\u0647\u064e\u064a\u0652\u0645\u0650\u0646\u064f \u0627\u064f\u06ec\u0644\u0652\u0639\u064e\u0632\u0650\u064a\u0632\u064f \u0627\u064f\u06ec\u0644\u0652\u062c\u064e\u0628\u0651\u064e\u0627\u0631\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u064f\u062a\u064e\u0643\u064e\u0628\u0651\u0650\u0631\u064f\u06d6 \u0633\u064f\u0628\u0652\u062d\u064e\u0670\u0646\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0639\u064e\u0645\u0651\u064e\u0627 \u064a\u064f\u0634\u0652\u0631\u0650\u0643\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u062d\u0634\u0631: 23]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0648\u064e\u0639\u064e\u0645\u0650\u0644\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0635\u0651\u064e\u0670\u0644\u0650\u062d\u064e\u0670\u062a\u0650 \u064a\u064e\u0647\u0652\u062f\u0650\u064a\u0647\u0650\u0645\u0652 \u0631\u064e\u0628\u0651\u064f\u0647\u064f\u0645 \u0628\u0650\u0625\u0650\u064a\u0645\u064e\u0670\u0646\u0650\u0647\u0650\u0645\u0652\u06d6 \u062a\u064e\u062c\u0652\u0631\u0650\u06d2 \u0645\u0650\u0646 \u062a\u064e\u062d\u0652\u062a\u0650\u0647\u0650\u0645\u064f \u0627\u064f\u06ec\u0644\u064e\u0627\u0646\u0652\u0647\u064e\u0670\u0631\u064f \u0641\u0650\u06d2 \u062c\u064e\u0646\u0651\u064e\u0670\u062a\u0650 \u0627\u0650\u06ec\u0644\u0646\u0651\u064e\u0639\u0650\u064a\u0645\u0650', r: '[\u064a\u0648\u0646\u0633: 9]' },
    { q: true, t: '\u062f\u064e\u0639\u0652\u0648\u06ea\u064a\u0670\u0647\u064f\u0645\u0652 \u0641\u0650\u064a\u0647\u064e\u0627 \u0633\u064f\u0628\u0652\u062d\u064e\u0670\u0646\u064e\u0643\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f\u0645\u0651\u064e\u06d6 \u0648\u064e\u062a\u064e\u062d\u0650\u064a\u0651\u064e\u062a\u064f\u0647\u064f\u0645\u0652 \u0641\u0650\u064a\u0647\u064e\u0627 \u0633\u064e\u0644\u064e\u0670\u0645\u065e\u06d6 \u0648\u064e\u0621\u064e\u0627\u062e\u0650\u0631\u064f \u062f\u064e\u0639\u0652\u0648\u06ea\u064a\u0670\u0647\u064f\u0645\u064f\u06e5\u0653 \u0623\u064e\u0646\u0650 \u0627\u0650\u06ec\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f \u0644\u0650\u0644\u0647\u0650 \u0631\u064e\u0628\u0651\u0650 \u0627\u0650\u06ec\u0644\u0652\u0639\u064e\u0670\u0644\u064e\u0645\u0650\u064a\u0646\u064e', r: '[\u064a\u0648\u0646\u0633: 10]' },
    { q: true, t: '\u0641\u064e\u0635\u064e\u0628\u0652\u0631\u065e \u062c\u064e\u0645\u0650\u064a\u0644\u065e\u06d6 \u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u064f\u0633\u0652\u062a\u064e\u0639\u064e\u0627\u0646\u064f \u0639\u064e\u0644\u064e\u0649\u0670 \u0645\u064e\u0627 \u062a\u064e\u0635\u0650\u0641\u064f\u0648\u0646\u064e', r: '[\u064a\u0648\u0633\u0641: 18]' },
    { q: true, t: '\u0631\u064e\u0636\u0650\u064a\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0639\u064e\u0646\u0652\u0647\u064f\u0645\u0652 \u0648\u064e\u0631\u064e\u0636\u064f\u0648\u0627\u0652 \u0639\u064e\u0646\u0652\u0647\u064f\u06d6 \u0623\u064f\u0648\u0652\u0644\u064e\u0670\u0653\u0626\u0650\u0643\u064e \u062d\u0650\u0632\u0652\u0628\u064f \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u0650\u06d6 \u0623\u064e\u0644\u064e\u0627\u0653 \u0625\u0650\u0646\u0651\u064e \u062d\u0650\u0632\u0652\u0628\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0647\u064f\u0645\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u064f\u0641\u0652\u0644\u0650\u062d\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0645\u062c\u0627\u062f\u0644\u0629: 21]' },
    { q: true, t: '\u0642\u064f\u0644\u0650 \u0627\u0650\u0646 \u0643\u064f\u0646\u062a\u064f\u0645\u0652 \u062a\u064f\u062d\u0650\u0628\u0651\u064f\u0648\u0646\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0641\u064e\u0627\u062a\u0651\u064e\u0628\u0650\u0639\u064f\u0648\u0646\u0650\u06d2 \u064a\u064f\u062d\u0652\u0628\u0650\u0628\u0652\u0643\u064f\u0645\u064f \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0648\u064e\u064a\u064e\u063a\u0652\u0641\u0650\u0631\u0652 \u0644\u064e\u0643\u064f\u0645\u0652 \u0630\u064f\u0646\u064f\u0648\u0628\u064e\u0643\u064f\u0645\u0652\u06d6 \u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u063a\u064e\u0641\u064f\u0648\u0631\u065e \u0631\u0651\u064e\u062d\u0650\u064a\u0645\u065e', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 31]' },
    { q: true, t: '\u0648\u064e\u0639\u064e\u0633\u06ea\u0649\u0670\u0653 \u0623\u064e\u0646 \u062a\u064e\u0643\u0652\u0631\u064e\u0647\u064f\u0648\u0627\u0652 \u0634\u064e\u064a\u0652\u0654\u0627\u0657 \u0648\u064e\u0647\u064f\u0648\u064e \u062e\u064e\u064a\u0652\u0631\u065e \u0644\u0651\u064e\u0643\u064f\u0645\u0652', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 214]' },
    { q: true, t: '\u0648\u064e\u0627\u0645\u064f\u0631\u064e \u0627\u064e\u0647\u0652\u0644\u064e\u0643\u064e \u0628\u0650\u0627\u0644\u0635\u0651\u064e\u0644\u064e\u0648\u0670\u0629\u0650 \u0648\u064e\u0627\u0635\u0652\u0637\u064e\u0628\u0650\u0631\u0652 \u0639\u064e\u0644\u064e\u064a\u0652\u0647\u064e\u0627', r: '[\u0637\u0647: 131]' },
    { q: true, t: '\u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0627\u064f\u06ec\u0644\u0652\u062e\u064e\u0670\u0644\u0650\u0642\u064f \u0627\u064f\u06ec\u0644\u0652\u0628\u064e\u0627\u0631\u0650\u06d2\u0654\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u064f\u0635\u064e\u0648\u0651\u0650\u0631\u064f\u06d6 \u0644\u064e\u0647\u064f \u0627\u064f\u06ec\u0644\u064e\u0627\u0633\u0652\u0645\u064e\u0627\u0653\u0621\u064f \u0627\u064f\u06ec\u0644\u0652\u062d\u064f\u0633\u0652\u0646\u06ea\u0649\u0670\u06d6 \u064a\u064f\u0633\u064e\u0628\u0651\u0650\u062d\u064f \u0644\u064e\u0647\u064f\u06e5 \u0645\u064e\u0627 \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0627\u0644\u064e\u0627\u0631\u0652\u0636\u0650\u06d6 \u0648\u064e\u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0652\u0639\u064e\u0632\u0650\u064a\u0632\u064f \u0627\u064f\u06ec\u0644\u0652\u062d\u064e\u0643\u0650\u064a\u0645\u064f', r: '[\u0627\u0644\u062d\u0634\u0631: 24]' },
    { q: true, t: '\u0644\u0651\u0650\u0644\u0630\u0650\u064a\u0646\u064e \u0623\u064e\u062d\u0652\u0633\u064e\u0646\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0652\u062d\u064f\u0633\u0652\u0646\u06ea\u0649\u0670 \u0648\u064e\u0632\u0650\u064a\u064e\u0627\u062f\u064e\u0629\u065e\u06d6 \u0648\u064e\u0644\u064e\u0627 \u064a\u064e\u0631\u0652\u0647\u064e\u0642\u064f \u0648\u064f\u062c\u064f\u0648\u0647\u064e\u0647\u064f\u0645\u0652 \u0642\u064e\u062a\u064e\u0631\u065e \u0648\u064e\u0644\u064e\u0627 \u0630\u0650\u0644\u0651\u064e\u0629\u064c\u06d6 \u0627\u06df\u0648\u0652\u0644\u064e\u0670\u0653\u0626\u0650\u0643\u064e \u0623\u064e\u0635\u0652\u062d\u064e\u0670\u0628\u064f \u0627\u064f\u06ec\u0644\u0652\u062c\u064e\u0646\u0651\u064e\u0629\u0650\u06d6 \u0647\u064f\u0645\u0652 \u0641\u0650\u064a\u0647\u064e\u0627 \u062e\u064e\u0670\u0644\u0650\u062f\u064f\u0648\u0646\u064e', r: '[\u064a\u0648\u0646\u0633: 26]' },
    { q: true, t: '\u0648\u064e\u0642\u064e\u0627\u0644\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f \u0644\u0650\u0644\u0647\u0650 \u0627\u0650\u06ec\u0644\u0630\u0650\u06d2 \u0635\u064e\u062f\u064e\u0642\u064e\u0646\u064e\u0627 \u0648\u064e\u0639\u0652\u062f\u064e\u0647\u064f\u06e5 \u0648\u064e\u0623\u064e\u0648\u0652\u0631\u064e\u062b\u064e\u0646\u064e\u0627 \u0627\u064e\u06ec\u0644\u064e\u0627\u0631\u0652\u0636\u064e \u0646\u064e\u062a\u064e\u0628\u064e\u0648\u0651\u064e\u0623\u064f \u0645\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0652\u062c\u064e\u0646\u0651\u064e\u0629\u0650 \u062d\u064e\u064a\u0652\u062b\u064f \u0646\u064e\u0634\u064e\u0627\u0653\u0621\u064f \u0641\u064e\u0646\u0650\u0639\u0652\u0645\u064e \u0623\u064e\u062c\u0652\u0631\u064f \u0627\u064f\u06ec\u0644\u0652\u0639\u064e\u0670\u0645\u0650\u0644\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0632\u0645\u0631: 71]' },
    { q: true, t: '\u0641\u064e\u0635\u064e\u0628\u0652\u0631\u065e \u062c\u064e\u0645\u0650\u064a\u0644\u064c\u06d6 \u0639\u064e\u0633\u064e\u0649 \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0623\u064e\u0646\u0652 \u064a\u0651\u064e\u0627\u062a\u0650\u064a\u064e\u0646\u0650\u06d2 \u0628\u0650\u0647\u0650\u0645\u0652 \u062c\u064e\u0645\u0650\u064a\u0639\u0627\u064b\u06d6 \u0627\u0650\u0646\u0651\u064e\u0647\u064f\u06e5 \u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0652\u0639\u064e\u0644\u0650\u064a\u0645\u064f \u0627\u064f\u06ec\u0644\u0652\u062d\u064e\u0643\u0650\u064a\u0645\u064f', r: '[\u064a\u0648\u0633\u0641: 83]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e\u0645\u064e\u0627 \u0627\u064e\u06ec\u0644\u0652\u0645\u064f\u0648\u0645\u0650\u0646\u064f\u0648\u0646\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0625\u0650\u0630\u064e\u0627 \u0630\u064f\u0643\u0650\u0631\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0648\u064e\u062c\u0650\u0644\u064e\u062a\u0652 \u0642\u064f\u0644\u064f\u0648\u0628\u064f\u0647\u064f\u0645\u0652 \u0648\u064e\u0625\u0650\u0630\u064e\u0627 \u062a\u064f\u0644\u0650\u064a\u064e\u062a\u0652 \u0639\u064e\u0644\u064e\u064a\u0652\u0647\u0650\u0645\u064f\u06e5\u0653 \u0621\u064e\u0627\u064a\u064e\u0670\u062a\u064f\u0647\u064f\u06e5 \u0632\u064e\u0627\u062f\u064e\u062a\u0652\u0647\u064f\u0645\u064f\u06e5\u0653 \u0625\u0650\u064a\u0645\u064e\u0670\u0646\u0627\u0657 \u0648\u064e\u0639\u064e\u0644\u064e\u0649\u0670 \u0631\u064e\u0628\u0651\u0650\u0647\u0650\u0645\u0652 \u064a\u064e\u062a\u064e\u0648\u064e\u0643\u0651\u064e\u0644\u064f\u0648\u0646\u064e\u06d6 \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u064a\u064f\u0642\u0650\u064a\u0645\u064f\u0648\u0646\u064e \u0627\u064e\u06ec\u0644\u0635\u0651\u064e\u0644\u064e\u0648\u0670\u0629\u064e \u0648\u064e\u0645\u0650\u0645\u0651\u064e\u0627 \u0631\u064e\u0632\u064e\u0642\u0652\u0646\u064e\u0670\u0647\u064f\u0645\u0652 \u064a\u064f\u0646\u0641\u0650\u0642\u064f\u0648\u0646\u064e \u0623\u064f\u0648\u0652\u0644\u064e\u0670\u0653\u0626\u0650\u0643\u064e \u0647\u064f\u0645\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u064f\u0648\u0645\u0650\u0646\u064f\u0648\u0646\u064e \u062d\u064e\u0642\u0651\u0627\u0657\u06d6 \u0644\u0651\u064e\u0647\u064f\u0645\u0652 \u062f\u064e\u0631\u064e\u062c\u064e\u0670\u062a\u064c \u0639\u0650\u0646\u062f\u064e \u0631\u064e\u0628\u0651\u0650\u0647\u0650\u0645\u0652 \u0648\u064e\u0645\u064e\u063a\u0652\u0641\u0650\u0631\u064e\u0629\u065e \u0648\u064e\u0631\u0650\u0632\u0652\u0642\u065e \u0643\u064e\u0631\u0650\u064a\u0645\u065e', r: '[\u0627\u0644\u0623\u0646\u0641\u0627\u0644: 2-4]' },
    { q: true, t: '\u0648\u064e\u0623\u064e\u0646\u0650 \u0627\u0650\u06ea\u0633\u0652\u062a\u064e\u063a\u0652\u0641\u0650\u0631\u064f\u0648\u0627\u0652 \u0631\u064e\u0628\u0651\u064e\u0643\u064f\u0645\u0652 \u062b\u064f\u0645\u0651\u064e \u062a\u064f\u0648\u0628\u064f\u0648\u0653\u0627\u0652 \u0625\u0650\u0644\u064e\u064a\u0652\u0647\u0650 \u064a\u064f\u0645\u064e\u062a\u0651\u0650\u0639\u0652\u0643\u064f\u0645 \u0645\u0651\u064e\u062a\u064e\u0670\u0639\u0627\u064b \u062d\u064e\u0633\u064e\u0646\u0627\u064b \u0627\u0650\u0644\u064e\u0649\u0670\u0653 \u0623\u064e\u062c\u064e\u0644\u0656 \u0645\u0651\u064f\u0633\u064e\u0645\u0651\u0649\u0657 \u0648\u064e\u064a\u064f\u0648\u062a\u0650 \u0643\u064f\u0644\u0651\u064e \u0630\u0650\u06d2 \u0641\u064e\u0636\u0652\u0644\u0656 \u0641\u064e\u0636\u0652\u0644\u064e\u0647\u064f\u06e5', r: '[\u0647\u0648\u062f: 3]' },
    { q: true, t: '\u062d\u064e\u0633\u0652\u0628\u064f\u0646\u064e\u0627 \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0648\u064e\u0646\u0650\u0639\u0652\u0645\u064e \u0627\u064e\u06ec\u0644\u0652\u0648\u064e\u0643\u0650\u064a\u0644\u064f', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 173]' },
    { q: true, t: '\u0642\u064f\u0644\u0650 \u0627\u0650\u0646\u0651\u064e \u0635\u064e\u0644\u064e\u0627\u062a\u0650\u06d2 \u0648\u064e\u0646\u064f\u0633\u064f\u0643\u0650\u06d2 \u0648\u064e\u0645\u064e\u062d\u0652\u064a\u06ea\u0627\u0653\u06d2\u0652 \u0648\u064e\u0645\u064e\u0645\u064e\u0627\u062a\u0650\u064a\u064e \u0644\u0650\u0644\u0647\u0650 \u0631\u064e\u0628\u0651\u0650 \u0627\u0650\u06ec\u0644\u0652\u0639\u064e\u0670\u0644\u064e\u0645\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0623\u0646\u0639\u0627\u0645: 164]' },
    { q: true, t: '\u0648\u064e\u0642\u064f\u0644\u0650 \u0627\u0650\u06ec\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f \u0644\u0650\u0644\u0647\u0650 \u0627\u0650\u06ec\u0644\u0630\u0650\u06d2 \u0644\u064e\u0645\u0652 \u064a\u064e\u062a\u0651\u064e\u062e\u0650\u0630\u0652 \u0648\u064e\u0644\u064e\u062f\u0627\u0657 \u0648\u064e\u0644\u064e\u0645\u0652 \u064a\u064e\u0643\u064f\u0646 \u0644\u0651\u064e\u0647\u064f\u06e5 \u0634\u064e\u0631\u0650\u064a\u0643\u065e \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u0652\u0645\u064f\u0644\u0652\u0643\u0650 \u0648\u064e\u0644\u064e\u0645\u0652 \u064a\u064e\u0643\u064f\u0646 \u0644\u0651\u064e\u0647\u064f\u06e5 \u0648\u064e\u0644\u0650\u064a\u0651\u065e \u0645\u0651\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0630\u0651\u064f\u0644\u0651\u0650\u06d6 \u0648\u064e\u0643\u064e\u0628\u0651\u0650\u0631\u0652\u0647\u064f \u062a\u064e\u0643\u0652\u0628\u0650\u064a\u0631\u0627\u064b', r: '[\u0627\u0644\u0625\u0633\u0631\u0627\u0621: 110]' },
    { q: true, t: '\u0627\u064e\u0644\u064e\u0627\u0653 \u0625\u0650\u0646\u0651\u064e \u0623\u064e\u0648\u0652\u0644\u0650\u064a\u064e\u0627\u0653\u0621\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0644\u064e\u0627 \u062e\u064e\u0648\u0652\u0641\u064c \u0639\u064e\u0644\u064e\u064a\u0652\u0647\u0650\u0645\u0652 \u0648\u064e\u0644\u064e\u0627 \u0647\u064f\u0645\u0652 \u064a\u064e\u062d\u0652\u0632\u064e\u0646\u064f\u0648\u0646\u064e\u06d6 \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0648\u064e\u0643\u064e\u0627\u0646\u064f\u0648\u0627\u0652 \u064a\u064e\u062a\u0651\u064e\u0642\u064f\u0648\u0646\u064e \u0644\u064e\u0647\u064f\u0645\u064f \u0627\u064f\u06ec\u0644\u0652\u0628\u064f\u0634\u0652\u0631\u06ea\u0649\u0670 \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u0652\u062d\u064e\u064a\u064e\u0648\u0670\u0629\u0650 \u0627\u0650\u06ec\u0644\u062f\u0651\u064f\u0646\u0652\u064a\u06ea\u0627 \u0648\u064e\u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u064e\u0627\u062e\u0650\u0631\u064e\u0629\u0650\u06d6 \u0644\u064e\u0627 \u062a\u064e\u0628\u0652\u062f\u0650\u064a\u0644\u064e \u0644\u0650\u0643\u064e\u0644\u0650\u0645\u064e\u0670\u062a\u0650 \u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u0650\u06d6 \u0630\u064e\u0670\u0644\u0650\u0643\u064e \u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0652\u0641\u064e\u0648\u0652\u0632\u064f \u0627\u064f\u06ec\u0644\u0652\u0639\u064e\u0638\u0650\u064a\u0645\u064f', r: '[\u064a\u0648\u0646\u0633: 62-64]' },
    { q: true, t: '\u0648\u064e\u0642\u064e\u0627\u0644\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f \u0644\u0650\u0644\u0647\u0650 \u0627\u0650\u06ec\u0644\u0630\u0650\u06d2\u0653 \u0623\u064e\u0630\u0652\u0647\u064e\u0628\u064e \u0639\u064e\u0646\u0651\u064e\u0627 \u0627\u064e\u06ec\u0644\u0652\u062d\u064e\u0632\u064e\u0646\u064e \u0625\u0650\u0646\u0651\u064e \u0631\u064e\u0628\u0651\u064e\u0646\u064e\u0627 \u0644\u064e\u063a\u064e\u0641\u064f\u0648\u0631\u065e \u0634\u064e\u0643\u064f\u0648\u0631\u064c', r: '[\u0641\u0627\u0637\u0631: 34]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e\u0647\u064f\u06e5 \u0645\u064e\u0646\u0652 \u064a\u0651\u064e\u062a\u0651\u064e\u0642\u0650 \u0648\u064e\u064a\u064e\u0635\u0652\u0628\u0650\u0631\u0652 \u0641\u064e\u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0644\u064e\u0627 \u064a\u064f\u0636\u0650\u064a\u0639\u064f \u0623\u064e\u062c\u0652\u0631\u064e \u0627\u064e\u06ec\u0644\u0652\u0645\u064f\u062d\u0652\u0633\u0650\u0646\u0650\u064a\u0646\u064e', r: '[\u064a\u0648\u0633\u0641: 90]' },
    { q: true, t: '\u0648\u064e\u0627\u062f\u0652\u0639\u064f\u0648\u0647\u064f \u062e\u064e\u0648\u0652\u0641\u0627\u0657 \u0648\u064e\u0637\u064e\u0645\u064e\u0639\u0627\u064b\u06d6 \u0627\u0650\u0646\u0651\u064e \u0631\u064e\u062d\u0652\u0645\u064e\u062a\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0642\u064e\u0631\u0650\u064a\u0628\u065e \u0645\u0651\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0652\u0645\u064f\u062d\u0652\u0633\u0650\u0646\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0623\u0639\u0631\u0627\u0641: 55]' },
    { q: true, t: '\u0623\u064e\u0644\u064e\u0627 \u062a\u064f\u062d\u0650\u0628\u0651\u064f\u0648\u0646\u064e \u0623\u064e\u0646\u0652 \u064a\u0651\u064e\u063a\u0652\u0641\u0650\u0631\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0644\u064e\u0643\u064f\u0645\u0652\u06d6 \u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u063a\u064e\u0641\u064f\u0648\u0631\u065e \u0631\u0651\u064e\u062d\u0650\u064a\u0645\u064c', r: '[\u0627\u0644\u0646\u0648\u0631: 22]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u064a\u064f\u062d\u0650\u0628\u0651\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u064f\u062a\u064e\u0648\u064e\u0643\u0651\u0650\u0644\u0650\u064a\u0646\u064e', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 159]' },
    { q: true, t: '\u0648\u064e\u0627\u0639\u0652\u0628\u064f\u062f\u0652 \u0631\u064e\u0628\u0651\u064e\u0643\u064e \u062d\u064e\u062a\u0651\u064e\u0649\u0670 \u064a\u064e\u0627\u062a\u0650\u064a\u064e\u0643\u064e \u0627\u064e\u06ec\u0644\u0652\u064a\u064e\u0642\u0650\u064a\u0646\u064f', r: '[\u0627\u0644\u062d\u062c\u0631: 99]' },
    { q: true, t: '\u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u064e\u0627\u0648\u0651\u064e\u0644\u064f \u0648\u064e\u0627\u0644\u064e\u0627\u062e\u0650\u0631\u064f \u0648\u064e\u0627\u0644\u0638\u0651\u064e\u0670\u0647\u0650\u0631\u064f \u0648\u064e\u0627\u0644\u0652\u0628\u064e\u0627\u0637\u0650\u0646\u064f\u06d6 \u0648\u064e\u0647\u064f\u0648\u064e \u0628\u0650\u0643\u064f\u0644\u0651\u0650 \u0634\u064e\u06d2\u0652\u0621\u064d \u0639\u064e\u0644\u0650\u064a\u0645\u064c', r: '[\u0627\u0644\u062d\u062f\u064a\u062f: 3]' },
    { q: true, t: '\u0648\u064e\u0642\u0650\u064a\u0644\u064e \u0644\u0650\u0644\u0630\u0650\u064a\u0646\u064e \u0627\u064e\u06ea\u062a\u0651\u064e\u0642\u064e\u0648\u0652\u0627\u0652 \u0645\u064e\u0627\u0630\u064e\u0627\u0653 \u0623\u064e\u0646\u0632\u064e\u0644\u064e \u0631\u064e\u0628\u0651\u064f\u0643\u064f\u0645\u0652 \u0642\u064e\u0627\u0644\u064f\u0648\u0627\u0652 \u062e\u064e\u064a\u0652\u0631\u0627\u0657\u06d6 \u0644\u0651\u0650\u0644\u0630\u0650\u064a\u0646\u064e \u0623\u064e\u062d\u0652\u0633\u064e\u0646\u064f\u0648\u0627\u0652 \u0641\u0650\u06d2 \u0647\u064e\u0670\u0630\u0650\u0647\u0650 \u0627\u0650\u06ec\u0644\u062f\u0651\u064f\u0646\u0652\u064a\u06ea\u0627 \u062d\u064e\u0633\u064e\u0646\u064e\u0629\u065e\u06d6 \u0648\u064e\u0644\u064e\u062f\u064e\u0627\u0631\u064f \u0627\u064f\u06ec\u0644\u064e\u0627\u062e\u0650\u0631\u064e\u0629\u0650 \u062e\u064e\u064a\u0652\u0631\u065e\u06d6 \u0648\u064e\u0644\u064e\u0646\u0650\u0639\u0652\u0645\u064e \u062f\u064e\u0627\u0631\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u064f\u062a\u0651\u064e\u0642\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0646\u062d\u0644: 30]' },
    { q: true, t: '\u0627\u0650\u06ec\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f \u0644\u0650\u0644\u0647\u0650 \u0627\u0650\u06ec\u0644\u0630\u0650\u06d2\u0653 \u0623\u064e\u0646\u0632\u064e\u0644\u064e \u0639\u064e\u0644\u064e\u0649\u0670 \u0639\u064e\u0628\u0652\u062f\u0650\u0647\u0650 \u0627\u0650\u06ec\u0644\u0652\u0643\u0650\u062a\u064e\u0670\u0628\u064e \u0648\u064e\u0644\u064e\u0645\u0652 \u064a\u064e\u062c\u0652\u0639\u064e\u0644 \u0644\u0651\u064e\u0647\u064f\u06e5 \u0639\u0650\u0648\u064e\u062c\u0627\u0657', r: '[\u0627\u0644\u0643\u0647\u0641: 1]' },
    { q: true, t: '\u0645\u064e\u0627 \u0639\u0650\u0646\u062f\u064e\u0643\u064f\u0645\u0652 \u064a\u064e\u0646\u0641\u064e\u062f\u064f\u06d6 \u0648\u064e\u0645\u064e\u0627 \u0639\u0650\u0646\u062f\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0628\u064e\u0627\u0642\u0656\u06d6 \u0648\u064e\u0644\u064e\u064a\u064e\u062c\u0652\u0632\u0650\u064a\u064e\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0635\u064e\u0628\u064e\u0631\u064f\u0648\u0653\u0627\u0652 \u0623\u064e\u062c\u0652\u0631\u064e\u0647\u064f\u0645 \u0628\u0650\u0623\u064e\u062d\u0652\u0633\u064e\u0646\u0650 \u0645\u064e\u0627 \u0643\u064e\u0627\u0646\u064f\u0648\u0627\u0652 \u064a\u064e\u0639\u0652\u0645\u064e\u0644\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0646\u062d\u0644: 96]' },
    { q: true, t: '\u0641\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u062e\u064e\u064a\u0652\u0631\u064c \u062d\u0650\u0641\u0652\u0638\u0627\u0657\u06d6 \u0648\u064e\u0647\u064f\u0648\u064e \u0623\u064e\u0631\u0652\u062d\u064e\u0645\u064f \u0627\u064f\u06ec\u0644\u0631\u0651\u064e\u0670\u062d\u0650\u0645\u0650\u064a\u0646\u064e', r: '[\u064a\u0648\u0633\u0641: 64]' },
    { q: true, t: '\u0627\u064e\u0641\u064e\u0644\u064e\u0627 \u064a\u064e\u062a\u064f\u0648\u0628\u064f\u0648\u0646\u064e \u0625\u0650\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0648\u064e\u064a\u064e\u0633\u0652\u062a\u064e\u063a\u0652\u0641\u0650\u0631\u064f\u0648\u0646\u064e\u0647\u064f\u06e5\u06d6 \u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u063a\u064e\u0641\u064f\u0648\u0631\u065e \u0631\u0651\u064e\u062d\u0650\u064a\u0645\u065e', r: '[\u0627\u0644\u0645\u0627\u0626\u062f\u0629: 76]' },
    { q: true, t: '\u0648\u064e\u0631\u064e\u062d\u0652\u0645\u064e\u062a\u0650\u06d2 \u0648\u064e\u0633\u0650\u0639\u064e\u062a\u0652 \u0643\u064f\u0644\u0651\u064e \u0634\u064e\u06d2\u0652\u0621\u0656', r: '[\u0627\u0644\u0623\u0639\u0631\u0627\u0641: 156]' },
    { q: true, t: '\u0641\u064e\u0627\u0630\u0652\u0643\u064f\u0631\u064f\u0648\u0646\u0650\u06d2\u0653 \u0623\u064e\u0630\u0652\u0643\u064f\u0631\u0652\u0643\u064f\u0645\u0652 \u0648\u064e\u0627\u0634\u0652\u0643\u064f\u0631\u064f\u0648\u0627\u0652 \u0644\u0650\u06d2 \u0648\u064e\u0644\u064e\u0627 \u062a\u064e\u0643\u0652\u0641\u064f\u0631\u064f\u0648\u0646\u0650', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 151]' },
    { q: true, t: '\u0627\u0650\u0646\u0651\u064e \u0625\u0650\u0644\u064e\u0670\u0647\u064e\u0643\u064f\u0645\u0652 \u0644\u064e\u0648\u064e\u0670\u062d\u0650\u062f\u065e\u06d6 \u0631\u0651\u064e\u0628\u0651\u064f \u0627\u064f\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0627\u0644\u064e\u0627\u0631\u0652\u0636\u0650 \u0648\u064e\u0645\u064e\u0627 \u0628\u064e\u064a\u0652\u0646\u064e\u0647\u064f\u0645\u064e\u0627 \u0648\u064e\u0631\u064e\u0628\u0651\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u064e\u0634\u064e\u0670\u0631\u0650\u0642\u0650', r: '[\u0627\u0644\u0635\u0627\u0641\u0627\u062a: 4-5]' },
    { q: true, t: '\u0645\u064e\u0646\u0652 \u0639\u064e\u0645\u0650\u0644\u064e \u0635\u064e\u0670\u0644\u0650\u062d\u0627\u0657 \u0645\u0651\u0650\u0646 \u0630\u064e\u0643\u064e\u0631\u064d \u0627\u064e\u0648\u064f \u0627\u06df\u0646\u062b\u06ea\u0649\u0670 \u0648\u064e\u0647\u064f\u0648\u064e \u0645\u064f\u0648\u0645\u0650\u0646\u065e \u0641\u064e\u0644\u064e\u0646\u064f\u062d\u0652\u064a\u0650\u064a\u064e\u0646\u0651\u064e\u0647\u064f\u06e5 \u062d\u064e\u064a\u064e\u0648\u0670\u0629\u0657 \u0637\u064e\u064a\u0651\u0650\u0628\u064e\u0629\u0657 \u0648\u064e\u0644\u064e\u0646\u064e\u062c\u0652\u0632\u0650\u064a\u064e\u0646\u0651\u064e\u0647\u064f\u0645\u064f\u06e5\u0653 \u0623\u064e\u062c\u0652\u0631\u064e\u0647\u064f\u0645 \u0628\u0650\u0623\u064e\u062d\u0652\u0633\u064e\u0646\u0650 \u0645\u064e\u0627 \u0643\u064e\u0627\u0646\u064f\u0648\u0627\u0652 \u064a\u064e\u0639\u0652\u0645\u064e\u0644\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0646\u062d\u0644: 97]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e\u0645\u064e\u0627\u0653 \u0623\u064e\u0645\u0652\u0631\u064f\u0647\u064f\u06e5\u0653 \u0625\u0650\u0630\u064e\u0627\u0653 \u0623\u064e\u0631\u064e\u0627\u062f\u064e \u0634\u064e\u064a\u0652\u0654\u0627\u064b \u0627\u064e\u0646\u0652 \u064a\u0651\u064e\u0642\u064f\u0648\u0644\u064e \u0644\u064e\u0647\u064f\u06e5 \u0643\u064f\u0646\u06d6 \u0641\u064e\u064a\u064e\u0643\u064f\u0648\u0646\u064f\u06d6 \u0641\u064e\u0633\u064f\u0628\u0652\u062d\u064e\u0670\u0646\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u06d2 \u0628\u0650\u064a\u064e\u062f\u0650\u0647\u0650\u06e6 \u0645\u064e\u0644\u064e\u0643\u064f\u0648\u062a\u064f \u0643\u064f\u0644\u0651\u0650 \u0634\u064e\u06d2\u0652\u0621\u0656 \u0648\u064e\u0625\u0650\u0644\u064e\u064a\u0652\u0647\u0650 \u062a\u064f\u0631\u0652\u062c\u064e\u0639\u064f\u0648\u0646\u064e', r: '[\u064a\u0633: 81-82]' },
    { q: true, t: '\u0648\u064e\u0627\u0635\u0652\u0628\u0650\u0631\u0652\u06d6 \u0648\u064e\u0645\u064e\u0627 \u0635\u064e\u0628\u0652\u0631\u064f\u0643\u064e \u0625\u0650\u0644\u0651\u064e\u0627 \u0628\u0650\u0627\u0644\u0644\u0651\u064e\u0647\u0650\u06d6 \u0648\u064e\u0644\u064e\u0627 \u062a\u064e\u062d\u0652\u0632\u064e\u0646\u0652 \u0639\u064e\u0644\u064e\u064a\u0652\u0647\u0650\u0645\u0652 \u0648\u064e\u0644\u064e\u0627 \u062a\u064e\u0643\u064f \u0641\u0650\u06d2 \u0636\u064e\u064a\u0652\u0642\u0656 \u0645\u0651\u0650\u0645\u0651\u064e\u0627 \u064a\u064e\u0645\u0652\u0643\u064f\u0631\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0646\u062d\u0644: 127]' },
    { q: true, t: '\u0648\u064e\u0646\u064f\u0646\u064e\u0632\u0651\u0650\u0644\u064f \u0645\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0652\u0642\u064f\u0631\u0652\u0621\u064e\u0627\u0646\u0650 \u0645\u064e\u0627 \u0647\u064f\u0648\u064e \u0634\u0650\u0641\u064e\u0627\u0653\u0621\u065e \u0648\u064e\u0631\u064e\u062d\u0652\u0645\u064e\u0629\u065e \u0644\u0651\u0650\u0644\u0652\u0645\u064f\u0648\u0645\u0650\u0646\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0625\u0633\u0631\u0627\u0621: 82]' },
    { q: true, t: '\u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u064a\u064e\u0639\u0650\u062f\u064f\u0643\u064f\u0645 \u0645\u0651\u064e\u063a\u0652\u0641\u0650\u0631\u064e\u0629\u0657 \u0645\u0651\u0650\u0646\u0652\u0647\u064f \u0648\u064e\u0641\u064e\u0636\u0652\u0644\u0627\u0657\u06d6 \u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u0648\u064e\u0670\u0633\u0650\u0639\u064c \u0639\u064e\u0644\u0650\u064a\u0645\u065e', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 267]' },
    { q: true, t: '\u0646\u064e\u0628\u0651\u0650\u06d2\u0654\u0652 \u0639\u0650\u0628\u064e\u0627\u062f\u0650\u064a\u064e \u0623\u064e\u0646\u0651\u0650\u064a\u064e \u0623\u064e\u0646\u064e\u0627 \u0627\u064e\u06ec\u0644\u0652\u063a\u064e\u0641\u064f\u0648\u0631\u064f \u0627\u064f\u06ec\u0644\u0631\u0651\u064e\u062d\u0650\u064a\u0645\u064f', r: '[\u0627\u0644\u062d\u062c\u0631: 49]' },
    { q: true, t: '\u0627\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0648\u064e\u0645\u064e\u0644\u064e\u0670\u0653\u0626\u0650\u0643\u064e\u062a\u064e\u0647\u064f\u06e5 \u064a\u064f\u0635\u064e\u0644\u0651\u064f\u0648\u0646\u064e \u0639\u064e\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0646\u0651\u064e\u0628\u0650\u06d2\u0653\u0621\u0650', r: '[\u0627\u0644\u0623\u062d\u0632\u0627\u0628: 56]' },
    { q: true, t: '\u0623\u064e\u0644\u064e\u0627 \u0644\u064e\u0647\u064f \u0627\u064f\u06ec\u0644\u0652\u062e\u064e\u0644\u0652\u0642\u064f \u0648\u064e\u0627\u0644\u064e\u0627\u0645\u0652\u0631\u064f\u06d6 \u062a\u064e\u0628\u064e\u0670\u0631\u064e\u0643\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0631\u064e\u0628\u0651\u064f \u0627\u064f\u06ec\u0644\u0652\u0639\u064e\u0670\u0644\u064e\u0645\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0623\u0639\u0631\u0627\u0641: 53]' },
    { q: true, t: '\u0627\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0648\u064e\u0639\u064e\u0645\u0650\u0644\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0635\u0651\u064e\u0670\u0644\u0650\u062d\u064e\u0670\u062a\u0650 \u0643\u064e\u0627\u0646\u064e\u062a\u0652 \u0644\u064e\u0647\u064f\u0645\u0652 \u062c\u064e\u0646\u0651\u064e\u0670\u062a\u064f \u0627\u064f\u06ec\u0644\u0652\u0641\u0650\u0631\u0652\u062f\u064e\u0648\u0652\u0633\u0650 \u0646\u064f\u0632\u064f\u0644\u0627\u064b \u062e\u064e\u0670\u0644\u0650\u062f\u0650\u064a\u0646\u064e \u0641\u0650\u064a\u0647\u064e\u0627 \u0644\u064e\u0627 \u064a\u064e\u0628\u0652\u063a\u064f\u0648\u0646\u064e \u0639\u064e\u0646\u0652\u0647\u064e\u0627 \u062d\u0650\u0648\u064e\u0644\u06d6\u0627\u0657', r: '[\u0627\u0644\u0643\u0647\u0641: 102-103]' },
    { q: true, t: '\u062a\u064e\u0628\u064e\u0670\u0631\u064e\u0643\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u06d2 \u0628\u0650\u064a\u064e\u062f\u0650\u0647\u0650 \u0627\u0650\u06ec\u0644\u0652\u0645\u064f\u0644\u0652\u0643\u064f \u0648\u064e\u0647\u064f\u0648\u064e \u0639\u064e\u0644\u064e\u0649\u0670 \u0643\u064f\u0644\u0651\u0650 \u0634\u064e\u06d2\u0652\u0621\u0656 \u0642\u064e\u062f\u0650\u064a\u0631\u064c', r: '[\u0627\u0644\u0645\u0644\u0643: 1]' },
    { q: true, t: '\u0641\u064e\u0627\u0635\u0652\u0628\u0650\u0631\u0652 \u0639\u064e\u0644\u064e\u0649\u0670 \u0645\u064e\u0627 \u064a\u064e\u0642\u064f\u0648\u0644\u064f\u0648\u0646\u064e\u06d6 \u0648\u064e\u0633\u064e\u0628\u0651\u0650\u062d\u0652 \u0628\u0650\u062d\u064e\u0645\u0652\u062f\u0650 \u0631\u064e\u0628\u0651\u0650\u0643\u064e \u0642\u064e\u0628\u0652\u0644\u064e \u0637\u064f\u0644\u064f\u0648\u0639\u0650 \u0627\u0650\u06ec\u0644\u0634\u0651\u064e\u0645\u0652\u0633\u0650 \u0648\u064e\u0642\u064e\u0628\u0652\u0644\u064e \u063a\u064f\u0631\u064f\u0648\u0628\u0650\u0647\u064e\u0627\u06d6 \u0648\u064e\u0645\u0650\u0646\u064e \u0627\u0670\u0646\u064e\u0627\u0653\u0621\u0650\u06d2\u0652 \u0627\u0650\u06ec\u0644\u064a\u0652\u0644\u0650 \u0641\u064e\u0633\u064e\u0628\u0651\u0650\u062d\u0652 \u0648\u064e\u0623\u064e\u0637\u0652\u0631\u064e\u0627\u0641\u064e \u0627\u064e\u06ec\u0644\u0646\u0651\u064e\u0647\u06ea\u0627\u0631\u0650 \u0644\u064e\u0639\u064e\u0644\u0651\u064e\u0643\u064e \u062a\u064e\u0631\u0652\u0636\u06ea\u0649\u0670', r: '[\u0637\u0647: 128]' },
    { q: true, t: '\u0627\u064e\u0644\u064e\u0645\u0652 \u0646\u064e\u0634\u0652\u0631\u064e\u062d\u0652 \u0644\u064e\u0643\u064e \u0635\u064e\u062f\u0652\u0631\u064e\u0643\u064e \u0648\u064e\u0648\u064e\u0636\u064e\u0639\u0652\u0646\u064e\u0627 \u0639\u064e\u0646\u0643\u064e \u0648\u0650\u0632\u0652\u0631\u064e\u0643\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u06d2\u0653 \u0623\u064e\u0646\u0642\u064e\u0636\u064e \u0638\u064e\u0647\u0652\u0631\u064e\u0643\u064e \u0648\u064e\u0631\u064e\u0641\u064e\u0639\u0652\u0646\u064e\u0627 \u0644\u064e\u0643\u064e \u0630\u0650\u0643\u0652\u0631\u064e\u0643\u064e', r: '[\u0627\u0644\u0634\u0631\u062d: 1-4]' },
    { q: true, t: '\u0641\u064e\u0628\u0650\u0645\u064e\u0627 \u0631\u064e\u062d\u0652\u0645\u064e\u0629\u0656 \u0645\u0651\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0644\u0650\u0646\u062a\u064e \u0644\u064e\u0647\u064f\u0645\u0652\u06d6 \u0648\u064e\u0644\u064e\u0648\u0652 \u0643\u064f\u0646\u062a\u064e \u0641\u064e\u0638\u0651\u0627\u064b \u063a\u064e\u0644\u0650\u064a\u0638\u064e \u0627\u064e\u06ec\u0644\u0652\u0642\u064e\u0644\u0652\u0628\u0650 \u0644\u064e\u0627\u0646\u0641\u064e\u0636\u0651\u064f\u0648\u0627\u0652 \u0645\u0650\u0646\u0652 \u062d\u064e\u0648\u0652\u0644\u0650\u0643\u064e', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 159]' },
    { q: true, t: '\u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u063a\u064e\u0641\u064f\u0648\u0631\u065e \u0631\u0651\u064e\u062d\u0650\u064a\u0645\u065e', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 216]' },
    { q: true, t: '\u0627\u064e\u06df\u062f\u0652\u0639\u064f\u0648\u0627\u0652 \u0631\u064e\u0628\u0651\u064e\u0643\u064f\u0645\u0652 \u062a\u064e\u0636\u064e\u0631\u0651\u064f\u0639\u0627\u0657 \u0648\u064e\u062e\u064f\u0641\u0652\u064a\u064e\u0629\u064b', r: '[\u0627\u0644\u0623\u0639\u0631\u0627\u0641: 54]' },
    { q: true, t: '\u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0644\u064e\u0627\u0653 \u0625\u0650\u0644\u064e\u0670\u0647\u064e \u0625\u0650\u0644\u0651\u064e\u0627 \u0647\u064f\u0648\u064e\u06d6 \u0627\u064e\u06ec\u0644\u0652\u062d\u064e\u064a\u0651\u064f \u0627\u064f\u06ec\u0644\u0652\u0642\u064e\u064a\u0651\u064f\u0648\u0645\u064f\u06d6 \u0644\u064e\u0627 \u062a\u064e\u0627\u062e\u064f\u0630\u064f\u0647\u064f\u06e5 \u0633\u0650\u0646\u064e\u0629\u065e \u0648\u064e\u0644\u064e\u0627 \u0646\u064e\u0648\u0652\u0645\u065e\u06d6 \u0644\u0651\u064e\u0647\u064f\u06e5 \u0645\u064e\u0627 \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0645\u064e\u0627 \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u064e\u0627\u0631\u0652\u0636\u0650', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 253-254]' },
    { q: true, t: '\u0627\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0648\u064e\u0639\u064e\u0645\u0650\u0644\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0635\u0651\u064e\u0670\u0644\u0650\u062d\u064e\u0670\u062a\u0650 \u0633\u064e\u064a\u064e\u062c\u0652\u0639\u064e\u0644\u064f \u0644\u064e\u0647\u064f\u0645\u064f \u0627\u064f\u06ec\u0644\u0631\u0651\u064e\u062d\u0652\u0645\u064e\u0670\u0646\u064f \u0648\u064f\u062f\u0651\u0627\u0657', r: '[\u0645\u0631\u064a\u0645: 97]' },
    { q: true, t: '\u0648\u064e\u064a\u064e\u0628\u0652\u0642\u06ea\u0649\u0670 \u0648\u064e\u062c\u0652\u0647\u064f \u0631\u064e\u0628\u0651\u0650\u0643\u064e \u0630\u064f\u0648 \u0627\u064f\u06ec\u0644\u0652\u062c\u064e\u0644\u064e\u0670\u0644\u0650 \u0648\u064e\u0627\u0644\u0650\u0627\u0643\u0652\u0631\u064e\u0627\u0645\u0650', r: '[\u0627\u0644\u0631\u062d\u0645\u0646: 25]' },
    { q: true, t: '\u0623\u064f\u0648\u0652\u0644\u064e\u0670\u0653\u0626\u0650\u0643\u064e \u064a\u064f\u0648\u062a\u064e\u0648\u0652\u0646\u064e \u0623\u064e\u062c\u0652\u0631\u064e\u0647\u064f\u0645 \u0645\u0651\u064e\u0631\u0651\u064e\u062a\u064e\u064a\u0652\u0646\u0650 \u0628\u0650\u0645\u064e\u0627 \u0635\u064e\u0628\u064e\u0631\u064f\u0648\u0627\u0652 \u0648\u064e\u064a\u064e\u062f\u0652\u0631\u064e\u0621\u064f\u0648\u0646\u064e \u0628\u0650\u0627\u0644\u0652\u062d\u064e\u0633\u064e\u0646\u064e\u0629\u0650 \u0627\u0650\u06ec\u0644\u0633\u0651\u064e\u064a\u0651\u0650\u064a\u0654\u064e\u0629\u064e \u0648\u064e\u0645\u0650\u0645\u0651\u064e\u0627 \u0631\u064e\u0632\u064e\u0642\u0652\u0646\u064e\u0670\u0647\u064f\u0645\u0652 \u064a\u064f\u0646\u0641\u0650\u0642\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0642\u0635\u0635: 54]' },
    { q: true, t: '\u0645\u064e\u0627\u0653 \u0623\u064e\u0646\u0632\u064e\u0644\u0652\u0646\u064e\u0627 \u0639\u064e\u0644\u064e\u064a\u0652\u0643\u064e \u0627\u064e\u06ec\u0644\u0652\u0642\u064f\u0631\u0652\u0621\u064e\u0627\u0646\u064e \u0644\u0650\u062a\u064e\u0634\u0652\u0642\u06ea\u0649\u0670\u0653 \u0625\u0650\u0644\u0651\u064e\u0627 \u062a\u064e\u0630\u0652\u0643\u0650\u0631\u064e\u0629\u0657 \u0644\u0651\u0650\u0645\u064e\u0646\u0652 \u064a\u0651\u064e\u062e\u0652\u0634\u06ea\u0649\u0670', r: '[\u0637\u0647: 1-2]' },
    { q: true, t: '\u064a\u064e\u0670\u0653\u0623\u064e\u064a\u0651\u064f\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0627\u064f\u06ea\u062a\u0651\u064e\u0642\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0648\u064e\u0621\u064e\u0627\u0645\u0650\u0646\u064f\u0648\u0627\u0652 \u0628\u0650\u0631\u064e\u0633\u064f\u0648\u0644\u0650\u0647\u0650\u06e6 \u064a\u064f\u0648\u062a\u0650\u0643\u064f\u0645\u0652 \u0643\u0650\u0641\u0652\u0644\u064e\u064a\u0652\u0646\u0650 \u0645\u0650\u0646 \u0631\u0651\u064e\u062d\u0652\u0645\u064e\u062a\u0650\u0647\u0650\u06e6 \u0648\u064e\u064a\u064e\u062c\u0652\u0639\u064e\u0644 \u0644\u0651\u064e\u0643\u064f\u0645\u0652 \u0646\u064f\u0648\u0631\u0627\u0657 \u062a\u064e\u0645\u0652\u0634\u064f\u0648\u0646\u064e \u0628\u0650\u0647\u0650\u06e6 \u0648\u064e\u064a\u064e\u063a\u0652\u0641\u0650\u0631\u0652 \u0644\u064e\u0643\u064f\u0645\u0652\u06d6 \u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u063a\u064e\u0641\u064f\u0648\u0631\u065e \u0631\u0651\u064e\u062d\u0650\u064a\u0645\u065e', r: '[\u0627\u0644\u062d\u062f\u064a\u062f: 27]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u064a\u064f\u062d\u0650\u0628\u0651\u064f \u0627\u064f\u06ec\u0644\u062a\u0651\u064e\u0648\u0651\u064e\u0670\u0628\u0650\u064a\u0646\u064e \u0648\u064e\u064a\u064f\u062d\u0650\u0628\u0651\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u064f\u062a\u064e\u0637\u064e\u0647\u0651\u0650\u0631\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 220]' },
    { q: true, t: '\u0648\u064e\u0646\u064e\u062d\u0652\u0646\u064f \u0623\u064e\u0642\u0652\u0631\u064e\u0628\u064f \u0625\u0650\u0644\u064e\u064a\u0652\u0647\u0650 \u0645\u0650\u0646\u0652 \u062d\u064e\u0628\u0652\u0644\u0650 \u0627\u0650\u06ec\u0644\u0652\u0648\u064e\u0631\u0650\u064a\u062f\u0650', r: '[\u0642: 16]' },
    { q: true, t: '\u0648\u064e\u0633\u0650\u0639\u064e \u0643\u064f\u0631\u0652\u0633\u0650\u064a\u0651\u064f\u0647\u064f \u0627\u064f\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0627\u0644\u064e\u0627\u0631\u0652\u0636\u064e\u06d6 \u0648\u064e\u0644\u064e\u0627 \u064a\u064e\u0640\u0654\u064f\u0648\u062f\u064f\u0647\u064f\u06e5 \u062d\u0650\u0641\u0652\u0638\u064f\u0647\u064f\u0645\u064e\u0627\u06d6 \u0648\u064e\u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0652\u0639\u064e\u0644\u0650\u064a\u0651\u064f \u0627\u064f\u06ec\u0644\u0652\u0639\u064e\u0638\u0650\u064a\u0645\u064f', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 254]' },
    { q: true, t: '\u0641\u064e\u0644\u064e\u0627 \u062a\u064e\u0639\u0652\u0644\u064e\u0645\u064f \u0646\u064e\u0641\u0652\u0633\u065e \u0645\u0651\u064e\u0627\u0653 \u0623\u064f\u062e\u0652\u0641\u0650\u064a\u064e \u0644\u064e\u0647\u064f\u0645 \u0645\u0651\u0650\u0646 \u0642\u064f\u0631\u0651\u064e\u0629\u0650 \u0623\u064e\u0639\u0652\u064a\u064f\u0646\u0656 \u062c\u064e\u0632\u064e\u0627\u0653\u0621\u064e\u06e2 \u0628\u0650\u0645\u064e\u0627 \u0643\u064e\u0627\u0646\u064f\u0648\u0627\u0652 \u064a\u064e\u0639\u0652\u0645\u064e\u0644\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0633\u062c\u062f\u0629: 17]' },
    { q: true, t: '\u0627\u0650\u06ec\u0644\u0631\u0651\u064e\u062d\u0652\u0645\u064e\u0670\u0646\u064f \u0639\u064e\u0644\u0651\u064e\u0645\u064e \u0627\u064e\u06ec\u0644\u0652\u0642\u064f\u0631\u0652\u0621\u064e\u0627\u0646\u064e\u06d6 \u062e\u064e\u0644\u064e\u0642\u064e \u0627\u064e\u06ec\u0644\u0650\u0627\u0646\u0633\u064e\u0670\u0646\u064e \u0639\u064e\u0644\u0651\u064e\u0645\u064e\u0647\u064f \u0627\u064f\u06ec\u0644\u0652\u0628\u064e\u064a\u064e\u0627\u0646\u064e', r: '[\u0627\u0644\u0631\u062d\u0645\u0646: 1-2]' },
    { q: true, t: '\u0648\u064e\u062c\u064e\u0639\u064e\u0644\u0652\u0646\u064e\u0627 \u0645\u0650\u0646\u0652\u0647\u064f\u0645\u064f\u06e5\u0653 \u0623\u064e\u0626\u0650\u0645\u0651\u064e\u0629\u0657 \u064a\u064e\u0647\u0652\u062f\u064f\u0648\u0646\u064e \u0628\u0650\u0623\u064e\u0645\u0652\u0631\u0650\u0646\u064e\u0627 \u0644\u064e\u0645\u0651\u064e\u0627 \u0635\u064e\u0628\u064e\u0631\u064f\u0648\u0627\u0652\u06d6 \u0648\u064e\u0643\u064e\u0627\u0646\u064f\u0648\u0627\u0652 \u0628\u0650\u0640\u0654\u064e\u0627\u064a\u064e\u0670\u062a\u0650\u0646\u064e\u0627 \u064a\u064f\u0648\u0642\u0650\u0646\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0633\u062c\u062f\u0629: 24]' },
    { q: true, t: '\u0648\u064e\u0625\u0650\u0646\u0651\u0650\u06d2 \u0644\u064e\u063a\u064e\u0641\u0651\u064e\u0627\u0631\u065e \u0644\u0651\u0650\u0645\u064e\u0646 \u062a\u064e\u0627\u0628\u064e \u0648\u064e\u0621\u064e\u0627\u0645\u064e\u0646\u064e \u0648\u064e\u0639\u064e\u0645\u0650\u0644\u064e \u0635\u064e\u0670\u0644\u0650\u062d\u0627\u0657 \u062b\u064f\u0645\u0651\u064e \u0627\u064e\u06ea\u0647\u0652\u062a\u064e\u062f\u06ea\u0649\u0670', r: '[\u0637\u0647: 80]' },
    { q: true, t: '\u0633\u064e\u0644\u064e\u0670\u0645\u065e\u06d6 \u0642\u064e\u0648\u0652\u0644\u0627\u0657 \u0645\u0651\u0650\u0646 \u0631\u0651\u064e\u0628\u0651\u0656 \u0631\u0651\u064e\u062d\u0650\u064a\u0645\u0656', r: '[\u064a\u0633: 57]' },
    { q: true, t: '\u0644\u064e\u0627 \u064a\u064f\u0643\u064e\u0644\u0651\u0650\u0641\u064f \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0646\u064e\u0641\u0652\u0633\u0627\u064b \u0627\u0650\u0644\u0651\u064e\u0627 \u0648\u064f\u0633\u0652\u0639\u064e\u0647\u064e\u0627', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 285]' },
    { q: true, t: '\u0648\u064e\u0633\u0650\u064a\u0642\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0627\u064e\u06ea\u062a\u0651\u064e\u0642\u064e\u0648\u0652\u0627\u0652 \u0631\u064e\u0628\u0651\u064e\u0647\u064f\u0645\u064f\u06e5\u0653 \u0625\u0650\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0652\u062c\u064e\u0646\u0651\u064e\u0629\u0650 \u0632\u064f\u0645\u064e\u0631\u0627\u064b\u06d6 \u062d\u064e\u062a\u0651\u064e\u0649\u0670\u0653 \u0625\u0650\u0630\u064e\u0627 \u062c\u064e\u0627\u0653\u0621\u064f\u0648\u0647\u064e\u0627 \u0648\u064e\u0641\u064f\u062a\u0651\u0650\u062d\u064e\u062a\u064e \u0627\u064e\u0628\u0652\u0648\u064e\u0670\u0628\u064f\u0647\u064e\u0627 \u0648\u064e\u0642\u064e\u0627\u0644\u064e \u0644\u064e\u0647\u064f\u0645\u0652 \u062e\u064e\u0632\u064e\u0646\u064e\u062a\u064f\u0647\u064e\u0627 \u0633\u064e\u0644\u064e\u0670\u0645\u064c \u0639\u064e\u0644\u064e\u064a\u0652\u0643\u064f\u0645\u0652 \u0637\u0650\u0628\u0652\u062a\u064f\u0645\u0652 \u0641\u064e\u0627\u062f\u0652\u062e\u064f\u0644\u064f\u0648\u0647\u064e\u0627 \u062e\u064e\u0670\u0644\u0650\u062f\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0632\u0645\u0631: 70]' },
    { q: true, t: '\u062a\u064e\u0628\u064e\u0670\u0631\u064e\u0643\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u06d2 \u062c\u064e\u0639\u064e\u0644\u064e \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0627\u0653\u0621\u0650 \u0628\u064f\u0631\u064f\u0648\u062c\u0627\u0657 \u0648\u064e\u062c\u064e\u0639\u064e\u0644\u064e \u0641\u0650\u064a\u0647\u064e\u0627 \u0633\u0650\u0631\u064e\u0670\u062c\u0627\u0657 \u0648\u064e\u0642\u064e\u0645\u064e\u0631\u0627\u0657 \u0645\u0651\u064f\u0646\u0650\u064a\u0631\u0627\u0657', r: '[\u0627\u0644\u0641\u0631\u0642\u0627\u0646: 61]' },
    { q: true, t: '\u0642\u064f\u0644\u0652 \u064a\u064e\u0670\u0639\u0650\u0628\u064e\u0627\u062f\u0650 \u0627\u0650\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0627\u064f\u06ea\u062a\u0651\u064e\u0642\u064f\u0648\u0627\u0652 \u0631\u064e\u0628\u0651\u064e\u0643\u064f\u0645\u0652\u06d6 \u0644\u0650\u0644\u0630\u0650\u064a\u0646\u064e \u0623\u064e\u062d\u0652\u0633\u064e\u0646\u064f\u0648\u0627\u0652 \u0641\u0650\u06d2 \u0647\u064e\u0670\u0630\u0650\u0647\u0650 \u0627\u0650\u06ec\u0644\u062f\u0651\u064f\u0646\u0652\u064a\u06ea\u0627 \u062d\u064e\u0633\u064e\u0646\u064e\u0629\u065e\u06d6 \u0648\u064e\u0623\u064e\u0631\u0652\u0636\u064f \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0648\u064e\u0670\u0633\u0650\u0639\u064e\u0629\u064c\u06d6 \u0627\u0650\u0646\u0651\u064e\u0645\u064e\u0627 \u064a\u064f\u0648\u064e\u0641\u0651\u064e\u0649 \u0627\u064e\u06ec\u0644\u0635\u0651\u064e\u0670\u0628\u0650\u0631\u064f\u0648\u0646\u064e \u0623\u064e\u062c\u0652\u0631\u064e\u0647\u064f\u0645 \u0628\u0650\u063a\u064e\u064a\u0652\u0631\u0650 \u062d\u0650\u0633\u064e\u0627\u0628\u0656', r: '[\u0627\u0644\u0632\u0645\u0631: 11]' },
    { q: true, t: '\u0648\u064e\u0643\u064e\u0627\u0646\u064e \u0641\u064e\u0636\u0652\u0644\u064f \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0639\u064e\u0644\u064e\u064a\u0652\u0643\u064e \u0639\u064e\u0638\u0650\u064a\u0645\u0627\u0657', r: '[\u0627\u0644\u0646\u0633\u0627\u0621: 112]' },
    { q: true, t: '\u0648\u064e\u0644\u064e\u0627 \u062a\u064e\u0627\u0652\u064a\u0652\u0640\u0654\u064e\u0633\u064f\u0648\u0627\u0652 \u0645\u0650\u0646 \u0631\u0651\u064e\u0648\u0652\u062d\u0650 \u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u0650', r: '[\u064a\u0648\u0633\u0641: 87]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0642\u064e\u0627\u0644\u064f\u0648\u0627\u0652 \u0631\u064e\u0628\u0651\u064f\u0646\u064e\u0627 \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u062b\u064f\u0645\u0651\u064e \u0627\u064e\u06ea\u0633\u0652\u062a\u064e\u0642\u064e\u0670\u0645\u064f\u0648\u0627\u0652 \u062a\u064e\u062a\u064e\u0646\u064e\u0632\u0651\u064e\u0644\u064f \u0639\u064e\u0644\u064e\u064a\u0652\u0647\u0650\u0645\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u064e\u0644\u064e\u0670\u0653\u0626\u0650\u0643\u064e\u0629\u064f \u0623\u064e\u0644\u0651\u064e\u0627 \u062a\u064e\u062e\u064e\u0627\u0641\u064f\u0648\u0627\u0652 \u0648\u064e\u0644\u064e\u0627 \u062a\u064e\u062d\u0652\u0632\u064e\u0646\u064f\u0648\u0627\u0652 \u0648\u064e\u0623\u064e\u0628\u0652\u0634\u0650\u0631\u064f\u0648\u0627\u0652 \u0628\u0650\u0627\u0644\u0652\u062c\u064e\u0646\u0651\u064e\u0629\u0650 \u0627\u0650\u06ec\u0644\u062a\u0650\u06d2 \u0643\u064f\u0646\u062a\u064f\u0645\u0652 \u062a\u064f\u0648\u0639\u064e\u062f\u064f\u0648\u0646\u064e', r: '[\u0641\u0635\u0644\u062a: 29]' },
    { q: true, t: '\u0648\u064e\u064a\u064f\u0633\u064e\u0628\u0651\u0650\u062d\u064f \u0627\u064f\u06ec\u0644\u0631\u0651\u064e\u0639\u0652\u062f\u064f \u0628\u0650\u062d\u064e\u0645\u0652\u062f\u0650\u0647\u0650\u06e6 \u0648\u064e\u0627\u0644\u0652\u0645\u064e\u0644\u064e\u0670\u0653\u0626\u0650\u0643\u064e\u0629\u064f \u0645\u0650\u0646\u0652 \u062e\u0650\u064a\u0641\u064e\u062a\u0650\u0647\u0650\u06e6', r: '[\u0627\u0644\u0631\u0639\u062f: 14]' },
    { q: true, t: '\u0648\u064e\u0645\u064e\u0627 \u064a\u064f\u0644\u064e\u0642\u0651\u06ea\u064a\u0670\u0647\u064e\u0627\u0653 \u0625\u0650\u0644\u0651\u064e\u0627 \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0635\u064e\u0628\u064e\u0631\u064f\u0648\u0627\u0652\u06d6 \u0648\u064e\u0645\u064e\u0627 \u064a\u064f\u0644\u064e\u0642\u0651\u06ea\u064a\u0670\u0647\u064e\u0627\u0653 \u0625\u0650\u0644\u0651\u064e\u0627 \u0630\u064f\u0648 \u062d\u064e\u0638\u0651\u064d \u0639\u064e\u0638\u0650\u064a\u0645\u0656', r: '[\u0641\u0635\u0644\u062a: 34]' },
    { q: true, t: '\u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u062e\u064e\u064a\u0652\u0631\u064f \u0627\u064f\u06ec\u0644\u0631\u0651\u064e\u0670\u0632\u0650\u0642\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u062c\u0645\u0639\u0629: 11]' },
    { q: true, t: '\u0623\u064e\u0644\u064e\u064a\u0652\u0633\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0628\u0650\u0643\u064e\u0627\u0641\u064d \u0639\u064e\u0628\u0652\u062f\u064e\u0647\u064f\u06e5', r: '[\u0627\u0644\u0632\u0645\u0631: 35]' },
    { q: true, t: '\u064a\u064e\u0670\u0639\u0650\u0628\u064e\u0627\u062f\u0650\u06d2 \u0644\u064e\u0627 \u062e\u064e\u0648\u0652\u0641\u064c \u0639\u064e\u0644\u064e\u064a\u0652\u0643\u064f\u0645\u064f \u0627\u064f\u06ec\u0644\u0652\u064a\u064e\u0648\u0652\u0645\u064e \u0648\u064e\u0644\u064e\u0627\u0653 \u0623\u064e\u0646\u062a\u064f\u0645\u0652 \u062a\u064e\u062d\u0652\u0632\u064e\u0646\u064f\u0648\u0646\u064e\u06d6 \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0628\u0650\u0640\u0654\u064e\u0627\u064a\u064e\u0670\u062a\u0650\u0646\u064e\u0627 \u0648\u064e\u0643\u064e\u0627\u0646\u064f\u0648\u0627\u0652 \u0645\u064f\u0633\u0652\u0644\u0650\u0645\u0650\u064a\u0646\u064e \u0627\u064e\u06df\u062f\u0652\u062e\u064f\u0644\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0652\u062c\u064e\u0646\u0651\u064e\u0629\u064e \u0623\u064e\u0646\u062a\u064f\u0645\u0652 \u0648\u064e\u0623\u064e\u0632\u0652\u0648\u064e\u0670\u062c\u064f\u0643\u064f\u0645\u0652 \u062a\u064f\u062d\u0652\u0628\u064e\u0631\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0632\u062e\u0631\u0641: 68-70]' },
    { q: true, t: '\u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0646\u064f\u0648\u0631\u064f \u0627\u064f\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0627\u0644\u064e\u0627\u0631\u0652\u0636\u0650\u06d6 \u0645\u064e\u062b\u064e\u0644\u064f \u0646\u064f\u0648\u0631\u0650\u0647\u0650\u06e6 \u0643\u064e\u0645\u0650\u0634\u0652\u0643\u064e\u0648\u0670\u0629\u0656 \u0641\u0650\u064a\u0647\u064e\u0627 \u0645\u0650\u0635\u0652\u0628\u064e\u0627\u062d\u064c\u06d6 \u0627\u0650\u06ec\u0644\u0652\u0645\u0650\u0635\u0652\u0628\u064e\u0627\u062d\u064f \u0641\u0650\u06d2 \u0632\u064f\u062c\u064e\u0627\u062c\u064e\u0629\u064d\u06d6 \u0627\u0650\u06ec\u0644\u0632\u0651\u064f\u062c\u064e\u0627\u062c\u064e\u0629\u064f \u0643\u064e\u0623\u064e\u0646\u0651\u064e\u0647\u064e\u0627 \u0643\u064e\u0648\u0652\u0643\u064e\u0628\u065e \u062f\u064f\u0631\u0651\u0650\u064a\u0651\u065e', r: '[\u0627\u0644\u0646\u0648\u0631: 35]' },
    { q: true, t: '\u0648\u064e\u0644\u064e\u0645\u064e\u0646 \u0635\u064e\u0628\u064e\u0631\u064e \u0648\u064e\u063a\u064e\u0641\u064e\u0631\u064e \u0625\u0650\u0646\u0651\u064e \u0630\u064e\u0670\u0644\u0650\u0643\u064e \u0644\u064e\u0645\u0650\u0646\u0652 \u0639\u064e\u0632\u0652\u0645\u0650 \u0627\u0650\u06ec\u0644\u064f\u0627\u0645\u064f\u0648\u0631\u0650', r: '[\u0627\u0644\u0634\u0648\u0631\u0649: 40]' },
    { q: true, t: '\u0648\u064e\u0645\u064e\u0646\u0652 \u064a\u0651\u064e\u062a\u0651\u064e\u0642\u0650 \u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u064a\u064e\u062c\u0652\u0639\u064e\u0644 \u0644\u0651\u064e\u0647\u064f\u06e5 \u0645\u0650\u0646\u064e \u0627\u064e\u0645\u0652\u0631\u0650\u0647\u0650\u06e6 \u064a\u064f\u0633\u0652\u0631\u0627\u0657', r: '[\u0627\u0644\u0637\u0644\u0627\u0642: 4]' },
    { q: true, t: '\u0648\u064e\u0645\u064e\u0627 \u062a\u064e\u0648\u0652\u0641\u0650\u064a\u0642\u0650\u064a\u064e \u0625\u0650\u0644\u0651\u064e\u0627 \u0628\u0650\u0627\u0644\u0644\u0651\u064e\u0647\u0650', r: '[\u0647\u0648\u062f: 88]' },
    { q: true, t: '\u0627\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0652\u0645\u064f\u062a\u0651\u064e\u0642\u0650\u064a\u0646\u064e \u0641\u0650\u06d2 \u062c\u064e\u0646\u0651\u064e\u0670\u062a\u0656 \u0648\u064e\u0646\u064e\u0647\u064e\u0631\u0656 \u0641\u0650\u06d2 \u0645\u064e\u0642\u0652\u0639\u064e\u062f\u0650 \u0635\u0650\u062f\u0652\u0642\u064d \u0639\u0650\u0646\u062f\u064e \u0645\u064e\u0644\u0650\u064a\u0643\u0656 \u0645\u0651\u064f\u0642\u0652\u062a\u064e\u062f\u0650\u0631\u064d', r: '[\u0627\u0644\u0642\u0645\u0631: 54-55]' },
    { q: true, t: '\u0633\u064e\u0628\u0651\u064e\u062d\u064e \u0644\u0650\u0644\u0647\u0650 \u0645\u064e\u0627 \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0645\u064e\u0627 \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u064e\u0627\u0631\u0652\u0636\u0650\u06d6 \u0648\u064e\u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0652\u0639\u064e\u0632\u0650\u064a\u0632\u064f \u0627\u064f\u06ec\u0644\u0652\u062d\u064e\u0643\u0650\u064a\u0645\u064f', r: '[\u0627\u0644\u062d\u0634\u0631: 1]' },
    { q: true, t: '\u0648\u064e\u0627\u0635\u0652\u0628\u0650\u0631\u0652 \u0639\u064e\u0644\u064e\u0649\u0670 \u0645\u064e\u0627 \u064a\u064e\u0642\u064f\u0648\u0644\u064f\u0648\u0646\u064e\u06d6 \u0648\u064e\u0627\u0647\u0652\u062c\u064f\u0631\u0652\u0647\u064f\u0645\u0652 \u0647\u064e\u062c\u0652\u0631\u0627\u0657 \u062c\u064e\u0645\u0650\u064a\u0644\u0627\u0657', r: '[\u0627\u0644\u0645\u0632\u0645\u0644: 9]' },
    { q: true, t: '\u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u064a\u064f\u062d\u0650\u0628\u0651\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u064f\u062d\u0652\u0633\u0650\u0646\u0650\u064a\u0646\u064e', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 134]' },
    { q: true, t: '\u0648\u064e\u0647\u064f\u0648\u064e \u0645\u064e\u0639\u064e\u0643\u064f\u0645\u064f\u06e5\u0653 \u0623\u064e\u064a\u0652\u0646\u064e \u0645\u064e\u0627 \u0643\u064f\u0646\u062a\u064f\u0645\u0652', r: '[\u0627\u0644\u062d\u062f\u064a\u062f: 4]' },
    { q: true, t: '\u0648\u064e\u0644\u0650\u0645\u064e\u0646\u0652 \u062e\u064e\u0627\u0641\u064e \u0645\u064e\u0642\u064e\u0627\u0645\u064e \u0631\u064e\u0628\u0651\u0650\u0647\u0650\u06e6 \u062c\u064e\u0646\u0651\u064e\u062a\u064e\u0670\u0646\u0650', r: '[\u0627\u0644\u0631\u062d\u0645\u0646: 45]' },
    { q: true, t: '\u064a\u064f\u0633\u064e\u0628\u0651\u0650\u062d\u064f \u0644\u0650\u0644\u0647\u0650 \u0645\u064e\u0627 \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0645\u064e\u0627 \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u064e\u0627\u0631\u0652\u0636\u0650 \u0627\u0650\u06ec\u0644\u0652\u0645\u064e\u0644\u0650\u0643\u0650 \u0627\u0650\u06ec\u0644\u0652\u0642\u064f\u062f\u0651\u064f\u0648\u0633\u0650 \u0627\u0650\u06ec\u0644\u0652\u0639\u064e\u0632\u0650\u064a\u0632\u0650 \u0627\u0650\u06ec\u0644\u0652\u062d\u064e\u0643\u0650\u064a\u0645\u0650', r: '[\u0627\u0644\u062c\u0645\u0639\u0629: 1]' },
    { q: true, t: '\u0627\u0650\u0644\u0651\u064e\u0627 \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0648\u064e\u0639\u064e\u0645\u0650\u0644\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0635\u0651\u064e\u0670\u0644\u0650\u062d\u064e\u0670\u062a\u0650 \u0648\u064e\u062a\u064e\u0648\u064e\u0627\u0635\u064e\u0648\u0652\u0627\u0652 \u0628\u0650\u0627\u0644\u0652\u062d\u064e\u0642\u0651\u0650 \u0648\u064e\u062a\u064e\u0648\u064e\u0627\u0635\u064e\u0648\u0652\u0627\u0652 \u0628\u0650\u0627\u0644\u0635\u0651\u064e\u0628\u0652\u0631\u0650', r: '[\u0627\u0644\u0639\u0635\u0631: 2-3]' },
    { q: true, t: '\u0627\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0644\u064e\u0627 \u064a\u064f\u0636\u0650\u064a\u0639\u064f \u0623\u064e\u062c\u0652\u0631\u064e \u0627\u064e\u06ec\u0644\u0652\u0645\u064f\u062d\u0652\u0633\u0650\u0646\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u062a\u0648\u0628\u0629: 121]' },
    { q: true, t: '\u0644\u064e\u0626\u0650\u0646 \u0634\u064e\u0643\u064e\u0631\u0652\u062a\u064f\u0645\u0652 \u0644\u064e\u0623\u064e\u0632\u0650\u064a\u062f\u064e\u0646\u0651\u064e\u0643\u064f\u0645\u0652', r: '[\u0625\u0628\u0631\u0627\u0647\u064a\u0645: 9]' },
    { q: true, t: '\u0633\u064e\u0627\u0628\u0650\u0642\u064f\u0648\u0653\u0627\u0652 \u0625\u0650\u0644\u064e\u0649\u0670 \u0645\u064e\u063a\u0652\u0641\u0650\u0631\u064e\u0629\u0656 \u0645\u0651\u0650\u0646 \u0631\u0651\u064e\u0628\u0651\u0650\u0643\u064f\u0645\u0652 \u0648\u064e\u062c\u064e\u0646\u0651\u064e\u0629\u064d \u0639\u064e\u0631\u0652\u0636\u064f\u0647\u064e\u0627 \u0643\u064e\u0639\u064e\u0631\u0652\u0636\u0650 \u0627\u0650\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0627\u0653\u0621\u0650 \u0648\u064e\u0627\u0644\u064e\u0627\u0631\u0652\u0636\u0650 \u0623\u064f\u0639\u0650\u062f\u0651\u064e\u062a\u0652 \u0644\u0650\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0628\u0650\u0627\u0644\u0644\u0651\u064e\u0647\u0650 \u0648\u064e\u0631\u064f\u0633\u064f\u0644\u0650\u0647\u0650\u06e6\u06d6 \u0630\u064e\u0670\u0644\u0650\u0643\u064e \u0641\u064e\u0636\u0652\u0644\u064f \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u064a\u064f\u0648\u062a\u0650\u064a\u0647\u0650 \u0645\u064e\u0646\u0652 \u064a\u0651\u064e\u0634\u064e\u0627\u0653\u0621\u064f\u06d6 \u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u0630\u064f\u0648 \u0627\u064f\u06ec\u0644\u0652\u0641\u064e\u0636\u0652\u0644\u0650 \u0627\u0650\u06ec\u0644\u0652\u0639\u064e\u0638\u0650\u064a\u0645\u0650', r: '[\u0627\u0644\u062d\u062f\u064a\u062f: 20]' },
    { q: true, t: '\u0648\u064e\u0644\u0650\u0644\u0647\u0650 \u0627\u0650\u06ec\u0644\u064e\u0627\u0633\u0652\u0645\u064e\u0627\u0653\u0621\u064f \u0627\u064f\u06ec\u0644\u0652\u062d\u064f\u0633\u0652\u0646\u06ea\u0649\u0670 \u0641\u064e\u0627\u062f\u0652\u0639\u064f\u0648\u0647\u064f \u0628\u0650\u0647\u064e\u0627', r: '[\u0627\u0644\u0623\u0639\u0631\u0627\u0641: 180]' },
    { q: true, t: '\u0641\u064e\u0625\u0650\u0630\u064e\u0627 \u0641\u064e\u0631\u064e\u063a\u0652\u062a\u064e \u0641\u064e\u0627\u0646\u0635\u064e\u0628\u0652 \u0648\u064e\u0625\u0650\u0644\u064e\u0649\u0670 \u0631\u064e\u0628\u0651\u0650\u0643\u064e \u0641\u064e\u0627\u0631\u0652\u063a\u064e\u0628\u0652', r: '[\u0627\u0644\u0634\u0631\u062d: 7-8]' },
    { q: true, t: '\u0641\u064e\u0627\u0633\u0652\u062a\u064e\u0628\u0650\u0642\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0652\u062e\u064e\u064a\u0652\u0631\u064e\u0670\u062a\u0650', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 147]' },
    { q: true, t: '\u0641\u064e\u0628\u0650\u0623\u064e\u064a\u0651\u0650 \u0621\u064e\u0627\u0644\u064e\u0627\u0653\u0621\u0650 \u0631\u064e\u0628\u0651\u0650\u0643\u064f\u0645\u064e\u0627 \u062a\u064f\u0643\u064e\u0630\u0651\u0650\u0628\u064e\u0627\u0646\u0650', r: '[\u0627\u0644\u0631\u062d\u0645\u0646: 11]' },
    { q: true, t: '\u0648\u064e\u0645\u064e\u0646\u0652 \u064a\u0651\u064f\u0648\u0645\u0650\u0646\u06e2 \u0628\u0650\u0627\u0644\u0644\u0651\u064e\u0647\u0650 \u0648\u064e\u064a\u064e\u0639\u0652\u0645\u064e\u0644\u0652 \u0635\u064e\u0670\u0644\u0650\u062d\u0627\u0657 \u0646\u0651\u064f\u062f\u0652\u062e\u0650\u0644\u0652\u0647\u064f \u062c\u064e\u0646\u0651\u064e\u0670\u062a\u0656 \u062a\u064e\u062c\u0652\u0631\u0650\u06d2 \u0645\u0650\u0646 \u062a\u064e\u062d\u0652\u062a\u0650\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u064e\u0627\u0646\u0652\u0647\u064e\u0670\u0631\u064f \u062e\u064e\u0670\u0644\u0650\u062f\u0650\u064a\u0646\u064e \u0641\u0650\u064a\u0647\u064e\u0627\u0653 \u0623\u064e\u0628\u064e\u062f\u0627\u0657 \u0642\u064e\u062f\u064e \u0627\u064e\u062d\u0652\u0633\u064e\u0646\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0644\u064e\u0647\u064f\u06e5 \u0631\u0650\u0632\u0652\u0642\u0627\u064b', r: '[\u0627\u0644\u0637\u0644\u0627\u0642: 11]' },
    { q: true, t: '\u0625\u0650\u0630\u064e\u0627 \u062c\u064e\u0627\u0653\u0621\u064e \u0646\u064e\u0635\u0652\u0631\u064f \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0648\u064e\u0627\u0644\u0652\u0641\u064e\u062a\u0652\u062d\u064f \u0648\u064e\u0631\u064e\u0623\u064e\u064a\u0652\u062a\u064e \u0627\u064e\u06ec\u0644\u0646\u0651\u064e\u0627\u0633\u064e \u064a\u064e\u062f\u0652\u062e\u064f\u0644\u064f\u0648\u0646\u064e \u0641\u0650\u06d2 \u062f\u0650\u064a\u0646\u0650 \u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0623\u064e\u0641\u0652\u0648\u064e\u0627\u062c\u0627\u0657 \u0641\u064e\u0633\u064e\u0628\u0651\u0650\u062d\u0652 \u0628\u0650\u062d\u064e\u0645\u0652\u062f\u0650 \u0631\u064e\u0628\u0651\u0650\u0643\u064e \u0648\u064e\u0627\u0633\u0652\u062a\u064e\u063a\u0652\u0641\u0650\u0631\u0652\u0647\u064f\u06d6 \u0625\u0650\u0646\u0651\u064e\u0647\u064f\u06e5 \u0643\u064e\u0627\u0646\u064e \u062a\u064e\u0648\u0651\u064e\u0627\u0628\u0627\u0657', r: '[\u0627\u0644\u0646\u0635\u0631: 1-3]' },
    { q: true, t: '\u0648\u064e\u0645\u064e\u0646\u0652 \u064a\u0651\u064e\u062a\u0651\u064e\u0642\u0650 \u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u064a\u064e\u062c\u0652\u0639\u064e\u0644 \u0644\u0651\u064e\u0647\u064f\u06e5 \u0645\u064e\u062e\u0652\u0631\u064e\u062c\u0627\u0657 \u0648\u064e\u064a\u064e\u0631\u0652\u0632\u064f\u0642\u0652\u0647\u064f \u0645\u0650\u0646\u0652 \u062d\u064e\u064a\u0652\u062b\u064f \u0644\u064e\u0627 \u064a\u064e\u062d\u0652\u062a\u064e\u0633\u0650\u0628\u064f\u06d6 \u0648\u064e\u0645\u064e\u0646\u0652 \u064a\u0651\u064e\u062a\u064e\u0648\u064e\u0643\u0651\u064e\u0644\u0652 \u0639\u064e\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0641\u064e\u0647\u064f\u0648\u064e \u062d\u064e\u0633\u0652\u0628\u064f\u0647\u064f\u06e5\u0653', r: '[\u0627\u0644\u0637\u0644\u0627\u0642: 2-3]' },
    { q: true, t: '\u0648\u064e\u0627\u0644\u064e\u0627\u062e\u0650\u0631\u064e\u0629\u064f \u062e\u064e\u064a\u0652\u0631\u065e \u0648\u064e\u0623\u064e\u0628\u0652\u0642\u06ea\u0649\u0670\u0653', r: '[\u0627\u0644\u0623\u0639\u0644\u0649: 17]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e \u0623\u064e\u0643\u0652\u0631\u064e\u0645\u064e\u0643\u064f\u0645\u0652 \u0639\u0650\u0646\u062f\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0623\u064e\u062a\u0652\u0642\u06ea\u064a\u0670\u0643\u064f\u0645\u064f\u06e5\u0653', r: '[\u0627\u0644\u062d\u062c\u0631\u0627\u062a: 13]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u064a\u064e\u062e\u0652\u0634\u064e\u0648\u0652\u0646\u064e \u0631\u064e\u0628\u0651\u064e\u0647\u064f\u0645 \u0628\u0650\u0627\u0644\u0652\u063a\u064e\u064a\u0652\u0628\u0650 \u0644\u064e\u0647\u064f\u0645 \u0645\u0651\u064e\u063a\u0652\u0641\u0650\u0631\u064e\u0629\u065e \u0648\u064e\u0623\u064e\u062c\u0652\u0631\u065e \u0643\u064e\u0628\u0650\u064a\u0631\u065e', r: '[\u0627\u0644\u0645\u0644\u0643: 13]' },
    { q: true, t: '\u064a\u064e\u0670\u0653\u0623\u064e\u064a\u0651\u064f\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0627\u064f\u06df\u0630\u0652\u0643\u064f\u0631\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0630\u0650\u0643\u0652\u0631\u0627\u0657 \u0643\u064e\u062b\u0650\u064a\u0631\u0627\u0657 \u0648\u064e\u0633\u064e\u0628\u0651\u0650\u062d\u064f\u0648\u0647\u064f \u0628\u064f\u0643\u0652\u0631\u064e\u0629\u0657 \u0648\u064e\u0623\u064e\u0635\u0650\u064a\u0644\u0627\u064b', r: '[\u0627\u0644\u0623\u062d\u0632\u0627\u0628: 41-42]' },
    { q: true, t: '\u0648\u064e\u0645\u064e\u0646\u0652 \u064a\u0651\u064e\u062a\u0651\u064e\u0642\u0650 \u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u064a\u064f\u0643\u064e\u0641\u0651\u0650\u0631\u0652 \u0639\u064e\u0646\u0652\u0647\u064f \u0633\u064e\u064a\u0651\u0650\u0640\u0654\u064e\u0627\u062a\u0650\u0647\u0650\u06e6 \u0648\u064e\u064a\u064f\u0639\u0652\u0638\u0650\u0645\u0652 \u0644\u064e\u0647\u064f\u06e5\u0653 \u0623\u064e\u062c\u0652\u0631\u0627\u064b', r: '[\u0627\u0644\u0637\u0644\u0627\u0642: 5]' },
    { q: true, t: '\u0648\u064e\u0645\u064e\u0627 \u0639\u0650\u0646\u062f\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u062e\u064e\u064a\u0652\u0631\u065e \u0648\u064e\u0623\u064e\u0628\u0652\u0642\u06ea\u0649\u0670', r: '[\u0627\u0644\u0634\u0648\u0631\u0649: 33]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0645\u064e\u0639\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0627\u064e\u06ea\u062a\u0651\u064e\u0642\u064e\u0648\u0627\u0652 \u0648\u0651\u064e\u0627\u0644\u0630\u0650\u064a\u0646\u064e \u0647\u064f\u0645 \u0645\u0651\u064f\u062d\u0652\u0633\u0650\u0646\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0646\u062d\u0644: 128]' },
    { q: true, t: '\u0648\u064e\u0623\u064e\u0645\u0651\u064e\u0627 \u0645\u064e\u0646\u0652 \u062e\u064e\u0627\u0641\u064e \u0645\u064e\u0642\u064e\u0627\u0645\u064e \u0631\u064e\u0628\u0651\u0650\u0647\u0650\u06e6 \u0648\u064e\u0646\u064e\u0647\u064e\u0649 \u0627\u064e\u06ec\u0644\u0646\u0651\u064e\u0641\u0652\u0633\u064e \u0639\u064e\u0646\u0650 \u0627\u0650\u06ec\u0644\u0652\u0647\u064e\u0648\u06ea\u0649\u0670 \u0641\u064e\u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0652\u062c\u064e\u0646\u0651\u064e\u0629\u064e \u0647\u0650\u064a\u064e \u0627\u064e\u06ec\u0644\u0652\u0645\u064e\u0623\u0652\u0648\u06ea\u0649\u0670', r: '[\u0627\u0644\u0646\u0627\u0632\u0639\u0627\u062a: 39-40]' },
    { q: true, t: '\u0627\u0650\u06ec\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f \u0644\u0650\u0644\u0647\u0650 \u0627\u0650\u06ec\u0644\u0630\u0650\u06d2 \u0644\u064e\u0647\u064f\u06e5 \u0645\u064e\u0627 \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0645\u064e\u0627 \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u064e\u0627\u0631\u0652\u0636\u0650\u06d6 \u0648\u064e\u0644\u064e\u0647\u064f \u0627\u064f\u06ec\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u064e\u0627\u062e\u0650\u0631\u064e\u0629\u0650\u06d6 \u0648\u064e\u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0652\u062d\u064e\u0643\u0650\u064a\u0645\u064f \u0627\u064f\u06ec\u0644\u0652\u062e\u064e\u0628\u0650\u064a\u0631\u064f', r: '[\u0633\u0628\u0625: 1]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0652\u0645\u064f\u062a\u0651\u064e\u0642\u0650\u064a\u0646\u064e \u0641\u0650\u06d2 \u062c\u064e\u0646\u0651\u064e\u0670\u062a\u0656 \u0648\u064e\u0646\u064e\u0639\u0650\u064a\u0645\u0656', r: '[\u0627\u0644\u0637\u0648\u0631: 15]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0652\u062d\u064e\u0633\u064e\u0646\u064e\u0670\u062a\u0650 \u064a\u064f\u0630\u0652\u0647\u0650\u0628\u0652\u0646\u064e \u0627\u064e\u06ec\u0644\u0633\u0651\u064e\u064a\u0651\u0650\u0640\u0654\u064e\u0627\u062a\u0650', r: '[\u0647\u0648\u062f: 114]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0648\u064e\u0639\u064e\u0645\u0650\u0644\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0635\u0651\u064e\u0670\u0644\u0650\u062d\u064e\u0670\u062a\u0650 \u0644\u064e\u0647\u064f\u0645\u0652 \u062c\u064e\u0646\u0651\u064e\u0670\u062a\u065e \u062a\u064e\u062c\u0652\u0631\u0650\u06d2 \u0645\u0650\u0646 \u062a\u064e\u062d\u0652\u062a\u0650\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u064e\u0627\u0646\u0652\u0647\u064e\u0670\u0631\u064f\u06d6 \u0630\u064e\u0670\u0644\u0650\u0643\u064e \u0627\u064e\u06ec\u0644\u0652\u0641\u064e\u0648\u0652\u0632\u064f \u0627\u064f\u06ec\u0644\u0652\u0643\u064e\u0628\u0650\u064a\u0631\u064f', r: '[\u0627\u0644\u0628\u0631\u0648\u062c: 11]' },
    { q: true, t: '\u0627\u0650\u06ec\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f \u0644\u0650\u0644\u0647\u0650 \u0641\u064e\u0627\u0637\u0650\u0631\u0650 \u0627\u0650\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0627\u0644\u064e\u0627\u0631\u0652\u0636\u0650 \u062c\u064e\u0627\u0639\u0650\u0644\u0650 \u0627\u0650\u06ec\u0644\u0652\u0645\u064e\u0644\u064e\u0670\u0653\u0626\u0650\u0643\u064e\u0629\u0650 \u0631\u064f\u0633\u064f\u0644\u0627\u064b \u0627\u06df\u0648\u0652\u0644\u0650\u06d2\u0653 \u0623\u064e\u062c\u0652\u0646\u0650\u062d\u064e\u0629\u0656 \u0645\u0651\u064e\u062b\u0652\u0646\u06ea\u0649\u0670 \u0648\u064e\u062b\u064f\u0644\u064e\u0670\u062b\u064e \u0648\u064e\u0631\u064f\u0628\u064e\u0670\u0639\u064e\u06d6 \u064a\u064e\u0632\u0650\u064a\u062f\u064f \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u0652\u062e\u064e\u0644\u0652\u0642\u0650 \u0645\u064e\u0627 \u064a\u064e\u0634\u064e\u0627\u0653\u0621\u064f\u06d6 \u0627\u06ea\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0639\u064e\u0644\u064e\u0649\u0670 \u0643\u064f\u0644\u0651\u0650 \u0634\u064e\u06d2\u0652\u0621\u0656 \u0642\u064e\u062f\u0650\u064a\u0631\u065e', r: '[\u0641\u0627\u0637\u0631: 1]' },
    { q: true, t: '\u0648\u064e\u0625\u0650\u0644\u064e\u0670\u0647\u064f\u0643\u064f\u0645\u064f\u06e5\u0653 \u0625\u0650\u0644\u064e\u0670\u0647\u065e \u0648\u064e\u0670\u062d\u0650\u062f\u065e\u06d6 \u0644\u0651\u064e\u0627\u0653 \u0625\u0650\u0644\u064e\u0670\u0647\u064e \u0625\u0650\u0644\u0651\u064e\u0627 \u0647\u064f\u0648\u064e\u06d6 \u0627\u064e\u06ec\u0644\u0631\u0651\u064e\u062d\u0652\u0645\u064e\u0670\u0646\u064f \u0627\u064f\u06ec\u0644\u0631\u0651\u064e\u062d\u0650\u064a\u0645\u064f', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 162]' },
    { q: true, t: '\u0647\u064e\u0644\u0652 \u062c\u064e\u0632\u064e\u0627\u0653\u0621\u064f \u0627\u064f\u06ec\u0644\u0650\u0627\u062d\u0652\u0633\u064e\u0670\u0646\u0650 \u0625\u0650\u0644\u0651\u064e\u0627 \u0627\u064e\u06ec\u0644\u0650\u0627\u062d\u0652\u0633\u064e\u0670\u0646\u064f', r: '[\u0627\u0644\u0631\u062d\u0645\u0646: 59]' },
    { q: true, t: '\u064a\u064e\u0670\u0653\u0623\u064e\u064a\u0651\u064e\u062a\u064f\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u0646\u0651\u064e\u0641\u0652\u0633\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u064f\u0637\u0652\u0645\u064e\u0626\u0650\u0646\u0651\u064e\u0629\u064f \u0627\u064f\u06ea\u0631\u0652\u062c\u0650\u0639\u0650\u06d2\u0653 \u0625\u0650\u0644\u064e\u0649\u0670 \u0631\u064e\u0628\u0651\u0650\u0643\u0650 \u0631\u064e\u0627\u0636\u0650\u064a\u064e\u0629\u0657 \u0645\u0651\u064e\u0631\u0652\u0636\u0650\u064a\u0651\u064e\u0629\u0657 \u0641\u064e\u0627\u062f\u0652\u062e\u064f\u0644\u0650\u06d2 \u0641\u0650\u06d2 \u0639\u0650\u0628\u064e\u0670\u062f\u0650\u06d2 \u0648\u064e\u0627\u062f\u0652\u062e\u064f\u0644\u0650\u06d2 \u062c\u064e\u0646\u0651\u064e\u062a\u0650\u06d2', r: '[\u0627\u0644\u0641\u062c\u0631: 30-32]' },
    { q: true, t: '\u0627\u0650\u06ec\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f \u0644\u0650\u0644\u0647\u0650 \u0627\u0650\u06ec\u0644\u0630\u0650\u06d2 \u062e\u064e\u0644\u064e\u0642\u064e \u0627\u064e\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0627\u0644\u064e\u0627\u0631\u0652\u0636\u064e \u0648\u064e\u062c\u064e\u0639\u064e\u0644\u064e \u0627\u064e\u06ec\u0644\u0638\u0651\u064f\u0644\u064f\u0645\u064e\u0670\u062a\u0650 \u0648\u064e\u0627\u0644\u0646\u0651\u064f\u0648\u0631\u064e', r: '[\u0627\u0644\u0623\u0646\u0639\u0627\u0645: 1]' },
    { q: true, t: '\u0642\u064e\u0648\u0652\u0644\u065e \u0645\u0651\u064e\u0639\u0652\u0631\u064f\u0648\u0641\u065e \u0648\u064e\u0645\u064e\u063a\u0652\u0641\u0650\u0631\u064e\u0629\u064c \u062e\u064e\u064a\u0652\u0631\u065e \u0645\u0651\u0650\u0646 \u0635\u064e\u062f\u064e\u0642\u064e\u0629\u0656 \u064a\u064e\u062a\u0652\u0628\u064e\u0639\u064f\u0647\u064e\u0627\u0653 \u0623\u064e\u0630\u0649\u0657\u06d6 \u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u063a\u064e\u0646\u0650\u064a\u0651\u064c \u062d\u064e\u0644\u0650\u064a\u0645\u065e', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 262]' },
    { q: true, t: '\u0648\u064e\u0642\u064f\u0648\u0644\u064f\u0648\u0627\u0652 \u0644\u0650\u0644\u0646\u0651\u064e\u0627\u0633\u0650 \u062d\u064f\u0633\u0652\u0646\u0627\u0657', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 82]' },
    { q: true, t: '\u0641\u064e\u0623\u064e\u0645\u0651\u064e\u0627 \u0645\u064e\u0646\u064e \u0627\u064e\u0639\u0652\u0637\u06ea\u0649\u0670 \u0648\u064e\u0627\u062a\u0651\u064e\u0642\u06ea\u0649\u0670 \u0648\u064e\u0635\u064e\u062f\u0651\u064e\u0642\u064e \u0628\u0650\u0627\u0644\u0652\u062d\u064f\u0633\u0652\u0646\u06ea\u0649\u0670 \u0641\u064e\u0633\u064e\u0646\u064f\u064a\u064e\u0633\u0651\u0650\u0631\u064f\u0647\u064f\u06e5 \u0644\u0650\u0644\u0652\u064a\u064f\u0633\u0652\u0631\u06ea\u0649\u0670', r: '[\u0627\u0644\u0644\u064a\u0644: 5-7]' },
    { q: true, t: '\u0648\u064e\u0625\u0650\u0646 \u062a\u064e\u0639\u064f\u062f\u0651\u064f\u0648\u0627\u0652 \u0646\u0650\u0639\u0652\u0645\u064e\u0629\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0644\u064e\u0627 \u062a\u064f\u062d\u0652\u0635\u064f\u0648\u0647\u064e\u0627\u0653\u06d6 \u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0644\u064e\u063a\u064e\u0641\u064f\u0648\u0631\u065e \u0631\u0651\u064e\u062d\u0650\u064a\u0645\u065e', r: '[\u0627\u0644\u0646\u062d\u0644: 18]' },
    { q: true, t: '\u064a\u064e\u062e\u0652\u062a\u064e\u0635\u0651\u064f \u0628\u0650\u0631\u064e\u062d\u0652\u0645\u064e\u062a\u0650\u0647\u0650\u06e6 \u0645\u064e\u0646\u0652 \u064a\u0651\u064e\u0634\u064e\u0627\u0653\u0621\u064f\u06d6 \u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u0630\u064f\u0648 \u0627\u064f\u06ec\u0644\u0652\u0641\u064e\u0636\u0652\u0644\u0650 \u0627\u0650\u06ec\u0644\u0652\u0639\u064e\u0638\u0650\u064a\u0645\u0650', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 73]' },
    { q: true, t: '\u0648\u064e\u062a\u064e\u0639\u064e\u0627\u0648\u064e\u0646\u064f\u0648\u0627\u0652 \u0639\u064e\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0652\u0628\u0650\u0631\u0651\u0650 \u0648\u064e\u0627\u0644\u062a\u0651\u064e\u0642\u0652\u0648\u06ea\u0649\u0670', r: '[\u0627\u0644\u0645\u0627\u0626\u062f\u0629: 3]' },
    { q: true, t: '\u0645\u064e\u0627 \u0648\u064e\u062f\u0651\u064e\u0639\u064e\u0643\u064e \u0631\u064e\u0628\u0651\u064f\u0643\u064e \u0648\u064e\u0645\u064e\u0627 \u0642\u064e\u0644\u06ea\u0649\u0670\u06d6 \u0648\u064e\u0644\u064e\u0644\u064e\u0627\u062e\u0650\u0631\u064e\u0629\u064f \u062e\u064e\u064a\u0652\u0631\u065e \u0644\u0651\u064e\u0643\u064e \u0645\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u064f\u0627\u0648\u0644\u06ea\u0649\u0670\u06d6 \u0648\u064e\u0644\u064e\u0633\u064e\u0648\u0652\u0641\u064e \u064a\u064f\u0639\u0652\u0637\u0650\u064a\u0643\u064e \u0631\u064e\u0628\u0651\u064f\u0643\u064e \u0641\u064e\u062a\u064e\u0631\u0652\u0636\u06ea\u0649\u0670\u0653', r: '[\u0627\u0644\u0636\u062d\u0649: 3-5]' },
    { q: true, t: '\u0628\u064e\u0644\u06ea\u0649\u0670 \u0645\u064e\u0646\u064e \u0627\u064e\u0648\u0652\u0641\u06ea\u0649\u0670 \u0628\u0650\u0639\u064e\u0647\u0652\u062f\u0650\u0647\u0650\u06e6 \u0648\u064e\u0627\u062a\u0651\u064e\u0642\u06ea\u0649\u0670 \u0641\u064e\u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u064a\u064f\u062d\u0650\u0628\u0651\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u064f\u062a\u0651\u064e\u0642\u0650\u064a\u0646\u064e', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 75]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0644\u064e\u0627 \u064a\u064f\u063a\u064e\u064a\u0651\u0650\u0631\u064f \u0645\u064e\u0627 \u0628\u0650\u0642\u064e\u0648\u0652\u0645\u064d \u062d\u064e\u062a\u0651\u064e\u0649\u0670 \u064a\u064f\u063a\u064e\u064a\u0651\u0650\u0631\u064f\u0648\u0627\u0652 \u0645\u064e\u0627 \u0628\u0650\u0623\u064e\u0646\u0641\u064f\u0633\u0650\u0647\u0650\u0645\u0652', r: '[\u0627\u0644\u0631\u0639\u062f: 12]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0648\u064e\u0639\u064e\u0645\u0650\u0644\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0635\u0651\u064e\u0670\u0644\u0650\u062d\u064e\u0670\u062a\u0650 \u0623\u064f\u0648\u0652\u0644\u064e\u0670\u0653\u0626\u0650\u0643\u064e \u0647\u064f\u0645\u0652 \u062e\u064e\u064a\u0652\u0631\u064f \u0627\u064f\u06ec\u0644\u0652\u0628\u064e\u0631\u0650\u064a\u0653\u0654\u064e\u0629\u0650\u06d6 \u062c\u064e\u0632\u064e\u0627\u0653\u0624\u064f\u0647\u064f\u0645\u0652 \u0639\u0650\u0646\u062f\u064e \u0631\u064e\u0628\u0651\u0650\u0647\u0650\u0645\u0652 \u062c\u064e\u0646\u0651\u064e\u0670\u062a\u064f \u0639\u064e\u062f\u0652\u0646\u0656 \u062a\u064e\u062c\u0652\u0631\u0650\u06d2 \u0645\u0650\u0646 \u062a\u064e\u062d\u0652\u062a\u0650\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u064e\u0627\u0646\u0652\u0647\u064e\u0670\u0631\u064f \u062e\u064e\u0670\u0644\u0650\u062f\u0650\u064a\u0646\u064e \u0641\u0650\u064a\u0647\u064e\u0627\u0653 \u0623\u064e\u0628\u064e\u062f\u0627\u0657\u06d6 \u0631\u0651\u064e\u0636\u0650\u064a\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0639\u064e\u0646\u0652\u0647\u064f\u0645\u0652 \u0648\u064e\u0631\u064e\u0636\u064f\u0648\u0627\u0652 \u0639\u064e\u0646\u0652\u0647\u064f\u06d6 \u0630\u064e\u0670\u0644\u0650\u0643\u064e \u0644\u0650\u0645\u064e\u0646\u0652 \u062e\u064e\u0634\u0650\u064a\u064e \u0631\u064e\u0628\u0651\u064e\u0647\u064f\u06e5\u0653', r: '[\u0627\u0644\u0628\u064a\u0646\u0629: 7-8]' },
    { q: true, t: '\u0648\u064e\u0645\u064e\u0627 \u062a\u064e\u0641\u0652\u0639\u064e\u0644\u064f\u0648\u0627\u0652 \u0645\u0650\u0646\u0652 \u062e\u064e\u064a\u0652\u0631\u0656 \u0641\u064e\u0644\u064e\u0646 \u062a\u064f\u0643\u0652\u0641\u064e\u0631\u064f\u0648\u0647\u064f\u06d6 \u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u0639\u064e\u0644\u0650\u064a\u0645\u064f\u06e2 \u0628\u0650\u0627\u0644\u0652\u0645\u064f\u062a\u0651\u064e\u0642\u0650\u064a\u0646\u064e', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 115]' },
    { q: true, t: '\u064a\u064e\u0670\u0653\u0623\u064e\u064a\u0651\u064f\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u0646\u0651\u064e\u0627\u0633\u064f \u0627\u064f\u06df\u0639\u0652\u0628\u064f\u062f\u064f\u0648\u0627\u0652 \u0631\u064e\u0628\u0651\u064e\u0643\u064f\u0645\u064f \u0627\u064f\u06ec\u0644\u0630\u0650\u06d2 \u062e\u064e\u0644\u064e\u0642\u064e\u0643\u064f\u0645\u0652 \u0648\u064e\u0627\u0644\u0630\u0650\u064a\u0646\u064e \u0645\u0650\u0646 \u0642\u064e\u0628\u0652\u0644\u0650\u0643\u064f\u0645\u0652 \u0644\u064e\u0639\u064e\u0644\u0651\u064e\u0643\u064f\u0645\u0652 \u062a\u064e\u062a\u0651\u064e\u0642\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 20]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e\u0627\u0653 \u0623\u064e\u0639\u0652\u0637\u064e\u064a\u0652\u0646\u064e\u0670\u0643\u064e \u0627\u064e\u06ec\u0644\u0652\u0643\u064e\u0648\u0652\u062b\u064e\u0631\u064e', r: '[\u0627\u0644\u0643\u0648\u062b\u0631: 1]' },
    { q: true, t: '\u0628\u064e\u0644\u0650 \u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0645\u064e\u0648\u0652\u0644\u06ea\u064a\u0670\u0643\u064f\u0645\u0652\u06d6 \u0648\u064e\u0647\u064f\u0648\u064e \u062e\u064e\u064a\u0652\u0631\u064f \u0627\u064f\u06ec\u0644\u0646\u0651\u064e\u0670\u0635\u0650\u0631\u0650\u064a\u0646\u064e', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 150]' },
    { q: true, t: '\u0648\u064e\u0644\u0650\u0644\u0647\u0650 \u0627\u0650\u06ec\u0644\u0652\u0645\u064e\u0634\u0652\u0631\u0650\u0642\u064f \u0648\u064e\u0627\u0644\u0652\u0645\u064e\u063a\u0652\u0631\u0650\u0628\u064f\u06d6 \u0641\u064e\u0623\u064e\u064a\u0652\u0646\u064e\u0645\u064e\u0627 \u062a\u064f\u0648\u064e\u0644\u0651\u064f\u0648\u0627\u0652 \u0641\u064e\u062b\u064e\u0645\u0651\u064e \u0648\u064e\u062c\u0652\u0647\u064f \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u0650\u06d6 \u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0648\u064e\u0670\u0633\u0650\u0639\u064c \u0639\u064e\u0644\u0650\u064a\u0645\u065e', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 114]' },
    { q: true, t: '\u0648\u064e\u062c\u064e\u0632\u06ea\u064a\u0670\u0647\u064f\u0645 \u0628\u0650\u0645\u064e\u0627 \u0635\u064e\u0628\u064e\u0631\u064f\u0648\u0627\u0652 \u062c\u064e\u0646\u0651\u064e\u0629\u0657 \u0648\u064e\u062d\u064e\u0631\u0650\u064a\u0631\u0627\u0657', r: '[\u0627\u0644\u0627\u0646\u0633\u0627\u0646: 12]' },
    { q: true, t: '\u064a\u064e\u0633\u0652\u062a\u064e\u0628\u0652\u0634\u0650\u0631\u064f\u0648\u0646\u064e \u0628\u0650\u0646\u0650\u0639\u0652\u0645\u064e\u0629\u0656 \u0645\u0651\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0648\u064e\u0641\u064e\u0636\u0652\u0644\u0656 \u0648\u064e\u0623\u064e\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0644\u064e\u0627 \u064a\u064f\u0636\u0650\u064a\u0639\u064f \u0623\u064e\u062c\u0652\u0631\u064e \u0627\u064e\u06ec\u0644\u0652\u0645\u064f\u0648\u0645\u0650\u0646\u0650\u064a\u0646\u064e', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 171]' },
    { q: true, t: '\u0635\u0650\u0628\u0652\u063a\u064e\u0629\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650\u06d6 \u0648\u064e\u0645\u064e\u0646\u064e \u0627\u064e\u062d\u0652\u0633\u064e\u0646\u064f \u0645\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0635\u0650\u0628\u0652\u063a\u064e\u0629\u0657\u06d6 \u0648\u064e\u0646\u064e\u062d\u0652\u0646\u064f \u0644\u064e\u0647\u064f\u06e5 \u0639\u064e\u0670\u0628\u0650\u062f\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 137]' },
    { q: true, t: '\u0627\u06df\u0648\u0652\u0644\u064e\u0670\u0653\u0626\u0650\u0643\u064e \u064a\u064f\u062c\u0652\u0632\u064e\u0648\u0652\u0646\u064e \u0627\u064e\u06ec\u0644\u0652\u063a\u064f\u0631\u0652\u0641\u064e\u0629\u064e \u0628\u0650\u0645\u064e\u0627 \u0635\u064e\u0628\u064e\u0631\u064f\u0648\u0627\u0652 \u0648\u064e\u064a\u064f\u0644\u064e\u0642\u0651\u064e\u0648\u0652\u0646\u064e \u0641\u0650\u064a\u0647\u064e\u0627 \u062a\u064e\u062d\u0650\u064a\u0651\u064e\u0629\u0657 \u0648\u064e\u0633\u064e\u0644\u064e\u0670\u0645\u0627\u064b', r: '[\u0627\u0644\u0641\u0631\u0642\u0627\u0646: 75]' },
    { q: true, t: '\u064a\u064e\u0670\u0653\u0623\u064e\u064a\u0651\u064f\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0627\u064f\u06ea\u0635\u0652\u0628\u0650\u0631\u064f\u0648\u0627\u0652 \u0648\u064e\u0635\u064e\u0627\u0628\u0650\u0631\u064f\u0648\u0627\u0652 \u0648\u064e\u0631\u064e\u0627\u0628\u0650\u0637\u064f\u0648\u0627\u0652 \u0648\u064e\u0627\u062a\u0651\u064e\u0642\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0644\u064e\u0639\u064e\u0644\u0651\u064e\u0643\u064f\u0645\u0652 \u062a\u064f\u0641\u0652\u0644\u0650\u062d\u064f\u0648\u0646\u064e', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 200]' },
    { q: true, t: '\u0648\u064e\u0645\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0646\u0651\u064e\u0627\u0633\u0650 \u0645\u064e\u0646\u0652 \u064a\u0651\u064e\u0634\u0652\u0631\u0650\u06d2 \u0646\u064e\u0641\u0652\u0633\u064e\u0647\u064f \u0627\u064f\u06ea\u0628\u0652\u062a\u0650\u063a\u064e\u0627\u0653\u0621\u064e \u0645\u064e\u0631\u0652\u0636\u064e\u0627\u062a\u0650 \u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u0650\u06d6 \u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u0631\u064e\u0621\u064f\u0648\u0641\u064f\u06e2 \u0628\u0650\u0627\u0644\u0652\u0639\u0650\u0628\u064e\u0627\u062f\u0650', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 205]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u0650\u06d2 \u062c\u064e\u0632\u064e\u064a\u0652\u062a\u064f\u0647\u064f\u0645\u064f \u0627\u064f\u06ec\u0644\u0652\u064a\u064e\u0648\u0652\u0645\u064e \u0628\u0650\u0645\u064e\u0627 \u0635\u064e\u0628\u064e\u0631\u064f\u0648\u0653\u0627\u0652 \u0623\u064e\u0646\u0651\u064e\u0647\u064f\u0645\u0652 \u0647\u064f\u0645\u064f \u0627\u064f\u06ec\u0644\u0652\u0641\u064e\u0627\u0653\u0626\u0650\u0632\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0645\u0624\u0645\u0646\u0648\u0646: 112]' },
    { q: true, t: '\u0627\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0644\u064e\u0627 \u064a\u064e\u0638\u0652\u0644\u0650\u0645\u064f \u0645\u0650\u062b\u0652\u0642\u064e\u0627\u0644\u064e \u0630\u064e\u0631\u0651\u064e\u0629\u0656\u06d6 \u0648\u064e\u0625\u0650\u0646 \u062a\u064e\u0643\u064f \u062d\u064e\u0633\u064e\u0646\u064e\u0629\u065e \u064a\u064f\u0636\u064e\u0670\u0639\u0650\u0641\u0652\u0647\u064e\u0627 \u0648\u064e\u064a\u064f\u0648\u062a\u0650 \u0645\u0650\u0646 \u0644\u0651\u064e\u062f\u064f\u0646\u0652\u0647\u064f \u0623\u064e\u062c\u0652\u0631\u0627\u064b \u0639\u064e\u0638\u0650\u064a\u0645\u0627\u0657', r: '[\u0627\u0644\u0646\u0633\u0627\u0621: 40]' },
    { q: true, t: '\u0645\u0651\u064e\u0646 \u0630\u064e\u0627 \u0627\u064e\u06ec\u0644\u0630\u0650\u06d2 \u064a\u064f\u0642\u0652\u0631\u0650\u0636\u064f \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0642\u064e\u0631\u0652\u0636\u0627\u064b \u062d\u064e\u0633\u064e\u0646\u0627\u0657 \u0641\u064e\u064a\u064f\u0636\u064e\u0670\u0639\u0650\u0641\u064f\u0647\u064f\u06e5 \u0644\u064e\u0647\u064f\u06e5\u0653 \u0623\u064e\u0636\u0652\u0639\u064e\u0627\u0641\u0627\u0657 \u0643\u064e\u062b\u0650\u064a\u0631\u064e\u0629\u0657\u06d6 \u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u064a\u064e\u0642\u0652\u0628\u0650\u0636\u064f \u0648\u064e\u064a\u064e\u0628\u0652\u0635\u064f\u0637\u064f\u06d6 \u0648\u064e\u0625\u0650\u0644\u064e\u064a\u0652\u0647\u0650 \u062a\u064f\u0631\u0652\u062c\u064e\u0639\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 243]' },
    { q: true, t: '\u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u06d2\u0653 \u0623\u064e\u0646\u0632\u064e\u0644\u064e \u0627\u064e\u06ec\u0644\u0633\u0651\u064e\u0643\u0650\u064a\u0646\u064e\u0629\u064e \u0641\u0650\u06d2 \u0642\u064f\u0644\u064f\u0648\u0628\u0650 \u0627\u0650\u06ec\u0644\u0652\u0645\u064f\u0648\u0645\u0650\u0646\u0650\u064a\u0646\u064e \u0644\u0650\u064a\u064e\u0632\u0652\u062f\u064e\u0627\u062f\u064f\u0648\u0653\u0627\u0652 \u0625\u0650\u064a\u0645\u064e\u0670\u0646\u0627\u0657 \u0645\u0651\u064e\u0639\u064e \u0625\u0650\u064a\u0645\u064e\u0670\u0646\u0650\u0647\u0650\u0645\u0652\u06d6 \u0648\u064e\u0644\u0650\u0644\u0647\u0650 \u062c\u064f\u0646\u064f\u0648\u062f\u064f \u0627\u064f\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0627\u0644\u064e\u0627\u0631\u0652\u0636\u0650\u06d6 \u0648\u064e\u0643\u064e\u0627\u0646\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0639\u064e\u0644\u0650\u064a\u0645\u0627\u064b \u062d\u064e\u0643\u0650\u064a\u0645\u0627\u0657', r: '[\u0627\u0644\u0641\u062a\u062d: 4]' },
    { q: true, t: '\u0648\u064e\u0627\u0633\u0652\u062a\u064e\u063a\u0652\u0641\u0650\u0631\u0650 \u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u064e\u06d6 \u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0643\u064e\u0627\u0646\u064e \u063a\u064e\u0641\u064f\u0648\u0631\u0627\u0657 \u0631\u0651\u064e\u062d\u0650\u064a\u0645\u0627\u0657', r: '[\u0627\u0644\u0646\u0633\u0627\u0621: 105]' },
    { q: true, t: '\u0631\u064e\u0628\u0651\u064e\u0646\u064e\u0627\u0653 \u0621\u064e\u0627\u0645\u064e\u0646\u0651\u064e\u0627 \u0628\u0650\u0645\u064e\u0627\u0653 \u0623\u064e\u0646\u0632\u064e\u0644\u0652\u062a\u064e \u0648\u064e\u0627\u062a\u0651\u064e\u0628\u064e\u0639\u0652\u0646\u064e\u0627 \u0627\u064e\u06ec\u0644\u0631\u0651\u064e\u0633\u064f\u0648\u0644\u064e \u0641\u064e\u0627\u0643\u0652\u062a\u064f\u0628\u0652\u0646\u064e\u0627 \u0645\u064e\u0639\u064e \u0627\u064e\u06ec\u0644\u0634\u0651\u064e\u0670\u0647\u0650\u062f\u0650\u064a\u0646\u064e', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 52]' },
    { q: true, t: '\u0641\u064e\u0627\u0633\u0652\u062a\u064e\u062c\u064e\u0627\u0628\u064e \u0644\u064e\u0647\u064f\u0645\u0652 \u0631\u064e\u0628\u0651\u064f\u0647\u064f\u0645\u064f\u06e5\u0653 \u0623\u064e\u0646\u0651\u0650\u06d2 \u0644\u064e\u0627\u0653 \u0623\u064f\u0636\u0650\u064a\u0639\u064f \u0639\u064e\u0645\u064e\u0644\u064e \u0639\u064e\u0670\u0645\u0650\u0644\u0656 \u0645\u0651\u0650\u0646\u0643\u064f\u0645 \u0645\u0651\u0650\u0646 \u0630\u064e\u0643\u064e\u0631\u064d \u0627\u064e\u0648\u064f \u0627\u06df\u0646\u062b\u06ea\u0649\u0670', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 195]' },
    { q: true, t: '\u0641\u064e\u0623\u064e\u0645\u0651\u064e\u0627 \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0628\u0650\u0627\u0644\u0644\u0651\u064e\u0647\u0650 \u0648\u064e\u0627\u0639\u0652\u062a\u064e\u0635\u064e\u0645\u064f\u0648\u0627\u0652 \u0628\u0650\u0647\u0650\u06e6 \u0641\u064e\u0633\u064e\u064a\u064f\u062f\u0652\u062e\u0650\u0644\u064f\u0647\u064f\u0645\u0652 \u0641\u0650\u06d2 \u0631\u064e\u062d\u0652\u0645\u064e\u0629\u0656 \u0645\u0651\u0650\u0646\u0652\u0647\u064f \u0648\u064e\u0641\u064e\u0636\u0652\u0644\u0656 \u0648\u064e\u064a\u064e\u0647\u0652\u062f\u0650\u064a\u0647\u0650\u0645\u064f\u06e5\u0653 \u0625\u0650\u0644\u064e\u064a\u0652\u0647\u0650 \u0635\u0650\u0631\u064e\u0670\u0637\u0627\u0657 \u0645\u0651\u064f\u0633\u0652\u062a\u064e\u0642\u0650\u064a\u0645\u0627\u0657', r: '[\u0627\u0644\u0646\u0633\u0627\u0621: 174]' },
    { q: true, t: '\u0648\u064e\u0623\u064e\u0637\u0650\u064a\u0639\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0648\u064e\u0627\u0644\u0631\u0651\u064e\u0633\u064f\u0648\u0644\u064e \u0644\u064e\u0639\u064e\u0644\u0651\u064e\u0643\u064f\u0645\u0652 \u062a\u064f\u0631\u0652\u062d\u064e\u0645\u064f\u0648\u0646\u064e', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 132]' },
    { q: true, t: '\u0648\u064e\u0645\u064e\u0646\u0652 \u064a\u0651\u064e\u0639\u0652\u0645\u064e\u0644\u0652 \u0645\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0635\u0651\u064e\u0670\u0644\u0650\u062d\u064e\u0670\u062a\u0650 \u0645\u0650\u0646 \u0630\u064e\u0643\u064e\u0631\u064d \u0627\u064e\u0648\u064f \u0627\u06df\u0646\u062b\u06ea\u0649\u0670 \u0648\u064e\u0647\u064f\u0648\u064e \u0645\u064f\u0648\u0645\u0650\u0646\u065e \u0641\u064e\u0623\u064f\u0648\u0652\u0644\u064e\u0670\u0653\u0626\u0650\u0643\u064e \u064a\u064e\u062f\u0652\u062e\u064f\u0644\u064f\u0648\u0646\u064e \u0627\u064e\u06ec\u0644\u0652\u062c\u064e\u0646\u0651\u064e\u0629\u064e \u0648\u064e\u0644\u064e\u0627 \u064a\u064f\u0638\u0652\u0644\u064e\u0645\u064f\u0648\u0646\u064e \u0646\u064e\u0642\u0650\u064a\u0631\u0627\u0657', r: '[\u0627\u0644\u0646\u0633\u0627\u0621: 123]' },
    { q: true, t: '\u0648\u064e\u0639\u064e\u062f\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0627\u064f\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0648\u064e\u0639\u064e\u0645\u0650\u0644\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0635\u0651\u064e\u0670\u0644\u0650\u062d\u064e\u0670\u062a\u0650 \u0644\u064e\u0647\u064f\u0645 \u0645\u0651\u064e\u063a\u0652\u0641\u0650\u0631\u064e\u0629\u065e \u0648\u064e\u0623\u064e\u062c\u0652\u0631\u064c \u0639\u064e\u0638\u0650\u064a\u0645\u065e', r: '[\u0627\u0644\u0645\u0627\u0626\u062f\u0629: 10]' },
    { q: true, t: '\u0648\u064e\u0644\u0650\u0644\u0647\u0650 \u0645\u064f\u0644\u0652\u0643\u064f \u0627\u064f\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0627\u0644\u064e\u0627\u0631\u0652\u0636\u0650\u06d6 \u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u0639\u064e\u0644\u064e\u0649\u0670 \u0643\u064f\u0644\u0651\u0650 \u0634\u064e\u06d2\u0652\u0621\u0656 \u0642\u064e\u062f\u0650\u064a\u0631\u064c', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 189]' },
    { q: true, t: '\u0644\u064e\u0627 \u064a\u064e\u062d\u0652\u0632\u064f\u0646\u064f\u0647\u064f\u0645\u064f \u0627\u064f\u06ec\u0644\u0652\u0641\u064e\u0632\u064e\u0639\u064f \u0627\u064f\u06ec\u0644\u064e\u0627\u0643\u0652\u0628\u064e\u0631\u064f\u06d6 \u0648\u064e\u062a\u064e\u062a\u064e\u0644\u064e\u0642\u0651\u06ea\u064a\u0670\u0647\u064f\u0645\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u064e\u0644\u064e\u0670\u0653\u0626\u0650\u0643\u064e\u0629\u064f \u0647\u064e\u0670\u0630\u064e\u0627 \u064a\u064e\u0648\u0652\u0645\u064f\u0643\u064f\u0645\u064f \u0627\u064f\u06ec\u0644\u0630\u0650\u06d2 \u0643\u064f\u0646\u062a\u064f\u0645\u0652 \u062a\u064f\u0648\u0639\u064e\u062f\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0623\u0646\u0628\u064a\u0627\u0621: 102]' },
    { q: true, t: '\u0630\u064e\u0670\u0644\u0650\u0643\u064f\u0645\u064f \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0631\u064e\u0628\u0651\u064f\u0643\u064f\u0645\u0652\u06d6 \u0644\u064e\u0627\u0653 \u0625\u0650\u0644\u064e\u0670\u0647\u064e \u0625\u0650\u0644\u0651\u064e\u0627 \u0647\u064f\u0648\u064e\u06d6 \u062e\u064e\u0670\u0644\u0650\u0642\u064f \u0643\u064f\u0644\u0651\u0650 \u0634\u064e\u06d2\u0652\u0621\u0656\u06d6 \u0641\u064e\u0627\u0639\u0652\u0628\u064f\u062f\u064f\u0648\u0647\u064f\u06d6 \u0648\u064e\u0647\u064f\u0648\u064e \u0639\u064e\u0644\u064e\u0649\u0670 \u0643\u064f\u0644\u0651\u0650 \u0634\u064e\u06d2\u0652\u0621\u0656 \u0648\u064e\u0643\u0650\u064a\u0644\u065e', r: '[\u0627\u0644\u0623\u0646\u0639\u0627\u0645: 103]' },
    { q: true, t: '\u064a\u064f\u0631\u0650\u064a\u062f\u064f \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0644\u0650\u064a\u064f\u0628\u064e\u064a\u0651\u0650\u0646\u064e \u0644\u064e\u0643\u064f\u0645\u0652 \u0648\u064e\u064a\u064e\u0647\u0652\u062f\u0650\u064a\u064e\u0643\u064f\u0645\u0652 \u0633\u064f\u0646\u064e\u0646\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0645\u0650\u0646 \u0642\u064e\u0628\u0652\u0644\u0650\u0643\u064f\u0645\u0652 \u0648\u064e\u064a\u064e\u062a\u064f\u0648\u0628\u064e \u0639\u064e\u0644\u064e\u064a\u0652\u0643\u064f\u0645\u0652\u06d6 \u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u0639\u064e\u0644\u0650\u064a\u0645\u064c \u062d\u064e\u0643\u0650\u064a\u0645\u065e', r: '[\u0627\u0644\u0646\u0633\u0627\u0621: 26]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e \u0623\u064e\u0635\u0652\u062d\u064e\u0670\u0628\u064e \u0627\u064e\u06ec\u0644\u0652\u062c\u064e\u0646\u0651\u064e\u0629\u0650 \u0627\u0650\u06ec\u0644\u0652\u064a\u064e\u0648\u0652\u0645\u064e \u0641\u0650\u06d2 \u0634\u064f\u063a\u0652\u0644\u0656 \u0641\u064e\u0670\u0643\u0650\u0647\u064f\u0648\u0646\u064e \u0647\u064f\u0645\u0652 \u0648\u064e\u0623\u064e\u0632\u0652\u0648\u064e\u0670\u062c\u064f\u0647\u064f\u0645\u0652 \u0641\u0650\u06d2 \u0638\u0650\u0644\u064e\u0670\u0644\u064d \u0639\u064e\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u064e\u0627\u0631\u064e\u0627\u0653\u0626\u0650\u0643\u0650 \u0645\u064f\u062a\u0651\u064e\u0643\u0650\u0640\u0654\u064f\u0648\u0646\u064e\u06d6 \u0644\u064e\u0647\u064f\u0645\u0652 \u0641\u0650\u064a\u0647\u064e\u0627 \u0641\u064e\u0670\u0643\u0650\u0647\u064e\u0629\u065e\u06d6 \u0648\u064e\u0644\u064e\u0647\u064f\u0645 \u0645\u0651\u064e\u0627 \u064a\u064e\u062f\u0651\u064e\u0639\u064f\u0648\u0646\u064e', r: '[\u064a\u0633: 54-56]' },
    { q: true, t: '\u0644\u064e\u0647\u064f\u0645\u0652 \u062f\u064e\u0627\u0631\u064f \u0627\u064f\u06ec\u0644\u0633\u0651\u064e\u0644\u064e\u0670\u0645\u0650 \u0639\u0650\u0646\u062f\u064e \u0631\u064e\u0628\u0651\u0650\u0647\u0650\u0645\u0652\u06d6 \u0648\u064e\u0647\u064f\u0648\u064e \u0648\u064e\u0644\u0650\u064a\u0651\u064f\u0647\u064f\u0645 \u0628\u0650\u0645\u064e\u0627 \u0643\u064e\u0627\u0646\u064f\u0648\u0627\u0652 \u064a\u064e\u0639\u0652\u0645\u064e\u0644\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0623\u0646\u0639\u0627\u0645: 128]' },
    { q: true, t: '\u0648\u064e\u0625\u0650\u0630\u064e\u0627 \u062d\u064f\u064a\u0651\u0650\u064a\u062a\u064f\u0645 \u0628\u0650\u062a\u064e\u062d\u0650\u064a\u0651\u064e\u0629\u0656 \u0641\u064e\u062d\u064e\u064a\u0651\u064f\u0648\u0627\u0652 \u0628\u0650\u0623\u064e\u062d\u0652\u0633\u064e\u0646\u064e \u0645\u0650\u0646\u0652\u0647\u064e\u0627\u0653 \u0623\u064e\u0648\u0652 \u0631\u064f\u062f\u0651\u064f\u0648\u0647\u064e\u0627\u0653\u06d6 \u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0643\u064e\u0627\u0646\u064e \u0639\u064e\u0644\u064e\u0649\u0670 \u0643\u064f\u0644\u0651\u0650 \u0634\u064e\u06d2\u0652\u0621\u064d \u062d\u064e\u0633\u0650\u064a\u0628\u0627\u064b', r: '[\u0627\u0644\u0646\u0633\u0627\u0621: 85]' },
    { q: true, t: '\u0648\u064e\u0627\u0644\u0633\u0651\u064e\u0670\u0628\u0650\u0642\u064f\u0648\u0646\u064e \u0627\u064e\u06ec\u0644\u0633\u0651\u064e\u0670\u0628\u0650\u0642\u064f\u0648\u0646\u064e\u06d6 \u0623\u064f\u0648\u0652\u0644\u064e\u0670\u0653\u0626\u0650\u0643\u064e \u0627\u064e\u06ec\u0644\u0652\u0645\u064f\u0642\u064e\u0631\u0651\u064e\u0628\u064f\u0648\u0646\u064e \u0641\u0650\u06d2 \u062c\u064e\u0646\u0651\u064e\u0670\u062a\u0650 \u0627\u0650\u06ec\u0644\u0646\u0651\u064e\u0639\u0650\u064a\u0645\u0650', r: '[\u0627\u0644\u0648\u0627\u0642\u0639\u0629: 12-14]' },
    { q: true, t: '\u064a\u064e\u0670\u0628\u064e\u0646\u0650\u06d2\u0653 \u0621\u064e\u0627\u062f\u064e\u0645\u064e \u062e\u064f\u0630\u064f\u0648\u0627\u0652 \u0632\u0650\u064a\u0646\u064e\u062a\u064e\u0643\u064f\u0645\u0652 \u0639\u0650\u0646\u062f\u064e \u0643\u064f\u0644\u0651\u0650 \u0645\u064e\u0633\u0652\u062c\u0650\u062f\u0656 \u0648\u064e\u0643\u064f\u0644\u064f\u0648\u0627\u0652 \u0648\u064e\u0627\u0634\u0652\u0631\u064e\u0628\u064f\u0648\u0627\u0652\u06d6 \u0648\u064e\u0644\u064e\u0627 \u062a\u064f\u0633\u0652\u0631\u0650\u0641\u064f\u0648\u0653\u0627\u0652\u06d6 \u0625\u0650\u0646\u0651\u064e\u0647\u064f\u06e5 \u0644\u064e\u0627 \u064a\u064f\u062d\u0650\u0628\u0651\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u064f\u0633\u0652\u0631\u0650\u0641\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0623\u0639\u0631\u0627\u0641: 29]' },
    { q: true, t: '\u0648\u064e\u0644\u0650\u0644\u0647\u0650 \u0645\u064e\u0627 \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0645\u064e\u0627 \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u064e\u0627\u0631\u0652\u0636\u0650\u06d6 \u0648\u064e\u0643\u064e\u0641\u06ea\u0649\u0670 \u0628\u0650\u0627\u0644\u0644\u0651\u064e\u0647\u0650 \u0648\u064e\u0643\u0650\u064a\u0644\u0627\u064b', r: '[\u0627\u0644\u0646\u0633\u0627\u0621: 131]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u064a\u064f\u062f\u0652\u062e\u0650\u0644\u064f \u0627\u064f\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0648\u064e\u0639\u064e\u0645\u0650\u0644\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0635\u0651\u064e\u0670\u0644\u0650\u062d\u064e\u0670\u062a\u0650 \u062c\u064e\u0646\u0651\u064e\u0670\u062a\u0656 \u062a\u064e\u062c\u0652\u0631\u0650\u06d2 \u0645\u0650\u0646 \u062a\u064e\u062d\u0652\u062a\u0650\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u064e\u0627\u0646\u0652\u0647\u064e\u0670\u0631\u064f \u064a\u064f\u062d\u064e\u0644\u0651\u064e\u0648\u0652\u0646\u064e \u0641\u0650\u064a\u0647\u064e\u0627 \u0645\u0650\u0646\u064e \u0627\u064e\u0633\u064e\u0627\u0648\u0650\u0631\u064e \u0645\u0650\u0646 \u0630\u064e\u0647\u064e\u0628\u0656 \u0648\u064e\u0644\u064f\u0624\u0652\u0644\u064f\u0624\u0627\u0657\u06d6 \u0648\u064e\u0644\u0650\u0628\u064e\u0627\u0633\u064f\u0647\u064f\u0645\u0652 \u0641\u0650\u064a\u0647\u064e\u0627 \u062d\u064e\u0631\u0650\u064a\u0631\u065e', r: '[\u0627\u0644\u062d\u062c: 21]' },
    { q: true, t: '\u0648\u064e\u0627\u0644\u0630\u0650\u064a\u0646\u064e \u0639\u064e\u0645\u0650\u0644\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0633\u0651\u064e\u064a\u0651\u0650\u0640\u0654\u064e\u0627\u062a\u0650 \u062b\u064f\u0645\u0651\u064e \u062a\u064e\u0627\u0628\u064f\u0648\u0627\u0652 \u0645\u0650\u0646\u06e2 \u0628\u064e\u0639\u0652\u062f\u0650\u0647\u064e\u0627 \u0648\u064e\u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0653\u0627 \u0625\u0650\u0646\u0651\u064e \u0631\u064e\u0628\u0651\u064e\u0643\u064e \u0645\u0650\u0646\u06e2 \u0628\u064e\u0639\u0652\u062f\u0650\u0647\u064e\u0627 \u0644\u064e\u063a\u064e\u0641\u064f\u0648\u0631\u065e \u0631\u0651\u064e\u062d\u0650\u064a\u0645\u065e', r: '[\u0627\u0644\u0623\u0639\u0631\u0627\u0641: 153]' },
    { q: true, t: '\u0645\u0651\u064e\u0646 \u0643\u064e\u0627\u0646\u064e \u064a\u064f\u0631\u0650\u064a\u062f\u064f \u062b\u064e\u0648\u064e\u0627\u0628\u064e \u0627\u064e\u06ec\u0644\u062f\u0651\u064f\u0646\u0652\u064a\u06ea\u0627 \u0641\u064e\u0639\u0650\u0646\u062f\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u062b\u064e\u0648\u064e\u0627\u0628\u064f \u0627\u064f\u06ec\u0644\u062f\u0651\u064f\u0646\u0652\u064a\u06ea\u0627 \u0648\u064e\u0627\u0644\u064e\u0627\u062e\u0650\u0631\u064e\u0629\u0650\u06d6 \u0648\u064e\u0643\u064e\u0627\u0646\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0633\u064e\u0645\u0650\u064a\u0639\u0627\u064e\u06e2 \u0628\u064e\u0635\u0650\u064a\u0631\u0627\u0657', r: '[\u0627\u0644\u0646\u0633\u0627\u0621: 133]' },
    { q: true, t: '\u0627\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0648\u064e\u0639\u064e\u0645\u0650\u0644\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0635\u0651\u064e\u0670\u0644\u0650\u062d\u064e\u0670\u062a\u0650 \u0625\u0650\u0646\u0651\u064e\u0627 \u0644\u064e\u0627 \u0646\u064f\u0636\u0650\u064a\u0639\u064f \u0623\u064e\u062c\u0652\u0631\u064e \u0645\u064e\u0646\u064e \u0627\u064e\u062d\u0652\u0633\u064e\u0646\u064e \u0639\u064e\u0645\u064e\u0644\u0627\u064b', r: '[\u0627\u0644\u0643\u0647\u0641: 30]' },
    { q: true, t: '\u0642\u064f\u0644 \u0644\u0651\u064e\u0646\u0652 \u064a\u0651\u064f\u0635\u0650\u064a\u0628\u064e\u0646\u064e\u0627\u0653 \u0625\u0650\u0644\u0651\u064e\u0627 \u0645\u064e\u0627 \u0643\u064e\u062a\u064e\u0628\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0644\u064e\u0646\u064e\u0627\u06d6 \u0647\u064f\u0648\u064e \u0645\u064e\u0648\u0652\u0644\u06ea\u064a\u0670\u0646\u064e\u0627\u06d6 \u0648\u064e\u0639\u064e\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0641\u064e\u0644\u0652\u064a\u064e\u062a\u064e\u0648\u064e\u0643\u0651\u064e\u0644\u0650 \u0627\u0650\u06ec\u0644\u0652\u0645\u064f\u0648\u0645\u0650\u0646\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u062a\u0648\u0628\u0629: 51]' },
    { q: true, t: '\u064a\u064e\u0670\u0653\u0623\u064e\u064a\u0651\u064f\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0627\u064f\u06ea\u062a\u0651\u064e\u0642\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0648\u064e\u0627\u0628\u0652\u062a\u064e\u063a\u064f\u0648\u0653\u0627\u0652 \u0625\u0650\u0644\u064e\u064a\u0652\u0647\u0650 \u0627\u0650\u06ec\u0644\u0652\u0648\u064e\u0633\u0650\u064a\u0644\u064e\u0629\u064e \u0648\u064e\u062c\u064e\u0670\u0647\u0650\u062f\u064f\u0648\u0627\u0652 \u0641\u0650\u06d2 \u0633\u064e\u0628\u0650\u064a\u0644\u0650\u0647\u0650\u06e6 \u0644\u064e\u0639\u064e\u0644\u0651\u064e\u0643\u064f\u0645\u0652 \u062a\u064f\u0641\u0652\u0644\u0650\u062d\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0645\u0627\u0626\u062f\u0629: 37]' },
    { q: true, t: '\u0648\u064e\u0627\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0648\u064e\u0639\u064e\u0645\u0650\u0644\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0635\u0651\u064e\u0670\u0644\u0650\u062d\u064e\u0670\u062a\u0650 \u0644\u064e\u0646\u064f\u0628\u064e\u0648\u0651\u0650\u064a\u0654\u064e\u0646\u0651\u064e\u0647\u064f\u0645 \u0645\u0651\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0652\u062c\u064e\u0646\u0651\u064e\u0629\u0650 \u063a\u064f\u0631\u064e\u0641\u0627\u0657 \u062a\u064e\u062c\u0652\u0631\u0650\u06d2 \u0645\u0650\u0646 \u062a\u064e\u062d\u0652\u062a\u0650\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u064e\u0627\u0646\u0652\u0647\u064e\u0670\u0631\u064f \u062e\u064e\u0670\u0644\u0650\u062f\u0650\u064a\u0646\u064e \u0641\u0650\u064a\u0647\u064e\u0627\u06d6 \u0646\u0650\u0639\u0652\u0645\u064e \u0623\u064e\u062c\u0652\u0631\u064f \u0627\u064f\u06ec\u0644\u0652\u0639\u064e\u0670\u0645\u0650\u0644\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0639\u0646\u0643\u0628\u0648\u062a: 58]' },
    { q: true, t: '\u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u064a\u064e\u062f\u0652\u0639\u064f\u0648\u0653\u0627\u0652 \u0625\u0650\u0644\u064e\u0649\u0670 \u062f\u06ea\u0627\u0631\u0650 \u0627\u0650\u06ec\u0644\u0633\u0651\u064e\u0644\u064e\u0670\u0645\u0650 \u0648\u064e\u064a\u064e\u0647\u0652\u062f\u0650\u06d2 \u0645\u064e\u0646\u0652 \u064a\u0651\u064e\u0634\u064e\u0627\u0653\u0621\u064f \u0627\u06ea\u0650\u0644\u064e\u0649\u0670 \u0635\u0650\u0631\u064e\u0670\u0637\u0656 \u0645\u0651\u064f\u0633\u0652\u062a\u064e\u0642\u0650\u064a\u0645\u0656', r: '[\u064a\u0648\u0646\u0633: 25]' },
    { q: true, t: '\u0648\u064e\u0643\u064f\u0644\u064f\u0648\u0627\u0652 \u0645\u0650\u0645\u0651\u064e\u0627 \u0631\u064e\u0632\u064e\u0642\u064e\u0643\u064f\u0645\u064f \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u062d\u064e\u0644\u064e\u0670\u0644\u0627\u0657 \u0637\u064e\u064a\u0651\u0650\u0628\u0627\u0657\u06d6 \u0648\u064e\u0627\u062a\u0651\u064e\u0642\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u06d2\u0653 \u0623\u064e\u0646\u062a\u064f\u0645 \u0628\u0650\u0647\u0650\u06e6 \u0645\u064f\u0648\u0645\u0650\u0646\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0645\u0627\u0626\u062f\u0629: 90]' },
    { q: true, t: '\u0648\u064e\u0627\u0644\u0633\u0651\u064e\u0670\u0628\u0650\u0642\u064f\u0648\u0646\u064e \u0627\u064e\u06ec\u0644\u064e\u0627\u0648\u0651\u064e\u0644\u064f\u0648\u0646\u064e \u0645\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0652\u0645\u064f\u0647\u064e\u0670\u062c\u0650\u0631\u0650\u064a\u0646\u064e \u0648\u064e\u0627\u0644\u064e\u0627\u0646\u0635\u06ea\u0627\u0631\u0650 \u0648\u064e\u0627\u0644\u0630\u0650\u064a\u0646\u064e \u0627\u064e\u06ea\u062a\u0651\u064e\u0628\u064e\u0639\u064f\u0648\u0647\u064f\u0645 \u0628\u0650\u0625\u0650\u062d\u0652\u0633\u064e\u0670\u0646\u0656 \u0631\u0651\u064e\u0636\u0650\u064a\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0639\u064e\u0646\u0652\u0647\u064f\u0645\u0652 \u0648\u064e\u0631\u064e\u0636\u064f\u0648\u0627\u0652 \u0639\u064e\u0646\u0652\u0647\u064f\u06d6 \u0648\u064e\u0623\u064e\u0639\u064e\u062f\u0651\u064e \u0644\u064e\u0647\u064f\u0645\u0652 \u062c\u064e\u0646\u0651\u064e\u0670\u062a\u0656 \u062a\u064e\u062c\u0652\u0631\u0650\u06d2 \u062a\u064e\u062d\u0652\u062a\u064e\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u064e\u0627\u0646\u0652\u0647\u064e\u0670\u0631\u064f \u062e\u064e\u0670\u0644\u0650\u062f\u0650\u064a\u0646\u064e \u0641\u0650\u064a\u0647\u064e\u0627\u0653 \u0623\u064e\u0628\u064e\u062f\u0627\u0657\u06d6 \u0630\u064e\u0670\u0644\u0650\u0643\u064e \u0627\u064e\u06ec\u0644\u0652\u0641\u064e\u0648\u0652\u0632\u064f \u0627\u064f\u06ec\u0644\u0652\u0639\u064e\u0638\u0650\u064a\u0645\u064f', r: '[\u0627\u0644\u062a\u0648\u0628\u0629: 101]' },
    { q: true, t: '\u064a\u064e\u0670\u0653\u0623\u064e\u064a\u0651\u064f\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u0646\u0651\u064e\u0627\u0633\u064f \u0642\u064e\u062f\u0652 \u062c\u064e\u0627\u0653\u0621\u064e\u062a\u0652\u0643\u064f\u0645 \u0645\u0651\u064e\u0648\u0652\u0639\u0650\u0638\u064e\u0629\u065e \u0645\u0651\u0650\u0646 \u0631\u0651\u064e\u0628\u0651\u0650\u0643\u064f\u0645\u0652 \u0648\u064e\u0634\u0650\u0641\u064e\u0627\u0653\u0621\u065e \u0644\u0651\u0650\u0645\u064e\u0627 \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u0635\u0651\u064f\u062f\u064f\u0648\u0631\u0650 \u0648\u064e\u0647\u064f\u062f\u0649\u0657 \u0648\u064e\u0631\u064e\u062d\u0652\u0645\u064e\u0629\u065e \u0644\u0651\u0650\u0644\u0652\u0645\u064f\u0648\u0645\u0650\u0646\u0650\u064a\u0646\u064e', r: '[\u064a\u0648\u0646\u0633: 57]' },
    { q: true, t: '\u0648\u064e\u0646\u064e\u0632\u064e\u0639\u0652\u0646\u064e\u0627 \u0645\u064e\u0627 \u0641\u0650\u06d2 \u0635\u064f\u062f\u064f\u0648\u0631\u0650\u0647\u0650\u0645 \u0645\u0651\u0650\u0646\u0652 \u063a\u0650\u0644\u0651\u0656 \u062a\u064e\u062c\u0652\u0631\u0650\u06d2 \u0645\u0650\u0646 \u062a\u064e\u062d\u0652\u062a\u0650\u0647\u0650\u0645\u064f \u0627\u064f\u06ec\u0644\u064e\u0627\u0646\u0652\u0647\u064e\u0670\u0631\u064f\u06d6 \u0648\u064e\u0642\u064e\u0627\u0644\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f \u0644\u0650\u0644\u0647\u0650 \u0627\u0650\u06ec\u0644\u0630\u0650\u06d2 \u0647\u064e\u062f\u06ea\u064a\u0670\u0646\u064e\u0627 \u0644\u0650\u0647\u064e\u0670\u0630\u064e\u0627 \u0648\u064e\u0645\u064e\u0627 \u0643\u064f\u0646\u0651\u064e\u0627 \u0644\u0650\u0646\u064e\u0647\u0652\u062a\u064e\u062f\u0650\u064a\u064e \u0644\u064e\u0648\u0652\u0644\u064e\u0627\u0653 \u0623\u064e\u0646\u0652 \u0647\u064e\u062f\u06ea\u064a\u0670\u0646\u064e\u0627 \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f', r: '[\u0627\u0644\u0623\u0639\u0631\u0627\u0641: 42]' },
    { q: true, t: '\u0642\u064f\u0644\u0652 \u0628\u0650\u0641\u064e\u0636\u0652\u0644\u0650 \u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0648\u064e\u0628\u0650\u0631\u064e\u062d\u0652\u0645\u064e\u062a\u0650\u0647\u0650\u06e6 \u0641\u064e\u0628\u0650\u0630\u064e\u0670\u0644\u0650\u0643\u064e \u0641\u064e\u0644\u0652\u064a\u064e\u0641\u0652\u0631\u064e\u062d\u064f\u0648\u0627\u0652\u06d6 \u0647\u064f\u0648\u064e \u062e\u064e\u064a\u0652\u0631\u065e \u0645\u0651\u0650\u0645\u0651\u064e\u0627 \u064a\u064e\u062c\u0652\u0645\u064e\u0639\u064f\u0648\u0646\u064e', r: '[\u064a\u0648\u0646\u0633: 58]' },
    { q: true, t: '\u0648\u064e\u062a\u064e\u0645\u0651\u064e\u062a\u0652 \u0643\u064e\u0644\u0650\u0645\u064e\u0670\u062a\u064f \u0631\u064e\u0628\u0651\u0650\u0643\u064e \u0635\u0650\u062f\u0652\u0642\u0627\u0657 \u0648\u064e\u0639\u064e\u062f\u0652\u0644\u0627\u0657\u06d6 \u0644\u0651\u064e\u0627 \u0645\u064f\u0628\u064e\u062f\u0651\u0650\u0644\u064e \u0644\u0650\u0643\u064e\u0644\u0650\u0645\u064e\u0670\u062a\u0650\u0647\u0650\u06e6\u06d6 \u0648\u064e\u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0633\u0651\u064e\u0645\u0650\u064a\u0639\u064f \u0627\u064f\u06ec\u0644\u0652\u0639\u064e\u0644\u0650\u064a\u0645\u064f', r: '[\u0627\u0644\u0623\u0646\u0639\u0627\u0645: 116]' },
    { q: true, t: '\u0645\u064e\u0646\u0652 \u0639\u064e\u0645\u0650\u0644\u064e \u0633\u064e\u064a\u0651\u0650\u064a\u0654\u064e\u0629\u0657 \u0641\u064e\u0644\u064e\u0627 \u064a\u064f\u062c\u0652\u0632\u06ea\u0649\u0670\u0653 \u0625\u0650\u0644\u0651\u064e\u0627 \u0645\u0650\u062b\u0652\u0644\u064e\u0647\u064e\u0627\u06d6 \u0648\u064e\u0645\u064e\u0646\u0652 \u0639\u064e\u0645\u0650\u0644\u064e \u0635\u064e\u0670\u0644\u0650\u062d\u0627\u0657 \u0645\u0651\u0650\u0646 \u0630\u064e\u0643\u064e\u0631\u064d \u0627\u064e\u0648\u064f \u0627\u06df\u0646\u062b\u06ea\u0649\u0670 \u0648\u064e\u0647\u064f\u0648\u064e \u0645\u064f\u0648\u0645\u0650\u0646\u065e \u0641\u064e\u0623\u064f\u0648\u0652\u0644\u064e\u0670\u0653\u0626\u0650\u0643\u064e \u064a\u064e\u062f\u0652\u062e\u064f\u0644\u064f\u0648\u0646\u064e \u0627\u064e\u06ec\u0644\u0652\u062c\u064e\u0646\u0651\u064e\u0629\u064e \u064a\u064f\u0631\u0652\u0632\u064e\u0642\u064f\u0648\u0646\u064e \u0641\u0650\u064a\u0647\u064e\u0627 \u0628\u0650\u063a\u064e\u064a\u0652\u0631\u0650 \u062d\u0650\u0633\u064e\u0627\u0628\u0656', r: '[\u063a\u0627\u0641\u0631: 40]' },
    { q: true, t: '\u0648\u064e\u0627\u062a\u0651\u064e\u0628\u0650\u0639\u0652 \u0645\u064e\u0627 \u064a\u064f\u0648\u062d\u06ea\u0649\u0670\u0653 \u0625\u0650\u0644\u064e\u064a\u0652\u0643\u064e \u0648\u064e\u0627\u0635\u0652\u0628\u0650\u0631\u0652 \u062d\u064e\u062a\u0651\u064e\u0649\u0670 \u064a\u064e\u062d\u0652\u0643\u064f\u0645\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f\u06d6 \u0648\u064e\u0647\u064f\u0648\u064e \u062e\u064e\u064a\u0652\u0631\u064f \u0627\u064f\u06ec\u0644\u0652\u062d\u064e\u0670\u0643\u0650\u0645\u0650\u064a\u0646\u064e', r: '[\u064a\u0648\u0646\u0633: 109]' },
    { q: true, t: '\u0648\u064e\u0623\u064f\u0632\u0652\u0644\u0650\u0641\u064e\u062a\u0650 \u0627\u0650\u06ec\u0644\u0652\u062c\u064e\u0646\u0651\u064e\u0629\u064f \u0644\u0650\u0644\u0652\u0645\u064f\u062a\u0651\u064e\u0642\u0650\u064a\u0646\u064e \u063a\u064e\u064a\u0652\u0631\u064e \u0628\u064e\u0639\u0650\u064a\u062f\u064d\u06d6 \u0647\u064e\u0670\u0630\u064e\u0627 \u0645\u064e\u0627 \u062a\u064f\u0648\u0639\u064e\u062f\u064f\u0648\u0646\u064e \u0644\u0650\u0643\u064f\u0644\u0651\u0650 \u0623\u064e\u0648\u0651\u064e\u0627\u0628\u064d \u062d\u064e\u0641\u0650\u064a\u0638\u0656\u06d6 \u0645\u0651\u064e\u0646\u0652 \u062e\u064e\u0634\u0650\u064a\u064e \u0627\u064e\u06ec\u0644\u0631\u0651\u064e\u062d\u0652\u0645\u064e\u0670\u0646\u064e \u0628\u0650\u0627\u0644\u0652\u063a\u064e\u064a\u0652\u0628\u0650 \u0648\u064e\u062c\u064e\u0627\u0653\u0621\u064e \u0628\u0650\u0642\u064e\u0644\u0652\u0628\u0656 \u0645\u0651\u064f\u0646\u0650\u064a\u0628\u064d', r: '[\u0642: 31-33]' },
    { q: true, t: '\u0648\u064e\u0627\u0633\u0652\u062a\u064e\u063a\u0652\u0641\u0650\u0631\u064f\u0648\u0627\u0652 \u0631\u064e\u0628\u0651\u064e\u0643\u064f\u0645\u0652 \u062b\u064f\u0645\u0651\u064e \u062a\u064f\u0648\u0628\u064f\u0648\u0653\u0627\u0652 \u0625\u0650\u0644\u064e\u064a\u0652\u0647\u0650\u06d6 \u0625\u0650\u0646\u0651\u064e \u0631\u064e\u0628\u0651\u0650\u06d2 \u0631\u064e\u062d\u0650\u064a\u0645\u065e \u0648\u064e\u062f\u064f\u0648\u062f\u065e', r: '[\u0647\u0648\u062f: 90]' },
    { q: true, t: '\u0642\u064f\u0644\u064e \u0627\u064e\u0648\u0652\u06df\u0646\u064e\u0628\u0651\u0650\u064a\u0654\u064f\u0643\u064f\u0645 \u0628\u0650\u062e\u064e\u064a\u0652\u0631\u0656 \u0645\u0651\u0650\u0646 \u0630\u064e\u0670\u0644\u0650\u0643\u064f\u0645\u0652\u06d6 \u0644\u0650\u0644\u0630\u0650\u064a\u0646\u064e \u0627\u064e\u06ea\u062a\u0651\u064e\u0642\u064e\u0648\u0652\u0627\u0652 \u0639\u0650\u0646\u062f\u064e \u0631\u064e\u0628\u0651\u0650\u0647\u0650\u0645\u0652 \u062c\u064e\u0646\u0651\u064e\u0670\u062a\u065e \u062a\u064e\u062c\u0652\u0631\u0650\u06d2 \u0645\u0650\u0646 \u062a\u064e\u062d\u0652\u062a\u0650\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u064e\u0627\u0646\u0652\u0647\u064e\u0670\u0631\u064f \u062e\u064e\u0670\u0644\u0650\u062f\u0650\u064a\u0646\u064e \u0641\u0650\u064a\u0647\u064e\u0627 \u0648\u064e\u0623\u064e\u0632\u0652\u0648\u064e\u0670\u062c\u065e \u0645\u0651\u064f\u0637\u064e\u0647\u0651\u064e\u0631\u064e\u0629\u065e \u0648\u064e\u0631\u0650\u0636\u0652\u0648\u064e\u0670\u0646\u065e \u0645\u0651\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650\u06d6 \u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u0628\u064e\u0635\u0650\u064a\u0631\u064f\u06e2 \u0628\u0650\u0627\u0644\u0652\u0639\u0650\u0628\u064e\u0627\u062f\u0650', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 15]' },
    { q: true, t: '\u0648\u064e\u0644\u0650\u0644\u0647\u0650 \u063a\u064e\u064a\u0652\u0628\u064f \u0627\u064f\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0627\u0644\u064e\u0627\u0631\u0652\u0636\u0650\u06d6 \u0648\u064e\u0625\u0650\u0644\u064e\u064a\u0652\u0647\u0650 \u064a\u064f\u0631\u0652\u062c\u064e\u0639\u064f \u0627\u064f\u06ec\u0644\u064e\u0627\u0645\u0652\u0631\u064f \u0643\u064f\u0644\u0651\u064f\u0647\u064f\u06e5\u06d6 \u0641\u064e\u0627\u0639\u0652\u0628\u064f\u062f\u0652\u0647\u064f \u0648\u064e\u062a\u064e\u0648\u064e\u0643\u0651\u064e\u0644\u0652 \u0639\u064e\u0644\u064e\u064a\u0652\u0647\u0650\u06d6 \u0648\u064e\u0645\u064e\u0627 \u0631\u064e\u0628\u0651\u064f\u0643\u064e \u0628\u0650\u063a\u064e\u0670\u0641\u0650\u0644\u064d \u0639\u064e\u0645\u0651\u064e\u0627 \u062a\u064e\u0639\u0652\u0645\u064e\u0644\u064f\u0648\u0646\u064e', r: '[\u0647\u0648\u062f: 121]' },
    { q: true, t: '\u0648\u064e\u0627\u0630\u0652\u0643\u064f\u0631 \u0631\u0651\u064e\u0628\u0651\u064e\u0643\u064e \u0641\u0650\u06d2 \u0646\u064e\u0641\u0652\u0633\u0650\u0643\u064e \u062a\u064e\u0636\u064e\u0631\u0651\u064f\u0639\u0627\u0657 \u0648\u064e\u062e\u0650\u064a\u0641\u064e\u0629\u0657 \u0648\u064e\u062f\u064f\u0648\u0646\u064e \u0627\u064e\u06ec\u0644\u0652\u062c\u064e\u0647\u0652\u0631\u0650 \u0645\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0652\u0642\u064e\u0648\u0652\u0644\u0650 \u0628\u0650\u0627\u0644\u0652\u063a\u064f\u062f\u064f\u0648\u0651\u0650 \u0648\u064e\u0627\u0644\u064e\u0627\u0635\u064e\u0627\u0644\u0650 \u0648\u064e\u0644\u064e\u0627 \u062a\u064e\u0643\u064f\u0646 \u0645\u0651\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0652\u063a\u064e\u0670\u0641\u0650\u0644\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0623\u0639\u0631\u0627\u0641: 205]' },
    { q: true, t: '\u0644\u064e\u0670\u0643\u0650\u0646\u0650 \u0627\u0650\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0627\u064e\u06ea\u062a\u0651\u064e\u0642\u064e\u0648\u0652\u0627\u0652 \u0631\u064e\u0628\u0651\u064e\u0647\u064f\u0645\u0652 \u0644\u064e\u0647\u064f\u0645\u0652 \u063a\u064f\u0631\u064e\u0641\u065e \u0645\u0651\u0650\u0646 \u0641\u064e\u0648\u0652\u0642\u0650\u0647\u064e\u0627 \u063a\u064f\u0631\u064e\u0641\u065e \u0645\u0651\u064e\u0628\u0652\u0646\u0650\u064a\u0651\u064e\u0629\u065e \u062a\u064e\u062c\u0652\u0631\u0650\u06d2 \u0645\u0650\u0646 \u062a\u064e\u062d\u0652\u062a\u0650\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u064e\u0627\u0646\u0652\u0647\u064e\u0670\u0631\u064f\u06d6 \u0648\u064e\u0639\u0652\u062f\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650\u06d6 \u0644\u064e\u0627 \u064a\u064f\u062e\u0652\u0644\u0650\u0641\u064f \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u0650\u064a\u0639\u064e\u0627\u062f\u064e', r: '[\u0627\u0644\u0632\u0645\u0631: 19]' },
    { q: true, t: '\u0627\u0650\u06ec\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f \u0644\u0650\u0644\u0647\u0650 \u0627\u0650\u06ec\u0644\u0630\u0650\u06d2 \u0648\u064e\u0647\u064e\u0628\u064e \u0644\u0650\u06d2 \u0639\u064e\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0652\u0643\u0650\u0628\u064e\u0631\u0650 \u0625\u0650\u0633\u0652\u0645\u064e\u0670\u0639\u0650\u064a\u0644\u064e \u0648\u064e\u0625\u0650\u0633\u0652\u062d\u064e\u0670\u0642\u064e\u06d6 \u0625\u0650\u0646\u0651\u064e \u0631\u064e\u0628\u0651\u0650\u06d2 \u0644\u064e\u0633\u064e\u0645\u0650\u064a\u0639\u064f \u0627\u064f\u06ec\u0644\u062f\u0651\u064f\u0639\u064e\u0627\u0653\u0621\u0650', r: '[\u0625\u0628\u0631\u0627\u0647\u064a\u0645: 41]' },
    { q: true, t: '\u064a\u064e\u0670\u0653\u0623\u064e\u064a\u0651\u064f\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0627\u064f\u06ea\u062a\u0651\u064e\u0642\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0648\u064e\u0643\u064f\u0648\u0646\u064f\u0648\u0627\u0652 \u0645\u064e\u0639\u064e \u0627\u064e\u06ec\u0644\u0635\u0651\u064e\u0670\u062f\u0650\u0642\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u062a\u0648\u0628\u0629: 120]' },
    { q: true, t: '\u0642\u064e\u062f\u064e \u0627\u064e\u0641\u0652\u0644\u064e\u062d\u064e \u0645\u064e\u0646 \u062a\u064e\u0632\u064e\u0643\u0651\u06ea\u0649\u0670 \u0648\u064e\u0630\u064e\u0643\u064e\u0631\u064e \u0627\u064e\u06ea\u0633\u0652\u0645\u064e \u0631\u064e\u0628\u0651\u0650\u0647\u0650\u06e6 \u0641\u064e\u0635\u064e\u0644\u0651\u06ea\u0649\u0670', r: '[\u0627\u0644\u0623\u0639\u0644\u0649: 14-15]' },
    { q: true, t: '\u0627\u064f\u06df\u062f\u0652\u062e\u064f\u0644\u064f\u0648\u0647\u064e\u0627 \u0628\u0650\u0633\u064e\u0644\u064e\u0670\u0645\u064d \u0627\u0670\u0645\u0650\u0646\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u062d\u062c\u0631: 46]' },
    { q: true, t: '\u0627\u0650\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0645\u064e\u0631\u0652\u062c\u0650\u0639\u064f\u0643\u064f\u0645\u0652\u06d6 \u0648\u064e\u0647\u064f\u0648\u064e \u0639\u064e\u0644\u064e\u0649\u0670 \u0643\u064f\u0644\u0651\u0650 \u0634\u064e\u06d2\u0652\u0621\u0656 \u0642\u064e\u062f\u0650\u064a\u0631\u064c', r: '[\u0647\u0648\u062f: 4]' },
    { q: true, t: '\u0642\u064e\u062f\u064e \u0627\u064e\u0641\u0652\u0644\u064e\u062d\u064e \u0645\u064e\u0646 \u0632\u064e\u0643\u0651\u064e\u064a\u0670\u0647\u064e\u0627', r: '[\u0627\u0644\u0634\u0645\u0633: 9]' },
    { q: true, t: '\u0641\u064e\u0633\u064e\u0628\u0651\u0650\u062d\u0652 \u0628\u0650\u062d\u064e\u0645\u0652\u062f\u0650 \u0631\u064e\u0628\u0651\u0650\u0643\u064e \u0648\u064e\u0643\u064f\u0646 \u0645\u0651\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0633\u0651\u064e\u0670\u062c\u0650\u062f\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u062d\u062c\u0631: 98]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e \u0631\u064e\u0628\u0651\u064e\u0643\u064e \u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0652\u062e\u064e\u0644\u0651\u064e\u0670\u0642\u064f \u0627\u064f\u06ec\u0644\u0652\u0639\u064e\u0644\u0650\u064a\u0645\u064f', r: '[\u0627\u0644\u062d\u062c\u0631: 86]' },
    { q: true, t: '\u0627\u0650\u0646\u0651\u064e \u0647\u064e\u0670\u0630\u064e\u0627 \u0643\u064e\u0627\u0646\u064e \u0644\u064e\u0643\u064f\u0645\u0652 \u062c\u064e\u0632\u064e\u0627\u0653\u0621\u0657 \u0648\u064e\u0643\u064e\u0627\u0646\u064e \u0633\u064e\u0639\u0652\u064a\u064f\u0643\u064f\u0645 \u0645\u0651\u064e\u0634\u0652\u0643\u064f\u0648\u0631\u0627\u064b', r: '[\u0627\u0644\u0627\u0646\u0633\u0627\u0646: 22]' },
    { q: true, t: '\u0633\u064e\u0644\u064e\u0670\u0645\u064c \u0639\u064e\u0644\u064e\u064a\u0652\u0643\u064f\u0645 \u0628\u0650\u0645\u064e\u0627 \u0635\u064e\u0628\u064e\u0631\u0652\u062a\u064f\u0645\u0652\u06d6 \u0641\u064e\u0646\u0650\u0639\u0652\u0645\u064e \u0639\u064f\u0642\u0652\u0628\u064e\u0649 \u0627\u064e\u06ec\u0644\u062f\u0651\u06ea\u0627\u0631\u0650', r: '[\u0627\u0644\u0631\u0639\u062f: 25]' },
    { q: true, t: '\u0627\u064f\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0648\u064e\u0639\u064e\u0645\u0650\u0644\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0635\u0651\u064e\u0670\u0644\u0650\u062d\u064e\u0670\u062a\u0650 \u0637\u064f\u0648\u0628\u06ea\u0649\u0670 \u0644\u064e\u0647\u064f\u0645\u0652 \u0648\u064e\u062d\u064f\u0633\u0652\u0646\u064f \u0645\u064e\u0640\u0654\u064e\u0627\u0628\u0656', r: '[\u0627\u0644\u0631\u0639\u062f: 30]' },
    { q: true, t: '\u0641\u064e\u0623\u064e\u0645\u0651\u064e\u0627\u0653 \u0625\u0650\u0646 \u0643\u064e\u0627\u0646\u064e \u0645\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0652\u0645\u064f\u0642\u064e\u0631\u0651\u064e\u0628\u0650\u064a\u0646\u064e \u0641\u064e\u0631\u064e\u0648\u0652\u062d\u065e \u0648\u064e\u0631\u064e\u064a\u0652\u062d\u064e\u0627\u0646\u065e \u0648\u064e\u062c\u064e\u0646\u0651\u064e\u062a\u064f \u0646\u064e\u0639\u0650\u064a\u0645\u0656', r: '[\u0627\u0644\u0648\u0627\u0642\u0639\u0629: 91-92]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e\u0647\u064f\u06e5 \u0644\u064e\u064a\u0652\u0633\u064e \u0644\u064e\u0647\u064f\u06e5 \u0633\u064f\u0644\u0652\u0637\u064e\u0670\u0646\u064c \u0639\u064e\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0648\u064e\u0639\u064e\u0644\u064e\u0649\u0670 \u0631\u064e\u0628\u0651\u0650\u0647\u0650\u0645\u0652 \u064a\u064e\u062a\u064e\u0648\u064e\u0643\u0651\u064e\u0644\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0646\u062d\u0644: 99]' },
    { q: true, t: '\u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u0623\u064e\u062e\u0652\u0631\u064e\u062c\u064e\u0643\u064f\u0645 \u0645\u0651\u0650\u0646\u06e2 \u0628\u064f\u0637\u064f\u0648\u0646\u0650 \u0623\u064f\u0645\u0651\u064e\u0647\u064e\u0670\u062a\u0650\u0643\u064f\u0645\u0652 \u0644\u064e\u0627 \u062a\u064e\u0639\u0652\u0644\u064e\u0645\u064f\u0648\u0646\u064e \u0634\u064e\u064a\u0652\u0654\u0627\u0657\u06d6 \u0648\u064e\u062c\u064e\u0639\u064e\u0644\u064e \u0644\u064e\u0643\u064f\u0645\u064f \u0627\u064f\u06ec\u0644\u0633\u0651\u064e\u0645\u0652\u0639\u064e \u0648\u064e\u0627\u0644\u064e\u0627\u0628\u0652\u0635\u064e\u0670\u0631\u064e \u0648\u064e\u0627\u0644\u064e\u0627\u0641\u0652\u0640\u0655\u0650\u062f\u064e\u0629\u064e \u0644\u064e\u0639\u064e\u0644\u0651\u064e\u0643\u064f\u0645\u0652 \u062a\u064e\u0634\u0652\u0643\u064f\u0631\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0646\u062d\u0644: 78]' },
    { q: true, t: '\u064a\u064e\u0648\u0652\u0645\u064e \u062a\u064e\u0631\u064e\u0649 \u0627\u064e\u06ec\u0644\u0652\u0645\u064f\u0648\u0645\u0650\u0646\u0650\u064a\u0646\u064e \u0648\u064e\u0627\u0644\u0652\u0645\u064f\u0648\u0645\u0650\u0646\u064e\u0670\u062a\u0650 \u064a\u064e\u0633\u0652\u0639\u06ea\u0649\u0670 \u0646\u064f\u0648\u0631\u064f\u0647\u064f\u0645 \u0628\u064e\u064a\u0652\u0646\u064e \u0623\u064e\u064a\u0652\u062f\u0650\u064a\u0647\u0650\u0645\u0652 \u0648\u064e\u0628\u0650\u0623\u064e\u064a\u0652\u0645\u064e\u0670\u0646\u0650\u0647\u0650\u0645\u06d6 \u0628\u064f\u0634\u0652\u0631\u06ea\u064a\u0670\u0643\u064f\u0645\u064f \u0627\u064f\u06ec\u0644\u0652\u064a\u064e\u0648\u0652\u0645\u064e \u062c\u064e\u0646\u0651\u064e\u0670\u062a\u065e \u062a\u064e\u062c\u0652\u0631\u0650\u06d2 \u0645\u0650\u0646 \u062a\u064e\u062d\u0652\u062a\u0650\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u064e\u0627\u0646\u0652\u0647\u064e\u0670\u0631\u064f \u062e\u064e\u0670\u0644\u0650\u062f\u0650\u064a\u0646\u064e \u0641\u0650\u064a\u0647\u064e\u0627\u06d6 \u0630\u064e\u0670\u0644\u0650\u0643\u064e \u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0652\u0641\u064e\u0648\u0652\u0632\u064f \u0627\u064f\u06ec\u0644\u0652\u0639\u064e\u0638\u0650\u064a\u0645\u064f', r: '[\u0627\u0644\u062d\u062f\u064a\u062f: 12]' },
    { q: true, t: '\u0642\u064f\u0644\u0652 \u0646\u064e\u0632\u0651\u064e\u0644\u064e\u0647\u064f\u06e5 \u0631\u064f\u0648\u062d\u064f \u0627\u064f\u06ec\u0644\u0652\u0642\u064f\u062f\u064f\u0633\u0650 \u0645\u0650\u0646 \u0631\u0651\u064e\u0628\u0651\u0650\u0643\u064e \u0628\u0650\u0627\u0644\u0652\u062d\u064e\u0642\u0651\u0650 \u0644\u0650\u064a\u064f\u062b\u064e\u0628\u0651\u0650\u062a\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0648\u064e\u0647\u064f\u062f\u0649\u0657 \u0648\u064e\u0628\u064f\u0634\u0652\u0631\u06ea\u0649\u0670 \u0644\u0650\u0644\u0652\u0645\u064f\u0633\u0652\u0644\u0650\u0645\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0646\u062d\u0644: 102]' },
    { q: true, t: '\u0641\u064e\u0643\u064f\u0644\u064f\u0648\u0627\u0652 \u0645\u0650\u0645\u0651\u064e\u0627 \u0631\u064e\u0632\u064e\u0642\u064e\u0643\u064f\u0645\u064f \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u062d\u064e\u0644\u064e\u0670\u0644\u0627\u0657 \u0637\u064e\u064a\u0651\u0650\u0628\u0627\u0657\u06d6 \u0648\u064e\u0627\u0634\u0652\u0643\u064f\u0631\u064f\u0648\u0627\u0652 \u0646\u0650\u0639\u0652\u0645\u064e\u062a\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0625\u0650\u0646 \u0643\u064f\u0646\u062a\u064f\u0645\u064f\u06e5\u0653 \u0625\u0650\u064a\u0651\u064e\u0627\u0647\u064f \u062a\u064e\u0639\u0652\u0628\u064f\u062f\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0646\u062d\u0644: 114]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0652\u0645\u064f\u062a\u0651\u064e\u0642\u0650\u064a\u0646\u064e \u0641\u0650\u06d2 \u0645\u064f\u0642\u064e\u0627\u0645\u064d \u0627\u064e\u0645\u0650\u064a\u0646\u0656 \u0641\u0650\u06d2 \u062c\u064e\u0646\u0651\u064e\u0670\u062a\u0656 \u0648\u064e\u0639\u064f\u064a\u064f\u0648\u0646\u0656', r: '[\u0627\u0644\u062f\u062e\u0627\u0646: 48-49]' },
    { q: true, t: '\u0631\u0651\u064e\u0628\u0651\u064f\u0643\u064f\u0645\u064f\u06e5\u0653 \u0623\u064e\u0639\u0652\u0644\u064e\u0645\u064f \u0628\u0650\u0645\u064e\u0627 \u0641\u0650\u06d2 \u0646\u064f\u0641\u064f\u0648\u0633\u0650\u0643\u064f\u0645\u064f\u06e5\u0653\u06d6 \u0625\u0650\u0646 \u062a\u064e\u0643\u064f\u0648\u0646\u064f\u0648\u0627\u0652 \u0635\u064e\u0670\u0644\u0650\u062d\u0650\u064a\u0646\u064e \u0641\u064e\u0625\u0650\u0646\u0651\u064e\u0647\u064f\u06e5 \u0643\u064e\u0627\u0646\u064e \u0644\u0650\u0644\u064e\u0627\u0648\u0651\u064e\u0670\u0628\u0650\u064a\u0646\u064e \u063a\u064e\u0641\u064f\u0648\u0631\u0627\u0657', r: '[\u0627\u0644\u0625\u0633\u0631\u0627\u0621: 25]' },
    { q: true, t: '\u0627\u0650\u0646\u0651\u064e \u0631\u064e\u0628\u0651\u064e\u0643\u064e \u064a\u064e\u0628\u0652\u0633\u064f\u0637\u064f \u0627\u064f\u06ec\u0644\u0631\u0651\u0650\u0632\u0652\u0642\u064e \u0644\u0650\u0645\u064e\u0646\u0652 \u064a\u0651\u064e\u0634\u064e\u0627\u0653\u0621\u064f \u0648\u064e\u064a\u064e\u0642\u0652\u062f\u0650\u0631\u064f\u06d6 \u0625\u0650\u0646\u0651\u064e\u0647\u064f\u06e5 \u0643\u064e\u0627\u0646\u064e \u0628\u0650\u0639\u0650\u0628\u064e\u0627\u062f\u0650\u0647\u0650\u06e6 \u062e\u064e\u0628\u0650\u064a\u0631\u0627\u064e\u06e2 \u0628\u064e\u0635\u0650\u064a\u0631\u0627\u0657', r: '[\u0627\u0644\u0625\u0633\u0631\u0627\u0621: 30]' },
    { q: true, t: '\u0648\u064e\u0643\u064e\u0630\u064e\u0670\u0644\u0650\u0643\u064e \u0645\u064e\u0643\u0651\u064e\u0646\u0651\u064e\u0627 \u0644\u0650\u064a\u064f\u0648\u0633\u064f\u0641\u064e \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u064e\u0627\u0631\u0652\u0636\u0650 \u064a\u064e\u062a\u064e\u0628\u064e\u0648\u0651\u064e\u0623\u064f \u0645\u0650\u0646\u0652\u0647\u064e\u0627 \u062d\u064e\u064a\u0652\u062b\u064f \u064a\u064e\u0634\u064e\u0627\u0653\u0621\u064f\u06d6 \u0646\u064f\u0635\u0650\u064a\u0628\u064f \u0628\u0650\u0631\u064e\u062d\u0652\u0645\u064e\u062a\u0650\u0646\u064e\u0627 \u0645\u064e\u0646 \u0646\u0651\u064e\u0634\u064e\u0627\u0653\u0621\u064f \u0648\u064e\u0644\u064e\u0627 \u0646\u064f\u0636\u0650\u064a\u0639\u064f \u0623\u064e\u062c\u0652\u0631\u064e \u0627\u064e\u06ec\u0644\u0652\u0645\u064f\u062d\u0652\u0633\u0650\u0646\u0650\u064a\u0646\u064e', r: '[\u064a\u0648\u0633\u0641: 56]' },
    { q: true, t: '\u0627\u0650\u06ec\u0644\u0652\u0645\u064e\u0627\u0644\u064f \u0648\u064e\u0627\u0644\u0652\u0628\u064e\u0646\u064f\u0648\u0646\u064e \u0632\u0650\u064a\u0646\u064e\u0629\u064f \u0627\u064f\u06ec\u0644\u0652\u062d\u064e\u064a\u064e\u0648\u0670\u0629\u0650 \u0627\u0650\u06ec\u0644\u062f\u0651\u064f\u0646\u0652\u064a\u06ea\u0627\u06d6 \u0648\u064e\u0627\u0644\u0652\u0628\u064e\u0670\u0642\u0650\u064a\u064e\u0670\u062a\u064f \u0627\u064f\u06ec\u0644\u0635\u0651\u064e\u0670\u0644\u0650\u062d\u064e\u0670\u062a\u064f \u062e\u064e\u064a\u0652\u0631\u064c \u0639\u0650\u0646\u062f\u064e \u0631\u064e\u0628\u0651\u0650\u0643\u064e \u062b\u064e\u0648\u064e\u0627\u0628\u0627\u0657 \u0648\u064e\u062e\u064e\u064a\u0652\u0631\u064c \u0627\u064e\u0645\u064e\u0644\u0627\u0657', r: '[\u0627\u0644\u0643\u0647\u0641: 45]' },
    { q: true, t: '\u0641\u064e\u0627\u062a\u0651\u064e\u0642\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0648\u064e\u0623\u064e\u0637\u0650\u064a\u0639\u064f\u0648\u0646\u0650', r: '[\u0627\u0644\u0634\u0639\u0631\u0627\u0621: 108]' },
    { q: true, t: '\u0645\u064e\u0646 \u062c\u064e\u0627\u0653\u0621\u064e \u0628\u0650\u0627\u0644\u0652\u062d\u064e\u0633\u064e\u0646\u064e\u0629\u0650 \u0641\u064e\u0644\u064e\u0647\u064f\u06e5 \u062e\u064e\u064a\u0652\u0631\u065e \u0645\u0651\u0650\u0646\u0652\u0647\u064e\u0627 \u0648\u064e\u0647\u064f\u0645 \u0645\u0651\u0650\u0646 \u0641\u064e\u0632\u064e\u0639\u0650 \u064a\u064e\u0648\u0652\u0645\u064e\u0626\u0650\u0630\u064d \u0627\u0670\u0645\u0650\u0646\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0646\u0645\u0644: 91]' },
    { q: true, t: '\u0648\u064e\u064a\u064e\u0632\u0650\u064a\u062f\u064f \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0627\u064f\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0627\u064e\u06ea\u0647\u0652\u062a\u064e\u062f\u064e\u0648\u0652\u0627\u0652 \u0647\u064f\u062f\u0649\u0657\u06d6 \u0648\u064e\u0627\u0644\u0652\u0628\u064e\u0670\u0642\u0650\u064a\u064e\u0670\u062a\u064f \u0627\u064f\u06ec\u0644\u0635\u0651\u064e\u0670\u0644\u0650\u062d\u064e\u0670\u062a\u064f \u062e\u064e\u064a\u0652\u0631\u064c \u0639\u0650\u0646\u062f\u064e \u0631\u064e\u0628\u0651\u0650\u0643\u064e \u062b\u064e\u0648\u064e\u0627\u0628\u0627\u0657 \u0648\u064e\u062e\u064e\u064a\u0652\u0631\u065e \u0645\u0651\u064e\u0631\u064e\u062f\u0651\u0627\u064b', r: '[\u0645\u0631\u064a\u0645: 77]' },
    { q: true, t: '\u0648\u064e\u0643\u064e\u0623\u064e\u064a\u0651\u0650\u0646 \u0645\u0651\u0650\u0646 \u062f\u064e\u0627\u0653\u0628\u0651\u064e\u0629\u0656 \u0644\u0651\u064e\u0627 \u062a\u064e\u062d\u0652\u0645\u0650\u0644\u064f \u0631\u0650\u0632\u0652\u0642\u064e\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u064a\u064e\u0631\u0652\u0632\u064f\u0642\u064f\u0647\u064e\u0627 \u0648\u064e\u0625\u0650\u064a\u0651\u064e\u0627\u0643\u064f\u0645\u0652\u06d6 \u0648\u064e\u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0633\u0651\u064e\u0645\u0650\u064a\u0639\u064f \u0627\u064f\u06ec\u0644\u0652\u0639\u064e\u0644\u0650\u064a\u0645\u064f', r: '[\u0627\u0644\u0639\u0646\u0643\u0628\u0648\u062a: 60]' },
    { q: true, t: '\u062a\u064f\u0648\u0628\u064f\u0648\u0653\u0627\u0652 \u0625\u0650\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u062a\u064e\u0648\u0652\u0628\u064e\u0629\u0657 \u0646\u0651\u064e\u0635\u064f\u0648\u062d\u0627\u064b \u0639\u064e\u0633\u06ea\u0649\u0670 \u0631\u064e\u0628\u0651\u064f\u0643\u064f\u0645\u064f\u06e5\u0653 \u0623\u064e\u0646\u0652 \u064a\u0651\u064f\u0643\u064e\u0641\u0651\u0650\u0631\u064e \u0639\u064e\u0646\u0643\u064f\u0645\u0652 \u0633\u064e\u064a\u0651\u0650\u0640\u0654\u064e\u0627\u062a\u0650\u0643\u064f\u0645\u0652 \u0648\u064e\u064a\u064f\u062f\u0652\u062e\u0650\u0644\u064e\u0643\u064f\u0645\u0652 \u062c\u064e\u0646\u0651\u064e\u0670\u062a\u0656 \u062a\u064e\u062c\u0652\u0631\u0650\u06d2 \u0645\u0650\u0646 \u062a\u064e\u062d\u0652\u062a\u0650\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u064e\u0627\u0646\u0652\u0647\u064e\u0670\u0631\u064f', r: '[\u0627\u0644\u062a\u062d\u0631\u064a\u0645: 8]' },
    { q: true, t: '\u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0644\u064e\u0627\u0653 \u0625\u0650\u0644\u064e\u0670\u0647\u064e \u0625\u0650\u0644\u0651\u064e\u0627 \u0647\u064f\u0648\u064e\u06d6 \u0644\u064e\u0647\u064f \u0627\u064f\u06ec\u0644\u064e\u0627\u0633\u0652\u0645\u064e\u0627\u0653\u0621\u064f \u0627\u064f\u06ec\u0644\u0652\u062d\u064f\u0633\u0652\u0646\u06ea\u0649\u0670', r: '[\u0637\u0647: 7]' },
    { q: true, t: '\u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u064a\u064e\u0628\u0652\u0633\u064f\u0637\u064f \u0627\u064f\u06ec\u0644\u0631\u0651\u0650\u0632\u0652\u0642\u064e \u0644\u0650\u0645\u064e\u0646\u0652 \u064a\u0651\u064e\u0634\u064e\u0627\u0653\u0621\u064f \u0645\u0650\u0646\u0652 \u0639\u0650\u0628\u064e\u0627\u062f\u0650\u0647\u0650\u06e6 \u0648\u064e\u064a\u064e\u0642\u0652\u062f\u0650\u0631\u064f \u0644\u064e\u0647\u064f\u06e5\u0653\u06d6 \u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0628\u0650\u0643\u064f\u0644\u0651\u0650 \u0634\u064e\u06d2\u0652\u0621\u064d \u0639\u064e\u0644\u0650\u064a\u0645\u065e', r: '[\u0627\u0644\u0639\u0646\u0643\u0628\u0648\u062a: 62]' },
    { q: true, t: '\u0645\u064e\u0646 \u062c\u064e\u0627\u0653\u0621\u064e \u0628\u0650\u0627\u0644\u0652\u062d\u064e\u0633\u064e\u0646\u064e\u0629\u0650 \u0641\u064e\u0644\u064e\u0647\u064f\u06e5 \u0639\u064e\u0634\u0652\u0631\u064f \u0623\u064e\u0645\u0652\u062b\u064e\u0627\u0644\u0650\u0647\u064e\u0627', r: '[\u0627\u0644\u0623\u0646\u0639\u0627\u0645: 161]' },
    { q: true, t: '\u0642\u064f\u0644 \u0631\u0651\u064e\u0628\u0651\u0650 \u0627\u0650\u06df\u062d\u0652\u0643\u064f\u0645 \u0628\u0650\u0627\u0644\u0652\u062d\u064e\u0642\u0651\u0650\u06d6 \u0648\u064e\u0631\u064e\u0628\u0651\u064f\u0646\u064e\u0627 \u0627\u064e\u06ec\u0644\u0631\u0651\u064e\u062d\u0652\u0645\u064e\u0670\u0646\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u064f\u0633\u0652\u062a\u064e\u0639\u064e\u0627\u0646\u064f \u0639\u064e\u0644\u064e\u0649\u0670 \u0645\u064e\u0627 \u062a\u064e\u0635\u0650\u0641\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0623\u0646\u0628\u064a\u0627\u0621: 111]' },
    { q: true, t: '\u0648\u064e\u0627\u0644\u0630\u0650\u064a\u0646\u064e \u062c\u064e\u0670\u0647\u064e\u062f\u064f\u0648\u0627\u0652 \u0641\u0650\u064a\u0646\u064e\u0627 \u0644\u064e\u0646\u064e\u0647\u0652\u062f\u0650\u064a\u064e\u0646\u0651\u064e\u0647\u064f\u0645\u0652 \u0633\u064f\u0628\u064f\u0644\u064e\u0646\u064e\u0627\u06d6 \u0648\u064e\u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0644\u064e\u0645\u064e\u0639\u064e \u0627\u064e\u06ec\u0644\u0652\u0645\u064f\u062d\u0652\u0633\u0650\u0646\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0639\u0646\u0643\u0628\u0648\u062a: 69]' },
    { q: true, t: '\u064a\u064e\u0670\u0653\u0623\u064e\u064a\u0651\u064f\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0627\u064f\u06ea\u0631\u0652\u0643\u064e\u0639\u064f\u0648\u0627\u0652 \u0648\u064e\u0627\u0633\u0652\u062c\u064f\u062f\u064f\u0648\u0627\u0652 \u0648\u064e\u0627\u0639\u0652\u0628\u064f\u062f\u064f\u0648\u0627\u0652 \u0631\u064e\u0628\u0651\u064e\u0643\u064f\u0645\u0652 \u0648\u064e\u0627\u0641\u0652\u0639\u064e\u0644\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0652\u062e\u064e\u064a\u0652\u0631\u064e \u0644\u064e\u0639\u064e\u0644\u0651\u064e\u0643\u064f\u0645\u0652 \u062a\u064f\u0641\u0652\u0644\u0650\u062d\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u062d\u062c: 75]' },
    { q: true, t: '\u064a\u064e\u0670\u0653\u0623\u064e\u064a\u0651\u064f\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0627\u0652 \u0627\u064f\u06ea\u062a\u0651\u064e\u0642\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0648\u064e\u0642\u064f\u0648\u0644\u064f\u0648\u0627\u0652 \u0642\u064e\u0648\u0652\u0644\u0627\u0657 \u0633\u064e\u062f\u0650\u064a\u062f\u0627\u0657', r: '[\u0627\u0644\u0623\u062d\u0632\u0627\u0628: 70]' },
    { q: true, t: '\u0648\u064e\u0642\u064f\u0644 \u0631\u0651\u064e\u0628\u0651\u0650 \u0623\u064e\u0646\u0632\u0650\u0644\u0652\u0646\u0650\u06d2 \u0645\u064f\u0646\u0632\u064e\u0644\u0627\u0657 \u0645\u0651\u064f\u0628\u064e\u0670\u0631\u064e\u0643\u0627\u0657 \u0648\u064e\u0623\u064e\u0646\u062a\u064e \u062e\u064e\u064a\u0652\u0631\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u064f\u0646\u0632\u0650\u0644\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0645\u0624\u0645\u0646\u0648\u0646: 29]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e\u0627\u0653 \u0623\u064e\u0646\u0632\u064e\u0644\u0652\u0646\u064e\u0627\u0653 \u0625\u0650\u0644\u064e\u064a\u0652\u0643\u064e \u0627\u064e\u06ec\u0644\u0652\u0643\u0650\u062a\u064e\u0670\u0628\u064e \u0628\u0650\u0627\u0644\u0652\u062d\u064e\u0642\u0651\u0650 \u0641\u064e\u0627\u0639\u0652\u0628\u064f\u062f\u0650 \u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0645\u064f\u062e\u0652\u0644\u0650\u0635\u0627\u0657 \u0644\u0651\u064e\u0647\u064f \u0627\u064f\u06ec\u0644\u062f\u0651\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0632\u0645\u0631: 2]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e\u0647\u064f\u06e5 \u0643\u064e\u0627\u0646\u064e \u0641\u064e\u0631\u0650\u064a\u0642\u065e \u0645\u0651\u0650\u0646\u0652 \u0639\u0650\u0628\u064e\u0627\u062f\u0650\u06d2 \u064a\u064e\u0642\u064f\u0648\u0644\u064f\u0648\u0646\u064e \u0631\u064e\u0628\u0651\u064e\u0646\u064e\u0627\u0653 \u0621\u064e\u0627\u0645\u064e\u0646\u0651\u064e\u0627 \u0641\u064e\u0627\u063a\u0652\u0641\u0650\u0631\u0652 \u0644\u064e\u0646\u064e\u0627 \u0648\u064e\u0627\u0631\u0652\u062d\u064e\u0645\u0652\u0646\u064e\u0627 \u0648\u064e\u0623\u064e\u0646\u062a\u064e \u062e\u064e\u064a\u0652\u0631\u064f \u0627\u064f\u06ec\u0644\u0631\u0651\u064e\u0670\u062d\u0650\u0645\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0645\u0624\u0645\u0646\u0648\u0646: 110]' },
    { q: true, t: '\u0642\u064f\u0644\u0650 \u0627\u0650\u0646\u0651\u0650\u064a\u064e \u0623\u064f\u0645\u0650\u0631\u0652\u062a\u064f \u0623\u064e\u0646\u064e \u0627\u064e\u0639\u0652\u0628\u064f\u062f\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0645\u064f\u062e\u0652\u0644\u0650\u0635\u0627\u0657 \u0644\u0651\u064e\u0647\u064f \u0627\u064f\u06ec\u0644\u062f\u0651\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0632\u0645\u0631: 12]' },
    { q: true, t: '\u0641\u064e\u062a\u064e\u0639\u064e\u0670\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u064e\u0644\u0650\u0643\u064f \u0627\u064f\u06ec\u0644\u0652\u062d\u064e\u0642\u0651\u064f\u06d6 \u0644\u064e\u0627\u0653 \u0625\u0650\u0644\u064e\u0670\u0647\u064e \u0625\u0650\u0644\u0651\u064e\u0627 \u0647\u064f\u0648\u064e\u06d6 \u0631\u064e\u0628\u0651\u064f \u0627\u064f\u06ec\u0644\u0652\u0639\u064e\u0631\u0652\u0634\u0650 \u0627\u0650\u06ec\u0644\u0652\u0643\u064e\u0631\u0650\u064a\u0645\u0650', r: '[\u0627\u0644\u0645\u0624\u0645\u0646\u0648\u0646: 117]' },
    { q: true, t: '\u0642\u064f\u0644\u0650 \u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0623\u064e\u0639\u0652\u0628\u064f\u062f\u064f \u0645\u064f\u062e\u0652\u0644\u0650\u0635\u0627\u0657 \u0644\u0651\u064e\u0647\u064f\u06e5 \u062f\u0650\u064a\u0646\u0650\u06d2', r: '[\u0627\u0644\u0632\u0645\u0631: 14]' },
    { q: true, t: '\u0648\u064e\u0642\u064f\u0644 \u0631\u0651\u064e\u0628\u0651\u0650 \u0627\u0650\u06ea\u063a\u0652\u0641\u0650\u0631\u0652 \u0648\u064e\u0627\u0631\u0652\u062d\u064e\u0645\u0652 \u0648\u064e\u0623\u064e\u0646\u062a\u064e \u062e\u064e\u064a\u0652\u0631\u064f \u0627\u064f\u06ec\u0644\u0631\u0651\u064e\u0670\u062d\u0650\u0645\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0645\u0624\u0645\u0646\u0648\u0646: 119]' },
    { q: true, t: '\u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u062e\u064e\u0670\u0644\u0650\u0642\u064f \u0643\u064f\u0644\u0651\u0650 \u0634\u064e\u06d2\u0652\u0621\u0656\u06d6 \u0648\u064e\u0647\u064f\u0648\u064e \u0639\u064e\u0644\u064e\u0649\u0670 \u0643\u064f\u0644\u0651\u0650 \u0634\u064e\u06d2\u0652\u0621\u0656 \u0648\u064e\u0643\u0650\u064a\u0644\u065e', r: '[\u0627\u0644\u0632\u0645\u0631: 59]' },
    { q: true, t: '\u0641\u0650\u06d2 \u0628\u064f\u064a\u064f\u0648\u062a\u064d \u0627\u064e\u0630\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0623\u064e\u0646 \u062a\u064f\u0631\u0652\u0641\u064e\u0639\u064e \u0648\u064e\u064a\u064f\u0630\u0652\u0643\u064e\u0631\u064e \u0641\u0650\u064a\u0647\u064e\u0627 \u0627\u064e\u06ea\u0633\u0652\u0645\u064f\u0647\u064f\u06e5 \u064a\u064f\u0633\u064e\u0628\u0651\u0650\u062d\u064f \u0644\u064e\u0647\u064f\u06e5 \u0641\u0650\u064a\u0647\u064e\u0627 \u0628\u0650\u0627\u0644\u0652\u063a\u064f\u062f\u064f\u0648\u0651\u0650 \u0648\u064e\u0627\u0644\u064e\u0627\u0635\u064e\u0627\u0644\u0650', r: '[\u0627\u0644\u0646\u0648\u0631: 36]' },
    { q: true, t: '\u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0644\u064e\u0637\u0650\u064a\u0641\u064f\u06e2 \u0628\u0650\u0639\u0650\u0628\u064e\u0627\u062f\u0650\u0647\u0650\u06e6\u06d6 \u064a\u064e\u0631\u0652\u0632\u064f\u0642\u064f \u0645\u064e\u0646\u0652 \u064a\u0651\u064e\u0634\u064e\u0627\u0653\u0621\u064f\u06d6 \u0648\u064e\u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0652\u0642\u064e\u0648\u0650\u064a\u0651\u064f \u0627\u064f\u06ec\u0644\u0652\u0639\u064e\u0632\u0650\u064a\u0632\u064f', r: '[\u0627\u0644\u0634\u0648\u0631\u0649: 17]' },
    { q: true, t: '\u0644\u0650\u064a\u064e\u062c\u0652\u0632\u0650\u064a\u064e\u0647\u064f\u0645\u064f \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0623\u064e\u062d\u0652\u0633\u064e\u0646\u064e \u0645\u064e\u0627 \u0639\u064e\u0645\u0650\u0644\u064f\u0648\u0627\u0652 \u0648\u064e\u064a\u064e\u0632\u0650\u064a\u062f\u064e\u0647\u064f\u0645 \u0645\u0651\u0650\u0646 \u0641\u064e\u0636\u0652\u0644\u0650\u0647\u0650\u06e6\u06d6 \u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u064a\u064e\u0631\u0652\u0632\u064f\u0642\u064f \u0645\u064e\u0646\u0652 \u064a\u0651\u064e\u0634\u064e\u0627\u0653\u0621\u064f \u0628\u0650\u063a\u064e\u064a\u0652\u0631\u0650 \u062d\u0650\u0633\u064e\u0627\u0628\u0656', r: '[\u0627\u0644\u0646\u0648\u0631: 37]' },
    { q: true, t: '\u0648\u064e\u0627\u0644\u0630\u0650\u064a\u0646\u064e \u0627\u064e\u06ea\u0633\u0652\u062a\u064e\u062c\u064e\u0627\u0628\u064f\u0648\u0627\u0652 \u0644\u0650\u0631\u064e\u0628\u0651\u0650\u0647\u0650\u0645\u0652 \u0648\u064e\u0623\u064e\u0642\u064e\u0627\u0645\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0635\u0651\u064e\u0644\u064e\u0648\u0670\u0629\u064e \u0648\u064e\u0623\u064e\u0645\u0652\u0631\u064f\u0647\u064f\u0645\u0652 \u0634\u064f\u0648\u0631\u06ea\u0649\u0670 \u0628\u064e\u064a\u0652\u0646\u064e\u0647\u064f\u0645\u0652 \u0648\u064e\u0645\u0650\u0645\u0651\u064e\u0627 \u0631\u064e\u0632\u064e\u0642\u0652\u0646\u064e\u0670\u0647\u064f\u0645\u0652 \u064a\u064f\u0646\u0641\u0650\u0642\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0634\u0648\u0631\u0649: 35]' },
    { q: true, t: '\u0648\u064e\u0625\u0650\u0646\u0651\u064e \u0631\u064e\u0628\u0651\u064e\u0643\u064e \u0644\u064e\u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0652\u0639\u064e\u0632\u0650\u064a\u0632\u064f \u0627\u064f\u06ec\u0644\u0631\u0651\u064e\u062d\u0650\u064a\u0645\u064f', r: '[\u0627\u0644\u0634\u0639\u0631\u0627\u0621: 8]' },
    { q: true, t: '\u064a\u064e\u0670\u0653\u0623\u064e\u064a\u0651\u064f\u0647\u064e\u0627 \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0653\u0627\u0652 \u0625\u0650\u0646 \u062a\u064e\u0646\u0635\u064f\u0631\u064f\u0648\u0627\u0652 \u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u064a\u064e\u0646\u0635\u064f\u0631\u0652\u0643\u064f\u0645\u0652 \u0648\u064e\u064a\u064f\u062b\u064e\u0628\u0651\u0650\u062a\u064e \u0627\u064e\u0642\u0652\u062f\u064e\u0627\u0645\u064e\u0643\u064f\u0645\u0652', r: '[\u0645\u062d\u0645\u062f: 8]' },
    { q: true, t: '\u0641\u064e\u062a\u064e\u0648\u064e\u0643\u0651\u064e\u0644\u0652 \u0639\u064e\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650\u06d6 \u0625\u0650\u0646\u0651\u064e\u0643\u064e \u0639\u064e\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0652\u062d\u064e\u0642\u0651\u0650 \u0627\u0650\u06ec\u0644\u0652\u0645\u064f\u0628\u0650\u064a\u0646\u0650', r: '[\u0627\u0644\u0646\u0645\u0644: 81]' },
    { q: true, t: '\u0648\u064e\u064a\u064e\u0646\u0635\u064f\u0631\u064e\u0643\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0646\u064e\u0635\u0652\u0631\u0627\u064b \u0639\u064e\u0632\u0650\u064a\u0632\u0627\u064b', r: '[\u0627\u0644\u0641\u062a\u062d: 3]' },
    { q: true, t: '\u0648\u064e\u0642\u064f\u0644\u0650 \u0627\u0650\u06ec\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f \u0644\u0650\u0644\u0647\u0650 \u0633\u064e\u064a\u064f\u0631\u0650\u064a\u0643\u064f\u0645\u064f\u06e5\u0653 \u0621\u064e\u0627\u064a\u064e\u0670\u062a\u0650\u0647\u0650\u06e6 \u0641\u064e\u062a\u064e\u0639\u0652\u0631\u0650\u0641\u064f\u0648\u0646\u064e\u0647\u064e\u0627\u06d6 \u0648\u064e\u0645\u064e\u0627 \u0631\u064e\u0628\u0651\u064f\u0643\u064e \u0628\u0650\u063a\u064e\u0670\u0641\u0650\u0644\u064d \u0639\u064e\u0645\u0651\u064e\u0627 \u062a\u064e\u0639\u0652\u0645\u064e\u0644\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0646\u0645\u0644: 95]' },
    { q: true, t: '\u0648\u064e\u0644\u0650\u0644\u0647\u0650 \u062c\u064f\u0646\u064f\u0648\u062f\u064f \u0627\u064f\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0627\u0644\u064e\u0627\u0631\u0652\u0636\u0650\u06d6 \u0648\u064e\u0643\u064e\u0627\u0646\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0639\u064e\u0632\u0650\u064a\u0632\u0627\u064b \u062d\u064e\u0643\u0650\u064a\u0645\u0627\u064b', r: '[\u0627\u0644\u0641\u062a\u062d: 7]' },
    { q: true, t: '\u0648\u064e\u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0644\u064e\u0627\u0653 \u0625\u0650\u0644\u064e\u0670\u0647\u064e \u0625\u0650\u0644\u0651\u064e\u0627 \u0647\u064f\u0648\u064e\u06d6 \u0644\u064e\u0647\u064f \u0627\u064f\u06ec\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u064f\u0627\u0648\u0644\u06ea\u0649\u0670 \u0648\u064e\u0627\u0644\u064e\u0627\u062e\u0650\u0631\u064e\u0629\u0650\u06d6 \u0648\u064e\u0644\u064e\u0647\u064f \u0627\u064f\u06ec\u0644\u0652\u062d\u064f\u0643\u0652\u0645\u064f\u06d6 \u0648\u064e\u0625\u0650\u0644\u064e\u064a\u0652\u0647\u0650 \u062a\u064f\u0631\u0652\u062c\u064e\u0639\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0642\u0635\u0635: 70]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u064a\u064e\u0639\u0652\u0644\u064e\u0645\u064f \u063a\u064e\u064a\u0652\u0628\u064e \u0627\u064e\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0627\u0644\u064e\u0627\u0631\u0652\u0636\u0650\u06d6 \u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u0628\u064e\u0635\u0650\u064a\u0631\u064f\u06e2 \u0628\u0650\u0645\u064e\u0627 \u062a\u064e\u0639\u0652\u0645\u064e\u0644\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u062d\u062c\u0631\u0627\u062a: 18]' },
    { q: true, t: '\u0628\u0650\u0646\u064e\u0635\u0652\u0631\u0650 \u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u0650\u06d6 \u064a\u064e\u0646\u0635\u064f\u0631\u064f \u0645\u064e\u0646\u0652 \u064a\u0651\u064e\u0634\u064e\u0627\u0653\u0621\u064f\u06d6 \u0648\u064e\u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0652\u0639\u064e\u0632\u0650\u064a\u0632\u064f \u0627\u064f\u06ec\u0644\u0631\u0651\u064e\u062d\u0650\u064a\u0645\u064f', r: '[\u0627\u0644\u0631\u0648\u0645: 4]' },
    { q: true, t: '\u064a\u064e\u0639\u0652\u0644\u064e\u0645\u064f \u0645\u064e\u0627 \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0627\u0644\u064e\u0627\u0631\u0652\u0636\u0650 \u0648\u064e\u064a\u064e\u0639\u0652\u0644\u064e\u0645\u064f \u0645\u064e\u0627 \u062a\u064f\u0633\u0650\u0631\u0651\u064f\u0648\u0646\u064e \u0648\u064e\u0645\u064e\u0627 \u062a\u064f\u0639\u0652\u0644\u0650\u0646\u064f\u0648\u0646\u064e\u06d6 \u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u0639\u064e\u0644\u0650\u064a\u0645\u064f\u06e2 \u0628\u0650\u0630\u064e\u0627\u062a\u0650 \u0627\u0650\u06ec\u0644\u0635\u0651\u064f\u062f\u064f\u0648\u0631\u0650', r: '[\u0627\u0644\u062a\u063a\u0627\u0628\u0646: 4]' },
    { q: true, t: '\u0641\u064e\u0627\u0635\u0652\u0628\u0650\u0631\u0650\u06d6 \u0627\u0650\u0646\u0651\u064e \u0648\u064e\u0639\u0652\u062f\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u062d\u064e\u0642\u0651\u065e\u06d6 \u0648\u064e\u0644\u064e\u0627 \u064a\u064e\u0633\u0652\u062a\u064e\u062e\u0650\u0641\u0651\u064e\u0646\u0651\u064e\u0643\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0644\u064e\u0627 \u064a\u064f\u0648\u0642\u0650\u0646\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0631\u0648\u0645: 59]' },
    { q: true, t: '\u0648\u064e\u0627\u0630\u0652\u0643\u064f\u0631\u0650 \u0627\u0650\u06ea\u0633\u0652\u0645\u064e \u0631\u064e\u0628\u0651\u0650\u0643\u064e \u0648\u064e\u062a\u064e\u0628\u064e\u062a\u0651\u064e\u0644\u0650 \u0627\u0650\u0644\u064e\u064a\u0652\u0647\u0650 \u062a\u064e\u0628\u0652\u062a\u0650\u064a\u0644\u0627\u0657', r: '[\u0627\u0644\u0645\u0632\u0645\u0644: 7]' },
    { q: true, t: '\u0648\u064e\u062a\u064e\u0648\u064e\u0643\u0651\u064e\u0644\u0652 \u0639\u064e\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650\u06d6 \u0648\u064e\u0643\u064e\u0641\u06ea\u0649\u0670 \u0628\u0650\u0627\u0644\u0644\u0651\u064e\u0647\u0650 \u0648\u064e\u0643\u0650\u064a\u0644\u0627\u0657', r: '[\u0627\u0644\u0623\u062d\u0632\u0627\u0628: 3]' },
    { q: true, t: '\u0648\u064e\u0627\u0630\u0652\u0643\u064f\u0631\u0650 \u0627\u0650\u06ea\u0633\u0652\u0645\u064e \u0631\u064e\u0628\u0651\u0650\u0643\u064e \u0628\u064f\u0643\u0652\u0631\u064e\u0629\u0657 \u0648\u064e\u0623\u064e\u0635\u0650\u064a\u0644\u0627\u0657', r: '[\u0627\u0644\u0627\u0646\u0633\u0627\u0646: 25]' },
    { q: true, t: '\u0648\u064e\u0628\u064e\u0634\u0651\u0650\u0631\u0650 \u0627\u0650\u06ec\u0644\u0652\u0645\u064f\u0648\u0645\u0650\u0646\u0650\u064a\u0646\u064e \u0628\u0650\u0623\u064e\u0646\u0651\u064e \u0644\u064e\u0647\u064f\u0645 \u0645\u0651\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0641\u064e\u0636\u0652\u0644\u0627\u0657 \u0643\u064e\u0628\u0650\u064a\u0631\u0627\u0657', r: '[\u0627\u0644\u0623\u062d\u0632\u0627\u0628: 47]' },
    { q: true, t: '\u0642\u064f\u0644\u064e \u0627\u064e\u0639\u064f\u0648\u0630\u064f \u0628\u0650\u0631\u064e\u0628\u0651\u0650 \u0627\u0650\u06ec\u0644\u0652\u0641\u064e\u0644\u064e\u0642\u0650 \u0645\u0650\u0646 \u0634\u064e\u0631\u0651\u0650 \u0645\u064e\u0627 \u062e\u064e\u0644\u064e\u0642\u064e', r: '[\u0627\u0644\u0641\u0644\u0642: 1-2]' },
    { q: true, t: '\u0631\u064e\u0628\u0651\u064f \u0627\u064f\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0627\u0644\u064e\u0627\u0631\u0652\u0636\u0650 \u0648\u064e\u0645\u064e\u0627 \u0628\u064e\u064a\u0652\u0646\u064e\u0647\u064f\u0645\u064e\u0627\u06d6 \u0627\u064e\u06ec\u0644\u0652\u0639\u064e\u0632\u0650\u064a\u0632\u064f \u0627\u064f\u06ec\u0644\u0652\u063a\u064e\u0641\u0651\u064e\u0670\u0631\u064f', r: '[\u0635: 65]' },
    { q: true, t: '\u0642\u064f\u0644\u064e \u0627\u064e\u0639\u064f\u0648\u0630\u064f \u0628\u0650\u0631\u064e\u0628\u0651\u0650 \u0627\u0650\u06ec\u0644\u0646\u0651\u064e\u0627\u0633\u0650 \u0645\u064e\u0644\u0650\u0643\u0650 \u0627\u0650\u06ec\u0644\u0646\u0651\u064e\u0627\u0633\u0650 \u0625\u0650\u0644\u064e\u0670\u0647\u0650 \u0627\u0650\u06ec\u0644\u0646\u0651\u064e\u0627\u0633\u0650', r: '[\u0627\u0644\u0646\u0627\u0633: 1-3]' },
    { q: true, t: '\u0644\u0650\u064a\u064f\u0643\u064e\u0641\u0651\u0650\u0631\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0639\u064e\u0646\u0652\u0647\u064f\u0645\u064f\u06e5\u0653 \u0623\u064e\u0633\u0652\u0648\u064e\u0623\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u06d2 \u0639\u064e\u0645\u0650\u0644\u064f\u0648\u0627\u0652 \u0648\u064e\u064a\u064e\u062c\u0652\u0632\u0650\u064a\u064e\u0647\u064f\u0645\u064f\u06e5\u0653 \u0623\u064e\u062c\u0652\u0631\u064e\u0647\u064f\u0645 \u0628\u0650\u0623\u064e\u062d\u0652\u0633\u064e\u0646\u0650 \u0627\u0650\u06ec\u0644\u0630\u0650\u06d2 \u0643\u064e\u0627\u0646\u064f\u0648\u0627\u0652 \u064a\u064e\u0639\u0652\u0645\u064e\u0644\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0632\u0645\u0631: 34]' },
    { q: true, t: '\u0648\u064e\u0623\u064f\u0641\u064e\u0648\u0651\u0650\u0636\u064f \u0623\u064e\u0645\u0652\u0631\u0650\u064a\u064e \u0625\u0650\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650\u06d6 \u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0628\u064e\u0635\u0650\u064a\u0631\u064f\u06e2 \u0628\u0650\u0627\u0644\u0652\u0639\u0650\u0628\u064e\u0627\u062f\u0650', r: '[\u063a\u0627\u0641\u0631: 44]' },
    { q: true, t: '\u0641\u064e\u0627\u0635\u0652\u0628\u0650\u0631\u0650 \u0627\u0650\u0646\u0651\u064e \u0648\u064e\u0639\u0652\u062f\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u062d\u064e\u0642\u0651\u065e\u06d6 \u0648\u064e\u0627\u0633\u0652\u062a\u064e\u063a\u0652\u0641\u0650\u0631\u0652 \u0644\u0650\u0630\u064e\u0646\u06e2\u0628\u0650\u0643\u064e \u0648\u064e\u0633\u064e\u0628\u0651\u0650\u062d\u0652 \u0628\u0650\u062d\u064e\u0645\u0652\u062f\u0650 \u0631\u064e\u0628\u0651\u0650\u0643\u064e \u0628\u0650\u0627\u0644\u0652\u0639\u064e\u0634\u0650\u064a\u0651\u0650 \u0648\u064e\u0627\u0644\u0650\u0627\u0628\u0652\u0643\u06ea\u0670\u0631\u0650', r: '[\u063a\u0627\u0641\u0631: 54]' },
    { q: true, t: '\u0648\u064e\u0645\u064e\u0627 \u0628\u0650\u0643\u064f\u0645 \u0645\u0651\u0650\u0646 \u0646\u0651\u0650\u0639\u0652\u0645\u064e\u0629\u0656 \u0641\u064e\u0645\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650', r: '[\u0627\u0644\u0646\u062d\u0644: 53]' },
    { q: true, t: '\u062a\u064e\u0646\u0632\u0650\u064a\u0644\u065e \u0645\u0651\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0631\u0651\u064e\u062d\u0652\u0645\u064e\u0670\u0646\u0650 \u0627\u0650\u06ec\u0644\u0631\u0651\u064e\u062d\u0650\u064a\u0645\u0650', r: '[\u0641\u0635\u0644\u062a: 1]' },
    { q: true, t: '\u0648\u064e\u0631\u0650\u0636\u0652\u0648\u064e\u0670\u0646\u065e \u0645\u0651\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0623\u064e\u0643\u0652\u0628\u064e\u0631\u064f', r: '[\u0627\u0644\u062a\u0648\u0628\u0629: 73]' },
    { q: true, t: '\u0633\u064f\u0628\u0652\u062d\u064e\u0670\u0646\u064e \u0631\u064e\u0628\u0651\u0650 \u0627\u0650\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0627\u0644\u064e\u0627\u0631\u0652\u0636\u0650 \u0631\u064e\u0628\u0651\u0650 \u0627\u0650\u06ec\u0644\u0652\u0639\u064e\u0631\u0652\u0634\u0650 \u0639\u064e\u0645\u0651\u064e\u0627 \u064a\u064e\u0635\u0650\u0641\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0632\u062e\u0631\u0641: 82]' },
    { q: true, t: '\u0648\u064e\u0627\u0644\u0630\u0650\u064a\u0646\u064e \u0621\u064e\u0627\u0645\u064e\u0646\u064f\u0648\u0653\u0627\u0652 \u0623\u064e\u0634\u064e\u062f\u0651\u064f \u062d\u064f\u0628\u0651\u0627\u0657 \u0644\u0651\u0650\u0644\u0647\u0650', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 164]' },
    { q: true, t: '\u0631\u064e\u062d\u0652\u0645\u064e\u0629\u0657 \u0645\u0651\u0650\u0646 \u0631\u0651\u064e\u0628\u0651\u0650\u0643\u064e\u06d6 \u0625\u0650\u0646\u0651\u064e\u0647\u064f\u06e5 \u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0633\u0651\u064e\u0645\u0650\u064a\u0639\u064f \u0627\u064f\u06ec\u0644\u0652\u0639\u064e\u0644\u0650\u064a\u0645\u064f', r: '[\u0627\u0644\u062f\u062e\u0627\u0646: 5]' },
    { q: true, t: '\u0641\u064e\u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0634\u064e\u0627\u0643\u0650\u0631\u064c \u0639\u064e\u0644\u0650\u064a\u0645\u064c', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 157]' },
    { q: true, t: '\u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0627\u064f\u06ec\u0644\u0630\u0650\u06d2 \u0633\u064e\u062e\u0651\u064e\u0631\u064e \u0644\u064e\u0643\u064f\u0645\u064f \u0627\u064f\u06ec\u0644\u0652\u0628\u064e\u062d\u0652\u0631\u064e \u0644\u0650\u062a\u064e\u062c\u0652\u0631\u0650\u064a\u064e \u0627\u064e\u06ec\u0644\u0652\u0641\u064f\u0644\u0652\u0643\u064f \u0641\u0650\u064a\u0647\u0650 \u0628\u0650\u0623\u064e\u0645\u0652\u0631\u0650\u0647\u0650\u06e6 \u0648\u064e\u0644\u0650\u062a\u064e\u0628\u0652\u062a\u064e\u063a\u064f\u0648\u0627\u0652 \u0645\u0650\u0646 \u0641\u064e\u0636\u0652\u0644\u0650\u0647\u0650\u06e6 \u0648\u064e\u0644\u064e\u0639\u064e\u0644\u0651\u064e\u0643\u064f\u0645\u0652 \u062a\u064e\u0634\u0652\u0643\u064f\u0631\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u062c\u0627\u062b\u064a\u0629: 11]' },
    { q: true, t: '\u0641\u064e\u0644\u0650\u0644\u0647\u0650 \u0627\u0650\u06ec\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f \u0631\u064e\u0628\u0651\u0650 \u0627\u0650\u06ec\u0644\u0633\u0651\u064e\u0645\u064e\u0670\u0648\u064e\u0670\u062a\u0650 \u0648\u064e\u0631\u064e\u0628\u0651\u0650 \u0627\u0650\u06ec\u0644\u064e\u0627\u0631\u0652\u0636\u0650 \u0631\u064e\u0628\u0651\u0650 \u0627\u0650\u06ec\u0644\u0652\u0639\u064e\u0670\u0644\u064e\u0645\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u062c\u0627\u062b\u064a\u0629: 35]' },
    { q: true, t: '\u0644\u0651\u0650\u064a\u064e\u063a\u0652\u0641\u0650\u0631\u064e \u0644\u064e\u0643\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0645\u064e\u0627 \u062a\u064e\u0642\u064e\u062f\u0651\u064e\u0645\u064e \u0645\u0650\u0646 \u0630\u064e\u0646\u06e2\u0628\u0650\u0643\u064e \u0648\u064e\u0645\u064e\u0627 \u062a\u064e\u0623\u064e\u062e\u0651\u064e\u0631\u064e \u0648\u064e\u064a\u064f\u062a\u0650\u0645\u0651\u064e \u0646\u0650\u0639\u0652\u0645\u064e\u062a\u064e\u0647\u064f\u06e5 \u0639\u064e\u0644\u064e\u064a\u0652\u0643\u064e \u0648\u064e\u064a\u064e\u0647\u0652\u062f\u0650\u064a\u064e\u0643\u064e \u0635\u0650\u0631\u064e\u0670\u0637\u0627\u0657 \u0645\u0651\u064f\u0633\u0652\u062a\u064e\u0642\u0650\u064a\u0645\u0627\u0657', r: '[\u0627\u0644\u0641\u062a\u062d: 2]' },
    { q: true, t: '\u0641\u064e\u0636\u0652\u0644\u0627\u0657 \u0645\u0651\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0648\u064e\u0646\u0650\u0639\u0652\u0645\u064e\u0629\u0657\u06d6 \u0648\u064e\u0627\u0644\u0644\u0651\u064e\u0647\u064f \u0639\u064e\u0644\u0650\u064a\u0645\u064c \u062d\u064e\u0643\u0650\u064a\u0645\u065e', r: '[\u0627\u0644\u062d\u062c\u0631\u0627\u062a: 8]' },
    { q: true, t: '\u0641\u064e\u0627\u0635\u0652\u0628\u0650\u0631\u0652 \u0639\u064e\u0644\u064e\u0649\u0670 \u0645\u064e\u0627 \u064a\u064e\u0642\u064f\u0648\u0644\u064f\u0648\u0646\u064e\u06d6 \u0648\u064e\u0633\u064e\u0628\u0651\u0650\u062d\u0652 \u0628\u0650\u062d\u064e\u0645\u0652\u062f\u0650 \u0631\u064e\u0628\u0651\u0650\u0643\u064e \u0642\u064e\u0628\u0652\u0644\u064e \u0637\u064f\u0644\u064f\u0648\u0639\u0650 \u0627\u0650\u06ec\u0644\u0634\u0651\u064e\u0645\u0652\u0633\u0650 \u0648\u064e\u0642\u064e\u0628\u0652\u0644\u064e \u0627\u064e\u06ec\u0644\u0652\u063a\u064f\u0631\u064f\u0648\u0628\u0650', r: '[\u0642: 39]' },
    { q: true, t: '\u0648\u064e\u0627\u0635\u0652\u0628\u0650\u0631\u0652 \u0644\u0650\u062d\u064f\u0643\u0652\u0645\u0650 \u0631\u064e\u0628\u0651\u0650\u0643\u064e \u0641\u064e\u0625\u0650\u0646\u0651\u064e\u0643\u064e \u0628\u0650\u0623\u064e\u0639\u0652\u064a\u064f\u0646\u0650\u0646\u064e\u0627\u06d6 \u0648\u064e\u0633\u064e\u0628\u0651\u0650\u062d\u0652 \u0628\u0650\u062d\u064e\u0645\u0652\u062f\u0650 \u0631\u064e\u0628\u0651\u0650\u0643\u064e \u062d\u0650\u064a\u0646\u064e \u062a\u064e\u0642\u064f\u0648\u0645\u064f', r: '[\u0627\u0644\u0637\u0648\u0631: 46]' },
    { q: true, t: '\u0641\u064e\u0633\u064e\u0628\u0651\u0650\u062d\u0652 \u0628\u0650\u0627\u0633\u0652\u0645\u0650 \u0631\u064e\u0628\u0651\u0650\u0643\u064e \u0627\u064e\u06ec\u0644\u0652\u0639\u064e\u0638\u0650\u064a\u0645\u0650', r: '[\u0627\u0644\u0648\u0627\u0642\u0639\u0629: 77]' },
    { q: true, t: '\u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0627\u064f\u06ec\u0644\u0630\u0650\u06d2 \u0644\u064e\u0627\u0653 \u0625\u0650\u0644\u064e\u0670\u0647\u064e \u0625\u0650\u0644\u0651\u064e\u0627 \u0647\u064f\u0648\u064e\u06d6 \u0639\u064e\u0670\u0644\u0650\u0645\u064f \u0627\u064f\u06ec\u0644\u0652\u063a\u064e\u064a\u0652\u0628\u0650 \u0648\u064e\u0627\u0644\u0634\u0651\u064e\u0647\u064e\u0670\u062f\u064e\u0629\u0650\u06d6 \u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0631\u0651\u064e\u062d\u0652\u0645\u064e\u0670\u0646\u064f \u0627\u064f\u06ec\u0644\u0631\u0651\u064e\u062d\u0650\u064a\u0645\u064f', r: '[\u0627\u0644\u062d\u0634\u0631: 22]' },
    { q: true, t: '\u0648\u064e\u0623\u064f\u062e\u0652\u0631\u06ea\u0649\u0670 \u062a\u064f\u062d\u0650\u0628\u0651\u064f\u0648\u0646\u064e\u0647\u064e\u0627 \u0646\u064e\u0635\u0652\u0631\u065e \u0645\u0651\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0648\u064e\u0641\u064e\u062a\u0652\u062d\u065e \u0642\u064e\u0631\u0650\u064a\u0628\u065e\u06d6 \u0648\u064e\u0628\u064e\u0634\u0651\u0650\u0631\u0650 \u0627\u0650\u06ec\u0644\u0652\u0645\u064f\u0648\u0645\u0650\u0646\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0635\u0641: 13]' },
    { q: true, t: '\u0627\u064f\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0644\u064e\u0627\u0653 \u0625\u0650\u0644\u064e\u0670\u0647\u064e \u0625\u0650\u0644\u0651\u064e\u0627 \u0647\u064f\u0648\u064e\u06d6 \u0648\u064e\u0639\u064e\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u0650 \u0641\u064e\u0644\u0652\u064a\u064e\u062a\u064e\u0648\u064e\u0643\u0651\u064e\u0644\u0650 \u0627\u0650\u06ec\u0644\u0652\u0645\u064f\u0648\u0645\u0650\u0646\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u062a\u063a\u0627\u0628\u0646: 13]' },
    { q: true, t: '\u0639\u064e\u0633\u06ea\u0649\u0670 \u0631\u064e\u0628\u0651\u064f\u0646\u064e\u0627\u0653 \u0623\u064e\u0646\u0652 \u064a\u0651\u064f\u0628\u064e\u062f\u0651\u0650\u0644\u064e\u0646\u064e\u0627 \u062e\u064e\u064a\u0652\u0631\u0627\u0657 \u0645\u0651\u0650\u0646\u0652\u0647\u064e\u0627\u0653 \u0625\u0650\u0646\u0651\u064e\u0627\u0653 \u0625\u0650\u0644\u064e\u0649\u0670 \u0631\u064e\u0628\u0651\u0650\u0646\u064e\u0627 \u0631\u064e\u0670\u063a\u0650\u0628\u064f\u0648\u0646\u064e', r: '[\u0627\u0644\u0642\u0644\u0645: 32]' },
    { q: true, t: '\u0641\u064e\u0642\u064f\u0644\u0652\u062a\u064f \u0627\u064f\u06ea\u0633\u0652\u062a\u064e\u063a\u0652\u0641\u0650\u0631\u064f\u0648\u0627\u0652 \u0631\u064e\u0628\u0651\u064e\u0643\u064f\u0645\u064f\u06e5\u0653 \u0625\u0650\u0646\u0651\u064e\u0647\u064f\u06e5 \u0643\u064e\u0627\u0646\u064e \u063a\u064e\u0641\u0651\u064e\u0627\u0631\u0627\u0657', r: '[\u0646\u0648\u062d: 10]' },
    { q: true, t: '\u0631\u0651\u064e\u0628\u0651\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u064e\u0634\u0652\u0631\u0650\u0642\u0650 \u0648\u064e\u0627\u0644\u0652\u0645\u064e\u063a\u0652\u0631\u0650\u0628\u0650\u06d6 \u0644\u064e\u0627\u0653 \u0625\u0650\u0644\u064e\u0670\u0647\u064e \u0625\u0650\u0644\u0651\u064e\u0627 \u0647\u064f\u0648\u064e\u06d6 \u0641\u064e\u0627\u062a\u0651\u064e\u062e\u0650\u0630\u0652\u0647\u064f \u0648\u064e\u0643\u0650\u064a\u0644\u0627\u0657', r: '[\u0627\u0644\u0645\u0632\u0645\u0644: 8]' },
    { q: true, t: '\u0633\u064e\u0628\u0651\u0650\u062d\u0650 \u0627\u0650\u06ea\u0633\u0652\u0645\u064e \u0631\u064e\u0628\u0651\u0650\u0643\u064e \u0627\u064e\u06ec\u0644\u064e\u0627\u0639\u0652\u0644\u064e\u064a', r: '[\u0627\u0644\u0623\u0639\u0644\u0649: 1]' },
    { q: true, t: '\u0642\u064f\u0644\u0652 \u0647\u064f\u0648\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0623\u064e\u062d\u064e\u062f\u064c\u06d6 \u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0627\u064f\u06ec\u0644\u0635\u0651\u064e\u0645\u064e\u062f\u064f\u06d6 \u0644\u064e\u0645\u0652 \u064a\u064e\u0644\u0650\u062f\u0652 \u0648\u064e\u0644\u064e\u0645\u0652 \u064a\u064f\u0648\u0644\u064e\u062f\u0652\u06d6 \u0648\u064e\u0644\u064e\u0645\u0652 \u064a\u064e\u0643\u064f\u0646 \u0644\u0651\u064e\u0647\u064f\u06e5 \u0643\u064f\u0641\u064f\u0624\u0627\u064b \u0627\u064e\u062d\u064e\u062f\u065e', r: '[\u0627\u0644\u0625\u062e\u0644\u0627\u0635: 1-4]' },
    { q: true, t: '\u0631\u064e\u0628\u0651\u064e\u0646\u064e\u0627\u0653 \u0623\u064e\u0641\u0652\u0631\u0650\u063a\u0652 \u0639\u064e\u0644\u064e\u064a\u0652\u0646\u064e\u0627 \u0635\u064e\u0628\u0652\u0631\u0627\u0657 \u0648\u064e\u062a\u064e\u0648\u064e\u0641\u0651\u064e\u0646\u064e\u0627 \u0645\u064f\u0633\u0652\u0644\u0650\u0645\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0623\u0639\u0631\u0627\u0641: 125]' },
    { q: true, t: '\u0642\u064f\u0644\u0650 \u0627\u0650\u06ec\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f \u0644\u0650\u0644\u0647\u0650 \u0648\u064e\u0633\u064e\u0644\u064e\u0670\u0645\u064c \u0639\u064e\u0644\u064e\u0649\u0670 \u0639\u0650\u0628\u064e\u0627\u062f\u0650\u0647\u0650 \u0627\u0650\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u0627\u064e\u06ea\u0635\u0652\u0637\u064e\u0641\u06ea\u0649\u0670\u0653', r: '[\u0627\u0644\u0646\u0645\u0644: 61]' },
    { q: true, t: '\u0641\u064e\u0627\u0639\u0652\u0644\u064e\u0645\u064e \u0627\u064e\u0646\u0651\u064e\u0647\u064f\u06e5 \u0644\u064e\u0627\u0653 \u0625\u0650\u0644\u064e\u0670\u0647\u064e \u0625\u0650\u0644\u0651\u064e\u0627 \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f \u0648\u064e\u0627\u0633\u0652\u062a\u064e\u063a\u0652\u0641\u0650\u0631\u0652 \u0644\u0650\u0630\u064e\u0646\u06e2\u0628\u0650\u0643\u064e', r: '[\u0645\u062d\u0645\u062f: 20]' },
    { q: true, t: '\u0648\u064e\u0644\u064e\u0627 \u062a\u064e\u0647\u0650\u0646\u064f\u0648\u0627\u0652 \u0648\u064e\u0644\u064e\u0627 \u062a\u064e\u062d\u0652\u0632\u064e\u0646\u064f\u0648\u0627\u0652 \u0648\u064e\u0623\u064e\u0646\u062a\u064f\u0645\u064f \u0627\u064f\u06ec\u0644\u064e\u0627\u0639\u0652\u0644\u064e\u0648\u0652\u0646\u064e \u0625\u0650\u0646 \u0643\u064f\u0646\u062a\u064f\u0645 \u0645\u0651\u064f\u0648\u0645\u0650\u0646\u0650\u064a\u0646\u064e', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 139]' },
    { q: true, t: '\u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u0630\u064f\u0648 \u0641\u064e\u0636\u0652\u0644\u064d \u0639\u064e\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0652\u0639\u064e\u0670\u0644\u064e\u0645\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 249]' },
    { q: true, t: '\u0642\u064f\u0644\u0650 \u0627\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0652\u0641\u064e\u0636\u0652\u0644\u064e \u0628\u0650\u064a\u064e\u062f\u0650 \u0627\u0650\u06ec\u0644\u0644\u0651\u064e\u0647\u0650\u06d6 \u064a\u064f\u0648\u062a\u0650\u064a\u0647\u0650 \u0645\u064e\u0646\u0652 \u064a\u0651\u064e\u0634\u064e\u0627\u0653\u0621\u064f', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 72]' },
    { q: true, t: '\u0625\u0650\u0646\u0651\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064e \u064a\u064f\u062d\u0650\u0628\u0651\u064f \u0627\u064f\u06ec\u0644\u0652\u0645\u064f\u0642\u0652\u0633\u0650\u0637\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0645\u0627\u0626\u062f\u0629: 44]' },
    { q: true, t: '\u0648\u064e\u062a\u064e\u0648\u064e\u0643\u0651\u064e\u0644\u0652 \u0639\u064e\u0644\u064e\u0649 \u0627\u064e\u06ec\u0644\u0652\u062d\u064e\u064a\u0651\u0650 \u0627\u0650\u06ec\u0644\u0630\u0650\u06d2 \u0644\u064e\u0627 \u064a\u064e\u0645\u064f\u0648\u062a\u064f\u06d6 \u0648\u064e\u0633\u064e\u0628\u0651\u0650\u062d\u0652 \u0628\u0650\u062d\u064e\u0645\u0652\u062f\u0650\u0647\u0650\u06e6', r: '[\u0627\u0644\u0641\u0631\u0642\u0627\u0646: 58]' },
    { q: true, t: '\u0648\u064e\u0627\u0635\u0652\u0628\u0650\u0631\u0652 \u0646\u064e\u0641\u0652\u0633\u064e\u0643\u064e \u0645\u064e\u0639\u064e \u0627\u064e\u06ec\u0644\u0630\u0650\u064a\u0646\u064e \u064a\u064e\u062f\u0652\u0639\u064f\u0648\u0646\u064e \u0631\u064e\u0628\u0651\u064e\u0647\u064f\u0645 \u0628\u0650\u0627\u0644\u0652\u063a\u064e\u062f\u064e\u0648\u0670\u0629\u0650 \u0648\u064e\u0627\u0644\u0652\u0639\u064e\u0634\u0650\u064a\u0651\u0650 \u064a\u064f\u0631\u0650\u064a\u062f\u064f\u0648\u0646\u064e \u0648\u064e\u062c\u0652\u0647\u064e\u0647\u064f\u06e5', r: '[\u0627\u0644\u0643\u0647\u0641: 28]' },
  ],
  dua: [      // une carte par doua
    { q: true, t: '\u0631\u064e\u0628\u0651\u064e\u0646\u064e\u0627\u0653 \u0621\u064e\u0627\u062a\u0650\u0646\u064e\u0627 \u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u062f\u0651\u064f\u0646\u0652\u064a\u06ea\u0627 \u062d\u064e\u0633\u064e\u0646\u064e\u0629\u0657 \u0648\u064e\u0641\u0650\u06d2 \u0627\u0650\u06ec\u0644\u064e\u0627\u062e\u0650\u0631\u064e\u0629\u0650 \u062d\u064e\u0633\u064e\u0646\u064e\u0629\u0657 \u0648\u064e\u0642\u0650\u0646\u064e\u0627 \u0639\u064e\u0630\u064e\u0627\u0628\u064e \u0627\u064e\u06ec\u0644\u0646\u0651\u06ea\u0627\u0631\u0650', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 199]' },
    { q: true, t: '\u0631\u064e\u0628\u0651\u0650 \u0627\u0650\u06ea\u0634\u0652\u0631\u064e\u062d\u0652 \u0644\u0650\u06d2 \u0635\u064e\u062f\u0652\u0631\u0650\u06d2 \u0648\u064e\u064a\u064e\u0633\u0651\u0650\u0631\u0652 \u0644\u0650\u064a\u064e \u0623\u064e\u0645\u0652\u0631\u0650\u06d2', r: '[\u0637\u0647: 24-25]' },
    { q: true, t: '\u0631\u064e\u0628\u0651\u064e\u0646\u064e\u0627 \u0644\u064e\u0627 \u062a\u064f\u0632\u0650\u063a\u0652 \u0642\u064f\u0644\u064f\u0648\u0628\u064e\u0646\u064e\u0627 \u0628\u064e\u0639\u0652\u062f\u064e \u0625\u0650\u0630\u0652 \u0647\u064e\u062f\u064e\u064a\u0652\u062a\u064e\u0646\u064e\u0627 \u0648\u064e\u0647\u064e\u0628\u0652 \u0644\u064e\u0646\u064e\u0627 \u0645\u0650\u0646 \u0644\u0651\u064e\u062f\u064f\u0646\u0643\u064e \u0631\u064e\u062d\u0652\u0645\u064e\u0629\u064b\u06d6 \u0627\u0650\u0646\u0651\u064e\u0643\u064e \u0623\u064e\u0646\u062a\u064e \u0627\u064e\u06ec\u0644\u0652\u0648\u064e\u0647\u0651\u064e\u0627\u0628\u064f', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 8]' },
    { q: true, t: '\u0631\u0651\u064e\u0628\u0651\u0650 \u0627\u0650\u06ea\u0631\u0652\u062d\u064e\u0645\u0652\u0647\u064f\u0645\u064e\u0627 \u0643\u064e\u0645\u064e\u0627 \u0631\u064e\u0628\u0651\u064e\u064a\u064e\u0670\u0646\u0650\u06d2 \u0635\u064e\u063a\u0650\u064a\u0631\u0627\u0657', r: '[\u0627\u0644\u0625\u0633\u0631\u0627\u0621: 24]' },
    { lead: '\u0645\u0645\u0627 \u062f\u0639\u0627 \u0628\u0647 \u0631\u0633\u0648\u0644 \u0627\u0644\u0644\u0647 \ufdfa', t: 'اللَّهُمَّ إِنِّي أَسْأَلُكَ الْعَافِيَةَ فِي الدُّنْيَا وَالْآخِرَةِ', r: 'رواه أبو داود (5074) وابن ماجه (3871)' },
    { lead: '\u0645\u0645\u0627 \u062f\u0639\u0627 \u0628\u0647 \u0631\u0633\u0648\u0644 \u0627\u0644\u0644\u0647 \ufdfa', t: 'يَا مُقَلِّبَ الْقُلُوبِ ثَبِّتْ قَلْبِي عَلَى دِينِكَ', r: 'رواه الترمذي (2140)' },
    { q: true, t: '\u0631\u064e\u0628\u0651\u064e\u0646\u064e\u0627 \u0647\u064e\u0628\u0652 \u0644\u064e\u0646\u064e\u0627 \u0645\u0650\u0646\u064e \u0627\u064e\u0632\u0652\u0648\u064e\u0670\u062c\u0650\u0646\u064e\u0627 \u0648\u064e\u0630\u064f\u0631\u0651\u0650\u064a\u0651\u064e\u0670\u062a\u0650\u0646\u064e\u0627 \u0642\u064f\u0631\u0651\u064e\u0629\u064e \u0623\u064e\u0639\u0652\u064a\u064f\u0646\u0656 \u0648\u064e\u0627\u062c\u0652\u0639\u064e\u0644\u0652\u0646\u064e\u0627 \u0644\u0650\u0644\u0652\u0645\u064f\u062a\u0651\u064e\u0642\u0650\u064a\u0646\u064e \u0625\u0650\u0645\u064e\u0627\u0645\u0627\u064b', r: '[\u0627\u0644\u0641\u0631\u0642\u0627\u0646: 74]' },
    { q: true, t: '\u0631\u0651\u064e\u0628\u0651\u0650 \u0632\u0650\u062f\u0652\u0646\u0650\u06d2 \u0639\u0650\u0644\u0652\u0645\u0627\u0657', r: '[\u0637\u0647: 111]' },
    { q: true, t: '\u0631\u064e\u0628\u0651\u064e\u0646\u064e\u0627 \u0627\u064e\u06ea\u063a\u0652\u0641\u0650\u0631\u0652 \u0644\u0650\u06d2 \u0648\u064e\u0644\u0650\u0648\u064e\u0670\u0644\u0650\u062f\u064e\u064a\u0651\u064e \u0648\u064e\u0644\u0650\u0644\u0652\u0645\u064f\u0648\u0645\u0650\u0646\u0650\u064a\u0646\u064e \u064a\u064e\u0648\u0652\u0645\u064e \u064a\u064e\u0642\u064f\u0648\u0645\u064f \u0627\u064f\u06ec\u0644\u0652\u062d\u0650\u0633\u064e\u0627\u0628\u064f', r: '[\u0625\u0628\u0631\u0627\u0647\u064a\u0645: 43]' },
    { q: true, t: '\u062d\u064e\u0633\u0652\u0628\u0650\u064a\u064e \u0627\u064e\u06ec\u0644\u0644\u0651\u064e\u0647\u064f\u06d6 \u0644\u064e\u0627\u0653 \u0625\u0650\u0644\u064e\u0670\u0647\u064e \u0625\u0650\u0644\u0651\u064e\u0627 \u0647\u064f\u0648\u064e\u06d6 \u0639\u064e\u0644\u064e\u064a\u0652\u0647\u0650 \u062a\u064e\u0648\u064e\u0643\u0651\u064e\u0644\u0652\u062a\u064f\u06d6 \u0648\u064e\u0647\u064f\u0648\u064e \u0631\u064e\u0628\u0651\u064f \u0627\u064f\u06ec\u0644\u0652\u0639\u064e\u0631\u0652\u0634\u0650 \u0627\u0650\u06ec\u0644\u0652\u0639\u064e\u0638\u0650\u064a\u0645\u0650', r: '[\u0627\u0644\u062a\u0648\u0628\u0629: 130]' },
    { q: true, t: '\u0644\u0651\u064e\u0627\u0653 \u0625\u0650\u0644\u064e\u0670\u0647\u064e \u0625\u0650\u0644\u0651\u064e\u0627\u0653 \u0623\u064e\u0646\u062a\u064e \u0633\u064f\u0628\u0652\u062d\u064e\u0670\u0646\u064e\u0643\u064e \u0625\u0650\u0646\u0651\u0650\u06d2 \u0643\u064f\u0646\u062a\u064f \u0645\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0638\u0651\u064e\u0670\u0644\u0650\u0645\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0623\u0646\u0628\u064a\u0627\u0621: 86]' },
    { q: true, t: '\u0631\u064e\u0628\u0651\u064e\u0646\u064e\u0627 \u0638\u064e\u0644\u064e\u0645\u0652\u0646\u064e\u0627\u0653 \u0623\u064e\u0646\u0641\u064f\u0633\u064e\u0646\u064e\u0627 \u0648\u064e\u0625\u0650\u0646 \u0644\u0651\u064e\u0645\u0652 \u062a\u064e\u063a\u0652\u0641\u0650\u0631\u0652 \u0644\u064e\u0646\u064e\u0627 \u0648\u064e\u062a\u064e\u0631\u0652\u062d\u064e\u0645\u0652\u0646\u064e\u0627 \u0644\u064e\u0646\u064e\u0643\u064f\u0648\u0646\u064e\u0646\u0651\u064e \u0645\u0650\u0646\u064e \u0627\u064e\u06ec\u0644\u0652\u062e\u064e\u0670\u0633\u0650\u0631\u0650\u064a\u0646\u064e', r: '[\u0627\u0644\u0623\u0639\u0631\u0627\u0641: 22]' },
    { lead: '\u0645\u0645\u0627 \u062f\u0639\u0627 \u0628\u0647 \u0631\u0633\u0648\u0644 \u0627\u0644\u0644\u0647 \ufdfa', t: 'اللَّهُمَّ إِنِّي أَسْأَلُكَ الْهُدَى وَالتُّقَى وَالْعَفَافَ وَالْغِنَى', r: 'رواه مسلم (2721)' },
    { lead: '\u0645\u0645\u0627 \u0639\u0644\u0651\u0645\u0647 \u0631\u0633\u0648\u0644 \u0627\u0644\u0644\u0647 \ufdfa \u0645\u0646 \u0627\u0644\u062f\u0639\u0627\u0621', t: 'اللَّهُمَّ أَعِنِّي عَلَى ذِكْرِكَ وَشُكْرِكَ وَحُسْنِ عِبَادَتِكَ', r: 'رواه أبو داود (1522) والنسائي (1303)' },
    { lead: '\u0645\u0645\u0627 \u0639\u0644\u0651\u0645\u0647 \u0631\u0633\u0648\u0644 \u0627\u0644\u0644\u0647 \ufdfa \u0645\u0646 \u0627\u0644\u062f\u0639\u0627\u0621', t: 'اللَّهُمَّ إِنَّكَ عَفُوٌّ تُحِبُّ الْعَفْوَ فَاعْفُ عَنِّي', r: 'رواه الترمذي (3513)' },
    { lead: '\u0645\u0645\u0627 \u062f\u0639\u0627 \u0628\u0647 \u0631\u0633\u0648\u0644 \u0627\u0644\u0644\u0647 \ufdfa', t: 'اللَّهُمَّ آتِ نَفْسِي تَقْوَاهَا، وَزَكِّهَا أَنْتَ خَيْرُ مَنْ زَكَّاهَا، أَنْتَ وَلِيُّهَا وَمَوْلَاهَا', r: 'رواه مسلم (2722)' },
    { lead: '\u0645\u0645\u0627 \u0639\u0644\u0651\u0645\u0647 \u0631\u0633\u0648\u0644 \u0627\u0644\u0644\u0647 \ufdfa \u0645\u0646 \u0627\u0644\u062f\u0639\u0627\u0621', t: 'اللَّهُمَّ اغْفِرْ لِي، وَارْحَمْنِي، وَاهْدِنِي، وَعَافِنِي، وَارْزُقْنِي', r: 'رواه مسلم (2697)' },
    { q: true, t: '\u0631\u064e\u0628\u0651\u064e\u0646\u064e\u0627 \u062a\u064e\u0642\u064e\u0628\u0651\u064e\u0644\u0652 \u0645\u0650\u0646\u0651\u064e\u0627\u0653 \u0625\u0650\u0646\u0651\u064e\u0643\u064e \u0623\u064e\u0646\u062a\u064e \u0627\u064e\u06ec\u0644\u0633\u0651\u064e\u0645\u0650\u064a\u0639\u064f \u0627\u064f\u06ec\u0644\u0652\u0639\u064e\u0644\u0650\u064a\u0645\u064f', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 126]' },
    { q: true, t: '\u0631\u064e\u0628\u0651\u064e\u0646\u064e\u0627 \u0644\u064e\u0627 \u062a\u064f\u0648\u06ec\u064e\u0627\u062e\u0650\u0630\u0652\u0646\u064e\u0627\u0653 \u0625\u0650\u0646 \u0646\u0651\u064e\u0633\u0650\u064a\u0646\u064e\u0627\u0653 \u0623\u064e\u0648\u064e \u0627\u064e\u062e\u0652\u0637\u064e\u0623\u0652\u0646\u064e\u0627', r: '[\u0627\u0644\u0628\u0642\u0631\u0629: 285]' },
    { q: true, t: '\u0631\u064e\u0628\u0651\u0650 \u0627\u0650\u06ea\u062c\u0652\u0639\u064e\u0644\u0652\u0646\u0650\u06d2 \u0645\u064f\u0642\u0650\u064a\u0645\u064e \u0627\u064e\u06ec\u0644\u0635\u0651\u064e\u0644\u064e\u0648\u0670\u0629\u0650 \u0648\u064e\u0645\u0650\u0646 \u0630\u064f\u0631\u0651\u0650\u064a\u0651\u064e\u062a\u0650\u06d2\u06d6 \u0631\u064e\u0628\u0651\u064e\u0646\u064e\u0627 \u0648\u064e\u062a\u064e\u0642\u064e\u0628\u0651\u064e\u0644\u0652 \u062f\u064f\u0639\u064e\u0627\u0653\u0621\u06d6\u0650\u06e6', r: '[\u0625\u0628\u0631\u0627\u0647\u064a\u0645: 42]' },
    { q: true, t: '\u0631\u064e\u0628\u0651\u0650 \u0623\u064e\u0648\u0652\u0632\u0650\u0639\u0652\u0646\u0650\u064a\u064e \u0623\u064e\u0646\u064e \u0627\u064e\u0634\u0652\u0643\u064f\u0631\u064e \u0646\u0650\u0639\u0652\u0645\u064e\u062a\u064e\u0643\u064e \u0627\u064e\u06ec\u0644\u062a\u0650\u06d2\u0653 \u0623\u064e\u0646\u0652\u0639\u064e\u0645\u0652\u062a\u064e \u0639\u064e\u0644\u064e\u064a\u0651\u064e \u0648\u064e\u0639\u064e\u0644\u064e\u0649\u0670 \u0648\u064e\u0670\u0644\u0650\u062f\u064e\u064a\u0651\u064e \u0648\u064e\u0623\u064e\u0646\u064e \u0627\u064e\u0639\u0652\u0645\u064e\u0644\u064e \u0635\u064e\u0670\u0644\u0650\u062d\u0627\u0657 \u062a\u064e\u0631\u0652\u0636\u06ea\u064a\u0670\u0647\u064f', r: '[\u0627\u0644\u0646\u0645\u0644: 19]' },
    { q: true, t: '\u0631\u064e\u0628\u0651\u0650 \u0625\u0650\u0646\u0651\u0650\u06d2 \u0644\u0650\u0645\u064e\u0627\u0653 \u0623\u064e\u0646\u0632\u064e\u0644\u0652\u062a\u064e \u0625\u0650\u0644\u064e\u064a\u0651\u064e \u0645\u0650\u0646\u0652 \u062e\u064e\u064a\u0652\u0631\u0656 \u0641\u064e\u0642\u0650\u064a\u0631\u065e', r: '[\u0627\u0644\u0642\u0635\u0635: 24]' },
    { q: true, t: '\u0631\u064e\u0628\u0651\u064e\u0646\u064e\u0627\u0653 \u0621\u064e\u0627\u062a\u0650\u0646\u064e\u0627 \u0645\u0650\u0646 \u0644\u0651\u064e\u062f\u064f\u0646\u0643\u064e \u0631\u064e\u062d\u0652\u0645\u064e\u0629\u0657 \u0648\u064e\u0647\u064e\u064a\u0651\u0650\u06d2\u0654\u0652 \u0644\u064e\u0646\u064e\u0627 \u0645\u0650\u0646\u064e \u0627\u064e\u0645\u0652\u0631\u0650\u0646\u064e\u0627 \u0631\u064e\u0634\u064e\u062f\u0627\u0657', r: '[\u0627\u0644\u0643\u0647\u0641: 10]' },
    { q: true, t: '\u0631\u064e\u0628\u0651\u0650 \u0647\u064e\u0628\u0652 \u0644\u0650\u06d2 \u0645\u0650\u0646 \u0644\u0651\u064e\u062f\u064f\u0646\u0643\u064e \u0630\u064f\u0631\u0651\u0650\u064a\u0651\u064e\u0629\u0657 \u0637\u064e\u064a\u0651\u0650\u0628\u064e\u0629\u064b \u0627\u0650\u0646\u0651\u064e\u0643\u064e \u0633\u064e\u0645\u0650\u064a\u0639\u064f \u0627\u064f\u06ec\u0644\u062f\u0651\u064f\u0639\u064e\u0627\u0653\u0621\u0650', r: '[\u0622\u0644 \u0639\u0645\u0631\u0627\u0646: 38]' },
    { q: true, t: '\u0631\u0651\u064e\u0628\u0651\u0650 \u0623\u064e\u062f\u0652\u062e\u0650\u0644\u0652\u0646\u0650\u06d2 \u0645\u064f\u062f\u0652\u062e\u064e\u0644\u064e \u0635\u0650\u062f\u0652\u0642\u0656 \u0648\u064e\u0623\u064e\u062e\u0652\u0631\u0650\u062c\u0652\u0646\u0650\u06d2 \u0645\u064f\u062e\u0652\u0631\u064e\u062c\u064e \u0635\u0650\u062f\u0652\u0642\u0656 \u0648\u064e\u0627\u062c\u0652\u0639\u064e\u0644 \u0644\u0651\u0650\u06d2 \u0645\u0650\u0646 \u0644\u0651\u064e\u062f\u064f\u0646\u0643\u064e \u0633\u064f\u0644\u0652\u0637\u064e\u0670\u0646\u0627\u0657 \u0646\u0651\u064e\u0635\u0650\u064a\u0631\u0627\u0657', r: '[\u0627\u0644\u0625\u0633\u0631\u0627\u0621: 80]' },
    { lead: '\u0645\u0645\u0627 \u062f\u0639\u0627 \u0628\u0647 \u0631\u0633\u0648\u0644 \u0627\u0644\u0644\u0647 \ufdfa', t: 'اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنَ الْهَمِّ وَالْحَزَنِ، وَالْعَجْزِ وَالْكَسَلِ، وَالْبُخْلِ وَالْجُبْنِ، وَضَلَعِ الدَّيْنِ، وَغَلَبَةِ الرِّجَالِ', r: 'رواه البخاري (6369)' },
    { lead: '\u0645\u0645\u0627 \u062f\u0639\u0627 \u0628\u0647 \u0631\u0633\u0648\u0644 \u0627\u0644\u0644\u0647 \ufdfa', t: 'اللَّهُمَّ مُصَرِّفَ الْقُلُوبِ صَرِّفْ قُلُوبَنَا عَلَى طَاعَتِكَ', r: 'رواه مسلم (2654)' },
    { lead: '\u0645\u0645\u0627 \u0639\u0644\u0651\u0645\u0647 \u0631\u0633\u0648\u0644 \u0627\u0644\u0644\u0647 \ufdfa \u0645\u0646 \u0627\u0644\u062f\u0639\u0627\u0621', t: 'اللَّهُمَّ إِنِّي ظَلَمْتُ نَفْسِي ظُلْمًا كَثِيرًا، وَلَا يَغْفِرُ الذُّنُوبَ إِلَّا أَنْتَ، فَاغْفِرْ لِي مَغْفِرَةً مِنْ عِنْدِكَ، وَارْحَمْنِي، إِنَّكَ أَنْتَ الْغَفُورُ الرَّحِيمُ', r: 'متفق عليه (البخاري 834، مسلم 2705)' },
    { lead: '\u0645\u0645\u0627 \u062f\u0639\u0627 \u0628\u0647 \u0631\u0633\u0648\u0644 \u0627\u0644\u0644\u0647 \ufdfa', t: 'اللَّهُمَّ أَصْلِحْ لِي دِينِيَ الَّذِي هُوَ عِصْمَةُ أَمْرِي، وَأَصْلِحْ لِي دُنْيَايَ الَّتِي فِيهَا مَعَاشِي، وَأَصْلِحْ لِي آخِرَتِي الَّتِي فِيهَا مَعَادِي', r: 'رواه مسلم (2720)' },
    { lead: '\u0645\u0645\u0627 \u062f\u0639\u0627 \u0628\u0647 \u0631\u0633\u0648\u0644 \u0627\u0644\u0644\u0647 \ufdfa', t: 'اللَّهُمَّ إِنِّي أَسْأَلُكَ عِلْمًا نَافِعًا، وَرِزْقًا طَيِّبًا، وَعَمَلًا مُتَقَبَّلًا', r: 'رواه ابن ماجه (925)' },
    { lead: '\u0645\u0645\u0627 \u062f\u0639\u0627 \u0628\u0647 \u0631\u0633\u0648\u0644 \u0627\u0644\u0644\u0647 \ufdfa', t: 'لَا إِلَهَ إِلَّا اللَّهُ الْعَظِيمُ الْحَلِيمُ، لَا إِلَهَ إِلَّا اللَّهُ رَبُّ الْعَرْشِ الْعَظِيمِ، لَا إِلَهَ إِلَّا اللَّهُ رَبُّ السَّمَاوَاتِ وَرَبُّ الْأَرْضِ وَرَبُّ الْعَرْشِ الْكَرِيمِ', r: 'متفق عليه (البخاري 6346، مسلم 2730)' },
    { lead: '\u0642\u0627\u0644 \u0631\u0633\u0648\u0644 \u0627\u0644\u0644\u0647 \ufdfa \u0641\u064a \u0633\u064a\u062f \u0627\u0644\u0627\u0633\u062a\u063a\u0641\u0627\u0631', t: 'اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَهَ إِلَّا أَنْتَ، خَلَقْتَنِي وَأَنَا عَبْدُكَ، وَأَنَا عَلَى عَهْدِكَ وَوَعْدِكَ مَا اسْتَطَعْتُ، أَعُوذُ بِكَ مِنْ شَرِّ مَا صَنَعْتُ، أَبُوءُ لَكَ بِنِعْمَتِكَ عَلَيَّ، وَأَبُوءُ لَكَ بِذَنْبِي، فَاغْفِرْ لِي فَإِنَّهُ لَا يَغْفِرُ الذُّنُوبَ إِلَّا أَنْتَ', r: 'سيد الاستغفار – رواه البخاري (6306)' },
  ],
  hadith: [   // hadiths authentiques courts
    { t: 'إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ، وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى', r: 'متفق عليه (البخاري 1، مسلم 1907) واللفظ للبخاري' },
    { t: 'لَا يُؤْمِنُ أَحَدُكُمْ حَتَّى يُحِبَّ لِأَخِيهِ مَا يُحِبُّ لِنَفْسِهِ', r: 'متفق عليه (البخاري 13، مسلم 45) واللفظ للبخاري' },
    { t: 'مَنْ كَانَ يُؤْمِنُ بِاللَّهِ وَالْيَوْمِ الْآخِرِ فَلْيَقُلْ خَيْرًا أَوْ لِيَصْمُتْ', r: 'متفق عليه (البخاري 6018، مسلم 47)' },
    { t: 'الْكَلِمَةُ الطَّيِّبَةُ صَدَقَةٌ', r: 'متفق عليه (البخاري 2989، مسلم 1009)' },
    { t: 'أَحَبُّ الْأَعْمَالِ إِلَى اللَّهِ تَعَالَى أَدْوَمُهَا وَإِنْ قَلَّ', r: 'رواه مسلم (783) واللفظ له، وبمعناه البخاري (6465)' },
    { t: 'كَلِمَتَانِ خَفِيفَتَانِ عَلَى اللِّسَانِ، ثَقِيلَتَانِ فِي الْمِيزَانِ، حَبِيبَتَانِ إِلَى الرَّحْمَنِ: سُبْحَانَ اللَّهِ وَبِحَمْدِهِ، سُبْحَانَ اللَّهِ الْعَظِيمِ', r: 'متفق عليه (البخاري 6682، مسلم 2694)' },
    { t: 'خَيْرُكُمْ مَنْ تَعَلَّمَ الْقُرْآنَ وَعَلَّمَهُ', r: 'رواه البخاري (5027)' },
    { t: 'مَنْ سَلَكَ طَرِيقًا يَلْتَمِسُ فِيهِ عِلْمًا سَهَّلَ اللَّهُ لَهُ بِهِ طَرِيقًا إِلَى الْجَنَّةِ', r: 'رواه مسلم (2699)' },
    { t: 'مَا نَقَصَتْ صَدَقَةٌ مِنْ مَالٍ', r: 'رواه مسلم (2588)' },
    { t: 'الدِّينُ النَّصِيحَةُ', r: 'رواه مسلم (55)' },
    { t: 'تَبَسُّمُكَ فِي وَجْهِ أَخِيكَ لَكَ صَدَقَةٌ', r: 'رواه الترمذي (1956)' },
    { t: 'اتَّقِ اللَّهَ حَيْثُمَا كُنْتَ، وَأَتْبِعِ السَّيِّئَةَ الْحَسَنَةَ تَمْحُهَا، وَخَالِقِ النَّاسَ بِخُلُقٍ حَسَنٍ', r: 'رواه الترمذي (1987)' },
    { t: 'مَنْ دَلَّ عَلَى خَيْرٍ فَلَهُ مِثْلُ أَجْرِ فَاعِلِهِ', r: 'رواه مسلم (1893)' },
    { t: 'الْمُسْلِمُ مَنْ سَلِمَ الْمُسْلِمُونَ مِنْ لِسَانِهِ وَيَدِهِ', r: 'متفق عليه (البخاري 10، مسلم 41)' },
    { t: 'لَيْسَ الشَّدِيدُ بِالصُّرَعَةِ، إِنَّمَا الشَّدِيدُ الَّذِي يَمْلِكُ نَفْسَهُ عِنْدَ الْغَضَبِ', r: 'متفق عليه (البخاري 6114، مسلم 2609)' },
    { t: 'يَسِّرُوا وَلَا تُعَسِّرُوا، وَبَشِّرُوا وَلَا تُنَفِّرُوا', r: 'متفق عليه (البخاري 69، مسلم 1734) واللفظ للبخاري' },
    { t: 'إِنَّ اللَّهَ رَفِيقٌ يُحِبُّ الرِّفْقَ فِي الْأَمْرِ كُلِّهِ', r: 'متفق عليه (البخاري 6927، مسلم 2165) واللفظ للبخاري' },
    { t: 'مَنْ لَا يَرْحَمِ النَّاسَ لَا يَرْحَمْهُ اللَّهُ', r: 'رواه مسلم (2319) واللفظ له' },
    { t: 'الْمُؤْمِنُ لِلْمُؤْمِنِ كَالْبُنْيَانِ يَشُدُّ بَعْضُهُ بَعْضًا', r: 'متفق عليه (البخاري 481، مسلم 2585) واللفظ لمسلم' },
    { t: 'اتَّقُوا النَّارَ وَلَوْ بِشِقِّ تَمْرَةٍ', r: 'متفق عليه (البخاري 1417، مسلم 1016)' },
    { t: 'إِنَّ اللَّهَ لَا يَنْظُرُ إِلَى صُوَرِكُمْ وَأَمْوَالِكُمْ، وَلَكِنْ يَنْظُرُ إِلَى قُلُوبِكُمْ وَأَعْمَالِكُمْ', r: 'رواه مسلم (2564)' },
    { t: 'الطُّهُورُ شَطْرُ الْإِيمَانِ', r: 'رواه مسلم (223)' },
    { t: 'مِنْ حُسْنِ إِسْلَامِ الْمَرْءِ تَرْكُهُ مَا لَا يَعْنِيهِ', r: 'رواه الترمذي (2317)' },
    { t: 'أَكْمَلُ الْمُؤْمِنِينَ إِيمَانًا أَحْسَنُهُمْ خُلُقًا', r: 'رواه أبو داود (4682) والترمذي (1162)' },
    { t: 'الرَّاحِمُونَ يَرْحَمُهُمُ الرَّحْمَنُ، ارْحَمُوا مَنْ فِي الْأَرْضِ يَرْحَمْكُمْ مَنْ فِي السَّمَاءِ', r: 'رواه الترمذي (1924) واللفظ له، وأبو داود (4941)' },
    // — adhkar du matin et du soir rapportés dans les hadiths (déplacés de la catégorie « versets ») —
    { lead: MORNING_LEAD, t: 'أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ', r: 'رواه مسلم (2723)' },
    { lead: MORNING_LEAD, t: 'اللَّهُمَّ بِكَ أَصْبَحْنَا، وَبِكَ أَمْسَيْنَا، وَبِكَ نَحْيَا، وَبِكَ نَمُوتُ، وَإِلَيْكَ النُّشُورُ', r: 'رواه الترمذي (3391)' },
    { t: 'مَنْ قَالَ حِينَ يُصْبِحُ وَحِينَ يُمْسِي: سُبْحَانَ اللَّهِ وَبِحَمْدِهِ مِائَةَ مَرَّةٍ، لَمْ يَأْتِ أَحَدٌ يَوْمَ الْقِيَامَةِ بِأَفْضَلَ مِمَّا جَاءَ بِهِ إِلَّا أَحَدٌ قَالَ مِثْلَ مَا قَالَ أَوْ زَادَ عَلَيْهِ', r: 'رواه مسلم (2692)' },
  ],
};
/** Texte à afficher pour une carte (rotation hebdomadaire / quotidienne, ou doua choisie) */
function cardTextOf(spec) {
  const list = CARD_TEXTS[spec.key]; if (!list) return null;
  if (spec.i != null) return list[spec.i % list.length];
  const n = Math.floor(spec.noon / DAY_MS);
  return list[(spec.key === 'jumuah' ? Math.floor(n / 7) : n) % list.length];
}
// Titre et formule en arabe (toujours affichés sur la carte)
const CARD_AR = {
  jumuah: ['جمعة مباركة', ''],
  white: ['الأيام البيض', 'تذكير بصيام الأيام البيض'],
  occNewYear: ['سنة هجرية مباركة', 'كل عام وأنتم بخير'],
  occAshura: ['يوم عاشوراء', 'تذكير بصيام يوم عاشوراء'],
  occMawlid: ['المولد النبوي الشريف', 'كل عام وأنتم بخير'],
  occIsra: ['ذكرى الإسراء والمعراج', 'كل عام وأنتم بخير'],
  occNisfShaban: ['ليلة النصف من شعبان', 'كل عام وأنتم بخير'],
  occRamadan: ['رمضان مبارك', 'تقبّل الله صيامكم وقيامكم'],
  occQadr: ['ليلة القدر', 'تقبّل الله منا ومنكم'],
  occFitr: ['عيد فطر مبارك', 'تقبّل الله منا ومنكم'],
  occArafa: ['يوم عرفة', 'تذكير بصيام يوم عرفة'],
  occAdha: ['عيد أضحى مبارك', 'تقبّل الله منا ومنكم'],
  morning: ['صباح الخير', 'صباحكم نور وبركة'],
  dua: ['دعاء', ''],
  hadith: ['حديث شريف', ''],
};
/** Nom à écrire sur une carte : rien par défaut ; le nom saisi seulement si l'utilisateur a coché « ajouter le nom de l'expéditeur ». */
const cardSender = () => (S().cardNoName === false ? (S().cardFrom || '').trim() : '');
function syncCardNameUi() {
  const add = S().cardNoName === false;                    // « ajouter le nom » : décoché par défaut
  $('#cardAddName').checked = add;
  $('#cardFromField').hidden = !add;
  $('#cardFrom').value = S().cardFrom || '';
}
/** Titre d'une occasion : « فاتح شهر جمادى الأولى » pour le 1er d'un mois ; les autres occasions n'ont pas de {m}. */
const occTitle = (o, h) => t(o.key, { m: t('hijriMonths')[h.m - 1] });
const arOccTitle = (key, h) => (AR_STRINGS[key] || '').replace('{m}', AR_STRINGS.hijriMonths[h.m - 1]);
const cardArTitle = sp => (sp.key === 'occMonth' ? arOccTitle('occMonth', sp.h) : (CARD_AR[sp.key] || [t(sp.key)])[0]);
// Salutation d'une carte du jour : « صباح الخير » jusqu'au Dhuhr du lieu, « مساء الخير » ensuite (et la nuit, avant le Fajr)
function greetKey(ts = now()) {
  const dh = state.today?.times?.Dhuhr, fj = state.today?.times?.Fajr;
  if (dh && fj) return ts >= fj && ts < dh ? 'morning' : 'evening';
  const hr = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz() }).format(ts));
  return hr >= 5 && hr < 12 ? 'morning' : 'evening';
}
// Une date d'occasion est « confirmée » tant qu'elle tombe dans un mois dont le début est connu (Maroc : annonce des Habous ; ailleurs : 30 jours).
// Au-delà, c'est une prévision calculée, qui peut bouger d'un jour : on l'écrit « متوقع ».
function isDateConfirmed(noon) {
  const hi = habousInfo();
  const horizon = habousActive() && hi ? (hi.last.day + 29) * DAY_MS : civilNoon(now(), tz()) + 30 * DAY_MS;
  return noon < horizon;
}
const isExpected = sp => sp.key !== 'jumuah' && !sp.evergreen && !isDateConfirmed(sp.noon);
const greetAr = k => (DICT_AR[k === 'morning' ? 'greetMorning' : 'greetEvening']);
const EVERGREEN = ['morning', 'dua', 'hadith'];
const DICT_AR = AR_STRINGS;
const kindKey = key => (key === 'dua' ? 'kindDua' : key === 'hadith' ? 'kindHadith' : 'kindVerse');   // verset | doua | hadith
const CARD_THEME = {
  green: ['#0B5D4B', '#12806A', '#E9C46A'],   // Joumou'a, Mawlid, nouvel an…
  night: ['#141F3D', '#3B2F63', '#E9C46A'],   // Ramadan, Qadr, jours blancs
  gold:  ['#5B2A1E', '#B5652E', '#FFE3A3'],   // Aïds
  teal:  ['#0E4A5C', '#1F7A8C', '#F3DDB0'],   // Achoura, Arafat (jeûne)
  dawn:  ['#1D4E6E', '#C9804A', '#FFE9B8'],   // (inutilisé)
  sky:   ['#5E9FD3', '#D9EAF4', '#0F2C45'],   // cartes du jour : ciel bleu clair + texte bleu nuit (comme l'écran des horaires)
};
const themeOf = key => (['occFitr', 'occAdha'].includes(key) ? 'gold'
  : ['occRamadan', 'occQadr', 'white', 'occNisfShaban'].includes(key) ? 'night'
  : ['occAshura', 'occArafa'].includes(key) ? 'teal' : ['morning', 'dua', 'hadith'].includes(key) ? 'sky' : 'green');
const cardSubLocal = (key, h) => (getLang() === 'ar' ? ''
  : key === 'occMonth' ? occTitle({ key }, h)
  : EVERGREEN.includes(key) ? t(greetKey() === 'morning' ? 'greetMorning' : 'greetEvening')
  : key === 'jumuah' ? t('cardJumuah') : key === 'white' ? t('cardWhite') : (t('cardSub') || {})[key] || t(key));

/** Liste des cartes disponibles à partir d'aujourd'hui */
function cardSpecs() {
  const off = S().hijriOffset, today = civilNoon(now(), tz());
  const out = [];
  // prochain vendredi (aujourd'hui si c'est vendredi)
  let fri = today; while (new Date(fri).getUTCDay() !== 5) fri += DAY_MS;
  out.push({ key: 'jumuah', noon: fri });
  // prochaine série de jours blancs
  for (let i = 0; i < 32; i++) {
    const noon = today + i * DAY_MS;
    if (isWhiteDay(hijriOf(noon, off))) {                // 1er jour blanc à venir, puis toute la série
      const list = upcomingWhiteDays(noon, off, 4);
      out.push({ key: 'white', noon: list[0].noon, list }); break;
    }
  }
  // occasions à venir (≈ 1 an)
  const seen = new Set();
  for (let i = 0; i < 370 && seen.size < OCCASIONS.length; i++) {
    const noon = today + i * DAY_MS, h = hijriOf(noon, off);
    const o = OCCASIONS.find(x => x.m === h.m && x.d === h.d);
    if (o && !seen.has(o.key)) { seen.add(o.key); out.push({ key: o.key, noon, h }); }
  }
  // prochain « فاتح الشهر » : 1er d'un mois sans fête propre (Mouharram, Ramadan et Chawwal ont déjà leur carte)
  for (let i = 0; i < 45; i++) {
    const noon = today + i * DAY_MS, h = hijriOf(noon, off);
    if (h.d === 1 && !OCCASIONS.some(o => o.m === h.m && o.d === 1)) { out.push({ key: 'occMonth', noon, h }); break; }
  }
  // Imsakiya du prochain Ramadan (ou du Ramadan en cours)
  for (let i = -30; i < 370; i++) {
    const noon = today + i * DAY_MS, h = hijriOf(noon, off);
    if (h.m === 9 && h.d === 1 && noon + 30 * DAY_MS >= today) { out.push({ key: 'imsakiya', noon, mon: hijriMonth(noon, off) }); break; }
  }
  out.sort((a, b) => a.noon - b.noon);
  // cartes de tous les jours (sans date)
  const day = Math.floor(today / DAY_MS);
  for (const k of ['morning', 'dua', 'hadith']) out.push({ key: k, i: day % CARD_TEXTS[k].length, noon: today, evergreen: true, pick: true });
  return out;
}

function wrapLines(g, text, maxW) {
  // les signes ﴿ ﴾ « » restent collés à leur mot (jamais seuls en début ou en fin de ligne)
  const words = [];
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (/^[﴾»]$/.test(w) && words.length) words[words.length - 1] += ' ' + w;
    else if (words.length && /^[﴿«]$/.test(words[words.length - 1])) words[words.length - 1] += ' ' + w;
    else words.push(w);
  }
  const wd = a => g.measureText(a.join(' ')).width, rows = []; let cur = [];
  for (const w of words) {
    if (cur.length && wd([...cur, w]) > maxW) { rows.push(cur); cur = [w]; } else cur.push(w);
  }
  if (cur.length) rows.push(cur);
  // équilibrer les deux dernières lignes : pas de mot seul sur la dernière
  while (rows.length > 1) {
    const a = rows[rows.length - 2], b = rows[rows.length - 1];
    if (a.length < 2) break;
    const a2 = a.slice(0, -1), b2 = [a[a.length - 1], ...b];
    if (wd(b2) <= maxW && (b.length < 2 || Math.abs(wd(b2) - wd(a2)) < Math.abs(wd(b) - wd(a)))) { rows[rows.length - 2] = a2; rows[rows.length - 1] = b2; } else break;
  }
  return rows.map(r => r.join(' '));
}
function drawStars(g, W, color) {                       // motif marocain discret (étoiles à 8 branches)
  g.save(); g.strokeStyle = color; g.globalAlpha = .10; g.lineWidth = 2;
  for (let y = 60; y < 560; y += 120) for (let x = (y / 120) % 2 ? 60 : 0; x < W + 60; x += 120) {
    for (const r of [0, Math.PI / 4]) { g.save(); g.translate(x, y); g.rotate(r); g.strokeRect(-26, -26, 52, 52); g.restore(); }
  }
  g.restore();
}
// Fonds marocains des cartes (silhouettes neutres, dessinées ici : aucune image externe).
// Unité : boîte 200 × 80, agrandie ×5,4 en bas de carte.
const CARD_SCENES = {
  koutoubia: ['M0 80V70h200v10ZM30 70V52h78v18ZM26 53h86l-7-7H33ZM112 70V14h20v56ZM114 14h16v-3h-2v-2h-3v2h-2v-2h-3v2h-2v-2h-3v2h-1ZM118 9V2h8v7ZM121 2V-4h2v6Z'],
  hassan2: [   // grande salle, minaret élancé à lanternon, flèche
    'M0 80V64h200v16ZM8 64V56h124v8ZM20 56V51h100v5ZM140 64V2h15v62ZM143 2V-8h9v10ZM141.5 -8h12l-6-4ZM146.9 -12V-21h1.2v9ZM145.3 -22h4.4v1h-4.4Z',
  ],
  kasbah: [    // mosquée rurale en pisé, minaret carré crénelé, palmiers, montagnes
    'M0 80V66h200v14ZM18 66V50h150v16ZM40 50V12h22v38ZM40 12V7h4v5ZM46 12V7h4v5ZM52 12V7h4v5ZM58 12V7h4v5ZM47 7V1h8v6ZM150 50V36h14v14ZM150 36V33h3v3ZM155.5 36V33h3v3ZM161 36V33h3v3Z',
    null,
    'M0 66L28 42L52 56L84 30L118 58L150 40L200 60V66Z',          // montagnes (plus pâles)
  ],
};
const SCENE_KEYS = [...Object.keys(CARD_SCENES), 'zellige'];
// Aléa « semé » par la date : la même carte garde le même fond et le même ordre toute la journée (aperçu = carte partagée), et tout change le lendemain.
function hash32(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const dayNumber = () => Math.floor(civilNoon(now(), tz()) / DAY_MS);
const sceneFor = spec => SCENE_KEYS[hash32(`${spec.key}|${spec.i ?? ''}|${EVERGREEN_KEYS.includes(spec.key) ? dayNumber() : Math.floor(spec.noon / DAY_MS)}`) % SCENE_KEYS.length];
const EVERGREEN_KEYS = ['morning', 'dua', 'hadith'];
function drawMosque(g, W, H, color, scene = 'koutoubia', k = 1) {  // silhouette en bas de carte
  if (scene === 'zellige') return;
  const [main, , far] = CARD_SCENES[scene];
  g.save(); g.fillStyle = color; g.translate(W / 2 - 540, H - 420); g.scale(5.4, 5.4);
  if (far) { g.globalAlpha = .06 * k; g.fill(new Path2D(far)); }
  g.globalAlpha = .13 * k; g.fill(new Path2D(main));
  g.restore();
}
/** Zellige de Fès : étoiles à 8 branches sur toute la carte (fond sans silhouette) */
function drawZellige(g, W, H, color) {
  g.save(); g.strokeStyle = color; g.lineWidth = 2;
  const s = 108;
  for (let y = 0; y < H + s; y += s) for (let x = 0; x < W + s; x += s) {
    g.save(); g.translate(x, y);
    g.globalAlpha = .10;
    for (const r of [0, Math.PI / 4]) { g.save(); g.rotate(r); g.strokeRect(-30, -30, 60, 60); g.restore(); }
    g.globalAlpha = .06; g.beginPath(); g.arc(0, 0, 13, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = .05; g.beginPath(); g.moveTo(30, 0); g.lineTo(s - 30, 0); g.moveTo(0, 30); g.lineTo(0, s - 30); g.stroke();
    g.restore();
  }
  g.restore();
}

/** Illustration d'Aïd, dessinée ici (aucune image externe) ; renvoie la hauteur utilisée. */
function drawEidArt(g, key, cx, top, accent) {
  g.save();
  if (key === 'occAdha') {                                   // le mouton
    const K = 1.2, cy = top + 170 * K, wool = '#FFF4DC', dark = '#2B1A12';
    g.translate(cx, cy); g.scale(K, K);
    g.fillStyle = 'rgba(0,0,0,.2)'; g.beginPath(); g.ellipse(0, 162, 190, 16, 0, 0, 7); g.fill();       // ombre
    g.fillStyle = dark;
    for (const x of [-92, -44, 58, 106]) { g.beginPath(); g.roundRect(x - 11, 80, 22, 82, 9); g.fill(); }  // pattes
    g.fillStyle = wool;
    for (const [x, y, r] of [[-110, 14, 60], [-62, -28, 64], [-6, -44, 66], [52, -34, 64], [104, 0, 60], [-96, 56, 56], [-40, 62, 60], [22, 62, 60], [80, 54, 54], [-24, 8, 72], [38, 12, 66]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(122,82,40,.28)'; g.lineWidth = 3;                                              // boucles de laine
    for (const [x, y, r] of [[-62, -28, 40], [-6, -44, 42], [52, -34, 40], [104, 0, 36], [-24, 8, 44], [38, 12, 40]]) { g.beginPath(); g.arc(x, y, r, Math.PI * 1.05, Math.PI * 1.9); g.stroke(); }
    g.fillStyle = wool; g.beginPath(); g.arc(176, 6, 22, 0, 7); g.fill();                                // queue
    g.save(); g.translate(-176, 20); g.rotate(-.12);                                                      // tête
    g.fillStyle = dark; g.beginPath(); g.ellipse(0, 0, 50, 62, 0, 0, 7); g.fill();
    g.fillStyle = '#3B261A'; g.beginPath(); g.ellipse(-24, 4, 22, 34, .5, 0, 7); g.fill();               // oreille
    g.beginPath(); g.ellipse(34, -34, 18, 30, -.5, 0, 7); g.fill();
    g.fillStyle = wool; g.beginPath(); g.arc(12, -24, 6.5, 0, 7); g.fill();                              // œil
    g.fillStyle = '#6A4630'; g.beginPath(); g.ellipse(-8, 42, 22, 14, 0, 0, 7); g.fill();                // museau
    g.strokeStyle = accent; g.lineWidth = 15; g.lineCap = 'round';                                       // cornes
    g.beginPath(); g.arc(30, -52, 34, Math.PI * .9, Math.PI * 2.15); g.stroke();
    g.beginPath(); g.arc(-4, -62, 34, Math.PI * 1.05, Math.PI * 2.3); g.stroke();
    g.restore();
    g.restore(); return 420;
  }
  // Aïd al-Fitr : emblème — rub el-hizb (deux carrés), croissant et étoile
  const K = 1.2, cy = top + 150 * K, R = 140;
  g.translate(cx, cy); g.scale(K, K);
  g.strokeStyle = accent; g.lineWidth = 5;
  g.globalAlpha = .9; g.beginPath(); g.arc(0, 0, R + 14, 0, 7); g.stroke();
  g.globalAlpha = .12; g.fillStyle = accent; g.beginPath(); g.arc(0, 0, R + 14, 0, 7); g.fill();
  g.globalAlpha = .85; g.lineWidth = 5;
  for (const rot of [0, Math.PI / 4]) { g.save(); g.rotate(rot); g.strokeRect(-R * .78, -R * .78, R * 1.56, R * 1.56); g.restore(); }
  g.globalAlpha = 1;
  g.fillStyle = accent; g.beginPath(); g.arc(-8, 0, 78, 0, 7); g.fill();                                // croissant
  g.save(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(18, -10, 66, 0, 7); g.fill(); g.restore();
  g.fillStyle = accent; g.beginPath();                                                                  // étoile à 8 branches
  for (let i = 0; i < 16; i++) { const r = i % 2 ? 11 : 26, a = i * Math.PI / 8 - Math.PI / 2; g.lineTo(52 + Math.cos(a) * r, -26 + Math.sin(a) * r); }
  g.closePath(); g.fill();
  g.restore(); return 372;
}

async function buildGreetingCard(spec) {
  await ensureCardFonts();
  const W = 1080, H = 1350, key = spec.key;
  const [c1, c2, accent] = CARD_THEME[themeOf(key)];
  const isSky = themeOf(key) === 'sky', ink = isSky ? accent : '#fff';   // ciel clair : texte bleu nuit
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  let g = cv.getContext('2d');
  const plex = (w, px) => `${w} ${px}px "IBM Plex Sans Arabic", system-ui, sans-serif`;
  const amiri = (w, px) => `${w} ${px}px Amiri, "IBM Plex Sans Arabic", serif`;
const warsh = px => `400 ${px}px WarshQ, Amiri, serif`;             // texte coranique : police Warsh du Complexe du Roi Fahd (une seule graisse)
  const kufi = px => `700 ${px}px "Reem Kufi", "IBM Plex Sans Arabic", sans-serif`;
  const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, c1); grad.addColorStop(1, c2);
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  // fond : Koutoubia, Hassan II, mosquée rurale ou zellige — change à chaque carte, le contenu ne bouge pas
  const scene = spec.scene || sceneFor(spec);
  const pat = isSky ? '#fff' : accent;
  if (scene === 'zellige') drawZellige(g, W, H, pat); else drawStars(g, W, pat);
  if (themeOf(key) === 'night') {                        // lune
    g.fillStyle = accent; g.globalAlpha = .9; g.beginPath(); g.arc(W - 170, 170, 70, 0, 7); g.fill();
    if (key !== 'white') { g.globalAlpha = 1; g.fillStyle = c1; g.beginPath(); g.arc(W - 140, 150, 62, 0, 7); g.fill(); }
    g.globalAlpha = 1;
  }
  if (isSky) drawMosque(g, W, H, '#5E9FD3', scene, 2.2); else drawMosque(g, W, H, '#fff', scene);
  // le contenu est dessiné sur un calque, puis centré verticalement au-dessus de la dédicace
  const base = g, layer = document.createElement('canvas'); layer.width = W; layer.height = H;
  g = layer.getContext('2d');
  let [arTitle, arLine] = CARD_AR[key] || [t(key), ''];
  if (key === 'occMonth') { arTitle = arOccTitle('occMonth', spec.h); arLine = '\u0634\u0647\u0631 \u0645\u0628\u0627\u0631\u0643 \u0633\u0639\u064a\u062f'; }   // « شهر مبارك سعيد »
  const txt0 = EVERGREEN.includes(key) ? cardTextOf(spec) : null;
  if (EVERGREEN.includes(key)) { arTitle = greetAr(spec.greet || greetKey()); arLine = DICT_AR[kindKey(key, txt0)]; }   // « صباح / مساء الخير » + آية، ذكر، دعاء ou حديث
  g.textAlign = 'center'; g.direction = 'rtl'; g.textBaseline = 'alphabetic';
  const top = 120; let y = top + (spec.evergreen ? 90 : 110);   // cartes du jour : titre plus haut
  g.fillStyle = isSky ? ink : accent; g.font = kufi(key === 'occMawlid' || key === 'occIsra' ? 84 : 112);
  g.fillText(arTitle, W / 2, y);
  y += 80;
  if (key === 'occNewYear' && spec.h) { g.font = amiri(700, 60); g.fillStyle = ink; g.fillText(`${spec.h.y} هـ`, W / 2, y); y += 70; }
  if (arLine) { g.font = amiri(400, 56); g.fillStyle = ink; g.fillText(arLine, W / 2, y); y += 70; }
  if (key === 'occAdha' || key === 'occFitr') { y += 24; y += drawEidArt(g, key, W / 2, y, accent) + 36; }   // mouton de l'Aïd al-Adha / emblème de l'Aïd al-Fitr
  // texte sourcé (verset, hadith, dhikr ou doua)
  const txt = cardTextOf(spec);
  if (txt) {
    const lead = key === 'hadith' || txt.lead ? (txt.lead || t('hadithLead')) : '';   // « قال رسول الله ﷺ » : on voit tout de suite que c'est un hadith
    const leadH = lead ? 76 : 0;
    const waqf = hasWaqf(txt.t);                              // signes de pause : un peu plus d'espace entre les lignes
    const QB = !!txt.q;                                       // verset : police Warsh, un peu plus grande et épaissie pour égaler le poids des textes en Amiri gras
    let size = QB ? 84 : 72, fs = size, lines, lh, boxH, b0;
    do {
      g.font = txt.q ? warsh(size) : amiri(700, size); fs = size; lines = wrapLines(g, txt.q ? `﴿ ${txt.t} ﴾` : `« ${txt.t} »`, W - (QB ? 250 : 200));   // verset : marges plus larges (le trait épaissi ne doit pas frôler le cadre)
      // b0 = distance haut de boîte → 1re ligne (marge haute confortable) ; 50 = reste sous la référence
      lh = Math.round((size + 4) * (waqf ? 1.75 : 1.5)); b0 = 46 + leadH + Math.round(size * .95); boxH = b0 + lines.length * lh + 50 + (txt.q ? 46 : 0); size -= 4;   // verset : une ligne de plus (riwaya et décompte)
    } while ((lines.length > 6 || boxH > (txt.q ? 690 : 640)) && size > 36);
    // cartes du jour : le texte sourcé est centré entre l'en-tête (titre) et le pied de carte
    if (spec.evergreen) y = Math.max(y, Math.round((340 + (H - 260)) / 2 - boxH / 2) + 10);
    const bt = y - 10;   // haut de la boîte
    g.fillStyle = isSky ? 'rgba(255,255,255,.58)' : 'rgba(255,255,255,.10)'; g.beginPath(); g.roundRect(70, bt, W - 140, boxH, 36); g.fill();
    if (isSky) { g.strokeStyle = 'rgba(15,44,69,.14)'; g.lineWidth = 2; g.stroke(); }
    if (lead) { g.save(); g.font = amiri(400, 44); g.fillStyle = isSky ? '#1B6E80' : accent; g.fillText(lead, W / 2, bt + 74); g.restore(); }
    g.fillStyle = ink; g.font = txt.q ? warsh(fs) : amiri(700, fs);
    lines.forEach((ln, i) => drawArabicLine(g, ln, W / 2, bt + b0 + i * lh, fs, px => (txt.q ? warsh(px) : amiri(400, px)), isSky ? '#1B6E80' : accent, QB ? Math.max(1.4, fs * 0.022) : 0));
    // la source, et pour le Coran la riwaya (le texte de l'appli est en Warsh 'an Nafi') ; la police baisse si la ligne est longue
    const refLine = txt.q ? txt.r : txt.r;
    let rs = 40; g.font = amiri(400, rs);
    while (rs > 26 && g.measureText(refLine).width > W - 240) { rs -= 2; g.font = amiri(400, rs); }
    g.fillStyle = isSky ? '#1B6E80' : accent;
    g.fillText(refLine, W / 2, bt + boxH - 44 - (txt.q ? 46 : 0));
    if (txt.q) {                                                // 2e ligne : « برواية ورش عن نافع — العدّ المدني الأخير المعتمد في المصحف المغربي »
      let ns = 31; g.font = amiri(400, ns);
      while (ns > 22 && g.measureText(t('riwayaWarsh')).width > W - 260) { ns -= 1; g.font = amiri(400, ns); }
      g.globalAlpha = .9; g.fillText(t('riwayaWarsh'), W / 2, bt + boxH - 44); g.globalAlpha = 1;
    }
    y += boxH + 50;
  }
  const sub = cardSubLocal(key, spec.h);
  g.direction = document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';
  if (sub && !spec.evergreen) { g.font = plex(500, 36); g.fillStyle = ink; g.globalAlpha = .92; g.fillText(sub, W / 2, y); g.globalAlpha = 1; y += 58; }
  // date(s) — pas de ville ni d'horaires : la carte peut être envoyée partout au Maroc
  const dateFmt = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  g.font = plex(400, 32); g.fillStyle = ink; g.globalAlpha = .88;
  if (key === 'white' && spec.list) {
    const df = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    spec.list.forEach(x => { g.fillText(`${df.format(x.noon)}${isExpected({ key: 'white', noon: x.noon }) ? ` (${t('expectedDate')})` : ''} · ${hijriLabel(x.h)}`, W / 2, y); y += 50; });
  } else if (!spec.evergreen) {
    g.fillText(dateFmt.format(spec.noon) + (isExpected(spec) ? ` (${t('expectedDate')})` : ''), W / 2, y); y += 48;
    g.fillText(hijriLabel(hijriOf(spec.noon, S().hijriOffset)), W / 2, y); y += 40;
  }
  g.globalAlpha = 1;
  const zoneTop = 90, zoneBottom = H - 270;            // entre le haut et la dédicace
  const dy = spec.evergreen && txt ? 0 : Math.max(zoneTop - top, Math.round((zoneTop + zoneBottom) / 2 - (top + y - 30) / 2));
  base.drawImage(layer, 0, dy);
  g = base; g.textAlign = 'center'; g.direction = 'rtl';   // le canevas hors écran est en LTR par défaut : pied de carte en arabe
  // dédicace (facultative) : « من: … »
  const from = cardSender();
  if (from) {
    g.direction = 'rtl'; g.font = amiri(700, 44); g.fillStyle = isSky ? ink : accent;
    g.fillText(`من: ${from}`, W / 2, H - 215);
  }
  // mention SaLaTi
  const fy = H - 150;
  if (isSky) { const bg = g.createLinearGradient(0, 0, W, 0); bg.addColorStop(0, '#0F4C5F'); bg.addColorStop(1, '#2A8497'); g.fillStyle = bg; }   // même bandeau que le bouton du doua
  else g.fillStyle = 'rgba(0,0,0,.22)';
  g.fillRect(0, fy - 20, W, 170);
  const icon = await new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = 'icons/icon-192.png?v=190'; });
  const rtl = document.documentElement.dir === 'rtl';
  const ix = rtl ? W - 60 - 90 : 60;
  if (icon) { g.save(); g.beginPath(); g.roundRect(ix, fy + 8, 90, 90, 20); g.clip(); g.drawImage(icon, ix, fy + 8, 90, 90); g.restore(); }
  g.textAlign = rtl ? 'right' : 'left';
  const tx = rtl ? W - 60 - 110 : 170;
  g.fillStyle = '#fff'; g.font = plex(700, 38); g.fillText('SaLaTi – صلاتي', tx, fy + 50);
  g.font = plex(400, 24); g.globalAlpha = .85; g.fillText(t('shareFooter').split(':').slice(1).join(':').trim(), tx, fy + 88);
  g.fillText('Google Play : SaLaTi', tx, fy + 118); g.globalAlpha = 1;
  return cv;
}

function cardText(spec) {
  let [arTitle, arLine] = CARD_AR[spec.key] || [t(spec.key), ''];
  if (spec.key === 'occMonth') { arTitle = arOccTitle('occMonth', spec.h); arLine = '\u0634\u0647\u0631 \u0645\u0628\u0627\u0631\u0643 \u0633\u0639\u064a\u062f'; }
  if (EVERGREEN.includes(spec.key)) { arTitle = greetAr(spec.greet || greetKey()); arLine = DICT_AR[kindKey(spec.key, cardTextOf(spec))]; }
  const sub = cardSubLocal(spec.key, spec.h);
  const icon = EVERGREEN.includes(spec.key) && (spec.greet || greetKey()) === 'morning' ? '\u2600\ufe0f' : spec.key === 'occAdha' ? '\ud83d\udc11' : '\ud83c\udf19';   // soleil le matin, croissant le soir, mouton pour l'Aïd al-Adha
  let txt = `${icon} ${arTitle}${arLine ? '\n' + arLine : ''}${sub ? '\n' + sub : ''}`;
  const body = cardTextOf(spec);
  if (body) txt += `\n\n${spec.key === 'hadith' || body.lead ? (body.lead || t('hadithLead')) + '\n' : ''}${body.q ? `﴿ ${body.t} ﴾` : `« ${body.t} »`}\n${body.r}${body.q ? ' · ' + t('riwayaWarsh') : ''}`;
  const from = cardSender();
  if (from) txt += `\n\nمن: ${from}`;
  return txt + `\n\n📱 ${t('shareFooter')}\n${PLAY_URL}`;
}

async function shareCard(spec) {
  if (spec.key === 'imsakiya') { return openMonthTable(spec.mon, 'ramadan'); }
  const text = cardText(spec);
  try {
    const cv = await buildGreetingCard(spec);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    const file = blob && new File([blob], `SaLaTi-${spec.key}-${new Date(spec.noon).toISOString().slice(0, 10)}.png`, { type: 'image/png' });
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'SaLaTi', text: shortShareText() });
    else if (navigator.share) await navigator.share({ title: 'SaLaTi', text });
    else if (file) {
      const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000); toast(t('shareImgOk'));
    } else { await navigator.clipboard.writeText(text); toast(t('copied')); }
  } catch (e) {
    if (e && e.name !== 'AbortError') { try { await navigator.clipboard.writeText(text); toast(t('copied')); } catch {} }
  }
}

function whenLabel(noon) {
  const n = Math.round((noon - civilNoon(now(), tz())) / DAY_MS);
  return n <= 0 ? t('todayWord') : n === 1 ? t('tomorrowWord') : t('inDays', { n });
}
// Ordre : cartes de tous les jours (sabah el-khir, doua, hadith), puis Joumou'a, puis le reste par date
const CARD_ORDER = ['morning', 'dua', 'hadith', 'jumuah'];
const cardRank = sp => { const i = CARD_ORDER.indexOf(sp.key); return i < 0 ? CARD_ORDER.length : i; };
const noWaqf = text => text.replace(/[\u06D6-\u06DC]/g, '');     // listes : sans signes de pause (ils se superposeraient à la ligne du dessus)
const preview = (text, n = 6) => { const w = noWaqf(text).split(/\s+/); return w.slice(0, n).join(' ') + (w.length > n ? ' …' : ''); };

/** Liste complète des textes d'une catégorie (fenêtre) : un toucher = aperçu de la carte */
function openPickAll(sp) {
  $('#pdTitle').textContent = categoryTitle(sp.key);
  $('#pdNote').hidden = !CARD_TEXTS[sp.key].some(x => x.q);          // listes de versets : rappel de la riwaya et du décompte
  const ul = $('#pdList'); ul.replaceChildren();
  CARD_TEXTS[sp.key].forEach((x, i) => {
    const item = document.createElement('li'), btn = document.createElement('button');
    btn.type = 'button'; btn.innerHTML = '<span class="pt"></span><small></small>'; btn.querySelector('.pt').classList.toggle('quran', !!x.q);
    btn.querySelector('.pt').textContent = x.q ? `\uFD3F ${noWaqf(x.t)} \uFD3E` : noWaqf(x.t);
    btn.querySelector('small').textContent = x.r;
    btn.addEventListener('click', () => { $('#pickDialog').close(); openCardPreview({ ...sp, i }); });
    item.append(btn); ul.append(item);
  });
  $('#pickDialog').showModal(); ul.scrollTop = 0;
}
const categoryTitle = key => (key === 'morning' ? t('cardsMorning') : getLang() === 'ar' ? (CARD_AR[key] || [t(key)])[0] : t(key === 'hadith' ? 'kindHadith' : 'kindDua'));
const cardTitleOf = sp => (sp.key === 'imsakiya' ? `${t('imsakiya')} ${sp.mon.y}`
  : sp.key === 'occMonth' ? occTitle(sp, sp.h)
  : getLang() === 'ar' ? (CARD_AR[sp.key] || [t(sp.key)])[0]
  : t({ jumuah: 'cardJumuah', white: 'whiteDays' }[sp.key] || sp.key));

// ---- Aperçus : la vraie carte, dessinée en petit (une à la fois, seulement quand elle devient visible)
const THUMB_W = 296, THUMB_H = 370;
const thumbQueue = []; let thumbBusy = false;
async function pumpThumbs() {
  if (thumbBusy) return; thumbBusy = true;
  while (thumbQueue.length) {
    const { sp, cv } = thumbQueue.shift();
    if (!cv.isConnected) continue;
    try {
      const full = await buildGreetingCard(sp);
      cv.width = THUMB_W; cv.height = THUMB_H;
      const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(full, 0, 0, THUMB_W, THUMB_H);
      cv.classList.add('ready');
    } catch { /* l'aperçu reste vide, la carte se partage quand même */ }
    await new Promise(r => setTimeout(r, 30));
  }
  thumbBusy = false;
}
let thumbObserver = null;
function watchThumb(cv, sp) {
  if (!('IntersectionObserver' in window)) { thumbQueue.push({ sp, cv }); pumpThumbs(); return; }
  thumbObserver = thumbObserver || new IntersectionObserver(entries => {
    entries.forEach(en => { if (en.isIntersecting) { const x = en.target.__job; thumbObserver.unobserve(en.target); thumbQueue.push(x); } });
    pumpThumbs();
  }, { rootMargin: '0px 240px 240px 240px' });
  cv.__job = { sp, cv }; thumbObserver.observe(cv);
}
function thumbButton(sp, label, caption) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'card-thumb';
  b.innerHTML = '<canvas width="8" height="10"></canvas><span class="ct-cap"><b></b><span></span></span>';
  b.querySelector('b').textContent = label; b.querySelector('.ct-cap span').textContent = caption || '';
  b.addEventListener('click', () => openCardPreview(sp));
  watchThumb(b.querySelector('canvas'), sp);
  return b;
}

// ---- Aperçu plein format + partage
async function paintPreview() {
  const sp = state.cdSpec; if (!sp) return;
  const box = $('#cdPreview'), stamp = (state.cdStamp = (state.cdStamp || 0) + 1);
  const cv = await buildGreetingCard(sp);
  if (stamp !== state.cdStamp) return;                       // une saisie plus récente a pris le relais
  cv.className = 'cd-canvas'; box.replaceChildren(cv);
}
function openCardPreview(sp) {
  if (sp.key === 'imsakiya') return shareCard(sp);
  if (EVERGREEN.includes(sp.key)) sp.greet = greetKey();
  state.cdSpec = sp;
  syncCardNameUi();
  $('#cdPreview').replaceChildren();
  $('#cardDialog').showModal();
  paintPreview();
}

function renderCards() {
  const df = new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const specs = cardSpecs();
  const body = $('#cardsBody'); body.replaceChildren();
  thumbQueue.length = 0;
  const section = (title, count, onAll) => {
    const sec = document.createElement('section'); sec.className = 'cards-sec';
    const head = document.createElement('div'); head.className = 'cards-sec-head';
    head.innerHTML = '<h2><span></span> <small class="cnt"></small></h2>';
    head.querySelector('h2 span').textContent = title; head.querySelector('.cnt').textContent = count != null ? String(count) : '';
    if (onAll) { const a = document.createElement('button'); a.type = 'button'; a.className = 'link-btn'; a.textContent = t('viewAll'); a.addEventListener('click', onAll); head.append(a); }
    const row = document.createElement('div'); row.className = 'hscroll';
    sec.append(head, row); return { sec, row };
  };
  // « bientôt » : Joumou'a, jours blancs, occasions (dont les deux Aïds), Imsakiya
  const soon = specs.filter(sp => !sp.evergreen), blocks = { soon: null, daily: [] };
  if (soon.length) {
    const { sec, row } = section(t('cardsSoon'), null, null); blocks.soon = sec;
    for (const sp of soon) {
      if (sp.key === 'imsakiya') {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'card-thumb imsak-tile';
        b.innerHTML = '<span class="it-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 10v10M15 10v10"/></svg></span><span class="ct-cap"><b></b><span></span></span>';
        b.querySelector('b').textContent = `${t('imsakiya')} ${sp.mon.y}`; b.querySelector('.ct-cap span').textContent = gregSpan(sp.mon);
        b.addEventListener('click', () => shareCard(sp)); row.append(b); continue;
      }
      row.append(thumbButton(sp, cardTitleOf(sp), `${df.format(sp.noon)} \u00b7 ${whenLabel(sp.noon)}${isExpected(sp) ? ` \u00b7 ${t('expectedDate')}` : ''}`));
    }
  }
  // chaque jour : versets et rappels, doua, hadith — 6 textes, puis « tout voir »
  for (const sp of specs.filter(x => x.evergreen)) {
    const list = CARD_TEXTS[sp.key];
    // texte du jour (rotation dans l'ordre de la liste), puis 5 autres tirés par la date
    const order = list.map((_, i) => i).filter(i => i !== sp.i), rnd = seeded(hash32(`${sp.key}|${dayNumber()}`));
    for (let k = order.length - 1; k > 0; k--) { const r = Math.floor(rnd() * (k + 1)); [order[k], order[r]] = [order[r], order[k]]; }
    const picks = [sp.i, ...order.slice(0, 5)];
    const { sec, row } = section(categoryTitle(sp.key), list.length, () => openPickAll(sp));
    for (const i of picks) {
      const spec = { ...sp, i, pick: true }, txt = list[i];
      row.append(thumbButton(spec, t(kindKey(sp.key, txt)), preview(txt.t, 5)));
    }
    const all = document.createElement('button'); all.type = 'button'; all.className = 'card-thumb all-tile';
    all.innerHTML = '<span class="at-n"></span><span class="ct-cap"><b></b></span>'; all.querySelector('.at-n').textContent = String(list.length); all.querySelector('b').textContent = t('viewAll');
    all.addEventListener('click', () => openPickAll(sp)); row.append(all);
    blocks.daily.push(sec);
  }
  // les plus utilisées d'abord ; une occasion imminente (aujourd'hui, demain, après-demain) passe devant
  const today = civilNoon(now(), tz());
  const urgent = soon.some(sp => sp.key !== 'imsakiya' && sp.noon - today <= 2 * DAY_MS);
  const ordered = urgent ? [blocks.soon, ...blocks.daily] : [...blocks.daily, blocks.soon];
  body.append(...ordered.filter(Boolean));
  $('#cardFrom').value = S().cardFrom || '';
}

// Pastille sur l'écran Horaires : vendredi, ou occasion aujourd'hui / demain
function renderOccChip() {
  const chip = $('#occChip'), row = $('#occRow'); if (!chip || !row) return;
  const today = civilNoon(now(), tz());
  const sp = cardSpecs().find(x => !x.evergreen && x.key !== 'white' && x.key !== 'imsakiya'
    && (x.key === 'jumuah' ? x.noon === today : x.noon - today <= DAY_MS));
  // vendredi / occasion : cette carte ; les autres jours : doua ou hadith du jour (en alternance)
  const daily = !sp && cardSpecs().find(x => x.key === (Math.floor(today / DAY_MS) % 2 ? 'hadith' : 'dua'));
  state.chipSpec = sp || daily || null;
  row.hidden = viewing() || !state.chipSpec;
  if (!state.chipSpec) return;
  $('#occTxt').textContent = sp
    ? `${cardArTitle(sp)} \u00b7 ${t('shareCard')}`
    : preview(cardTextOf(daily).t, 12);   // début du texte, sur deux lignes
  chip.setAttribute('aria-label', `${t('shareCard')} : ${$('#occTxt').textContent}`);
  chip.classList.toggle('daily', !sp);
  $('#occTxt').classList.toggle('quran', !!(daily && cardTextOf(daily)?.q));    // verset : police Warsh
}

function calShift(dir) {
  const mon = state.calMonth; if (!mon) return;
  state.calAnchor = dir > 0 ? mon.days.at(-1).noon + 864e5 : mon.days[0].noon - 864e5;
  renderCalendar();
}

// ================= Compte à rebours + événements =================
const countdown = new Countdown({
  onTick(remaining, tNow) {
    const ck = $('#clock'); if (ck) ck.textContent = fmtTime(tNow);
    if (state.elapsed) {
      const txt = '+' + formatHMS(Math.max(0, tNow - state.elapsed.ts)).replace(/^00:/, '');   // +19:05
      $('#countdown').textContent = txt;
      document.title = `${prayerLabel(state.elapsed.name, state.today.date)} ${txt}`;
    } else if (remaining != null) {
      $('#countdown').textContent = formatHMS(remaining);
      document.title = `${prayerLabel(state.next.name, state.next.day === 'today' ? state.today.date : addDays(state.today.date, 1))} ${formatHMS(remaining)}`;
    }
    // changement de jour dans le fuseau du lieu
    if (state.dayKey && dateKeyInTz(tNow, tz()) !== state.dayKey) { loadDays(); if (state.viewKey === state.dayKey) state.viewKey = null; renderAll(); refresh(); }
    checkEvents(tNow);
    if (tNow % 60000 < 1000) { renderHome(); renderSilent(); if (!$('#view-qibla').hidden) renderSun(); } // chaque minute
  },
  onReach() {
    // heure de la prière arrivée : période « +mm:ss » ; fin de cette période : prière suivante
    setTimeout(() => { computeNext(); renderHome(); }, 1100);
  },
});

function adhanFor(prayer) {
  if (S().adhan.mute && S().adhan.mute[prayer]) return 'none';   // cloche barrée : pas d'Adhan pour cette prière
  const a = S().adhan;
  return a.mode === 'perPrayer' ? a.perPrayer[prayer] : a.global;
}

const REM_KEY = 'priere.remFired';
function remAlreadyFired(id) { try { return JSON.parse(localStorage.getItem(REM_KEY) || '[]').includes(id); } catch { return false; } }
function remMarkFired(id) { try { const a = JSON.parse(localStorage.getItem(REM_KEY) || '[]'); a.push(id); localStorage.setItem(REM_KEY, JSON.stringify(a.slice(-30))); } catch { /* stockage indisponible */ } }

function checkEvents(tNow) {
  if (!state.today) return;
  const a = S().adhan;
  const events = [];
  for (const day of [state.today, state.tomorrow]) {
    for (const p of PRAYERS) {
      const ts = day.times[p];
      if (!ts) continue;
      events.push({ id: `${day.date}-${p}-at`, ts, p, type: 'at' });
      if (a.notifyBefore > 0) events.push({ id: `${day.date}-${p}-b${a.notifyBefore}`, ts: ts - a.notifyBefore * 60000, p, type: 'before' });
    }
  }
  // rappel des jours blancs : 30 min après Isha, la veille d'un jour blanc
  if (S().whiteDays && state.today.times.Isha) {
    const tomorrowNoon = civilNoon(now(), tz()) + 864e5;
    const h = hijriOf(tomorrowNoon, S().hijriOffset);
    if ([13, 14, 15].includes(h.d) && !(h.m === 12 && h.d === 13)) {
      events.push({ id: `${state.today.date}-white`, ts: state.today.times.Isha + 30 * 60000, type: 'white', h, win: 6 * 3600e3 });
    }
  }
  // vendredi : 15 min après le lever du soleil, « أكثروا من الصلاة على النبي ﷺ »
  if (S().fridayReminder !== false && state.today.times.Sunrise && isFridayKey(state.today.date)) {
    events.push({ id: `${state.today.date}-friday`, ts: state.today.times.Sunrise + 15 * 60000, type: 'friday', win: 5 * 3600e3 });
  }
  // rappels de la veille au soir (20 min après le Maghrib) : début de mois avec le doua, ou Aïd avec le takbir.
  // Au Maroc, seulement quand la date est officielle (annonce du ministère). Fenêtre de 6 h : l'annonce peut tomber tard.
  if (state.today.times.Maghrib) {
    const todayNoon = civilNoon(tNow, tz());
    const rem = reminderFor(todayNoon + 864e5, S().hijriOffset, { eid: S().eidReminder !== false, month: S().monthReminder !== false });
    if (rem) events.push({ id: `${state.today.date}-${rem.type}`, ts: state.today.times.Maghrib + 20 * 60000, win: 6 * 3600e3, ...rem });
    // soirée du 29 ou du 30 : on interroge le calendrier des Habous toutes les 10 min pour capter l'annonce
    else if (habousActive() && tNow >= state.today.times.Maghrib && hijriOf(todayNoon, S().hijriOffset).d >= 29) checkHabous(false, 10 * 60000);
  }
  for (const ev of events) {
    // fenêtre de 90 s : si l'appli s'est réveillée bien après, on ne rejoue pas un Adhan périmé
    if (tNow < ev.ts || tNow - ev.ts > (ev.win || 90000) || state.fired.has(ev.id)) continue;
    const once = ev.type === 'month' || ev.type === 'eid' || ev.type === 'white' || ev.type === 'friday';     // un seul envoi, même si l'appli est relancée
    if (once && remAlreadyFired(ev.id)) continue;
    if (once) remMarkFired(ev.id);
    state.fired.add(ev.id);
    sessionStorage.setItem('priere.fired', JSON.stringify([...state.fired].slice(-40)));
    fireEvent(ev);
  }
}

async function fireEvent(ev) {
  const a = S().adhan;
  if (ev.type === 'eid' || ev.type === 'month' || ev.type === 'white' || ev.type === 'friday') {
    const { title, body } = reminderText(t, ev);
    // avec le module Android récent, c'est lui qui envoie ces rappels (même appli fermée) : pas de doublon
    if (!nativeRem()) notify(title, body, { tag: ev.type, vibrateOn: !isSilent() && a.vibrate });
    toast(title, 6000);
    return;
  }
  const silent = isSilent();
  const name = prayerLabel(ev.p, dateKeyInTz(ev.ts, tz()));
  if (nativeActive() && ev.type !== 'white') {        // le module Android joue l'Adhan : pas de doublon
    if (ev.type === 'at') toast(`${t('itsTime')} ${name}`, 6000);
    return;
  }
  if (ev.type === 'before') {
    notify(name, t('beforeMsg', { n: a.notifyBefore }), { tag: `before-${ev.p}`, vibrateOn: a.vibrate });
    return;
  }
  const msg = `${t('itsTime')} ${name}`;
  if (a.notifyAt || silent) notify(msg, fmtTime(ev.ts), { tag: `at-${ev.p}`, vibrateOn: !silent && a.vibrate });
  if (silent) { toast(msg, 6000); return; }   // mode silencieux : ni son ni vibration
  if (a.vibrate) vibrate();
  if (a.enabled && adhanFor(ev.p) !== 'none') {
    $('#adhanAlertText').textContent = msg;
    $('#adhanAlert').hidden = false;
    const r = await playAdhan(adhanFor(ev.p), a.volume, { title: msg, ended: hideAdhanAlert, short: a.short });
    if (r === 'fallback' || r === 'beep') toast(t('adhanMissing'), 5000);
  }
}

// ================= Adhan téléphone fermé (module Android de l'application Play Store) =================
const TWA_PKG = 'io.github.webnour2026.salat';
// Seule l'application Android qui contient le module (version code ≥ 2) s'ouvre avec « native=1 ».
// L'ancienne version (sans module) ne doit jamais recevoir de demande : sinon Android ouvre le Play Store.
const isTwa = () => localStorage.getItem('priere.native') === '1';
const nativeActive = () => isTwa() && !!localStorage.getItem('priere.nativeAt');
const nativeRem = () => nativeActive() && localStorage.getItem('priere.nativeRem') === '1';   // le module envoie lui-même les rappels
function detectTwa() {
  const n = new URLSearchParams(location.search).get('native');
  if (n === '1') localStorage.setItem('priere.native', '1');
  if (n === '2') { localStorage.setItem('priere.native', '1'); localStorage.setItem('priere.nativeRem', '1'); }   // module ≥ v10 : rappels appli fermée
  if (n === '0') { localStorage.removeItem('priere.native'); localStorage.removeItem('priere.nativeRem'); }       // retour sans module : désactivé
  if (!isTwa()) { localStorage.removeItem('priere.nativeAt'); localStorage.removeItem('priere.nativeDirty'); localStorage.removeItem('priere.nativeRem'); }
  localStorage.removeItem('priere.twa');                     // ancien indicateur (v2.5.0)
}
// même règle que le workflow Android pour nommer les sons intégrés (res/raw)
const rawName = id => { let n = String(id).toLowerCase().replace(/[^a-z0-9_]/g, '_'); if (/^[0-9]/.test(n)) n = 'a_' + n; return n; };
function nativeSound(id) {
  if (id === 'none') return 'none';                                   // « Aucun » : notification sans son
  if (id === 'beep') return 'aaqib_court';                            // bip → Adhan court
  if (!id || String(id).startsWith('u:')) id = 'aaqib';               // Adhans importés → Adhan intégré
  return rawName(id) + (S().adhan.short ? '_court' : '');
}
async function nativePayload() {
  const loc = S().location; if (!loc) return null;
  const today = state.dayKey || dateKeyInTz(now(), tz());
  await Promise.all([...new Set([today.slice(0, 7), addDays(today, 31).slice(0, 7), addDays(today, 42).slice(0, 7)])].map(ym => ensureMonth(S(), ym).catch(() => false)));
  const times = [];
  for (let i = 0; i < 31; i++) {
    const d = getDay(S(), addDays(today, i));
    times.push(PRAYERS.map(k => Math.round((d.times[k] || 0) / 60000)));
  }
  const a = S().adhan;
  const su = S().silentUntil === -1 ? 32503680000000 : (S().silentUntil || 0);
  const rem = planNativeReminders({
    today, offset: S().hijriOffset, t,
    prefs: { eid: S().eidReminder !== false, month: S().monthReminder !== false, white: !!S().whiteDays, friday: S().fridayReminder !== false },
    addDays, dayInfo: key => { const d = getDay(S(), key); return d && d.times ? { Sunrise: d.times.Sunrise, Maghrib: d.times.Maghrib, Isha: d.times.Isha } : null; },
  });
  return {
    v: 2, base: new URL('.', location.href).href, rem, lat: +loc.lat.toFixed(5), lng: +loc.lng.toFixed(5), tz: tz(), method: S().method, school: S().school,
    off: getOffset(),   // téléphone déréglé : écart (ms) entre l'horloge du téléphone et l'heure réelle ; le module décale ses alarmes d'autant
    ol: S().officialLocality !== false, olc: S().officialLocalityCode ?? null,   // Maroc : localité officielle (collage automatique / choix manuel), pour le calcul de secours du module
    adj: S().adjust, en: !!a.enabled, na: !!a.notifyAt, nb: a.notifyBefore || 0, vib: !!a.vibrate, su, on: !!S().ongoing, gr: GRACE_MIN,
    hj: Array.from({ length: 31 }, (_, i) => fmtDates(Date.parse(`${addDays(today, i)}T12:00:00Z`)).hijri),
    ad: Object.fromEntries(PRAYERS.map(k => [k, a.enabled ? nativeSound(adhanFor(k)) : 'none'])),
    names: { ...Object.fromEntries(PRAYERS.map(k => [k, t(k)])), Jumuah: t('Jumuah') },   // Jumuah : nom du Dhuhr le vendredi
    txt: { itsTime: t('itsTime'), before: t('beforeMsg'), stop: t('stop'), ok: t('nativeOk'), city: loc.name || '',
           chAdhan: t('chAdhan'), chBefore: t('chBefore'), chSilent: t('chSilent'), chOngoing: t('chOngoing'), chReminder: t('chReminder') },
    times,
  };
}
async function syncNative({ ask = false, quiet = false, test = false } = {}) {
  if (!isTwa()) return;
  const payload = await nativePayload(); if (!payload) return;
  localStorage.setItem('priere.nativeAt', String(Date.now()));
  localStorage.setItem('priere.nativeOff', String(payload.off || 0));
  localStorage.removeItem('priere.nativeDirty');
  const q = `d=${encodeURIComponent(JSON.stringify(payload))}${ask ? '&ask=1' : ''}${quiet ? '&quiet=1' : ''}${test ? '&test=1' : ''}`;
  // si le module est absent, Android revient ici (native=0) au lieu d'ouvrir le Play Store
  const back = encodeURIComponent(`${location.origin}${location.pathname}?native=0#settings`);
  location.href = `intent://sync?${q}#Intent;scheme=salati;package=${TWA_PKG};S.browser_fallback_url=${back};end`;
  renderNative();
}
// Android n'accepte l'ouverture du module que lors d'un geste de l'utilisateur :
// sinon on note qu'une mise à jour est à faire, et on la fait au prochain toucher.
// L'horloge vient d'être (re)mesurée : on prévient l'utilisateur si son téléphone est déréglé, et on renvoie l'écart au module Android s'il a changé
function afterClockSync() {
  if (state.today) computeNext();
  renderCta();
  const last = Number(localStorage.getItem('priere.nativeOff') || 0);
  if (nativeActive() && Math.abs(getOffset() - last) > 5000) { localStorage.setItem('priere.nativeDirty', '1'); requestNativeSync(); }
}
function requestNativeSync() {
  if (!nativeActive()) return;
  if (navigator.userActivation ? navigator.userActivation.isActive : true) syncNative({ quiet: true });
  else localStorage.setItem('priere.nativeDirty', '1');
}
function nativeNeedsSync() {
  if (!nativeActive()) return false;
  if (localStorage.getItem('priere.nativeV') !== '4') { localStorage.setItem('priere.nativeV', '4'); localStorage.setItem('priere.nativeDirty', '1'); }   // 4 : la charge utile contient l'écart d'horloge
  const at = +localStorage.getItem('priere.nativeAt') || 0;
  return localStorage.getItem('priere.nativeDirty') === '1' || Date.now() - at > 5 * 864e5;
}
function renderNative() {
  const g = $('#nativeGroup'); if (!g) return;
  g.hidden = !isTwa();
  const lim = $('#limitsBox'); if (lim) lim.hidden = nativeActive();
  if (!isTwa()) return;
  const at = +localStorage.getItem('priere.nativeAt') || 0;
  $('#nativeStatus').textContent = at
    ? t('nativeOn', { d: new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short', timeZone: tz() }).format(at) })
    : t('nativeOff');
  $('#nativeStatus').className = 'native-status ' + (at ? 'ok' : '');
  $('#nativeSync').textContent = at ? t('nativeBtnUpdate') : t('nativeBtnOn');
}

// ================= Qibla =================
function currentDeclination() {
  const loc = S().location;
  if (!S().declAuto || !loc) return Number(S().declination) || 0;
  try { return wmmDeclination(loc.lat, loc.lng, 0); } catch { return Number(S().declination) || 0; }
}
const fmtDeg = (v, digits = 1) => v.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });

const compass = new Compass({
  onHeading(magnetic, { flat, source, accuracy, quality, mode }) {
    if (state.qibla == null) return;
    const heading = (magnetic + state.decl + 360) % 360; // → nord géographique
    // angle cumulé : la rose ne fait pas un tour complet entre 359° et 0°
    const target = -heading;
    state.roseAngle = state.roseAngle ?? target;
    state.roseAngle += ((target - state.roseAngle + 540) % 360) - 180;
    $('#rose').style.transform = `rotate(${state.roseAngle}deg)`;
    uprightLabels(state.roseAngle);
    $('#headingBig').textContent = Math.round(heading) % 360;
    setSensor(quality);
    $('#compassDebug').textContent = `${t('heading')} : ${fmtDeg(heading)}°`
      + (accuracy != null && accuracy >= 0 ? ` · ${t('accuracy')} ±${Math.round(accuracy)}°` : '') + ` · ${source}`;

    const diff = ((state.qibla - heading + 540) % 360) - 180; // −180…180
    // hystérésis : aligné sous 2°, désaligné au-delà de 4°
    const aligned = flat && Math.abs(diff) <= (compass.wasAligned ? 4 : 2);
    $('#dial').classList.toggle('aligned', aligned);
    $('#qiblaIcon').classList.toggle('on', aligned);
    uprightQibla();
    const msg = $('#compassMsg');
    if (!flat) { msg.textContent = t('notFlat'); msg.className = 'compass-msg alert-s'; }
    else if (aligned) { msg.textContent = t('aligned'); msg.className = 'compass-msg ok-s'; if (!compass.wasAligned) { vibrate(60); if (S().qiblaBeep !== false) playBeep(); } }
    else { msg.textContent = (mode === 'back' ? t('backMode') + ' · ' : '') + `${diff > 0 ? t('turnRight') : t('turnLeft')} \u2066${Math.round(Math.abs(diff))}°\u2069`; msg.className = 'compass-msg'; }
    compass.wasAligned = aligned;
  },
  onStatus(s) {
    compass.lastStatus = s;
    if (s === 'needTap') { setCompassMsg(t('tapToEnable'), ''); $('#compassStart').hidden = false; setSensor('off'); return; }
    const map = { unsupported: 'compassUnsupported', denied: 'compassDenied', nodata: 'compassBlocked', relative: 'compassRelative', blocked: 'compassBlocked' };
    if (map[s]) {
      $('#compassMsg').textContent = t(map[s]); $('#compassMsg').className = 'compass-msg alert-s';
      $('#rose').style.transform = ''; state.roseAngle = null; uprightLabels(0); uprightQibla(); $('#headingBig').textContent = '--';
      setSensor('off');
    }
    if (s === 'calibrate') setSensor('poor');
    $('#compassStart').hidden = s === 'ok' || s === 'calibrate';
    $('#sensorHelpBtn').hidden = !['blocked', 'nodata', 'denied'].includes(s);        // capteurs bloqués ou muets : aide pas à pas
    $('#manualNorth').hidden = !(s === 'relative' || compass.manual);                 // gyroscope seul : le nord se règle à la main (et se ré-règle)
    if (['blocked', 'nodata', 'denied', 'unsupported'].includes(s)) showQiblaAlternatives();   // sans boussole : soleil et angle sur boussole classique, déjà ouverts
  },
});

/** Appli installée (Play / « ajouter à l'écran d'accueil ») : pas de barre d'adresse, donc on passe par les réglages de Chrome. */
const inInstalledApp = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches
  || /[?&]source=twa\b/.test(location.search) || (document.referrer || '').startsWith('android-app://');
function showSensorHelp() {
  const steps = t(inInstalledApp() ? 'sensorHelpApp' : 'sensorHelpBrowser');
  $('#sensorHelpList').replaceChildren(...steps.map(s => { const li = document.createElement('li'); li.textContent = s; return li; }));
  $('#sensorHelpDlg').showModal();
}
/** Pas de capteur : on ouvre d'office « Plus de détails » (angle pour une boussole classique + vérification par le soleil). */
function showQiblaAlternatives(scroll = false) {
  const d = document.querySelector('.qibla-more'); if (!d) return;
  d.open = true; renderSun();
  requestAnimationFrame(() => { setFit(); if (scroll) document.querySelector('.sun-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
}
function setCompassMsg(text, cls) {
  const m = $('#compassMsg'); if (!m) return;
  m.textContent = text; m.className = `compass-msg ${cls || ''}`;
}

function setSensor(q) {
  if (state.sensorQ === q) return;
  state.sensorQ = q;
  $('#sensorRow').hidden = q === 'good';                    // capteur précis : rien à signaler
  $('#sensorDot').dataset.q = q;
  $('#calibrateBtn').hidden = q === 'off';                   // capteur muet : « calibrer » n'a pas de sens, l'aide d'activation suffit
  $('#sensorText').textContent = t({ good: 'sensorGood', fair: 'sensorFair', poor: 'sensorPoor', off: 'sensorOff' }[q]);
}

const RING_R = 130;                                      // rayon de l'anneau du cadran (voir index.html)
function buildDial() {
  const ns = 'http://www.w3.org/2000/svg';
  const ticks = $('#roseTicks');
  for (let a = 0; a < 360; a += 15) {
    if (a % 90 === 0) continue;                            // les points cardinaux ont leur lettre
    const len = a % 45 === 0 ? 11 : 6;
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1', 0); l.setAttribute('x2', 0); l.setAttribute('y1', -(RING_R - 3)); l.setAttribute('y2', -(RING_R - 3 - len));
    l.setAttribute('transform', `rotate(${a})`);
    l.setAttribute('class', a % 45 === 0 ? 'rtick major' : 'rtick');
    ticks.append(l);
  }
  renderDialLabels();
}
// L'icône de la Kaaba reste droite à l'écran pendant que la rose tourne
function uprightQibla() {
  const ic = $('#qiblaIcon'); if (!ic) return;
  ic.setAttribute('transform', `translate(0 ${-RING_R}) rotate(${-((state.roseAngle || 0) + (state.qibla || 0))})`);
}
function renderDialLabels() {
  const ns = 'http://www.w3.org/2000/svg';
  const names = { fr: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'], en: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], ar: ['شمال', '', 'شرق', '', 'جنوب', '', 'غرب', ''] }[getLang()];
  $('#roseLabels').replaceChildren(...names.map((n, i) => n && (() => {
    const a = i * 45, r = 92;
    const x = Math.sin(a * Math.PI / 180) * r, y = -Math.cos(a * Math.PI / 180) * r;
    const tx = document.createElementNS(ns, 'text');
    tx.setAttribute('x', x.toFixed(1)); tx.setAttribute('y', y.toFixed(1));
    tx.dataset.x = x.toFixed(1); tx.dataset.y = y.toFixed(1);
    tx.setAttribute('class', i === 0 ? 'rlabel n' : 'rlabel');
    tx.textContent = n;
    return tx;
  })()).filter(Boolean));
  uprightLabels(state.roseAngle || 0);
}
// Les lettres restent droites à l'écran (lisibles, surtout en arabe) pendant que la rose tourne
function uprightLabels(roseAngle) {
  document.querySelectorAll('#roseLabels text').forEach(tx => {
    tx.setAttribute('transform', `rotate(${-roseAngle} ${tx.dataset.x} ${tx.dataset.y})`);
  });
}

function renderQibla() {
  const loc = S().location;
  if (!loc) return;
  state.qibla = qiblaBearing(loc.lat, loc.lng);
  state.decl = currentDeclination();
  $('#qiblaCity').textContent = loc.name || `${loc.lat.toFixed(2)}, ${loc.lng.toFixed(2)}`;
  $('#qiblaDeg').textContent = `${fmtDeg(state.qibla)}°`;
  $('#qiblaCardinal').textContent = t('cardinals')[cardinalIndex(state.qibla)];
  const mag = (state.qibla - state.decl + 360) % 360;
  $('#qiblaMag').textContent = `${fmtDeg(mag)}° (${t('declShort')} ${state.decl >= 0 ? '+' : ''}${fmtDeg(state.decl)}°)`;
  $('#qiblaDist').textContent = `${Math.round(distanceToKaaba(loc.lat, loc.lng)).toLocaleString(locale())} km`;
  $('#qiblaMark').setAttribute('transform', `rotate(${state.qibla})`);
  uprightQibla();
  if (!state.sensorQ) setSensor('off');
  renderSun();
  if (!Compass.isSupported()) compass.onStatus('unsupported');
}

/**
 * Petit bonhomme vu de dessus : il part face au soleil (mode « front ») ou dos au soleil (mode « back »), puis pivote de `angle`° (droite > 0)
 * jusqu'à la Qibla, marquée par la Kaaba. Animation en boucle (SMIL), figée si l'utilisateur a demandé moins d'animations.
 */
function drawSunFigure(mode, angle, label, svg = $('#sunFig')) {
  if (!svg) return;
  const R = 60, RS = 90, rad = angle * Math.PI / 180, kx = 100 + R * Math.sin(rad), ky = 100 - R * Math.cos(rad);   // Kaaba sur l'anneau, soleil en dehors
  const ax = 100 + 36 * Math.sin(rad), ay = 100 - 36 * Math.cos(rad);
  const angDist = (p, q) => Math.abs(((p - q + 540) % 360) - 180);
  let mx = 100, my = 52, bestD = 1e9;                                   // étiquette d'angle : position libre la plus proche de la bissectrice
  for (let c = 0; c < 360; c += 45) {
    const px = 100 + 50 * Math.sin(toRad(c)), py = 100 - 50 * Math.cos(toRad(c));
    if (angDist(c, 0) < 30 || angDist(c, angle) < 30 || Math.hypot(px - kx, py - ky) < 30) continue;   // ni sur la flèche, ni sur le pointillé, ni sur la Kaaba
    const d = angDist(c, angle / 2); if (d < bestD) { bestD = d; mx = px; my = py + 4; }
  }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches, val = Math.round(angle * 10) / 10;
  const sunY = mode === 'back' ? 100 + RS : 100 - RS;
  const rays = Array.from({ length: 8 }, (_, i) => `<line x1="0" y1="-12" x2="0" y2="-17" transform="rotate(${i * 45})"/>`).join('');
  const anim = reduce ? '' : `<animateTransform attributeName="transform" type="rotate" calcMode="spline" values="0 100 100;0 100 100;${val} 100 100;${val} 100 100;0 100 100" keyTimes="0;.2;.5;.85;1" keySplines="0 0 1 1;.4 0 .2 1;0 0 1 1;.4 0 .2 1" dur="6s" repeatCount="indefinite"/>`;
  svg.innerHTML = `
    <circle class="sf-ring" cx="100" cy="100" r="${R}"/>
    ${mode === 'walk' ? '' : `<line class="sf-sunline" x1="100" y1="${mode === 'back' ? sunY - 18 : sunY + 18}" x2="100" y2="${mode === 'back' ? 118 : 82}"/>
    <g class="sf-sun" transform="translate(100 ${sunY})"><circle r="9"/><g>${rays}</g></g>`}
    ${Math.abs(val) >= 3 ? `<path class="sf-arc" d="M100 ${100 - 36}A36 36 0 0 ${val > 0 ? 1 : 0} ${ax.toFixed(1)} ${ay.toFixed(1)}"/>` : ''}
    <line class="sf-dash" x1="100" y1="100" x2="${kx.toFixed(1)}" y2="${ky.toFixed(1)}"/>
    <g class="sf-kaaba" transform="translate(${kx.toFixed(1)} ${ky.toFixed(1)})"><circle r="13"/><path d="M0-7 9-2.5 0 2-9-2.5Z" fill="#4A4F54"/><path d="M-9-2.5 0 2V10L-9 5.5Z" fill="#2B2E31"/><path d="M9-2.5 0 2V10L9 5.5Z" fill="#1B1D1F"/><path d="M-9 0 0 4.5 9 0v2L0 6.5-9 2Z" fill="#C9962B"/></g>
    ${Math.abs(val) >= 3 ? `<text class="sf-deg" x="${mx.toFixed(1)}" y="${my.toFixed(1)}" text-anchor="middle" direction="ltr">${Math.abs(val).toLocaleString(locale(), { maximumFractionDigits: 1 })}\u00b0</text>` : ''}
    <g class="sf-man" ${reduce ? `transform="rotate(${val} 100 100)"` : ''}>${anim}
      <rect class="sf-body" x="76" y="98" width="48" height="20" rx="10"/>
      <circle class="sf-head" cx="100" cy="106" r="10.5"/>
      <path class="sf-nose" d="M100 91.5l-4.5 6.5h9z"/>
      <path class="sf-gaze" d="M100 86V60M92 69l8-10 8 10"/>
    </g>`;
  svg.setAttribute('viewBox', mode === 'walk' ? '0 14 200 172' : mode === 'back' ? '-8 32 216 176' : '-8 -8 216 176');   // cadre resserré : pas de grand vide autour du dessin
  svg.setAttribute('aria-label', label || ''); svg.removeAttribute('hidden');       // (la propriété `hidden` n'existe pas sur un <svg> : il faut l'attribut)
}

// ---- Qibla en marchant : le cap vient du GPS (sens de déplacement), sans boussole ni caméra ----
const walk = { id: null, fixes: [], heads: [], t0: 0, timer: null };
const toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI;
const bearingBetween = (p, q) => { const f1 = toRad(p.lat), f2 = toRad(q.lat), dl = toRad(q.lng - p.lng); return (toDeg(Math.atan2(Math.sin(dl) * Math.cos(f2), Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl))) + 360) % 360; };
const metersBetween = (p, q) => { const f1 = toRad(p.lat), f2 = toRad(q.lat), df = f2 - f1, dl = toRad(q.lng - p.lng), s = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(s)); };
const circMean = list => (toDeg(Math.atan2(list.reduce((s, x) => s + Math.sin(toRad(x)), 0), list.reduce((s, x) => s + Math.cos(toRad(x)), 0))) + 360) % 360;
function walkOnFix(pos) {
  const c = pos.coords, fix = { lat: c.latitude, lng: c.longitude, acc: c.accuracy || 99 };
  let h = null;
  if (Number.isFinite(c.heading) && Number.isFinite(c.speed) && c.speed >= 0.8) h = c.heading;                  // cap fourni par le GPS (déplacement réel)
  else {                                                                                                         // sinon : direction entre deux positions assez éloignées
    const ref = walk.fixes.find(f => metersBetween(f, fix) >= 15 && f.acc <= 20 && fix.acc <= 20);
    if (ref) h = bearingBetween(ref, fix);
    else { walk.fixes.push(fix); if (walk.fixes.length > 8) walk.fixes.shift(); }
  }
  if (h === null) { $('#walkMsg').textContent = Date.now() - walk.t0 < 4000 ? t('walkWait') : t('walkMove'); return; }
  walk.heads.push(h); if (walk.heads.length > 3) walk.heads.shift();
  const heading = circMean(walk.heads), turn = ((state.qibla - heading + 540) % 360) - 180;                    // < 0 : la Qibla est à gauche
  walk.last = { h: heading, at: Date.now() };                                                                    // sert aussi à régler le nord d'un téléphone à gyroscope
  const line2 = Math.abs(turn) < 8 ? t('walkAligned') : t(turn > 0 ? 'walkTurnR' : 'walkTurnL', { d: fmtDeg(Math.abs(turn)) });
  const text = `${t('walkNow', { h: Math.round(heading) })} ${line2}`;
  $('#walkMsg').textContent = text;
  drawSunFigure('walk', turn, text, $('#walkFig'));
}
function stopWalk() {
  if (walk.id !== null) navigator.geolocation.clearWatch(walk.id);
  clearTimeout(walk.timer); walk.id = null;
  const b = $('#walkBtn'); if (b) { b.textContent = t('walkStart'); b.classList.add('btn-primary'); }
}
function toggleWalk() {
  if (walk.id !== null) { stopWalk(); return; }
  if (!navigator.geolocation) { $('#walkMsg').textContent = t('walkDenied'); return; }
  walk.fixes = []; walk.heads = []; walk.last = null; walk.t0 = Date.now();
  $('#walkMsg').textContent = t('walkWait'); $('#walkBtn').textContent = t('walkStop'); $('#walkBtn').classList.remove('btn-primary');
  walk.id = navigator.geolocation.watchPosition(walkOnFix, e => { stopWalk(); $('#walkMsg').textContent = t('walkDenied'); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  walk.timer = setTimeout(stopWalk, 3 * 60 * 1000);                                                              // s'arrête seul après 3 min (batterie)
}

function renderSun() {
  const loc = S().location; if (!loc || state.qibla == null) return;
  const tNow = now();
  const sp = sunPosition(tNow, loc.lat, loc.lng);
  if (sp.elevation > 0) {
    $('#sunNow').textContent = t('sunNow', { az: fmtDeg(sp.azimuth), el: fmtDeg(sp.elevation) });
    const d = ((state.qibla - sp.azimuth + 540) % 360) - 180;         // > 0 : la Qibla est à droite du soleil
    if (Math.abs(d) >= 135) {
      // soleil presque dans le dos (typiquement au Maroc : coucher du soleil, Qibla vers l'est) : plus parlant de lui tourner le dos
      const r = ((state.qibla - (sp.azimuth + 180) + 540) % 360) - 180;
      $('#sunRel').textContent = Math.abs(r) < 3 ? t('sunBack') : t(r > 0 ? 'sunBehindR' : 'sunBehindL', { d: fmtDeg(Math.abs(r)) });
      drawSunFigure('back', r, $('#sunRel').textContent);
    } else {
      $('#sunRel').textContent = t('sunRel', { d: fmtDeg(Math.abs(d)), side: d > 0 ? t('toRight') : t('toLeft') });
      drawSunFigure('front', d, $('#sunRel').textContent);
    }
  } else {
    $('#sunNow').textContent = t('sunDown'); $('#sunRel').textContent = t('sunNightTip'); const fg = $('#sunFig'); if (fg) fg.setAttribute('hidden', '');   // la nuit : pas de soleil à montrer
  }
  // journée dans le fuseau du lieu : de Fajr à Isha si connus, sinon ±12 h
  const day = state.today?.times;
  const from = day?.Fajr ?? tNow - 12 * 36e5, to = day?.Isha ?? tNow + 12 * 36e5;
  const items = [
    ...timesAtAzimuth(state.qibla, loc.lat, loc.lng, from, to).map(ts => ({ ts, key: 'faceSun' })),
    ...timesAtAzimuth((state.qibla + 180) % 360, loc.lat, loc.lng, from, to).map(ts => ({ ts, key: 'shadow' })),
  ].sort((a, b) => a.ts - b.ts);
  $('#sunTimes').replaceChildren(...(items.length ? items.map(({ ts, key }) => {
    const li = document.createElement('li');
    li.textContent = t(key, { t: fmtTime(ts) }) + (ts < tNow ? ` ${t('sunPast')}` : '');
    if (ts < tNow) li.className = 'past';
    return li;
  }) : [Object.assign(document.createElement('li'), { textContent: t('sunNone'), className: 'past' })]));
}

// ================= Réglages =================
// Maroc : localité officielle la plus proche et choix « horaire de la localité » / « position exacte »
function renderOfficialLocality() {
  const s = S(), box = $('#maOfficial'), lang = getLang();
  box.hidden = Number(s.method) !== 21;
  const code = s.officialLocalityCode ?? null, chosen = code != null ? localityByCode(Number(code)) : null;
  const names = allLocalities().map(l => [localityName(l, lang), l.code]).sort((a, b) => a[0].localeCompare(b[0], lang === 'ar' ? 'ar' : 'fr'));
  $('#sLocalityPick').replaceChildren(new Option(t('officialLocalityAuto'), ''), new Option(t('officialLocalityExact'), 'exact'), ...names.map(([n, c]) => new Option(n, c)));
  $('#sLocalityPick').value = chosen ? String(chosen.code) : (s.officialLocality === false ? 'exact' : '');
  // une seule ligne, et seulement si elle apprend quelque chose : on s'est collé à une AUTRE localité que le lieu de l'utilisateur
  const loc = s.location, n = loc && nearestLocality(loc.lat, loc.lng);
  const show = !chosen && s.officialLocality !== false && !!n && n.km <= SNAP_KM && !sameLocalityName(loc.name, n);
  $('#officialLocalityInfo').hidden = !show;
  $('#officialLocalityInfo').textContent = show ? t('officialLocalityNear', { name: localityName(n, lang) }) : '';
}

function renderSettings() {
  const s = S();
  const loc = s.location;
  const lri = x => `\u2066${x}\u2069`;   // chiffres isolés : plus de signe « moins » collé du mauvais côté
  $('#locSummary').textContent = loc
    ? (loc.name
        ? `${loc.source === 'gps' ? t('gpsAuto') : t('manualCity')} \u2014 ${loc.name}${loc.accuracy ? ` \u00b7 \u00b1${lri(`${loc.accuracy} m`)}` : ''}`
        : `${t('gpsAuto')} \u2014 ${lri(`${loc.lat.toFixed(3)}, ${loc.lng.toFixed(3)}`)}`)
    : t('chooseCity');

  // « Moonsighting Committee » (id 15) : méthode britannique / nord-américaine, nom trompeur en arabe et calcul hors ligne approximatif :
  // retirée de la liste, sauf pour celui qui l'a déjà choisie
  $('#sMethod').replaceChildren(...METHOD_IDS.filter(id => id !== 15 || Number(s.method) === 15).map(id => new Option(t('methods')[id], id, false, id === s.method)));
  $('#sSchool').value = String(s.school);
  renderOfficialLocality();

  const PR = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  const fmtAdj = v => v ? `${v > 0 ? '+' : '\u2212'}${Math.abs(v)} ${t('minShort')}` : '0';
  const setAdj = (k, v) => { s.adjust[k] = Math.max(-30, Math.min(30, v)); save(); loadDays(); renderHome(); };
  $('#adjustGrid').replaceChildren(...PR.map(k => {
    const row = document.createElement('div'); row.className = 'adj-row';
    row.innerHTML = '<span></span><button type="button" class="adj-btn" data-d="-1">\u2212</button><span class="adj-val"></span><button type="button" class="adj-btn" data-d="1">+</button>';
    row.firstChild.textContent = t(k);
    const val = row.querySelector('.adj-val'), paint = () => { const v = s.adjust[k] || 0; val.textContent = fmtAdj(v); val.classList.toggle('zero', !v); };
    paint();
    row.querySelectorAll('.adj-btn').forEach(b => b.addEventListener('click', () => { setAdj(k, (s.adjust[k] || 0) + Number(b.dataset.d)); paint(); }));
    return row;
  }));
  const reset = $('#adjReset'); if (reset) { reset.onclick = () => { PR.forEach(k => { s.adjust[k] = 0; }); save(); loadDays(); renderHome(); renderSettings(); }; reset.hidden = !PR.some(k => s.adjust[k]); }

  const a = s.adhan;
  $('#sAdhanOn').checked = a.enabled;
  document.querySelectorAll('input[name="adhanMode"]').forEach(r => { r.checked = r.value === a.mode; });
  renderAdhanPickers();
  $('#sVolume').value = a.volume;
  $('#sVibrate').checked = a.vibrate;
  $('#sAdhanShort').checked = !!a.short;
  renderNative();
  $('#sWhiteDays').checked = s.whiteDays;
  $('#sMonthReminder').checked = s.monthReminder !== false;
  $('#sEidReminder').checked = s.eidReminder !== false;
  $('#sFridayReminder').checked = s.fridayReminder !== false;
  renderSettingsHub();
  renderCredits();
  renderCustomAdhan();
  const ver = $('#appVersion'); if (ver) ver.textContent = `Version ${APP_VERSION}`;
  if (!state.adhanAvail) availableAdhans().then(av => { state.adhanAvail = av; renderAdhanPickers(); });
  $('#sNotifyAt').checked = a.notifyAt;
  $('#sNotifyBefore').replaceChildren(...[0, 5, 10, 15].map(n => new Option(n ? `${n} ${t('minBefore')}` : t('none'), n, false, n === a.notifyBefore)));
  updateNotifWarn();

  document.querySelectorAll('input[name="lang"]').forEach(r => { r.checked = r.value === s.lang; });
  document.querySelectorAll('input[name="theme"]').forEach(r => { r.checked = r.value === s.theme; });
  $('#sHijri').value = s.hijriOffset > 0 ? `+${s.hijriOffset}` : String(s.hijriOffset);
  $('#sHijriSrc').value = s.hijriSource || 'auto';
  const hi = habousInfo(), info = $('#hijriSrcInfo');
  if (info) {
    info.textContent = habousActive() && hi
      ? t('hijriInfoHabous', { d: new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(hi.last.day * 864e5 + 12 * 36e5) })
      : t('hijriInfoCalc');
  }
  $('#sTz').value = s.tzMode || 'auto';
  $('#sOngoing').checked = !!s.ongoing;
  $('#sQiblaBeep').checked = s.qiblaBeep !== false;
  $('#sDeclAuto').checked = s.declAuto;
  $('#sDecl').disabled = s.declAuto;
  const dv = Number(currentDeclination());
  $('#sDecl').value = s.declAuto ? (Number.isFinite(dv) ? dv.toFixed(1) : '') : s.declination;   // valeur numérique (un champ numérique refuse « 1,0° O »)
  $('#clockOffset').textContent = `\u2066${getOffset() >= 0 ? '+' : '\u2212'}${Math.abs(Math.round(getOffset() / 1000))} s\u2069`;   // isolé : le signe reste du bon côté
}

// Auteurs et licences des Adhans : fichier généré par le workflow « Télécharger les Adhans »
async function renderCredits() {
  const ul = $('#audioCredits'); if (!ul) return;
  try {
    const r = await fetch('audio/adhan/credits.json', { cache: 'no-cache' });
    if (!r.ok) throw 0;
    const list = await r.json();
    // on n'affiche que les Adhans réellement proposés (un credits.json ancien peut contenir des Adhans retirés)
    const shown = list.filter(c => !RETIRED.includes(c.id) && ADHANS.some(x => x.id === c.id && x.file));
    ul.replaceChildren(...shown.map(c => {
      const li = document.createElement('li');
      const item = ADHANS.find(x => x.id === c.id);
      li.textContent = `${item ? t(item.labelKey) : c.id} — ${c.author || '?'}, ${c.license || ''} `;
      if (c.url) { const a = document.createElement('a'); a.href = c.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = c.source || 'source'; li.append(a); }
      return li;
    }));
  } catch { ul.replaceChildren(); }
}

function renderCustomAdhan() {
  const ul = $('#customList'); if (!ul) return;
  const list = customAdhans();
  if (!list.length) { ul.replaceChildren(Object.assign(document.createElement('li'), { className: 'note', textContent: t('noCustom') })); return; }
  ul.replaceChildren(...list.map(x => {
    const li = document.createElement('li');
    const name = document.createElement('span'); name.textContent = x.label.replace(/^★ /, '');
    const size = document.createElement('small'); size.textContent = ` ${(x.size / 1e6).toFixed(1)} Mo`;
    const play = document.createElement('button'); play.type = 'button'; play.className = 'icon-btn'; play.textContent = '▶'; play.setAttribute('aria-label', t('preview'));
    play.addEventListener('click', async () => {
      if (play.dataset.on) { stopAdhan(); return; }
      unlockAudio(); play.dataset.on = '1'; play.textContent = '■';
      await playAdhan(x.id, S().adhan.volume, { title: x.label, ended: () => { delete play.dataset.on; play.textContent = '▶'; } });
    });
    const del = document.createElement('button'); del.type = 'button'; del.className = 'icon-btn'; del.textContent = '🗑'; del.setAttribute('aria-label', t('removeAdhan'));
    del.addEventListener('click', async () => {
      if (!confirm(t('deleteQ', { name: name.textContent }))) return;
      await removeCustomAdhan(x.id);
      sanitizeAdhans(); renderCustomAdhan(); renderAdhanPickers();
    });
    li.append(name, size, play, del);
    return li;
  }));
}

function adhanOptions(selected) {
  const av = state.adhanAvail || {};
  // on masque les Adhans absents du site (sauf celui déjà choisi, pour que l'utilisateur le voie)
  return ADHANS.filter(x => x.custom || !(x.file && av[x.id] === false) || x.id === selected).map(x => new Option((x.labelKey ? t(x.labelKey) : x.label) + (x.file && av[x.id] === false ? ` (${t('adhanUnavailable')})` : ''), x.id, false, x.id === selected));
}
function renderAdhanPickers() {
  const a = S().adhan;
  const keys = a.mode === 'perPrayer' ? PRAYERS : ['global'];
  $('#adhanPickers').replaceChildren(...keys.map(k => {
    const wrap = document.createElement('div'); wrap.className = 'picker';
    const label = document.createElement('label'); label.className = 'field';
    const span = document.createElement('span'); span.textContent = k === 'global' ? t('adhanSound') : t(k);
    const sel = document.createElement('select');
    sel.append(...adhanOptions(k === 'global' ? a.global : a.perPrayer[k]));
    sel.addEventListener('change', () => { if (k === 'global') a.global = sel.value; else a.perPrayer[k] = sel.value; save(); });
    label.append(span, sel);
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'btn small'; btn.textContent = t('preview');
    btn.addEventListener('click', async () => {
      if (btn.dataset.playing) { stopAdhan(); delete btn.dataset.playing; btn.textContent = t('preview'); return; }
      unlockAudio();
      const reset = () => { delete btn.dataset.playing; btn.textContent = t('preview'); };
      const r = await playAdhan(sel.value, a.volume, { title: t('adhanSound'), ended: reset, short: a.short });
      if (r === 'fallback' || r === 'beep') toast(t('adhanMissing'), 5000);
      if (r !== 'none') { btn.dataset.playing = '1'; btn.textContent = t('stop'); }
    });
    wrap.append(label, btn);
    return wrap;
  }));
}

function updateNotifWarn() {
  const w = $('#notifWarn');
  const p = notifPermission();
  const wants = S().adhan.notifyAt || S().adhan.notifyBefore > 0;
  w.hidden = nativeActive() || !(wants && (p === 'denied' || p === 'unsupported'));
  w.textContent = t('notifDenied');
}

async function ensureNotifPermission() {
  const p = await requestNotifPermission();
  updateNotifWarn();
  return p === 'granted';
}

function bindSettings() {
  on('#changeLoc', 'click', openLocationDialog);
  on('#sMethod', 'change', e => { S().method = Number(e.target.value); S().methodAuto = false; save(); renderOfficialLocality(); refresh(); checkOfficiel(true); });
  on('#sLocalityPick', 'change', e => {
    const v = e.target.value, exact = v === 'exact';
    S().officialLocality = !exact; S().officialLocalityCode = v && !exact ? Number(v) : null;   // Automatique | position exacte | localité choisie
    save(); renderOfficialLocality(); refresh(); checkOfficiel(true);
  });
  on('#sSchool', 'change', e => { S().school = Number(e.target.value); save(); refresh(); });
  on('#sAdhanOn', 'change', e => { S().adhan.enabled = e.target.checked; save(); if (e.target.checked) unlockAudio(); renderCta(); renderHome(); });
  on('#ctaAdhanBtn', 'click', enableAdhan);
  on('#prayerList', 'click', e => {
    const b = e.target.closest('.bell'); if (!b) return;
    const a = S().adhan;
    if (!a.enabled) return enableAdhan();                                  // Adhan coupé partout : on le réactive d'abord
    a.mute = a.mute || {};
    if (a.mute[b.dataset.k]) delete a.mute[b.dataset.k]; else a.mute[b.dataset.k] = true;
    save(); renderHome(); requestNativeSync();
  });
  on('#sAdhanMode', 'change', e => { S().adhan.mode = e.target.value; save(); renderAdhanPickers(); });
  on('#sVolume', 'input', e => { S().adhan.volume = Number(e.target.value); save(); });
  on('#sFridayReminder', 'change', async e => { S().fridayReminder = e.target.checked; save(); if (e.target.checked) await ensureNotifPermission(); });
  on('#sEidReminder', 'change', async e => { S().eidReminder = e.target.checked; save(); if (e.target.checked) await ensureNotifPermission(); });
  on('#sMonthReminder', 'change', async e => { S().monthReminder = e.target.checked; save(); if (e.target.checked) await ensureNotifPermission(); });
  on('#sWhiteDays', 'change', async e => { S().whiteDays = e.target.checked; save(); renderWhite(); if (e.target.checked) await ensureNotifPermission(); });
  on('#sVibrate', 'change', e => { S().adhan.vibrate = e.target.checked; save(); if (e.target.checked) vibrate(80); });
  on('#sAdhanShort', 'change', e => { S().adhan.short = e.target.checked; save(); });
  on('#nativeSync', 'click', () => syncNative({ ask: true }));
  on('#notifYes', 'click', () => { localStorage.setItem('priere.notifAsked', '1'); $('#notifDialog').close(); syncNative({ ask: true }); });
  on('#notifLater', 'click', () => { localStorage.setItem('priere.notifAsked', '1'); $('#notifDialog').close(); });
  // tout réglage modifié (geste de l'utilisateur) → le module Android est mis à jour
  on('#view-settings', 'change', () => requestNativeSync());
  on('#silentDialog', 'click', () => setTimeout(requestNativeSync, 50));
  on('#sNotifyAt', 'change', async e => {
    S().adhan.notifyAt = e.target.checked; save();
    if (e.target.checked) await ensureNotifPermission(); else updateNotifWarn();
  });
  on('#sNotifyBefore', 'change', async e => {
    S().adhan.notifyBefore = Number(e.target.value); save();
    if (S().adhan.notifyBefore > 0) await ensureNotifPermission(); else updateNotifWarn();
  });
  on('#testNotif', 'click', async () => {
    if (nativeActive()) { syncNative({ quiet: true, test: true }); return; }   // test via le module Android
    if (await ensureNotifPermission()) notify(`${t('itsTime')} ${t('Asr')}`, fmtTime(now()), { tag: 'test', vibrateOn: S().adhan.vibrate });
  });
  on('#sLang', 'change', e => { S().lang = e.target.value; save(); applyLang(); renderAll(); renderSettings(); renderQibla(); });
  on('#sTheme', 'change', e => { S().theme = e.target.value; save(); applyTheme(); });
  on('#sOngoing', 'change', e => { S().ongoing = e.target.checked; save(); });   // resynchro via #view-settings
  on('#sTz', 'change', e => {
    S().tzMode = e.target.value; save();
    state.viewKey = null; loadDays(); renderAll(); refresh();   // le module Android est resynchronisé par le « change » de #view-settings
  });
  on('#sHijri', 'change', e => { S().hijriOffset = Number(e.target.value); save(); rerenderHijri(); });
  on('#sHijriSrc', 'change', e => { S().hijriSource = e.target.value; save(); rerenderHijri(); renderSettings(); });
  on('#sDecl', 'change', e => { S().declination = Math.max(-30, Math.min(30, Number(String(e.target.value).replace(',', '.')) || 0)); save(); state.decl = currentDeclination(); });
  on('#sQiblaBeep', 'change', e => { S().qiblaBeep = e.target.checked; save(); if (e.target.checked) playBeep(); });   // aperçu du bip à l'activation
  document.addEventListener('pointerdown', () => unlockAudio(), { once: true, capture: true });                        // le navigateur exige un geste avant le premier son
  on('#sDeclAuto', 'change', e => { S().declAuto = e.target.checked; save(); state.decl = currentDeclination(); renderSettings(); });
  on('#syncBtn', 'click', async () => { await syncClock(); afterClockSync(); renderSettings(); });
  on('#clearBtn', 'click', () => $('#clearDialog').showModal());
  on('#clearConfirm', 'click', () => { clearMonths(); toast(t('cleared')); refresh(); });   // le bouton « Annuler » ferme simplement la boîte
  on('#clockWarnClose', 'click', () => { try { localStorage.setItem(CW_KEY, JSON.stringify({ at: Date.now(), off: getOffset() })); } catch { /* sans stockage : fermé jusqu'au prochain affichage */ } $('#clockWarn').hidden = true; });
  on('#settingsHub', 'click', e => { const r = e.target.closest('.hub-row'); if (r) showSettingsPage(r.dataset.page, { push: true }); });
  document.querySelectorAll('.spage-back').forEach(b => b.addEventListener('click', () => { if (history.state?.spage) history.back(); else showSettingsPage(null); }));
  window.addEventListener('popstate', () => {
    if ($('#view-settings').hidden) return;
    const m = location.hash.match(/^#settings\/(\w+)$/); showSettingsPage(m ? m[1] : null, { silent: true });
  });
}

// ================= Service worker =================
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  // une nouvelle version activée → on recharge une seule fois pour l'utiliser en entier
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    // vérifie les mises à jour à chaque retour dans l'appli
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) toast(t('installed'), 6000);
      });
    });
  }).catch(err => console.warn('SW', err));
}

// ================= Démarrage =================
function bind() {
  document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => go(b.dataset.goto)));
  on('#placeBtn', 'click', openLocationDialog);
  on('#langBtn', 'click', () => {
    S().lang = { fr: 'ar', ar: 'en', en: 'fr' }[S().lang] || 'fr';
    save(); applyLang(); renderAll();
    if (!$('#view-settings').hidden) renderSettings();
    if (!$('#view-qibla').hidden) renderQibla();
    if (!$('#view-cards').hidden) renderCards();
    if (!$('#view-calendar').hidden) renderCalendar();
  });
  on('#gpsBtn', 'click', useGps);
  on('#citySearch', 'input', onSearch);
  on('#compassStart', 'click', async () => { unlockAudio(); await compass.start(); });
  on('#calibrateBtn', 'click', () => $('#calDialog').showModal());
  on('#sensorHelpBtn', 'click', showSensorHelp);
  const setNorth = ref => { const ok = compass.calibrateTo(ref); $('#mnState').textContent = ok ? t('mnDone') : t('mnRetry'); if (ok) $('#manualNorth').hidden = false; };
  on('#mnNorth', 'click', () => setNorth(0));
  on('#mnWalk', 'click', () => {                                                                       // « je fais face à mon sens de marche » (cap GPS récent)
    if (!walk.last || Date.now() - walk.last.at > 90000) { $('#mnState').textContent = t('mnNoWalk'); return; }
    setNorth(walk.last.h);
  });
  on('#mnSun', 'click', () => {
    const loc = S().location, sp = loc && sunPosition(now(), loc.lat, loc.lng);
    if (!sp || sp.elevation < 3) { $('#mnState').textContent = t('mnNoSun'); return; }              // trop bas ou sous l'horizon : le calcul n'aide pas
    setNorth(sp.azimuth);
  });
  on('#walkBtn', 'click', toggleWalk);
  document.querySelector('.qibla-more')?.addEventListener('toggle', () => requestAnimationFrame(setFit));   // le contenu change de hauteur : on re-vérifie
  on('#sensorHelpSun', 'click', () => { $('#sensorHelpDlg').close(); showQiblaAlternatives(true); });
  on('#adhanStop', 'click', () => { stopAdhan(); hideAdhanAlert(); });
  on('#adhanSilent', 'click', () => { stopAdhan(); hideAdhanAlert(); renderSilent(); $('#silentDialog').showModal(); });
  on('#silentBtn', 'click', () => { renderSilent(); $('#silentDialog').showModal(); });
  document.querySelectorAll('[data-silent]').forEach(b => b.addEventListener('click', () => { setSilent(b.dataset.silent); $('#silentDialog').close(); }));
  on('#calPrev', 'click', () => calShift(-1));
  on('#calNext', 'click', () => calShift(1));
  on('#calToday', 'click', () => { state.calAnchor = null; renderCalendar(); });
  on('#calMonthTable', 'click', () => openMonthTable());
  on('#occChip', 'click', () => { const sp = state.chipSpec; if (sp) shareCard(sp); else go('cards'); });
  on('#occMore', 'click', () => go('cards'));
  on('#settingsBtn', 'click', () => go('settings'));
  on('#monthPrint', 'click', printMonthTable);
  on('#monthShare', 'click', shareMonthTable);
  on('#cardAddName', 'change', e => {
    S().cardNoName = !e.target.checked; save();                                     // décochée (défaut) : envoi sans nom
    $('#cardFromField').hidden = !e.target.checked;
    if (e.target.checked) setTimeout(() => $('#cardFrom').focus(), 50);            // cochée : on demande le nom, le clavier s'ouvre dessus
    paintPreview();
  });
  on('#cardFrom', 'change', e => { S().cardFrom = e.target.value.trim().slice(0, 40); save(); paintPreview(); });
  on('#cardFrom', 'input', e => { clearTimeout(state.cdTimer); state.cdTimer = setTimeout(() => { S().cardFrom = e.target.value.trim().slice(0, 40); save(); paintPreview(); }, 350); });
  on('#cdClose', 'click', () => $('#cardDialog').close());
  on('#cdShare', 'click', () => { if (state.cdSpec) shareCard(state.cdSpec); });
  on('#dayShare', 'click', shareDay);
  on('#dayPrev', 'click', () => shiftDay(-1));
  on('#dayNext', 'click', () => shiftDay(1));
  on('#dayToday', 'click', () => showDay(null));
  bindSwipe();
  // l'audio ne peut démarrer qu'après un premier geste de l'utilisateur
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('online', () => { state.online = true; refresh(); syncClock().then(afterClockSync); });
  window.addEventListener('offline', () => { state.online = false; renderHome(); });
  on('#noLocCity', 'click', openLocationDialog);
  on('#noLocGps', 'click', useGps);
  on('#customImport', 'click', () => $('#customFile').click());
  on('#customFile', 'change', async e => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    if (!files.length) return;
    const hadNone = !customAdhans().length;
    let ok = 0, firstId = null, lastErr = null;
    for (const f of files) {
      try { const id = await importCustomAdhan(f); firstId = firstId || id; ok++; }
      catch (err) { lastErr = err; }
    }
    await loadCustomAdhans();
    // premier import : on sélectionne directement le premier Adhan importé
    if (ok && hadNone && S().adhan.mode !== 'perPrayer') { S().adhan.global = firstId; save(); }
    renderCustomAdhan(); renderAdhanPickers();
    if (ok) toast(t('importedN', { n: ok }), 6000);
    if (lastErr) toast(t({ type: 'importErrType', size: 'importErrSize' }[lastErr.message] || 'importErrDecode'), 6000);
  });
  bindSettings();
}

// un Adhan choisi autrefois mais retiré de la liste (ex. « sham ») → Mosquée Hassan II
function sanitizeAdhans() {
  const a = S().adhan, ok = id => ADHANS.some(x => x.id === id);
  let changed = false;
  if (!ok(a.global)) { a.global = DEFAULT_ADHAN; changed = true; }
  for (const k of Object.keys(a.perPrayer)) if (!ok(a.perPrayer[k])) { a.perPrayer[k] = DEFAULT_ADHAN; changed = true; }
  if (changed) save();
}

export const APP_VERSION = '2.12.19';

// Garde-fou largeur : aucune vue ne doit rester décalée sur le côté (Chrome peut faire défiler
// horizontalement un conteneur même quand le débordement est masqué).
function lockHorizontal() {
  const reset = el => { if (el && el.scrollLeft !== 0) el.scrollLeft = 0; };
  const all = () => { reset(document.scrollingElement); document.querySelectorAll('main, .view').forEach(reset); };
  document.querySelectorAll('main, .view').forEach(el => el.addEventListener('scroll', () => reset(el), { passive: true }));
  window.addEventListener('resize', all);
  window.addEventListener('orientationchange', all);
  all();
}

function init() {
  lockHorizontal();
  detectTwa();
  document.addEventListener('click', () => { if (nativeNeedsSync()) syncNative({ quiet: true }); }, { capture: true });
  Promise.all([loadCustomAdhans(), loadSiteAdhans()]).then(([{ migratedTo }]) => {
    const a = S().adhan;
    if (migratedTo) {       // ancien emplacement unique « custom » → nouvel identifiant
      if (a.global === 'custom') a.global = migratedTo;
      for (const k of Object.keys(a.perPrayer)) if (a.perPrayer[k] === 'custom') a.perPrayer[k] = migratedTo;
      save();
    }
    sanitizeAdhans(); renderCustomAdhan(); state.adhanAvail = null; renderAdhanPickers();
    availableAdhans().then(av => { state.adhanAvail = { ...av }; renderAdhanPickers(); });
    renderCredits();
  });
  // premier lancement : langue de l'appareil (arabe si le téléphone est en arabe)
  if (!localStorage.getItem('priere.settings.v1')) {
    const dev = (navigator.language || 'fr').slice(0, 2);
    S().lang = ['ar', 'fr', 'en'].includes(dev) ? dev : 'fr';
    save();
  }
  // Adhans retirés de la liste (anciennes versions) → Adhan marocain
  // (les Adhans importés « u:… » et l'ancien « custom » sont vérifiés après leur chargement)
  // (les Adhans du site et importés sont vérifiés après leur chargement)
  const fix = v => (RETIRED.includes(v) || !v ? DEFAULT_ADHAN : v);
  S().adhan.global = fix(S().adhan.global);
  for (const k of Object.keys(S().adhan.perPrayer)) S().adhan.perPrayer[k] = fix(S().adhan.perPrayer[k]);
  save();
  initHabous(); applyHijriSource();      // calendrier officiel du Maroc (liste intégrée + copie locale)
  applyTheme();
  applyLang();
  buildDial();
  bind();
  registerSW();
  countdown.start();

  const [view, page] = (location.hash || '#home').slice(1).split('/');
  if (view === 'settings' && page) state.pendingPage = page;
  go(['home', 'qibla', 'calendar', 'cards', 'settings'].includes(view) ? view : 'home');
  renderNoLoc();

  if (!S().location) {
    // premier lancement : on demande la position GPS
    useGps();
  } else {
    loadDays(); renderAll();   // affichage immédiat depuis le cache
    refresh();
    // position GPS : on la rafraîchit discrètement si l'utilisateur est en mode GPS
    if (S().location.source === 'gps') {
      getGpsPosition().then(p => {
        const o = S().location;
        if (Math.hypot(p.lat - o.lat, p.lng - o.lng) > 0.02) useGps();
        else { o.accuracy = p.accuracy; save(); }
      }).catch(() => {});
    }
  }
  syncClock().then(afterClockSync);
  checkHabous();       // nouveau début de mois annoncé ? (au plus une vérification toutes les 3 h)
  checkOfficiel();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkHabous(); checkOfficiel(); } });
  setTimeout(askNotifFirstRun, 2500);
}

// Premier lancement de l'appli Android : proposer tout de suite l'autorisation des notifications
// (Android exige un geste de l'utilisateur, d'où la fenêtre avec un bouton).
function askNotifFirstRun(tries = 0) {
  if (!isTwa() || nativeActive() || localStorage.getItem('priere.notifAsked')) return;
  if (document.querySelector('dialog[open]')) { if (tries < 10) setTimeout(() => askNotifFirstRun(tries + 1), 3000); return; }
  $('#notifDialog').showModal();
}

try { init(); } finally {
  window.__appStarted = true;
  requestAnimationFrame(() => document.body.classList.remove('booting'));   // retire l'écran de démarrage
}

export { buildGreetingCard, cardSpecs, greetKey, nativePayload, cardTextOf };   // utilisés aussi par les tests visuels
