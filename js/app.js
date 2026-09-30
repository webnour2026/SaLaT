import { t, setLang, locale, getLang } from './i18n.js';
import { loadSettings, saveSettings, clearMonths, PRAYERS } from './storage.js';
import { now, syncClock, getOffset } from './clock.js';
import { ensureMonths, ensureMonth, getDay, findNext, findElapsed, dateKeyInTz, addDays, deviceTz } from './prayer-times.js';
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
function go(view) {
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== `view-${view}`; });
  document.querySelectorAll('.tabbar button').forEach(b => {
    if (b.dataset.goto === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  document.body.classList.toggle('fit', view !== 'settings' && view !== 'cards');   // écran ajusté, sans défilement
  $('#settingsBtn')?.classList.toggle('active', view === 'settings');
  requestAnimationFrame(() => document.querySelectorAll('main, .view').forEach(el => { el.scrollLeft = 0; }));
  if (view !== 'qibla') compass.stop();
  if (view === 'qibla') {
    renderQibla();
    // démarrage automatique ; sur iPhone, un toucher n'est demandé que si Safari ne l'a pas déjà autorisé
    setCompassMsg(t('compassSearching'), '');
    compass.start({ ask: !Compass.needsPermission() });
  }
  if (view === 'settings') renderSettings();
  if (view === 'cards') renderCards();
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

  const el = state.elapsed;   // heure de la prière tout juste arrivée : on reste dessus un moment
  $('#nextLabel').textContent = el ? t('prayerNow') : t('nextPrayer');
  $('#nextName').textContent = t(el ? el.name : next.name);
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

// Texte joint à une image partagée : l'image dit déjà tout, on ne garde que l'invitation et le lien
const shortShareText = () => `📲 ${t('shareShort')}\n${PLAY_URL}`;

// ================= Cartes à partager (Joumou'a, jours blancs, occasions, Imsakiya) =================
const DAY_MS = 864e5;
const JUMUAH_VERSE = 'إِنَّ اللَّهَ وَمَلَائِكَتَهُ يُصَلُّونَ عَلَى النَّبِيِّ ۚ يَا أَيُّهَا الَّذِينَ آمَنُوا صَلُّوا عَلَيْهِ وَسَلِّمُوا تَسْلِيمًا';
const JUMUAH_REF = '[الأحزاب: 56]';
// Textes des cartes : uniquement Coran et hadiths authentiques, avec leur référence.
// q = verset (entre ﴿ ﴾), sinon hadith/dhikr (entre « »).
const CARD_TEXTS = {
  jumuah: [   // change chaque vendredi
    { q: true, t: JUMUAH_VERSE, r: JUMUAH_REF },
    { t: 'مَنْ قَرَأَ سُورَةَ الْكَهْفِ فِي يَوْمِ الْجُمُعَةِ أَضَاءَ لَهُ مِنَ النُّورِ مَا بَيْنَ الْجُمُعَتَيْنِ', r: 'رواه الحاكم والبيهقي، وصححه الألباني' },
    { t: 'إِنَّ مِنْ أَفْضَلِ أَيَّامِكُمْ يَوْمَ الْجُمُعَةِ … فَأَكْثِرُوا عَلَيَّ مِنَ الصَّلَاةِ فِيهِ', r: 'رواه أبو داود (1047)' },
  ],
  occRamadan: [{ q: true, t: 'شَهْرُ رَمَضَانَ الَّذِي أُنزِلَ فِيهِ الْقُرْآنُ هُدًى لِّلنَّاسِ وَبَيِّنَاتٍ مِّنَ الْهُدَىٰ وَالْفُرْقَانِ', r: '[البقرة: 185]' }],
  occQadr: [{ q: true, t: 'لَيْلَةُ الْقَدْرِ خَيْرٌ مِّنْ أَلْفِ شَهْرٍ', r: '[القدر: 3]' },
            { t: 'اللَّهُمَّ إِنَّكَ عَفُوٌّ تُحِبُّ الْعَفْوَ فَاعْفُ عَنِّي', r: 'رواه الترمذي (3513)' }],
  occArafa: [{ t: 'صِيَامُ يَوْمِ عَرَفَةَ أَحْتَسِبُ عَلَى اللَّهِ أَنْ يُكَفِّرَ السَّنَةَ الَّتِي قَبْلَهُ وَالسَّنَةَ الَّتِي بَعْدَهُ', r: 'رواه مسلم (1162)' }],
  occAshura: [{ t: 'صِيَامُ يَوْمِ عَاشُورَاءَ أَحْتَسِبُ عَلَى اللَّهِ أَنْ يُكَفِّرَ السَّنَةَ الَّتِي قَبْلَهُ', r: 'رواه مسلم (1162)' }],
  morning: [  // adhkar du matin + versets courts ; liste mélangée à chaque ouverture
    { t: 'أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ', r: 'رواه مسلم (2723)' },
    { t: 'اللَّهُمَّ بِكَ أَصْبَحْنَا، وَبِكَ أَمْسَيْنَا، وَبِكَ نَحْيَا، وَبِكَ نَمُوتُ، وَإِلَيْكَ النُّشُورُ', r: 'رواه الترمذي (3391)' },
    { t: 'مَنْ قَالَ حِينَ يُصْبِحُ وَحِينَ يُمْسِي: سُبْحَانَ اللَّهِ وَبِحَمْدِهِ مِائَةَ مَرَّةٍ، لَمْ يَأْتِ أَحَدٌ يَوْمَ الْقِيَامَةِ بِأَفْضَلَ مِمَّا جَاءَ بِهِ إِلَّا أَحَدٌ قَالَ مِثْلَ مَا قَالَ أَوْ زَادَ عَلَيْهِ', r: 'رواه مسلم (2692)' },
    // — Versets courts (sabah el-khir) —
    { q: true, t: 'إِنَّ الصَّلَاةَ كَانَتْ عَلَى الْمُؤْمِنِينَ كِتَابًا مَّوْقُوتًا', r: '[النساء: 103]' },
    { q: true, t: 'حَافِظُوا عَلَى الصَّلَوَاتِ وَالصَّلَاةِ الْوُسْطَىٰ وَقُومُوا لِلَّهِ قَانِتِينَ', r: '[البقرة: 238]' },
    { q: true, t: 'قَدْ أَفْلَحَ الْمُؤْمِنُونَ ۝ الَّذِينَ هُمْ فِي صَلَاتِهِمْ خَاشِعُونَ', r: '[المؤمنون: 1-2]' },
    { q: true, t: 'وَأَقِمِ الصَّلَاةَ لِذِكْرِي', r: '[طه: 14]' },
    { q: true, t: 'إِنَّ الصَّلَاةَ تَنْهَىٰ عَنِ الْفَحْشَاءِ وَالْمُنكَرِ', r: '[العنكبوت: 45]' },
    { q: true, t: 'وَلَذِكْرُ اللَّهِ أَكْبَرُ', r: '[العنكبوت: 45]' },
    { q: true, t: 'يَا أَيُّهَا الَّذِينَ آمَنُوا اسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ ۚ إِنَّ اللَّهَ مَعَ الصَّابِرِينَ', r: '[البقرة: 153]' },
    { q: true, t: 'وَاسْجُدْ وَاقْتَرِب', r: '[العلق: 19]' },
    { q: true, t: 'وَأْمُرْ أَهْلَكَ بِالصَّلَاةِ وَاصْطَبِرْ عَلَيْهَا', r: '[طه: 132]' },
    { q: true, t: 'قُلْ إِنَّ صَلَاتِي وَنُسُكِي وَمَحْيَايَ وَمَمَاتِي لِلَّهِ رَبِّ الْعَالَمِينَ', r: '[الأنعام: 162]' },
    { q: true, t: 'وَاعْبُدْ رَبَّكَ حَتَّىٰ يَأْتِيَكَ الْيَقِينُ', r: '[الحجر: 99]' },
    { q: true, t: 'أَلَا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ', r: '[الرعد: 28]' },
    { q: true, t: 'فَاذْكُرُونِي أَذْكُرْكُمْ وَاشْكُرُوا لِي وَلَا تَكْفُرُونِ', r: '[البقرة: 152]' },
    { q: true, t: 'يَا أَيُّهَا الَّذِينَ آمَنُوا اذْكُرُوا اللَّهَ ذِكْرًا كَثِيرًا', r: '[الأحزاب: 41]' },
    { q: true, t: 'وَاذْكُر رَّبَّكَ كَثِيرًا وَسَبِّحْ بِالْعَشِيِّ وَالْإِبْكَارِ', r: '[آل عمران: 41]' },
    { q: true, t: 'فَسَبِّحْ بِحَمْدِ رَبِّكَ وَاسْتَغْفِرْهُ ۚ إِنَّهُ كَانَ تَوَّابًا', r: '[النصر: 3]' },
    { q: true, t: 'وَإِذَا سَأَلَكَ عِبَادِي عَنِّي فَإِنِّي قَرِيبٌ ۖ أُجِيبُ دَعْوَةَ الدَّاعِ إِذَا دَعَانِ', r: '[البقرة: 186]' },
    { q: true, t: 'وَقَالَ رَبُّكُمُ ادْعُونِي أَسْتَجِبْ لَكُمْ', r: '[غافر: 60]' },
    { q: true, t: 'ادْعُوا رَبَّكُمْ تَضَرُّعًا وَخُفْيَةً', r: '[الأعراف: 55]' },
    { q: true, t: 'إِنَّ رَبِّي قَرِيبٌ مُّجِيبٌ', r: '[هود: 61]' },
    { q: true, t: 'وَنَحْنُ أَقْرَبُ إِلَيْهِ مِنْ حَبْلِ الْوَرِيدِ', r: '[ق: 16]' },
    { q: true, t: 'فَإِنَّ مَعَ الْعُسْرِ يُسْرًا ۝ إِنَّ مَعَ الْعُسْرِ يُسْرًا', r: '[الشرح: 5-6]' },
    { q: true, t: 'سَيَجْعَلُ اللَّهُ بَعْدَ عُسْرٍ يُسْرًا', r: '[الطلاق: 7]' },
    { q: true, t: 'لَا يُكَلِّفُ اللَّهُ نَفْسًا إِلَّا وُسْعَهَا', r: '[البقرة: 286]' },
    { q: true, t: 'وَلَا تَيْأَسُوا مِن رَّوْحِ اللَّهِ', r: '[يوسف: 87]' },
    { q: true, t: 'لَا تَقْنَطُوا مِن رَّحْمَةِ اللَّهِ', r: '[الزمر: 53]' },
    { q: true, t: 'فَاصْبِرْ صَبْرًا جَمِيلًا', r: '[المعارج: 5]' },
    { q: true, t: 'وَاصْبِرْ وَمَا صَبْرُكَ إِلَّا بِاللَّهِ', r: '[النحل: 127]' },
    { q: true, t: 'وَبَشِّرِ الصَّابِرِينَ', r: '[البقرة: 155]' },
    { q: true, t: 'وَاللَّهُ يُحِبُّ الصَّابِرِينَ', r: '[آل عمران: 146]' },
    { q: true, t: 'إِنَّمَا يُوَفَّى الصَّابِرُونَ أَجْرَهُم بِغَيْرِ حِسَابٍ', r: '[الزمر: 10]' },
    { q: true, t: 'وَعَسَىٰ أَن تَكْرَهُوا شَيْئًا وَهُوَ خَيْرٌ لَّكُمْ', r: '[البقرة: 216]' },
    { q: true, t: 'مَا وَدَّعَكَ رَبُّكَ وَمَا قَلَىٰ', r: '[الضحى: 3]' },
    { q: true, t: 'وَلَلْآخِرَةُ خَيْرٌ لَّكَ مِنَ الْأُولَىٰ', r: '[الضحى: 4]' },
    { q: true, t: 'وَلَسَوْفَ يُعْطِيكَ رَبُّكَ فَتَرْضَىٰ', r: '[الضحى: 5]' },
    { q: true, t: 'وَمَن يَتَوَكَّلْ عَلَى اللَّهِ فَهُوَ حَسْبُهُ', r: '[الطلاق: 3]' },
    { q: true, t: 'حَسْبُنَا اللَّهُ وَنِعْمَ الْوَكِيلُ', r: '[آل عمران: 173]' },
    { q: true, t: 'إِنَّ اللَّهَ يُحِبُّ الْمُتَوَكِّلِينَ', r: '[آل عمران: 159]' },
    { q: true, t: 'أَلَيْسَ اللَّهُ بِكَافٍ عَبْدَهُ', r: '[الزمر: 36]' },
    { q: true, t: 'وَمَا تَوْفِيقِي إِلَّا بِاللَّهِ', r: '[هود: 88]' },
    { q: true, t: 'وَهُوَ مَعَكُمْ أَيْنَ مَا كُنتُمْ', r: '[الحديد: 4]' },
    { q: true, t: 'وَرَحْمَتِي وَسِعَتْ كُلَّ شَيْءٍ', r: '[الأعراف: 156]' },
    { q: true, t: 'إِنَّ رَحْمَتَ اللَّهِ قَرِيبٌ مِّنَ الْمُحْسِنِينَ', r: '[الأعراف: 56]' },
    { q: true, t: 'نَبِّئْ عِبَادِي أَنِّي أَنَا الْغَفُورُ الرَّحِيمُ', r: '[الحجر: 49]' },
    { q: true, t: 'وَاللَّهُ غَفُورٌ رَّحِيمٌ', r: '[البقرة: 218]' },
    { q: true, t: 'إِنَّ اللَّهَ يُحِبُّ التَّوَّابِينَ وَيُحِبُّ الْمُتَطَهِّرِينَ', r: '[البقرة: 222]' },
    { q: true, t: 'سَلَامٌ قَوْلًا مِّن رَّبٍّ رَّحِيمٍ', r: '[يس: 58]' },
    { q: true, t: 'اللَّهُ نُورُ السَّمَاوَاتِ وَالْأَرْضِ', r: '[النور: 35]' },
    { q: true, t: 'لَئِن شَكَرْتُمْ لَأَزِيدَنَّكُمْ', r: '[إبراهيم: 7]' },
    { q: true, t: 'وَإِن تَعُدُّوا نِعْمَةَ اللَّهِ لَا تُحْصُوهَا', r: '[النحل: 18]' },
    { q: true, t: 'فَبِأَيِّ آلَاءِ رَبِّكُمَا تُكَذِّبَانِ', r: '[الرحمن: 13]' },
    { q: true, t: 'وَكَانَ فَضْلُ اللَّهِ عَلَيْكَ عَظِيمًا', r: '[النساء: 113]' },
    { q: true, t: 'وَاللَّهُ خَيْرُ الرَّازِقِينَ', r: '[الجمعة: 11]' },
    { q: true, t: 'وَمَن يَتَّقِ اللَّهَ يَجْعَل لَّهُ مَخْرَجًا', r: '[الطلاق: 2]' },
    { q: true, t: 'وَمَن يَتَّقِ اللَّهَ يَجْعَل لَّهُ مِنْ أَمْرِهِ يُسْرًا', r: '[الطلاق: 4]' },
    { q: true, t: 'إِنَّ أَكْرَمَكُمْ عِندَ اللَّهِ أَتْقَاكُمْ', r: '[الحجرات: 13]' },
    { q: true, t: 'إِنَّ اللَّهَ مَعَ الَّذِينَ اتَّقَوا وَّالَّذِينَ هُم مُّحْسِنُونَ', r: '[النحل: 128]' },
    { q: true, t: 'إِنَّ الْحَسَنَاتِ يُذْهِبْنَ السَّيِّئَاتِ', r: '[هود: 114]' },
    { q: true, t: 'هَلْ جَزَاءُ الْإِحْسَانِ إِلَّا الْإِحْسَانُ', r: '[الرحمن: 60]' },
    { q: true, t: 'وَاللَّهُ يُحِبُّ الْمُحْسِنِينَ', r: '[آل عمران: 134]' },
    { q: true, t: 'إِنَّ اللَّهَ لَا يُضِيعُ أَجْرَ الْمُحْسِنِينَ', r: '[التوبة: 120]' },
    { q: true, t: 'وَقُولُوا لِلنَّاسِ حُسْنًا', r: '[البقرة: 83]' },
    { q: true, t: 'وَتَعَاوَنُوا عَلَى الْبِرِّ وَالتَّقْوَىٰ', r: '[المائدة: 2]' },
    { q: true, t: 'إِنَّ اللَّهَ لَا يُغَيِّرُ مَا بِقَوْمٍ حَتَّىٰ يُغَيِّرُوا مَا بِأَنفُسِهِمْ', r: '[الرعد: 11]' },
    { q: true, t: 'فَاسْتَبِقُوا الْخَيْرَاتِ', r: '[البقرة: 148]' },
    { q: true, t: 'وَسَارِعُوا إِلَىٰ مَغْفِرَةٍ مِّن رَّبِّكُمْ', r: '[آل عمران: 133]' },
    { q: true, t: 'كُلُّ نَفْسٍ ذَائِقَةُ الْمَوْتِ', r: '[آل عمران: 185]' },
    { q: true, t: 'وَالْآخِرَةُ خَيْرٌ وَأَبْقَىٰ', r: '[الأعلى: 17]' },
    { q: true, t: 'وَمَا عِندَ اللَّهِ خَيْرٌ وَأَبْقَىٰ', r: '[الشورى: 36]' },
    { q: true, t: 'إِنَّ الْمُتَّقِينَ فِي جَنَّاتٍ وَنَعِيمٍ', r: '[الطور: 17]' },
  ],
  dua: [      // une carte par doua
    { q: true, t: 'رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ', r: '[البقرة: 201]' },
    { q: true, t: 'رَبِّ اشْرَحْ لِي صَدْرِي وَيَسِّرْ لِي أَمْرِي', r: '[طه: 25-26]' },
    { q: true, t: 'رَبَّنَا لَا تُزِغْ قُلُوبَنَا بَعْدَ إِذْ هَدَيْتَنَا وَهَبْ لَنَا مِن لَّدُنكَ رَحْمَةً إِنَّكَ أَنتَ الْوَهَّابُ', r: '[آل عمران: 8]' },
    { q: true, t: 'رَّبِّ ارْحَمْهُمَا كَمَا رَبَّيَانِي صَغِيرًا', r: '[الإسراء: 24]' },
    { t: 'اللَّهُمَّ إِنِّي أَسْأَلُكَ الْعَافِيَةَ فِي الدُّنْيَا وَالْآخِرَةِ', r: 'رواه أبو داود (5074) وابن ماجه (3871)' },
    { t: 'يَا مُقَلِّبَ الْقُلُوبِ ثَبِّتْ قَلْبِي عَلَى دِينِكَ', r: 'رواه الترمذي (2140)' },
    { q: true, t: 'رَبَّنَا هَبْ لَنَا مِنْ أَزْوَاجِنَا وَذُرِّيَّاتِنَا قُرَّةَ أَعْيُنٍ وَاجْعَلْنَا لِلْمُتَّقِينَ إِمَامًا', r: '[الفرقان: 74]' },
    { q: true, t: 'رَّبِّ زِدْنِي عِلْمًا', r: '[طه: 114]' },
    { q: true, t: 'رَبَّنَا اغْفِرْ لِي وَلِوَالِدَيَّ وَلِلْمُؤْمِنِينَ يَوْمَ يَقُومُ الْحِسَابُ', r: '[إبراهيم: 41]' },
    { q: true, t: 'حَسْبِيَ اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ ۖ عَلَيْهِ تَوَكَّلْتُ ۖ وَهُوَ رَبُّ الْعَرْشِ الْعَظِيمِ', r: '[التوبة: 129]' },
    { q: true, t: 'لَّا إِلَٰهَ إِلَّا أَنتَ سُبْحَانَكَ إِنِّي كُنتُ مِنَ الظَّالِمِينَ', r: '[الأنبياء: 87]' },
    { q: true, t: 'رَبَّنَا ظَلَمْنَا أَنفُسَنَا وَإِن لَّمْ تَغْفِرْ لَنَا وَتَرْحَمْنَا لَنَكُونَنَّ مِنَ الْخَاسِرِينَ', r: '[الأعراف: 23]' },
    { t: 'اللَّهُمَّ إِنِّي أَسْأَلُكَ الْهُدَى وَالتُّقَى وَالْعَفَافَ وَالْغِنَى', r: 'رواه مسلم (2721)' },
    { t: 'اللَّهُمَّ أَعِنِّي عَلَى ذِكْرِكَ وَشُكْرِكَ وَحُسْنِ عِبَادَتِكَ', r: 'رواه أبو داود (1522) والنسائي (1303)' },
    { t: 'اللَّهُمَّ إِنَّكَ عَفُوٌّ تُحِبُّ الْعَفْوَ فَاعْفُ عَنِّي', r: 'رواه الترمذي (3513)' },
    { t: 'اللَّهُمَّ آتِ نَفْسِي تَقْوَاهَا، وَزَكِّهَا أَنْتَ خَيْرُ مَنْ زَكَّاهَا، أَنْتَ وَلِيُّهَا وَمَوْلَاهَا', r: 'رواه مسلم (2722)' },
    { t: 'اللَّهُمَّ اغْفِرْ لِي، وَارْحَمْنِي، وَاهْدِنِي، وَعَافِنِي، وَارْزُقْنِي', r: 'رواه مسلم (2697)' },
    { q: true, t: 'رَبَّنَا تَقَبَّلْ مِنَّا ۖ إِنَّكَ أَنتَ السَّمِيعُ الْعَلِيمُ', r: '[البقرة: 127]' },
    { q: true, t: 'رَبَّنَا لَا تُؤَاخِذْنَا إِن نَّسِينَا أَوْ أَخْطَأْنَا', r: '[البقرة: 286]' },
    { q: true, t: 'رَبِّ اجْعَلْنِي مُقِيمَ الصَّلَاةِ وَمِن ذُرِّيَّتِي ۚ رَبَّنَا وَتَقَبَّلْ دُعَاءِ', r: '[إبراهيم: 40]' },
    { q: true, t: 'رَبِّ أَوْزِعْنِي أَنْ أَشْكُرَ نِعْمَتَكَ الَّتِي أَنْعَمْتَ عَلَيَّ وَعَلَىٰ وَالِدَيَّ وَأَنْ أَعْمَلَ صَالِحًا تَرْضَاهُ', r: '[النمل: 19]' },
    { q: true, t: 'رَبِّ إِنِّي لِمَا أَنزَلْتَ إِلَيَّ مِنْ خَيْرٍ فَقِيرٌ', r: '[القصص: 24]' },
    { q: true, t: 'رَبَّنَا آتِنَا مِن لَّدُنكَ رَحْمَةً وَهَيِّئْ لَنَا مِنْ أَمْرِنَا رَشَدًا', r: '[الكهف: 10]' },
    { q: true, t: 'رَبِّ هَبْ لِي مِن لَّدُنكَ ذُرِّيَّةً طَيِّبَةً ۖ إِنَّكَ سَمِيعُ الدُّعَاءِ', r: '[آل عمران: 38]' },
    { q: true, t: 'رَبِّ أَدْخِلْنِي مُدْخَلَ صِدْقٍ وَأَخْرِجْنِي مُخْرَجَ صِدْقٍ وَاجْعَل لِّي مِن لَّدُنكَ سُلْطَانًا نَّصِيرًا', r: '[الإسراء: 80]' },
    { t: 'اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنَ الْهَمِّ وَالْحَزَنِ، وَالْعَجْزِ وَالْكَسَلِ، وَالْبُخْلِ وَالْجُبْنِ، وَضَلَعِ الدَّيْنِ، وَغَلَبَةِ الرِّجَالِ', r: 'رواه البخاري (6369)' },
    { t: 'اللَّهُمَّ مُصَرِّفَ الْقُلُوبِ صَرِّفْ قُلُوبَنَا عَلَى طَاعَتِكَ', r: 'رواه مسلم (2654)' },
    { t: 'اللَّهُمَّ إِنِّي ظَلَمْتُ نَفْسِي ظُلْمًا كَثِيرًا، وَلَا يَغْفِرُ الذُّنُوبَ إِلَّا أَنْتَ، فَاغْفِرْ لِي مَغْفِرَةً مِنْ عِنْدِكَ، وَارْحَمْنِي، إِنَّكَ أَنْتَ الْغَفُورُ الرَّحِيمُ', r: 'متفق عليه (البخاري 834، مسلم 2705)' },
    { t: 'اللَّهُمَّ أَصْلِحْ لِي دِينِيَ الَّذِي هُوَ عِصْمَةُ أَمْرِي، وَأَصْلِحْ لِي دُنْيَايَ الَّتِي فِيهَا مَعَاشِي، وَأَصْلِحْ لِي آخِرَتِي الَّتِي فِيهَا مَعَادِي', r: 'رواه مسلم (2720)' },
    { t: 'اللَّهُمَّ إِنِّي أَسْأَلُكَ عِلْمًا نَافِعًا، وَرِزْقًا طَيِّبًا، وَعَمَلًا مُتَقَبَّلًا', r: 'رواه ابن ماجه (925)' },
    { t: 'لَا إِلَهَ إِلَّا اللَّهُ الْعَظِيمُ الْحَلِيمُ، لَا إِلَهَ إِلَّا اللَّهُ رَبُّ الْعَرْشِ الْعَظِيمِ، لَا إِلَهَ إِلَّا اللَّهُ رَبُّ السَّمَاوَاتِ وَرَبُّ الْأَرْضِ وَرَبُّ الْعَرْشِ الْكَرِيمِ', r: 'متفق عليه (البخاري 6346، مسلم 2730)' },
    { t: 'اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَهَ إِلَّا أَنْتَ، خَلَقْتَنِي وَأَنَا عَبْدُكَ، وَأَنَا عَلَى عَهْدِكَ وَوَعْدِكَ مَا اسْتَطَعْتُ، أَعُوذُ بِكَ مِنْ شَرِّ مَا صَنَعْتُ، أَبُوءُ لَكَ بِنِعْمَتِكَ عَلَيَّ، وَأَبُوءُ لَكَ بِذَنْبِي، فَاغْفِرْ لِي فَإِنَّهُ لَا يَغْفِرُ الذُّنُوبَ إِلَّا أَنْتَ', r: 'سيد الاستغفار – رواه البخاري (6306)' },
  ],
  hadith: [   // hadiths authentiques courts
    { t: 'إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ، وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى', r: 'متفق عليه (البخاري 1، مسلم 1907)' },
    { t: 'لَا يُؤْمِنُ أَحَدُكُمْ حَتَّى يُحِبَّ لِأَخِيهِ مَا يُحِبُّ لِنَفْسِهِ', r: 'متفق عليه (البخاري 13، مسلم 45)' },
    { t: 'مَنْ كَانَ يُؤْمِنُ بِاللَّهِ وَالْيَوْمِ الْآخِرِ فَلْيَقُلْ خَيْرًا أَوْ لِيَصْمُتْ', r: 'متفق عليه (البخاري 6018، مسلم 47)' },
    { t: 'الْكَلِمَةُ الطَّيِّبَةُ صَدَقَةٌ', r: 'متفق عليه (البخاري 2989، مسلم 1009)' },
    { t: 'أَحَبُّ الْأَعْمَالِ إِلَى اللَّهِ أَدْوَمُهَا وَإِنْ قَلَّ', r: 'متفق عليه (البخاري 6464، مسلم 783)' },
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
    { t: 'يَسِّرُوا وَلَا تُعَسِّرُوا، وَبَشِّرُوا وَلَا تُنَفِّرُوا', r: 'متفق عليه (البخاري 69، مسلم 1734)' },
    { t: 'إِنَّ اللَّهَ رَفِيقٌ يُحِبُّ الرِّفْقَ فِي الْأَمْرِ كُلِّهِ', r: 'متفق عليه (البخاري 6927، مسلم 2165)' },
    { t: 'مَنْ لَا يَرْحَمِ النَّاسَ لَا يَرْحَمْهُ اللَّهُ', r: 'متفق عليه (البخاري 7376، مسلم 2319)' },
    { t: 'الْمُؤْمِنُ لِلْمُؤْمِنِ كَالْبُنْيَانِ يَشُدُّ بَعْضُهُ بَعْضًا', r: 'متفق عليه (البخاري 481، مسلم 2585)' },
    { t: 'اتَّقُوا النَّارَ وَلَوْ بِشِقِّ تَمْرَةٍ', r: 'متفق عليه (البخاري 1417، مسلم 1016)' },
    { t: 'إِنَّ اللَّهَ لَا يَنْظُرُ إِلَى صُوَرِكُمْ وَأَمْوَالِكُمْ، وَلَكِنْ يَنْظُرُ إِلَى قُلُوبِكُمْ وَأَعْمَالِكُمْ', r: 'رواه مسلم (2564)' },
    { t: 'الطُّهُورُ شَطْرُ الْإِيمَانِ', r: 'رواه مسلم (223)' },
    { t: 'مِنْ حُسْنِ إِسْلَامِ الْمَرْءِ تَرْكُهُ مَا لَا يَعْنِيهِ', r: 'رواه الترمذي (2317)' },
    { t: 'أَكْمَلُ الْمُؤْمِنِينَ إِيمَانًا أَحْسَنُهُمْ خُلُقًا', r: 'رواه أبو داود (4682) والترمذي (1162)' },
    { t: 'الرَّاحِمُونَ يَرْحَمُهُمُ الرَّحْمَنُ، ارْحَمُوا مَنْ فِي الْأَرْضِ يَرْحَمْكُمْ مَنْ فِي السَّمَاءِ', r: 'رواه أبو داود (4941) والترمذي (1924)' },
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
const CARD_THEME = {
  green: ['#0B5D4B', '#12806A', '#E9C46A'],   // Joumou'a, Mawlid, nouvel an…
  night: ['#141F3D', '#3B2F63', '#E9C46A'],   // Ramadan, Qadr, jours blancs
  gold:  ['#5B2A1E', '#B5652E', '#FFE3A3'],   // Aïds
  teal:  ['#0E4A5C', '#1F7A8C', '#F3DDB0'],   // Achoura, Arafat (jeûne)
  dawn:  ['#1D4E6E', '#C9804A', '#FFE9B8'],   // Sabah el-khir (lever du jour)
};
const themeOf = key => (['occFitr', 'occAdha'].includes(key) ? 'gold'
  : ['occRamadan', 'occQadr', 'white', 'occNisfShaban'].includes(key) ? 'night'
  : ['occAshura', 'occArafa', 'dua'].includes(key) ? 'teal' : key === 'morning' ? 'dawn' : 'green');   // hadith : vert
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
  out.sort((a, b) => a.noon - b.noon);
  // cartes de tous les jours (sans date)
  const day = Math.floor(today / DAY_MS);
  for (const k of ['morning', 'dua', 'hadith']) out.push({ key: k, i: day % CARD_TEXTS[k].length, noon: today, evergreen: true, pick: true });
  return out;
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
function drawMosque(g, W, H, color, scene = 'koutoubia') {  // silhouette en bas de carte
  if (scene === 'zellige') return;
  const [main, , far] = CARD_SCENES[scene];
  g.save(); g.fillStyle = color; g.translate(W / 2 - 540, H - 420); g.scale(5.4, 5.4);
  if (far) { g.globalAlpha = .06; g.fill(new Path2D(far)); }
  g.globalAlpha = .13; g.fill(new Path2D(main));
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

async function buildGreetingCard(spec) {
  try { await Promise.all([document.fonts.load('700 60px Amiri'), document.fonts.load('700 60px "Reem Kufi"'), document.fonts.ready]); } catch {}
  const W = 1080, H = 1350, key = spec.key;
  const [c1, c2, accent] = CARD_THEME[themeOf(key)];
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  let g = cv.getContext('2d');
  const plex = (w, px) => `${w} ${px}px "IBM Plex Sans Arabic", system-ui, sans-serif`;
  const amiri = (w, px) => `${w} ${px}px Amiri, "IBM Plex Sans Arabic", serif`;
  const kufi = px => `700 ${px}px "Reem Kufi", "IBM Plex Sans Arabic", sans-serif`;
  const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, c1); grad.addColorStop(1, c2);
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  // fond : Koutoubia, Hassan II, mosquée rurale ou zellige — change à chaque carte, le contenu ne bouge pas
  const scene = spec.scene || SCENE_KEYS[Math.floor(Math.random() * SCENE_KEYS.length)];
  if (scene === 'zellige') drawZellige(g, W, H, accent); else drawStars(g, W, accent);
  if (themeOf(key) === 'night') {                        // lune
    g.fillStyle = accent; g.globalAlpha = .9; g.beginPath(); g.arc(W - 170, 170, 70, 0, 7); g.fill();
    if (key !== 'white') { g.globalAlpha = 1; g.fillStyle = c1; g.beginPath(); g.arc(W - 140, 150, 62, 0, 7); g.fill(); }
    g.globalAlpha = 1;
  }
  drawMosque(g, W, H, '#fff', scene);
  // le contenu est dessiné sur un calque, puis centré verticalement au-dessus de la dédicace
  const base = g, layer = document.createElement('canvas'); layer.width = W; layer.height = H;
  g = layer.getContext('2d');
  const [arTitle, arLine] = CARD_AR[key] || [t(key), ''];
  g.textAlign = 'center'; g.direction = 'rtl'; g.textBaseline = 'alphabetic';
  const top = 120; let y = top + 110;
  g.fillStyle = accent; g.font = kufi(key === 'occMawlid' || key === 'occIsra' ? 84 : 112);
  g.fillText(arTitle, W / 2, y);
  y += 80;
  if (key === 'occNewYear' && spec.h) { g.font = amiri(700, 60); g.fillStyle = '#fff'; g.fillText(`${spec.h.y} هـ`, W / 2, y); y += 70; }
  if (arLine) { g.font = amiri(400, 56); g.fillStyle = '#fff'; g.fillText(arLine, W / 2, y); y += 70; }
  // texte sourcé (verset, hadith, dhikr ou doua)
  const txt = cardTextOf(spec);
  if (txt) {
    let size = 52, lines;
    do { g.font = amiri(700, size); lines = wrapLines(g, txt.q ? `﴿ ${txt.t} ﴾` : `« ${txt.t} »`, W - 200); size -= 4; }
    while (lines.length > 6 && size > 36);
    const lh = Math.round((size + 4) * 1.5), boxH = lines.length * lh + 100;
    g.fillStyle = 'rgba(255,255,255,.10)'; g.beginPath(); g.roundRect(70, y - 10, W - 140, boxH, 36); g.fill();
    g.fillStyle = '#fff'; lines.forEach((ln, i) => g.fillText(ln, W / 2, y + 60 + i * lh));
    g.font = amiri(400, 32); g.fillStyle = accent; g.fillText(txt.r, W / 2, y + boxH - 34);
    y += boxH + 50;
  }
  const sub = cardSubLocal(key);
  g.direction = document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';
  if (sub && !spec.evergreen) { g.font = plex(500, 36); g.fillStyle = '#fff'; g.globalAlpha = .92; g.fillText(sub, W / 2, y); g.globalAlpha = 1; y += 58; }
  // date(s) — pas de ville ni d'horaires : la carte peut être envoyée partout au Maroc
  const dateFmt = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  g.font = plex(400, 32); g.fillStyle = '#fff'; g.globalAlpha = .88;
  if (key === 'white' && spec.list) {
    const df = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    spec.list.forEach(x => { g.fillText(`${df.format(x.noon)} · ${hijriLabel(x.h)}`, W / 2, y); y += 50; });
  } else if (!spec.evergreen) {
    g.fillText(dateFmt.format(spec.noon), W / 2, y); y += 48;
    g.fillText(hijriLabel(hijriOf(spec.noon, S().hijriOffset)), W / 2, y); y += 40;
  }
  g.globalAlpha = 1;
  const zoneTop = 90, zoneBottom = H - 270;            // entre le haut et la dédicace
  const dy = Math.max(zoneTop - top, Math.round((zoneTop + zoneBottom) / 2 - (top + y - 30) / 2));
  base.drawImage(layer, 0, dy);
  g = base; g.textAlign = 'center'; g.direction = 'rtl';   // le canevas hors écran est en LTR par défaut : pied de carte en arabe
  // dédicace (facultative) : « من: … »
  const from = (S().cardFrom || '').trim();
  if (from) {
    g.direction = 'rtl'; g.font = amiri(700, 44); g.fillStyle = accent;
    g.fillText(`من: ${from}`, W / 2, H - 215);
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
  const body = cardTextOf(spec);
  if (body) txt += `\n\n${body.q ? `﴿ ${body.t} ﴾` : `« ${body.t} »`}\n${body.r}`;
  const from = (S().cardFrom || '').trim();
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
const preview = (text, n = 6) => { const w = text.split(/\s+/); return w.slice(0, n).join(' ') + (w.length > n ? ' …' : ''); };

/** Liste déroulante de tous les textes d'une catégorie : un toucher = partage direct */
function pickPanel(sp) {
  const panel = document.createElement('li'); panel.className = 'pick-panel'; panel.hidden = true;
  const ul = document.createElement('ul'); ul.className = 'pick-list';
  const order = CARD_TEXTS[sp.key].map((_, i) => i);
  for (let k = order.length - 1; k > 0; k--) { const r = Math.floor(Math.random() * (k + 1)); [order[k], order[r]] = [order[r], order[k]]; }
  order.forEach(i => { const x = CARD_TEXTS[sp.key][i];   // ordre différent à chaque ouverture
    const item = document.createElement('li'), btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = '<span class="pt"></span><small></small>';
    btn.querySelector('.pt').textContent = x.q ? `﴿ ${x.t} ﴾` : x.t;
    btn.querySelector('small').textContent = x.r;
    btn.addEventListener('click', () => shareCard({ ...sp, i }));
    item.append(btn); ul.append(item);
  });
  panel.append(ul);
  return panel;
}

function renderCards() {
  const df = new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const specs = cardSpecs().map((sp, n) => ({ sp, n })).sort((a, b) => cardRank(a.sp) - cardRank(b.sp) || a.n - b.n).map(x => x.sp);
  const rows = [];
  for (const sp of specs) {
    const li = document.createElement('li');
    const title = sp.key === 'imsakiya' ? `${t('imsakiya')} ${sp.mon.y}`
      : getLang() === 'ar' ? (CARD_AR[sp.key] || [t(sp.key)])[0]
      : t({ jumuah: 'cardJumuah', white: 'whiteDays' }[sp.key] || sp.key);
    const sub = sp.key === 'imsakiya' ? gregSpan(sp.mon)
      : sp.pick ? `${CARD_TEXTS[sp.key].length} ${t('textsCount')}`
      : sp.evergreen ? preview(cardTextOf(sp).t)
      : `${df.format(sp.noon)} · ${whenLabel(sp.noon)}`;
    li.innerHTML = '<div class="cl-txt"><b></b><small></small></div><div class="cl-btns"><button class="btn small btn-primary" type="button"></button></div>';
    li.querySelector('b').textContent = title;
    li.querySelector('small').textContent = sub;
    const b = li.querySelector('button');
    rows.push(li);
    if (sp.pick) {                                        // doua / hadith : ouvrir la liste pour choisir
      const panel = pickPanel(sp);
      b.textContent = t('chooseText') + ' ▾'; b.setAttribute('aria-expanded', 'false');
      b.addEventListener('click', () => {
        panel.hidden = !panel.hidden;
        b.setAttribute('aria-expanded', String(!panel.hidden));
        b.textContent = t('chooseText') + (panel.hidden ? ' ▾' : ' ▴');
      });
      rows.push(panel);
      continue;
    }
    b.textContent = sp.key === 'imsakiya' ? t('imsakiya') : t('shareCard');
    b.addEventListener('click', () => shareCard(sp));
  }
  $('#cardsList').replaceChildren(...rows);
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
    ? `🌙 ${(CARD_AR[sp.key] || [t(sp.key)])[0]} · ${t('shareCard')}`
    : `${daily.key === 'dua' ? '🤲' : '📖'} ${preview(cardTextOf(daily).t, 7)}`;   // début du texte : suscite la curiosité
  chip.setAttribute('aria-label', `${t('shareCard')} : ${$('#occTxt').textContent}`);
  chip.classList.toggle('daily', !sp);
}

function calShift(dir) {
  const mon = state.calMonth; if (!mon) return;
  state.calAnchor = dir > 0 ? mon.days.at(-1).noon + 864e5 : mon.days[0].noon - 864e5;
  renderCalendar();
}

// ================= Compte à rebours + événements =================
const countdown = new Countdown({
  onTick(remaining, tNow) {
    $('#clock').textContent = fmtTime(tNow);
    if (state.elapsed) {
      const txt = '+' + formatHMS(Math.max(0, tNow - state.elapsed.ts)).replace(/^00:/, '');   // +19:05
      $('#countdown').textContent = txt;
      document.title = `${t(state.elapsed.name)} ${txt}`;
    } else if (remaining != null) {
      $('#countdown').textContent = formatHMS(remaining);
      document.title = `${t(state.next.name)} ${formatHMS(remaining)}`;
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
function detectTwa() {
  const n = new URLSearchParams(location.search).get('native');
  if (n === '1') localStorage.setItem('priere.native', '1');
  if (n === '0') localStorage.removeItem('priere.native');       // retour sans module : désactivé
  if (!isTwa()) { localStorage.removeItem('priere.nativeAt'); localStorage.removeItem('priere.nativeDirty'); }
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
  await Promise.all([today.slice(0, 7), addDays(today, 31).slice(0, 7)].map(ym => ensureMonth(S(), ym).catch(() => false)));
  const times = [];
  for (let i = 0; i < 31; i++) {
    const d = getDay(S(), addDays(today, i));
    times.push(PRAYERS.map(k => Math.round((d.times[k] || 0) / 60000)));
  }
  const a = S().adhan;
  const su = S().silentUntil === -1 ? 32503680000000 : (S().silentUntil || 0);
  return {
    v: 1, lat: +loc.lat.toFixed(5), lng: +loc.lng.toFixed(5), tz: tz(), method: S().method, school: S().school,
    adj: S().adjust, en: !!a.enabled, na: !!a.notifyAt, nb: a.notifyBefore || 0, vib: !!a.vibrate, su, on: !!S().ongoing, gr: GRACE_MIN,
    hj: Array.from({ length: 31 }, (_, i) => fmtDates(Date.parse(`${addDays(today, i)}T12:00:00Z`)).hijri),
    ad: Object.fromEntries(PRAYERS.map(k => [k, a.enabled ? nativeSound(adhanFor(k)) : 'none'])),
    names: Object.fromEntries(PRAYERS.map(k => [k, t(k)])),
    txt: { itsTime: t('itsTime'), before: t('beforeMsg'), stop: t('stop'), ok: t('nativeOk'), city: loc.name || '',
           chAdhan: t('chAdhan'), chBefore: t('chBefore'), chSilent: t('chSilent'), chOngoing: t('chOngoing') },
    times,
  };
}
async function syncNative({ ask = false, quiet = false, test = false } = {}) {
  if (!isTwa()) return;
  const payload = await nativePayload(); if (!payload) return;
  localStorage.setItem('priere.nativeAt', String(Date.now()));
  localStorage.removeItem('priere.nativeDirty');
  const q = `d=${encodeURIComponent(JSON.stringify(payload))}${ask ? '&ask=1' : ''}${quiet ? '&quiet=1' : ''}${test ? '&test=1' : ''}`;
  // si le module est absent, Android revient ici (native=0) au lieu d'ouvrir le Play Store
  const back = encodeURIComponent(`${location.origin}${location.pathname}?native=0#settings`);
  location.href = `intent://sync?${q}#Intent;scheme=salati;package=${TWA_PKG};S.browser_fallback_url=${back};end`;
  renderNative();
}
// Android n'accepte l'ouverture du module que lors d'un geste de l'utilisateur :
// sinon on note qu'une mise à jour est à faire, et on la fait au prochain toucher.
function requestNativeSync() {
  if (!nativeActive()) return;
  if (navigator.userActivation ? navigator.userActivation.isActive : true) syncNative({ quiet: true });
  else localStorage.setItem('priere.nativeDirty', '1');
}
function nativeNeedsSync() {
  if (!nativeActive()) return false;
  if (localStorage.getItem('priere.nativeV') !== '2') { localStorage.setItem('priere.nativeV', '2'); localStorage.setItem('priere.nativeDirty', '1'); }
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
  $('#sAdhanShort').checked = !!a.short;
  renderNative();
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
  $('#sTz').value = s.tzMode || 'auto';
  $('#sOngoing').checked = !!s.ongoing;
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
  on('#sMethod', 'change', e => { S().method = Number(e.target.value); S().methodAuto = false; save(); refresh(); });
  on('#sSchool', 'change', e => { S().school = Number(e.target.value); save(); refresh(); });
  on('#sAdhanOn', 'change', e => { S().adhan.enabled = e.target.checked; save(); if (e.target.checked) unlockAudio(); });
  on('#sAdhanMode', 'change', e => { S().adhan.mode = e.target.value; save(); renderAdhanPickers(); });
  on('#sVolume', 'input', e => { S().adhan.volume = Number(e.target.value); save(); });
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
  on('#sHijri', 'change', e => { S().hijriOffset = Number(e.target.value); save(); renderHeader(); });
  on('#sDecl', 'change', e => { S().declination = Math.max(-30, Math.min(30, Number(String(e.target.value).replace(',', '.')) || 0)); save(); state.decl = currentDeclination(); });
  on('#sDeclAuto', 'change', e => { S().declAuto = e.target.checked; save(); state.decl = currentDeclination(); renderSettings(); });
  on('#syncBtn', 'click', async () => { await syncClock(); computeNext(); renderSettings(); });
  on('#clearBtn', 'click', () => { clearMonths(); toast(t('cleared')); refresh(); });
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
  on('#adhanStop', 'click', () => { stopAdhan(); hideAdhanAlert(); });
  on('#adhanSilent', 'click', () => { stopAdhan(); hideAdhanAlert(); renderSilent(); $('#silentDialog').showModal(); });
  on('#silentBtn', 'click', () => { renderSilent(); $('#silentDialog').showModal(); });
  document.querySelectorAll('[data-silent]').forEach(b => b.addEventListener('click', () => { setSilent(b.dataset.silent); $('#silentDialog').close(); }));
  on('#calPrev', 'click', () => calShift(-1));
  on('#calNext', 'click', () => calShift(1));
  on('#calToday', 'click', () => { state.calAnchor = null; renderCalendar(); });
  on('#calMonthTable', 'click', () => openMonthTable());
  on('#calCards', 'click', () => go('cards'));
  on('#occChip', 'click', () => { const sp = state.chipSpec; if (sp) shareCard(sp); else go('cards'); });
  on('#occMore', 'click', () => go('cards'));
  on('#settingsBtn', 'click', () => go('settings'));
  on('#monthPrint', 'click', printMonthTable);
  on('#monthShare', 'click', shareMonthTable);
  on('#cardFrom', 'change', e => { S().cardFrom = e.target.value.trim().slice(0, 40); save(); });
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

export const APP_VERSION = '2.5.1';

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
  applyTheme();
  applyLang();
  buildDial();
  bind();
  registerSW();
  countdown.start();

  const view = (location.hash || '#home').slice(1);
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
  syncClock().then(() => { if (state.today) computeNext(); });
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
