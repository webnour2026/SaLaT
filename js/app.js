import { t, setLang, locale, getLang } from './i18n.js';
import { loadSettings, saveSettings, clearMonths, PRAYERS } from './storage.js';
import { now, syncClock, getOffset } from './clock.js';
import { ensureMonths, getDay, findNext, dateKeyInTz, addDays, deviceTz } from './prayer-times.js';
import { Countdown, formatHMS } from './countdown.js';
import { qiblaBearing, distanceToKaaba, cardinalIndex } from './qibla.js';
import { Compass } from './compass.js';
import { ADHANS, playAdhan, stopAdhan, unlockAudio, vibrate, notify, requestNotifPermission, notifPermission } from './adhan.js';
import { PRESET_CITIES, METHOD_BY_COUNTRY, getGpsPosition, reverseGeocode, searchCity } from './location.js';

const $ = sel => document.querySelector(sel);
const METHOD_IDS = [21, 3, 5, 4, 1, 2, 13, 12, 19, 18, 8, 16, 15];
const LIST_ROWS = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
const EXTRA_ROWS = ['Imsak', 'Sunset', 'Midnight'];

const state = {
  settings: loadSettings(),
  today: null, tomorrow: null, next: null, dayKey: null,
  online: navigator.onLine, fetchFailed: false,
  fired: new Set(JSON.parse(sessionStorage.getItem('priere.fired') || '[]')),
  qibla: null,
};
const S = () => state.settings;
const save = () => saveSettings(state.settings);
const tz = () => S().location?.tz || deviceTz();

// ================= Formatage =================
const fmtTime = ts => ts == null ? '--:--'
  : new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz() }).format(ts);
const fmtClock = ts => new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: tz() }).format(ts);

function fmtDates(ts) {
  const greg = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz() }).format(ts);
  const shifted = ts + S().hijriOffset * 864e5;
  let hijri = '';
  try {
    hijri = new Intl.DateTimeFormat(`${locale().split('-u-')[0]}-u-ca-islamic-umalqura-nu-latn`,
      { day: 'numeric', month: 'long', year: 'numeric', timeZone: tz() }).format(shifted);
  } catch { /* calendrier islamique non pris en charge */ }
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
  const letters = { fr: ['N', 'E', 'S', 'O'], en: ['N', 'E', 'S', 'W'], ar: ['ش', 'ق', 'ج', 'غ'] }[getLang()];
  document.querySelectorAll('.dial-n, .dial-c').forEach((el, i) => { el.textContent = letters[i]; });
}

