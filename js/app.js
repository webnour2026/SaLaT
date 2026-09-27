import { t, setLang, locale, getLang } from './i18n.js';
import { loadSettings, saveSettings, clearMonths, PRAYERS } from './storage.js';
import { now, syncClock, getOffset } from './clock.js';
import { ensureMonths, ensureMonth, getDay, findNext, dateKeyInTz, addDays, deviceTz } from './prayer-times.js';
import { Countdown, formatHMS } from './countdown.js';
import { qiblaBearing, distanceToKaaba, cardinalIndex } from './qibla.js';
import { Compass } from './compass.js';
import { formatHijri } from './hijri.js';
import { declination as wmmDeclination } from './wmm.js';
import { sunPosition, timesAtAzimuth } from './sun.js';
import { ADHANS, playAdhan, stopAdhan, unlockAudio, vibrate, notify, requestNotifPermission, notifPermission, availableAdhans, importCustomAdhan, removeCustomAdhan, loadCustomAdhans, customAdhans, loadSiteAdhans, DEFAULT_ADHAN, RETIRED } from './adhan.js';
import { hijriMonth, upcomingWhiteDays, civilNoon, hijriOf, OCCASIONS, isWhiteDay } from './calendar.js';
import { PRESET_CITIES, METHOD_BY_COUNTRY, getGpsPosition, reverseGeocode, searchCity } from './location.js';

