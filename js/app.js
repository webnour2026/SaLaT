import { t, setLang, locale, getLang } from './i18n.js';
import { loadSettings, saveSettings, clearMonths, PRAYERS } from './storage.js';
import { now, syncClock, getOffset } from './clock.js';
import { ensureMonths, getDay, findNext, dateKeyInTz, addDays, deviceTz } from './prayer-times.js';
import { Countdown, formatHMS } from './countdown.js';
import { qiblaBearing, distanceToKaaba, cardinalIndex } from './qibla.js';
import { Compass } from './compass.js';
import { declination as wmmDeclination } from './wmm.js';
import { sunPosition, timesAtAzimuth } from './sun.js';
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
  if (view !== 'qibla') compass.stop();
  if (view === 'qibla') { renderQibla(); if (!Compass.needsPermission()) compass.start(); }
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
    if (tNow % 60000 < 1000) { renderHome(); if (!$('#view-qibla').hidden) renderSun(); } // chaque minute
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
function currentDeclination() {
  const loc = S().location;
  if (!S().declAuto || !loc) return Number(S().declination) || 0;
  try { return wmmDeclination(loc.lat, loc.lng, 0); } catch { return Number(S().declination) || 0; }
}
const fmtDeg = (v, digits = 1) => v.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });

const compass = new Compass({
  onHeading(magnetic, { flat, source, accuracy, quality }) {
    if (state.qibla == null) return;
    const heading = (magnetic + state.decl + 360) % 360; // → nord géographique
    // angle cumulé : la rose ne fait pas un tour complet entre 359° et 0°
    const target = -heading;
    state.roseAngle = state.roseAngle ?? target;
    state.roseAngle += ((target - state.roseAngle + 540) % 360) - 180;
    $('#rose').style.transform = `rotate(${state.roseAngle}deg)`;
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
    else { msg.textContent = `${diff > 0 ? t('turnRight') : t('turnLeft')} \u2066${Math.round(Math.abs(diff))}°\u2069`; msg.className = 'compass-msg'; }
    compass.wasAligned = aligned;
  },
  onStatus(s) {
    compass.lastStatus = s;
    const map = { unsupported: 'compassUnsupported', denied: 'compassDenied', nodata: 'compassNoData', relative: 'compassRelative' };
    if (map[s]) {
      $('#compassMsg').textContent = t(map[s]); $('#compassMsg').className = 'compass-msg alert-s';
      $('#rose').style.transform = ''; state.roseAngle = null; $('#headingBig').textContent = '--';
      setSensor('off');
    }
    if (s === 'calibrate') setSensor('poor');
    $('#compassStart').hidden = s === 'ok' || s === 'calibrate';
  },
});

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
    tx.setAttribute('transform', `rotate(${a} ${x.toFixed(1)} ${y.toFixed(1)})`);
    tx.setAttribute('class', i === 0 ? 'rlabel n' : 'rlabel');
    tx.textContent = n;
    return tx;
  })()).filter(Boolean));
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
  $('#sDecl').addEventListener('change', e => { S().declination = Math.max(-30, Math.min(30, Number(String(e.target.value).replace(',', '.')) || 0)); save(); state.decl = currentDeclination(); });
  $('#sDeclAuto').addEventListener('change', e => { S().declAuto = e.target.checked; save(); state.decl = currentDeclination(); renderSettings(); });
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
  $('#langBtn').addEventListener('click', () => {
    S().lang = { fr: 'ar', ar: 'en', en: 'fr' }[S().lang] || 'fr';
    save(); applyLang(); renderAll();
    if (!$('#view-settings').hidden) renderSettings();
    if (!$('#view-qibla').hidden) renderQibla();
  });
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
  // premier lancement : langue de l'appareil (arabe si le téléphone est en arabe)
  if (!localStorage.getItem('priere.settings.v1')) {
    const dev = (navigator.language || 'fr').slice(0, 2);
    S().lang = ['ar', 'fr', 'en'].includes(dev) ? dev : 'fr';
    save();
  }
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