// ================= Navigation =================
function go(view) {
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== `view-${view}`; });
  document.querySelectorAll('.tabbar button').forEach(b => {
    if (b.dataset.goto === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  if (view !== 'qibla') compass.stop();
  if (view === 'qibla') renderQibla();
  if (view === 'settings') renderSettings();
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

function renderAll() { renderHeader(); renderHome(); }

function renderHeader() {
  const loc = S().location;
  $('#placeName').textContent = loc ? (loc.name || `${loc.lat.toFixed(3)}, ${loc.lng.toFixed(3)}`) : t('chooseCity');
  const { greg, hijri } = fmtDates(now());
  $('#gregDate').textContent = greg;
  $('#hijriDate').textContent = hijri;
}

function renderHome() {
  if (!state.today) return;
  const tNow = now();
  const { next } = state;
  let current = next.current;
  if (current === 'Fajr' && tNow >= state.today.times.Sunrise) current = null; // le temps du Fajr s'arrête au lever

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
    const mark = !isPrayer ? '☀' : isNext ? (document.dir === 'rtl' ? '←' : '→') : past ? '✓' : '○';
    li.innerHTML = `<span class="mark" aria-hidden="true">${mark}</span><span class="name"></span><time class="time"></time>`;
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

  const st = $('#status');
  st.classList.toggle('warn-s', state.today.source === 'local' || state.fetchFailed);
  if (state.today.source === 'local') st.textContent = t('localCalc');
  else {
    const when = new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(state.today.fetchedAt);
    st.textContent = `${state.fetchFailed || !navigator.onLine ? t('offline') + ' · ' : ''}${t('lastUpdate')} ${when}`;
  }
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
    if (state.dayKey && dateKeyInTz(tNow, tz()) !== state.dayKey) { loadDays(); renderAll(); refresh(); }
    checkEvents(tNow);
    if (tNow % 60000 < 1000) renderHome(); // rafraîchit les coches chaque minute
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
  const name = t(ev.p);
  if (ev.type === 'before') {
    notify(name, t('beforeMsg', { n: a.notifyBefore }), { tag: `before-${ev.p}`, vibrateOn: a.vibrate });
    return;
  }
  const msg = `${t('itsTime')} ${name}`;
  if (a.notifyAt) notify(msg, fmtTime(ev.ts), { tag: `at-${ev.p}`, vibrateOn: a.vibrate });
  if (a.vibrate) vibrate();
  if (a.enabled && adhanFor(ev.p) !== 'none') {
    $('#adhanAlertText').textContent = msg;
    $('#adhanAlert').hidden = false;
    const r = await playAdhan(adhanFor(ev.p), a.volume);
    if (r === 'fallback') toast(t('adhanMissing'), 5000);
    if (r !== 'played') setTimeout(() => { $('#adhanAlert').hidden = true; }, 8000);
  }
}

// ================= Qibla =================
const compass = new Compass({
  onHeading(magnetic, { flat }) {
    if (state.qibla == null) return;
    const heading = (magnetic + Number(S().declination || 0) + 360) % 360; // → nord géographique
    // angle cumulé pour que la rose ne fasse pas un tour complet entre 359° et 0°
    const target = -heading;
    state.roseAngle = state.roseAngle ?? target;
    state.roseAngle += ((target - state.roseAngle + 540) % 360) - 180;
    $('#rose').style.transform = `rotate(${state.roseAngle}deg)`;
    if (compass.lastStatus === 'calibrate') return;
    let diff = ((state.qibla - heading + 540) % 360) - 180; // −180…180
    const msg = $('#compassMsg');
    const aligned = Math.abs(diff) <= 3;
    $('#dial').classList.toggle('aligned', aligned && flat);
    if (!flat) { msg.textContent = t('notFlat'); msg.className = 'compass-msg alert-s'; return; }
    if (aligned) {
      msg.textContent = t('aligned'); msg.className = 'compass-msg ok-s';
      if (!compass.wasAligned) vibrate(60);
    } else {
      msg.textContent = `${diff > 0 ? t('turnRight') : t('turnLeft')} ${Math.round(Math.abs(diff))}°`;
      msg.className = 'compass-msg';
    }
    compass.wasAligned = aligned;
  },
  onStatus(s) {
    compass.lastStatus = s;
    const msg = $('#compassMsg');
    const map = { unsupported: 'compassUnsupported', denied: 'compassDenied', nodata: 'compassNoData', relative: 'compassRelative', calibrate: 'needCalibration' };
    if (map[s]) { msg.textContent = t(map[s]); msg.className = 'compass-msg alert-s'; }
    if (s === 'unsupported' || s === 'denied' || s === 'relative') { $('#rose').style.transform = ''; }
    if (s !== 'ok' && s !== 'calibrate') $('#compassStart').hidden = false;
    else $('#compassStart').hidden = true;
  },
});

function buildDial() {
  const g = $('#ticks');
  const ns = 'http://www.w3.org/2000/svg';
  for (let a = 0; a < 360; a += 5) {
    const major = a % 30 === 0;
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1', 0); l.setAttribute('x2', 0);
    l.setAttribute('y1', -130); l.setAttribute('y2', major ? -116 : a % 10 === 0 ? -121 : -125);
    l.setAttribute('transform', `rotate(${a})`);
    l.setAttribute('class', major ? 'dial-tick major' : 'dial-tick');
    g.append(l);
  }
}

function renderQibla() {
  const loc = S().location;
  if (!loc) return;
  state.qibla = qiblaBearing(loc.lat, loc.lng);
  const dist = distanceToKaaba(loc.lat, loc.lng);
  $('#qiblaDeg').textContent = state.qibla.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  $('#qiblaCardinal').textContent = t('cardinals')[cardinalIndex(state.qibla)];
  $('#qiblaDist').textContent = `${Math.round(dist).toLocaleString(locale())} km`;
  $('#kaabaMark').setAttribute('transform', `rotate(${state.qibla})`);
  if (!Compass.isSupported()) compass.onStatus('unsupported');
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
  $('#sNotifyAt').checked = a.notifyAt;
  $('#sNotifyBefore').replaceChildren(...[0, 5, 10, 15].map(n => new Option(n ? `${n} ${t('minBefore')}` : t('none'), n, false, n === a.notifyBefore)));
  updateNotifWarn();

  document.querySelectorAll('input[name="lang"]').forEach(r => { r.checked = r.value === s.lang; });
  document.querySelectorAll('input[name="theme"]').forEach(r => { r.checked = r.value === s.theme; });
  $('#sHijri').value = s.hijriOffset > 0 ? `+${s.hijriOffset}` : String(s.hijriOffset);
  $('#sDecl').value = s.declination;
  $('#clockOffset').textContent = `${getOffset() >= 0 ? '+' : ''}${Math.round(getOffset() / 1000)} s`;
}

function adhanOptions(selected) {
  return ADHANS.map(x => new Option(x.labelKey ? t(x.labelKey) : x.label, x.id, false, x.id === selected));
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
      const r = await playAdhan(sel.value, a.volume);
      if (r === 'fallback') toast(t('adhanMissing'), 5000);
      if (r === 'played') { btn.dataset.playing = '1'; btn.textContent = t('stop'); setTimeout(() => { delete btn.dataset.playing; btn.textContent = t('preview'); }, 15000); }
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
  $('#changeLoc').addEventListener('click', openLocationDialog);
  $('#sMethod').addEventListener('change', e => { S().method = Number(e.target.value); S().methodAuto = false; save(); refresh(); });
  $('#sSchool').addEventListener('change', e => { S().school = Number(e.target.value); save(); refresh(); });
  $('#sAdhanOn').addEventListener('change', e => { S().adhan.enabled = e.target.checked; save(); if (e.target.checked) unlockAudio(); });
  $('#sAdhanMode').addEventListener('change', e => { S().adhan.mode = e.target.value; save(); renderAdhanPickers(); });
  $('#sVolume').addEventListener('input', e => { S().adhan.volume = Number(e.target.value); save(); });
  $('#sVibrate').addEventListener('change', e => { S().adhan.vibrate = e.target.checked; save(); if (e.target.checked) vibrate(80); });
  $('#sNotifyAt').addEventListener('change', async e => {
    S().adhan.notifyAt = e.target.checked; save();
    if (e.target.checked) await ensureNotifPermission(); else updateNotifWarn();
  });
  $('#sNotifyBefore').addEventListener('change', async e => {
    S().adhan.notifyBefore = Number(e.target.value); save();
    if (S().adhan.notifyBefore > 0) await ensureNotifPermission(); else updateNotifWarn();
  });
  $('#testNotif').addEventListener('click', async () => {
    if (await ensureNotifPermission()) notify(`${t('itsTime')} ${t('Asr')}`, fmtTime(now()), { tag: 'test', vibrateOn: S().adhan.vibrate });
  });
  $('#sLang').addEventListener('change', e => { S().lang = e.target.value; save(); applyLang(); renderAll(); renderSettings(); renderQibla(); });
  $('#sTheme').addEventListener('change', e => { S().theme = e.target.value; save(); applyTheme(); });
  $('#sHijri').addEventListener('change', e => { S().hijriOffset = Number(e.target.value); save(); renderHeader(); });
  $('#sDecl').addEventListener('change', e => { S().declination = Math.max(-30, Math.min(30, Number(e.target.value) || 0)); save(); });
  $('#syncBtn').addEventListener('click', async () => { await syncClock(); computeNext(); renderSettings(); });
  $('#clearBtn').addEventListener('click', () => { clearMonths(); toast(t('cleared')); refresh(); });
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
  $('#placeBtn').addEventListener('click', openLocationDialog);
  $('#gpsBtn').addEventListener('click', useGps);
  $('#citySearch').addEventListener('input', onSearch);
  $('#compassStart').addEventListener('click', async () => { unlockAudio(); await compass.start(); });
  $('#calibrateBtn').addEventListener('click', () => $('#calDialog').showModal());
  $('#adhanStop').addEventListener('click', () => { stopAdhan(); $('#adhanAlert').hidden = true; });
  // l'audio ne peut démarrer qu'après un premier geste de l'utilisateur
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('online', () => { state.online = true; refresh(); syncClock(); });
  window.addEventListener('offline', () => { state.online = false; renderHome(); });
  bindSettings();
}

function init() {
  applyTheme();
  applyLang();
  buildDial();
  bind();
  registerSW();
  countdown.start();

  const view = (location.hash || '#home').slice(1);
  go(['home', 'qibla', 'settings'].includes(view) ? view : 'home');

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

init();