const $ = sel => document.querySelector(sel);
// branche un écouteur sans planter si l'élément n'existe pas (ancien index.html en cache, etc.)
function on(sel, ev, fn, opts) {
  const el = document.querySelector(sel);
  if (el) el.addEventListener(ev, fn, opts); else console.warn('Élément absent :', sel);
}
const METHOD_IDS = [21, 3, 5, 4, 1, 2, 13, 12, 19, 18, 8, 16, 15];
const LIST_ROWS = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
const EXTRA_ROWS = ['Imsak', 'Sunset', 'Midnight'];

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
const tz = () => effectiveTz(S().location?.tz || deviceTz());

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
function go(view) {
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== `view-${view}`; });
  document.querySelectorAll('.tabbar button').forEach(b => {
    if (b.dataset.goto === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  document.body.classList.toggle('fit', view !== 'settings');   // écran ajusté, sans défilement
  requestAnimationFrame(() => document.querySelectorAll('main, .view').forEach(el => { el.scrollLeft = 0; }));
  if (view !== 'qibla') compass.stop();
  if (view === 'qibla') {
    renderQibla();
    // démarrage automatique ; sur iPhone, un toucher n'est demandé que si Safari ne l'a pas déjà autorisé
    setCompassMsg(t('compassSearching'), '');
    compass.start({ ask: !Compass.needsPermission() });
  }
  if (view === 'settings') renderSettings();
  if (view === 'calendar') { state.calAnchor = null; renderCalendar(); }
  window.scrollTo({ top: 0 });
  history.replaceState(null, '', `#${view}`);
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

function setLocation(loc) {
  const old = S().location;
  S().location = { ...loc, ts: Date.now() };
  // un changement de lieu important invalide le fuseau connu
  if (old && Math.abs(old.lng - loc.lng) > 3) S().location.tz = loc.tz || deviceTz();
  save(); renderHeader(); refresh();
  if (!$('#view-qibla').hidden) renderQibla();
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

function computeNext() {
  state.next = findNext(state.today, state.tomorrow, now());
  countdown.setTarget(state.next.ts);
}

function skyFor(t) {
  const d = state.today?.times; if (!d) return 'day';
  if (t < d.Fajr || t >= d.Isha) return 'night';
  if (t < d.Sunrise + 30 * 60000) return 'fajr';
  if (t < d.Asr) return 'day';
  if (t < d.Maghrib - 20 * 60000) return 'asr';
  return 'maghrib';
}

function renderAll() { renderHeader(); renderHome(); renderWhite(); renderOccChip(); renderSilent(); }

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
    li.querySelector('.name').textContent = t(k);
    li.querySelector('.time').textContent = fmtTime(day.times[k]);
    return li;
  });
  $('#prayerList').replaceChildren(...rows);
  $('#extraTimes').replaceChildren(...EXTRA_ROWS.map(k => {
    const div = document.createElement('div');
    div.innerHTML = '<dt></dt><dd></dd>';
    div.firstChild.textContent = t(k);
    div.lastChild.textContent = fmtTime(day.times[k]);
    return div;
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

  $('#nextLabel').textContent = t('nextPrayer');
  $('#nextName').textContent = t(next.name);
  $('#nextTime').textContent = fmtTime(next.ts) + (next.day === 'tomorrow' ? ` · ${t('tomorrow')}` : '');
  $('#nextAt').textContent = fmtTime(next.ts);
  $('#arch').dataset.sky = skyFor(tNow);

  const rows = LIST_ROWS.map(k => {
    const ts = state.today.times[k];
    const li = document.createElement('li');
    const isPrayer = PRAYERS.includes(k);
    const isNext = next.day === 'today' && next.name === k;
    const past = ts <= tNow;
    li.className = [past ? 'past' : '', isNext ? 'next' : '', !isPrayer ? 'minor' : '', current === k ? 'current' : ''].filter(Boolean).join(' ');
    li.innerHTML = `<span class="mark">${prayerIcon(k)}</span><span class="name"></span><time class="time"></time>`;
    li.querySelector('.name').textContent = t(k);
    if (current === k) li.querySelector('.name').dataset.badge = t('inProgress');
    li.querySelector('.time').textContent = fmtTime(ts);
    if (isNext) li.setAttribute('aria-current', 'time');
    return li;
  });
  $('#prayerList').replaceChildren(...rows);

  $('#extraTimes').replaceChildren(...EXTRA_ROWS.map(k => {
    const div = document.createElement('div');
    div.innerHTML = '<dt></dt><dd></dd>';
    div.firstChild.textContent = t(k);
    div.lastChild.textContent = fmtTime(state.today.times[k]);
    return div;
  }));

  // « Dernière mise à jour » n'apparaît que si c'est utile : hors ligne, calcul local ou données anciennes
  const st = $('#status');
  const offline = state.fetchFailed || !navigator.onLine;
  const stale = state.today.fetchedAt && Date.now() - state.today.fetchedAt > 3 * 864e5;
  st.classList.add('warn-s');
  if (state.today.source === 'local') st.textContent = t('localCalc');
  else if (offline || stale) {
    const when = new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(state.today.fetchedAt);
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
  const mb = $('#calMonthTable'); if (mb) mb.textContent = mon.m === 9 ? t('imsakiya') : t('monthTimes');
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
    el.className = 'cal-day' + (d.white ? ' white' : '') + (d.occasion ? ' occ' : '') + (d.noon === todayNoon ? ' today' : '');
    el.setAttribute('role', 'gridcell');
    el.tabIndex = 0;
    const key = new Date(d.noon).toISOString().slice(0, 10);
    const open = () => { go('home'); showDay(key); };
    el.addEventListener('click', open);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    el.innerHTML = '<span class="hd"></span><span class="gd"></span>';
    el.firstChild.textContent = d.h.d;
    el.lastChild.textContent = gd.format(d.noon);
    if (d.occasion) el.title = t(d.occasion.key);
    return el;
  });
  grid.replaceChildren(...heads, ...blanks, ...cells);
  const df = new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const events = mon.days.filter(d => d.occasion).map(d => [t(d.occasion.key), d]);
  const whites = mon.days.filter(d => d.white);
  if (whites.length) events.push([t('whiteDays'), whites[0], whites.at(-1)]);
  events.sort((x, y) => x[1].noon - y[1].noon);
  $('#calEvents').replaceChildren(...events.map(([name, d1, d2]) => {
    const li = document.createElement('li');
    li.innerHTML = '<span></span><span></span>';
    li.firstChild.textContent = `${name} — ${d2 ? `${d1.h.d}–${d2.h.d}` : d1.h.d} ${t('hijriMonths')[mon.m - 1]}`;
    li.lastChild.textContent = d2 ? `${df.format(d1.noon)} → ${df.format(d2.noon)}` : df.format(d1.noon);
    return li;
  }));
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
const PLAY_URL = 'https://play.google.com/store/apps/details?id=io.github.webnour2026.salat';

// Image PNG du tableau du mois (pour WhatsApp, etc.), avec la mention de SaLaTi en bas
async function buildMonthImage(mon) {
  try { await document.fonts.ready; } catch {}
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
    const text = `📱 ${t('shareFooter')}\n${PLAY_URL}`;
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
  try { await document.fonts.ready; } catch {}
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
    g.font = font(isNext ? 700 : minor ? 400 : 600, minor ? 38 : 44); g.fillText(t(k), X(M + 124), y + RH / 2);
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
    + LIST_ROWS.map(k => `${t(k)} : ${fmtTime(day.times[k])}`).join('\n')
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
      await navigator.share({ files: [file], title: `SaLaTi – ${t('shareTitle')}`, text });
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
  const html = `<!doctype html><html lang="${getLang()}" dir="${document.documentElement.dir}"><head><meta charset="utf-8"><title>${$('#monthTitle').textContent}</title>
<style>body{font:12px system-ui,sans-serif;margin:16px;color:#111}h1{font-size:17px;margin:0 0 4px}p{margin:0 0 10px;color:#555}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:4px 6px;text-align:center;font-variant-numeric:tabular-nums}
thead th{background:#0E6B58;color:#fff}tr.friday{font-weight:700}tr.white{background:#f6ecd6}tbody th{text-align:start;white-space:nowrap}</style></head>
<body><h1>${$('#monthTitle').textContent}</h1><p>${$('#monthSub').textContent}</p><table>${$('#monthTable').innerHTML}</table><p style="margin-top:10px">${t('shareFooter')} — ${PLAY_URL}</p></body></html>`;
  const fr = document.createElement('iframe');
  fr.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.append(fr);
  fr.contentDocument.open(); fr.contentDocument.write(html); fr.contentDocument.close();
  setTimeout(() => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch {} setTimeout(() => fr.remove(), 60000); }, 300);
}

// ================= Cartes à partager (Joumou'a, jours blancs, occasions, Imsakiya) =================
const DAY_MS = 864e5;
const JUMUAH_VERSE = 'إِنَّ اللَّهَ وَمَلَائِكَتَهُ يُصَلُّونَ عَلَى النَّبِيِّ ۚ يَا أَيُّهَا الَّذِينَ آمَنُوا صَلُّوا عَلَيْهِ وَسَلِّمُوا تَسْلِيمًا';
const JUMUAH_REF = '[الأحزاب: 56]';
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
};
const CARD_THEME = {
  green: ['#0B5D4B', '#12806A', '#E9C46A'],   // Joumou'a, Mawlid, nouvel an…
  night: ['#141F3D', '#3B2F63', '#E9C46A'],   // Ramadan, Qadr, jours blancs
  gold:  ['#5B2A1E', '#B5652E', '#FFE3A3'],   // Aïds
  teal:  ['#0E4A5C', '#1F7A8C', '#F3DDB0'],   // Achoura, Arafat (jeûne)
};
const themeOf = key => (['occFitr', 'occAdha'].includes(key) ? 'gold'
  : ['occRamadan', 'occQadr', 'white', 'occNisfShaban'].includes(key) ? 'night'
  : ['occAshura', 'occArafa'].includes(key) ? 'teal' : 'green');
const cardSubLocal = key => (getLang() === 'ar' ? ''
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
  for (let i = 0; i < 370 && seen.size < 5; i++) {
    const noon = today + i * DAY_MS, h = hijriOf(noon, off);
    const o = OCCASIONS.find(x => x.m === h.m && x.d === h.d);
    if (o && !seen.has(o.key)) { seen.add(o.key); out.push({ key: o.key, noon, h }); }
  }
  // Imsakiya du prochain Ramadan (ou du Ramadan en cours)
  for (let i = -30; i < 370; i++) {
    const noon = today + i * DAY_MS, h = hijriOf(noon, off);
    if (h.m === 9 && h.d === 1 && noon + 30 * DAY_MS >= today) { out.push({ key: 'imsakiya', noon, mon: hijriMonth(noon, off) }); break; }
  }
  return out.sort((a, b) => a.noon - b.noon);
}

function wrapLines(g, text, maxW) {
  const words = text.split(/\s+/), lines = []; let cur = '';
  for (const w of words) { const tst = cur ? cur + ' ' + w : w; if (g.measureText(tst).width > maxW && cur) { lines.push(cur); cur = w; } else cur = tst; }
  if (cur) lines.push(cur); return lines;
}
function drawStars(g, W, color) {                       // motif marocain discret (étoiles à 8 branches)
  g.save(); g.strokeStyle = color; g.globalAlpha = .10; g.lineWidth = 2;
  for (let y = 60; y < 560; y += 120) for (let x = (y / 120) % 2 ? 60 : 0; x < W + 60; x += 120) {
    for (const r of [0, Math.PI / 4]) { g.save(); g.translate(x, y); g.rotate(r); g.strokeRect(-26, -26, 52, 52); g.restore(); }
  }
  g.restore();
}
function drawMosque(g, W, H, color) {                  // silhouette (minaret + salle) en bas de carte
  const p = new Path2D('M0 80V70h200v10ZM30 70V52h78v18ZM26 53h86l-7-7H33ZM112 70V14h20v56ZM114 14h16v-3h-2v-2h-3v2h-2v-2h-3v2h-2v-2h-3v2h-1ZM118 9V2h8v7ZM121 2V-4h2v6Z');
  g.save(); g.globalAlpha = .10; g.fillStyle = color; g.translate(W / 2 - 540, H - 380); g.scale(5.4, 5.4); g.fill(p); g.restore();
}

async function buildGreetingCard(spec) {
  try { await Promise.all([document.fonts.load('700 60px Amiri'), document.fonts.load('700 60px "Reem Kufi"'), document.fonts.ready]); } catch {}
  const W = 1080, H = 1350, key = spec.key;
  const [c1, c2, accent] = CARD_THEME[themeOf(key)];
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const plex = (w, px) => `${w} ${px}px "IBM Plex Sans Arabic", system-ui, sans-serif`;
  const amiri = (w, px) => `${w} ${px}px Amiri, "IBM Plex Sans Arabic", serif`;
  const kufi = px => `700 ${px}px "Reem Kufi", "IBM Plex Sans Arabic", sans-serif`;
  const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, c1); grad.addColorStop(1, c2);
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  drawStars(g, W, accent);
  if (themeOf(key) === 'night') {                        // lune
    g.fillStyle = accent; g.globalAlpha = .9; g.beginPath(); g.arc(W - 170, 170, 70, 0, 7); g.fill();
    if (key !== 'white') { g.globalAlpha = 1; g.fillStyle = c1; g.beginPath(); g.arc(W - 140, 150, 62, 0, 7); g.fill(); }
    g.globalAlpha = 1;
  }
  drawMosque(g, W, H, '#fff');
  const [arTitle, arLine] = CARD_AR[key] || [t(key), ''];
  g.textAlign = 'center'; g.direction = 'rtl'; g.textBaseline = 'alphabetic';
  let y = 330;
  g.fillStyle = accent; g.font = kufi(key === 'occMawlid' || key === 'occIsra' ? 84 : 112);
  g.fillText(arTitle, W / 2, y);
  y += 80;
  if (key === 'occNewYear' && spec.h) { g.font = amiri(700, 60); g.fillStyle = '#fff'; g.fillText(`${spec.h.y} هـ`, W / 2, y); y += 70; }
  if (arLine) { g.font = amiri(400, 56); g.fillStyle = '#fff'; g.fillText(arLine, W / 2, y); y += 70; }
  if (key === 'jumuah') {                                // verset (Al-Ahzab 33:56)
    g.font = amiri(700, 50);
    const lines = wrapLines(g, `﴿ ${JUMUAH_VERSE} ﴾`, W - 200);
    const boxH = lines.length * 76 + 90;
    g.fillStyle = 'rgba(255,255,255,.10)'; g.beginPath(); g.roundRect(70, y - 20, W - 140, boxH, 36); g.fill();
    g.fillStyle = '#fff'; lines.forEach((ln, i) => g.fillText(ln, W / 2, y + 50 + i * 76));
    g.font = amiri(400, 32); g.fillStyle = accent; g.fillText(JUMUAH_REF, W / 2, y + boxH - 34);
    y += boxH + 50;
  }
  const sub = cardSubLocal(key);
  g.direction = document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';
  if (sub) { g.font = plex(500, 36); g.fillStyle = '#fff'; g.globalAlpha = .92; g.fillText(sub, W / 2, y); g.globalAlpha = 1; y += 58; }
  // date(s)
  const dateFmt = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  g.font = plex(400, 32); g.fillStyle = '#fff'; g.globalAlpha = .88;
  if (key === 'white' && spec.list) {
    const df = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    spec.list.forEach(x => { g.fillText(`${df.format(x.noon)} · ${hijriLabel(x.h)}`, W / 2, y); y += 50; });
  } else {
    g.fillText(dateFmt.format(spec.noon), W / 2, y); y += 48;
    g.fillText(hijriLabel(hijriOf(spec.noon, S().hijriOffset)), W / 2, y); y += 40;
  }
  g.globalAlpha = 1;
  // horaires du jour (sauf jours blancs : plusieurs jours)
  if (key !== 'white') {
    const day = getDay(S(), new Date(spec.noon).toISOString().slice(0, 10));
    const ks = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
    const bw = (W - 140 - 4 * 14) / 5, top = Math.max(y + 30, H - 420);
    g.font = plex(500, 28); g.fillStyle = '#fff'; g.globalAlpha = .9;
    g.fillText(S().location?.name || '', W / 2, top - 18); g.globalAlpha = 1;
    const rtl = document.documentElement.dir === 'rtl';
    ks.forEach((k, i) => {
      const x = rtl ? W - 70 - (i + 1) * bw - i * 14 : 70 + i * (bw + 14);
      g.fillStyle = 'rgba(255,255,255,.14)'; g.beginPath(); g.roundRect(x, top, bw, 130, 22); g.fill();
      g.fillStyle = '#fff'; g.font = plex(500, 26); g.fillText(t(k), x + bw / 2, top + 48);
      g.fillStyle = accent; g.font = plex(700, 40); g.fillText(fmtTime(day.times[k]), x + bw / 2, top + 102);
    });
  }
  // mention SaLaTi
  const fy = H - 150;
  g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(0, fy - 20, W, 170);
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
  const [arTitle, arLine] = CARD_AR[spec.key] || [t(spec.key), ''];
  const sub = cardSubLocal(spec.key);
  let txt = `🌙 ${arTitle}${arLine ? '\n' + arLine : ''}${sub ? '\n' + sub : ''}`;
  if (spec.key === 'jumuah') txt += `\n\n﴿ ${JUMUAH_VERSE} ﴾ ${JUMUAH_REF}`;
  return txt + `\n\n📱 ${t('shareFooter')}\n${PLAY_URL}`;
}

async function shareCard(spec) {
  if (spec.key === 'imsakiya') { $('#cardsDialog')?.open && $('#cardsDialog').close(); return openMonthTable(spec.mon, 'ramadan'); }
  const text = cardText(spec);
  try {
    await ensureMonth(S(), new Date(spec.noon).toISOString().slice(0, 7));
    const cv = await buildGreetingCard(spec);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    const file = blob && new File([blob], `SaLaTi-${spec.key}-${new Date(spec.noon).toISOString().slice(0, 10)}.png`, { type: 'image/png' });
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'SaLaTi', text });
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
function openCardsDialog() {
  const df = new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  $('#cardsList').replaceChildren(...cardSpecs().map(sp => {
    const li = document.createElement('li');
    const title = sp.key === 'imsakiya' ? `${t('imsakiya')} ${sp.mon.y}` : (CARD_AR[sp.key] || [t(sp.key)])[0];
    const sub = sp.key === 'imsakiya' ? gregSpan(sp.mon) : `${df.format(sp.noon)} · ${whenLabel(sp.noon)}`;
    li.innerHTML = '<div class="cl-txt"><b></b><small></small></div><button class="btn small btn-primary" type="button"></button>';
    li.querySelector('b').textContent = title;
    li.querySelector('small').textContent = sub;
    const b = li.querySelector('button'); b.textContent = sp.key === 'imsakiya' ? t('imsakiya') : t('shareCard');
    b.addEventListener('click', () => shareCard(sp));
    return li;
  }));
  $('#cardsDialog').showModal();
}

// Pastille sur l'écran Horaires : vendredi, ou occasion aujourd'hui / demain
function renderOccChip() {
  const chip = $('#occChip'); if (!chip) return;
  const today = civilNoon(now(), tz());
  const sp = cardSpecs().find(x => x.key !== 'white' && x.key !== 'imsakiya'
    && (x.key === 'jumuah' ? x.noon === today : x.noon - today <= DAY_MS));
  state.chipSpec = sp || null;
  chip.hidden = !sp || viewing();
  if (sp) chip.textContent = `🌙 ${(CARD_AR[sp.key] || [t(sp.key)])[0]} · ${t('shareCard')}`;
}

function calShift(dir) {
  const mon = state.calMonth; if (!mon) return;
  state.calAnchor = dir > 0 ? mon.days.at(-1).noon + 864e5 : mon.days[0].noon - 864e5;
  renderCalendar();
}

// ================= Compte à rebours + événements =================
const countdown = new Countdown({
  onTick(remaining, tNow) {
    $('#clock').textContent = fmtClock(tNow);
    if (remaining != null) {
      $('#countdown').textContent = formatHMS(remaining);
      document.title = `${t(state.next.name)} ${formatHMS(remaining)}`;
    }
    // changement de jour dans le fuseau du lieu
    if (state.dayKey && dateKeyInTz(tNow, tz()) !== state.dayKey) { loadDays(); if (state.viewKey === state.dayKey) state.viewKey = null; renderAll(); refresh(); }
    checkEvents(tNow);
    if (tNow % 60000 < 1000) { renderHome(); renderSilent(); if (!$('#view-qibla').hidden) renderSun(); } // chaque minute
  },
  onReach() {
    // la prière est arrivée : on passe à la suivante
    setTimeout(() => { computeNext(); renderHome(); }, 1100);
  },
});

function adhanFor(prayer) {
  const a = S().adhan;
  return a.mode === 'perPrayer' ? a.perPrayer[prayer] : a.global;
}

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
      events.push({ id: `${state.today.date}-white`, ts: state.today.times.Isha + 30 * 60000, type: 'white', h });
    }
  }
  for (const ev of events) {
    // fenêtre de 90 s : si l'appli s'est réveillée bien après, on ne rejoue pas un Adhan périmé
    if (tNow < ev.ts || tNow - ev.ts > 90000 || state.fired.has(ev.id)) continue;
    state.fired.add(ev.id);
    sessionStorage.setItem('priere.fired', JSON.stringify([...state.fired].slice(-40)));
    fireEvent(ev);
  }
}

async function fireEvent(ev) {
  const a = S().adhan;
  if (ev.type === 'white') {
    notify(t('whiteNotifTitle'), t('whiteNotifBody', { d: ev.h.d, m: t('hijriMonths')[ev.h.m - 1] }), { tag: 'white', vibrateOn: !isSilent() && a.vibrate });
    toast(t('whiteNotifTitle'), 6000);
    return;
  }
  const silent = isSilent();
  const name = t(ev.p);
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
    const r = await playAdhan(adhanFor(ev.p), a.volume, { title: msg, ended: hideAdhanAlert });
    if (r === 'fallback' || r === 'beep') toast(t('adhanMissing'), 5000);
  }
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
    $('#kaabaTop').classList.toggle('on', aligned);
    $('#headingBig').classList.toggle('on', aligned);
    const msg = $('#compassMsg');
    if (!flat) { msg.textContent = t('notFlat'); msg.className = 'compass-msg alert-s'; }
    else if (aligned) { msg.textContent = t('aligned'); msg.className = 'compass-msg ok-s'; if (!compass.wasAligned) vibrate(60); }
    else { msg.textContent = (mode === 'back' ? t('backMode') + ' · ' : '') + `${diff > 0 ? t('turnRight') : t('turnLeft')} \u2066${Math.round(Math.abs(diff))}°\u2069`; msg.className = 'compass-msg'; }
    compass.wasAligned = aligned;
  },
  onStatus(s) {
    compass.lastStatus = s;
    if (s === 'needTap') { setCompassMsg(t('tapToEnable'), ''); $('#compassStart').hidden = false; setSensor('off'); return; }
    const map = { unsupported: 'compassUnsupported', denied: 'compassDenied', nodata: 'compassBlocked', relative: 'compassRelative', blocked: 'compassBlocked' };
    if (map[s]) {
      $('#compassMsg').textContent = t(map[s]); $('#compassMsg').className = 'compass-msg alert-s';
      $('#rose').style.transform = ''; state.roseAngle = null; uprightLabels(0); $('#headingBig').textContent = '--';
      setSensor('off');
    }
    if (s === 'calibrate') setSensor('poor');
    $('#compassStart').hidden = s === 'ok' || s === 'calibrate';
  },
});

function setCompassMsg(text, cls) {
  const m = $('#compassMsg'); if (!m) return;
  m.textContent = text; m.className = `compass-msg ${cls || ''}`;
}

function setSensor(q) {
  if (state.sensorQ === q) return;
  state.sensorQ = q;
  $('#sensorDot').dataset.q = q;
  $('#sensorText').textContent = t({ good: 'sensorGood', fair: 'sensorFair', poor: 'sensorPoor', off: 'sensorOff' }[q]);
}

function buildDial() {
  const ns = 'http://www.w3.org/2000/svg';
  const ticks = $('#roseTicks');
  for (let a = 0; a < 360; a += 45) {
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1', 0); l.setAttribute('x2', 0); l.setAttribute('y1', -140); l.setAttribute('y2', -160);
    l.setAttribute('transform', `rotate(${a + 22.5})`);
    l.setAttribute('class', 'rtick');
    ticks.append(l);
  }
  renderDialLabels();
}
function renderDialLabels() {
  const ns = 'http://www.w3.org/2000/svg';
  const names = { fr: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'], en: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], ar: ['شمال', '', 'شرق', '', 'جنوب', '', 'غرب', ''] }[getLang()];
  $('#roseLabels').replaceChildren(...names.map((n, i) => n && (() => {
    const a = i * 45, r = 98;
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
  if (!state.sensorQ) setSensor('off');
  renderSun();
  if (!Compass.isSupported()) compass.onStatus('unsupported');
}

function renderSun() {
  const loc = S().location; if (!loc || state.qibla == null) return;
  const tNow = now();
  const sp = sunPosition(tNow, loc.lat, loc.lng);
  if (sp.elevation > 0) {
    $('#sunNow').textContent = t('sunNow', { az: fmtDeg(sp.azimuth), el: fmtDeg(sp.elevation) });
    const d = ((state.qibla - sp.azimuth + 540) % 360) - 180;
    $('#sunRel').textContent = t('sunRel', { d: fmtDeg(Math.abs(d)), side: d > 0 ? t('toRight') : t('toLeft') });
  } else {
    $('#sunNow').textContent = t('sunDown'); $('#sunRel').textContent = '';
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
function renderSettings() {
  const s = S();
  const loc = s.location;
  $('#locSummary').textContent = loc
    ? `${loc.source === 'gps' ? t('gpsAuto') : t('manualCity')} — ${loc.name || ''} (${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)})${loc.accuracy ? ` · ${t('gpsAccuracy')} ±${loc.accuracy} m` : ''}`
    : t('chooseCity');

  $('#sMethod').replaceChildren(...METHOD_IDS.map(id => new Option(t('methods')[id], id, false, id === s.method)));
  $('#sSchool').value = String(s.school);

  $('#adjustGrid').replaceChildren(...['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].map(k => {
    const l = document.createElement('label');
    l.innerHTML = '<span></span><input type="number" min="-30" max="30" step="1" inputmode="numeric">';
    l.firstChild.textContent = t(k);
    const inp = l.lastChild; inp.value = s.adjust[k] || 0;
    inp.addEventListener('change', () => {
      s.adjust[k] = Math.max(-30, Math.min(30, Math.round(Number(inp.value) || 0)));
      inp.value = s.adjust[k]; save(); loadDays(); renderHome();
    });
    return l;
  }));

  const a = s.adhan;
  $('#sAdhanOn').checked = a.enabled;
  document.querySelectorAll('input[name="adhanMode"]').forEach(r => { r.checked = r.value === a.mode; });
  renderAdhanPickers();
  $('#sVolume').value = a.volume;
  $('#sVibrate').checked = a.vibrate;
  $('#sWhiteDays').checked = s.whiteDays;
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
  $('#sDeclAuto').checked = s.declAuto;
  $('#sDecl').disabled = s.declAuto;
  $('#sDecl').value = s.declAuto ? fmtDeg(currentDeclination()).replace(',', '.') : s.declination;
  $('#clockOffset').textContent = `${getOffset() >= 0 ? '+' : ''}${Math.round(getOffset() / 1000)} s`;
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
      const r = await playAdhan(sel.value, a.volume, { title: t('adhanSound'), ended: reset });
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
  w.hidden = !(wants && (p === 'denied' || p === 'unsupported'));
  w.textContent = t('notifDenied');
}

async function ensureNotifPermission() {
  const p = await requestNotifPermission();
  updateNotifWarn();
  return p === 'granted';
}

function bindSettings() {
  on('#changeLoc', 'click', openLocationDialog);
  on('#sMethod', 'change', e => { S().method = Number(e.target.value); S().methodAuto = false; save(); refresh(); });
  on('#sSchool', 'change', e => { S().school = Number(e.target.value); save(); refresh(); });
  on('#sAdhanOn', 'change', e => { S().adhan.enabled = e.target.checked; save(); if (e.target.checked) unlockAudio(); });
  on('#sAdhanMode', 'change', e => { S().adhan.mode = e.target.value; save(); renderAdhanPickers(); });
  on('#sVolume', 'input', e => { S().adhan.volume = Number(e.target.value); save(); });
  on('#sWhiteDays', 'change', async e => { S().whiteDays = e.target.checked; save(); renderWhite(); if (e.target.checked) await ensureNotifPermission(); });
  on('#sVibrate', 'change', e => { S().adhan.vibrate = e.target.checked; save(); if (e.target.checked) vibrate(80); });
  on('#sNotifyAt', 'change', async e => {
    S().adhan.notifyAt = e.target.checked; save();
    if (e.target.checked) await ensureNotifPermission(); else updateNotifWarn();
  });
  on('#sNotifyBefore', 'change', async e => {
    S().adhan.notifyBefore = Number(e.target.value); save();
    if (S().adhan.notifyBefore > 0) await ensureNotifPermission(); else updateNotifWarn();
  });
  on('#testNotif', 'click', async () => {
    if (await ensureNotifPermission()) notify(`${t('itsTime')} ${t('Asr')}`, fmtTime(now()), { tag: 'test', vibrateOn: S().adhan.vibrate });
  });
  on('#sLang', 'change', e => { S().lang = e.target.value; save(); applyLang(); renderAll(); renderSettings(); renderQibla(); });
  on('#sTheme', 'change', e => { S().theme = e.target.value; save(); applyTheme(); });
  on('#sHijri', 'change', e => { S().hijriOffset = Number(e.target.value); save(); renderHeader(); });
  on('#sDecl', 'change', e => { S().declination = Math.max(-30, Math.min(30, Number(String(e.target.value).replace(',', '.')) || 0)); save(); state.decl = currentDeclination(); });
  on('#sDeclAuto', 'change', e => { S().declAuto = e.target.checked; save(); state.decl = currentDeclination(); renderSettings(); });
  on('#syncBtn', 'click', async () => { await syncClock(); computeNext(); renderSettings(); });
  on('#clearBtn', 'click', () => { clearMonths(); toast(t('cleared')); refresh(); });
}

// ================= Service worker =================
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(reg => {
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
  });
  on('#gpsBtn', 'click', useGps);
  on('#citySearch', 'input', onSearch);
  on('#compassStart', 'click', async () => { unlockAudio(); await compass.start(); });
  on('#calibrateBtn', 'click', () => $('#calDialog').showModal());
  on('#adhanStop', 'click', () => { stopAdhan(); hideAdhanAlert(); });
  on('#adhanSilent', 'click', () => { stopAdhan(); hideAdhanAlert(); renderSilent(); $('#silentDialog').showModal(); });
  on('#silentBtn', 'click', () => { renderSilent(); $('#silentDialog').showModal(); });
  document.querySelectorAll('[data-silent]').forEach(b => b.addEventListener('click', () => { setSilent(b.dataset.silent); $('#silentDialog').close(); }));
  on('#calPrev', 'click', () => calShift(-1));
  on('#calNext', 'click', () => calShift(1));
  on('#calToday', 'click', () => { state.calAnchor = null; renderCalendar(); });
  on('#calMonthTable', 'click', () => openMonthTable());
  on('#calCards', 'click', openCardsDialog);
  on('#occChip', 'click', () => { const sp = state.chipSpec; if (sp) shareCard(sp); });
  on('#monthPrint', 'click', printMonthTable);
  on('#monthShare', 'click', shareMonthTable);
  on('#dayShare', 'click', shareDay);
  on('#dayPrev', 'click', () => shiftDay(-1));
  on('#dayNext', 'click', () => shiftDay(1));
  on('#dayToday', 'click', () => showDay(null));
  bindSwipe();
  // l'audio ne peut démarrer qu'après un premier geste de l'utilisateur
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('online', () => { state.online = true; refresh(); syncClock(); });
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

export const APP_VERSION = '2.3.0';

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
  applyTheme();
  applyLang();
  buildDial();
  bind();
  registerSW();
  countdown.start();

  const view = (location.hash || '#home').slice(1);
  go(['home', 'qibla', 'calendar', 'settings'].includes(view) ? view : 'home');
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
  syncClock().then(() => { if (state.today) computeNext(); });
}

try { init(); } finally { window.__appStarted = true; }
