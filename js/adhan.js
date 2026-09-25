// Adhan (audio), vibration et notifications.
// Sons disponibles. Tous sont téléchargés automatiquement par le workflow GitHub
// « Télécharger les Adhans » (Freesound + Wikimedia Commons, licences libres vérifiées).
export const ADHANS = [
  { id: 'makkah',     labelKey: 'adhanMakkah',     file: 'audio/adhan/makkah.mp3' },
  { id: 'makkah2',    labelKey: 'adhanMakkah2',    file: 'audio/adhan/makkah2.mp3' },
  { id: 'madinah',    labelKey: 'adhanMadinah',    file: 'audio/adhan/madinah.mp3' },
  { id: 'casablanca', labelKey: 'adhanCasablanca', file: 'audio/adhan/casablanca.mp3' },
  { id: 'morocco',    labelKey: 'adhanAtlas',      file: 'audio/adhan/morocco.mp3' },
  { id: 'aaqib',      labelKey: 'adhanAaqib',      file: 'audio/adhan/aaqib.mp3' },
  { id: 'adhan1',     labelKey: 'adhanCalm',       file: 'audio/adhan/adhan1.mp3' },
  { id: 'beep',       labelKey: 'beep' },
  { id: 'none',       labelKey: 'noneAdhan' },
];
const FALLBACK_ORDER = ['makkah', 'casablanca', 'madinah', 'aaqib', 'makkah2', 'morocco', 'adhan1'];

// ---------- Adhan personnel (fichier choisi par l'utilisateur, gardé sur l'appareil) ----------
const DB = 'priere-audio', STORE = 'files';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, mode);
    const q = fn(tx.objectStore(STORE));
    tx.oncomplete = () => res(q && q.result);
    tx.onerror = () => rej(tx.error);
  });
}
function canPlay(url) {
  return new Promise((res, rej) => {
    const a = new Audio();
    const done = ok => { clearTimeout(tm); a.src = ''; ok ? res() : rej(new Error('decode')); };
    const tm = setTimeout(() => done(false), 10000);
    a.addEventListener('loadedmetadata', () => done(true), { once: true });
    a.addEventListener('error', () => done(false), { once: true });
    a.preload = 'metadata'; a.src = url;
  });
}
// Plusieurs Adhans personnels : chacun est stocké sous la clé « u:<horodatage> » et apparaît
// dans la liste avec son nom de fichier. Ils restent sur l'appareil (jamais envoyés au site).
const urlCache = new Map();
const niceName = n => n.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Adhan';

/** Lit les Adhans importés et les ajoute à ADHANS (avant « Bip » et « Aucun »).
 *  Convertit l'ancien emplacement unique « custom ». Renvoie { migratedTo } si besoin. */
export async function loadCustomAdhans() {
  let migratedTo = null;
  try {
    const old = await idbDo('readonly', st => st.get('custom'));
    if (old) {
      migratedTo = `u:${old.ts || Date.now()}`;
      await idbDo('readwrite', st => { st.put(old, migratedTo); return st.delete('custom'); });
    }
    const keys = (await idbDo('readonly', st => st.getAllKeys())) || [];
    const recs = await Promise.all(keys.filter(k => String(k).startsWith('u:')).map(async k => [k, await idbDo('readonly', st => st.get(k))]));
    for (let i = ADHANS.length - 1; i >= 0; i--) if (ADHANS[i].custom) ADHANS.splice(i, 1);
    const at = ADHANS.findIndex(x => x.id === 'beep');
    const items = recs.filter(([, r]) => r).sort((x, y) => x[1].ts - y[1].ts)
      .map(([k, r]) => ({ id: k, label: '★ ' + niceName(r.name), custom: true, size: r.size, name: r.name }));
    ADHANS.splice(at, 0, ...items);
  } catch { /* IndexedDB indisponible (navigation privée) */ }
  return { migratedTo };
}
export const customAdhans = () => ADHANS.filter(x => x.custom);

/** Importe un fichier audio du téléphone. Renvoie l'id créé. Lève 'type', 'size' ou 'decode'. */
export async function importCustomAdhan(file) {
  const okType = (file.type || '').startsWith('audio/') || /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm|3gp|amr)$/i.test(file.name);
  if (!okType) throw new Error('type');
  if (file.size > 30e6) throw new Error('size');
  const url = URL.createObjectURL(file);
  try { await canPlay(url); } finally { URL.revokeObjectURL(url); }
  const start = await voiceStart(file);
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const id = `u:${ts}`;
  await idbDo('readwrite', st => st.put({ blob: file, name: file.name, size: file.size, start, ts }, id));
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch {}
  return id;
}
export async function removeCustomAdhan(id) {
  try { await idbDo('readwrite', st => st.delete(id)); } catch {}
  const u = urlCache.get(id); if (u) { URL.revokeObjectURL(u.split('#')[0]); urlCache.delete(id); }
  const i = ADHANS.findIndex(x => x.id === id); if (i >= 0) ADHANS.splice(i, 1);
}

/**
 * Début de la voix dans un fichier importé (en secondes) : ignore les bruits courts du début
 * (ouverture du micro, clic) et le bruit de fond, comme le workflow de conversion.
 */
async function voiceStart(file) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    const buf = await ac.decodeAudioData(await file.arrayBuffer());
    ac.close && ac.close();
    const data = buf.getChannelData(0), W = Math.round(buf.sampleRate * 0.05);
    const n = Math.min(Math.floor(data.length / W), 20 * 60 * 5);   // 5 premières minutes max
    const db = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = i * W, e = j + W; j < e; j++) sum += data[j] * data[j];
      db[i] = 10 * Math.log10(sum / W + 1e-12);
    }
    const sorted = Array.from(db).sort((a, b) => a - b);
    const floor = sorted[Math.floor(n * 0.15)], peak = sorted[Math.floor(n * 0.95)];
    const thr = floor + 0.5 * (peak - floor);
    let run = 0, gap = 0, runStart = 0;
    for (let i = 0; i < n; i++) {
      if (db[i] > thr) { if (run === 0) runStart = i; run += 1 + gap; gap = 0; }
      else if (run) { gap++; if (gap > 8) { run = 0; gap = 0; } }
      if (run >= 30) return Math.max(0, runStart * 0.05 - 0.25);        // ≥ 1,5 s de voix
    }
  } catch { /* fichier non décodable ici : on joue depuis le début */ }
  return 0;
}
async function sourceFor(item) {
  if (!item.custom) return item.file;
  if (urlCache.has(item.id)) return urlCache.get(item.id);
  const r = await idbDo('readonly', st => st.get(item.id));
  if (!r) throw new Error('absent');
  // on saute ce qui précède la voix (ouverture du micro, bruit) : fragment #t=
  const u = URL.createObjectURL(r.blob) + (r.start > 0.3 ? `#t=${r.start.toFixed(2)}` : '');
  urlCache.set(item.id, u);
  return u;
}

let audio = null;
let ctx = null;
let beepNodes = [];
let onEnded = null;

/** Débloque l'audio : les navigateurs exigent un premier geste de l'utilisateur. */
export function unlockAudio() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {}
}

export function stopAdhan() {
  if (audio) { audio.pause(); audio.src = ''; audio = null; }
  beepNodes.forEach(n => { try { n.stop(); } catch {} });
  beepNodes = [];
  if ('mediaSession' in navigator) { try { navigator.mediaSession.playbackState = 'none'; } catch {} }
  if (onEnded) { const f = onEnded; onEnded = null; f(); }
}

async function tryFile(file, volume) {
  const a = new Audio(file);
  a.volume = Math.min(1, Math.max(0, volume));
  await a.play();
  return a;
}

// Contrôle depuis l'écran verrouillé / la barre de notifications (Android, iOS)
function setupMediaSession(title) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title, artist: 'Prière', artwork: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    });
    for (const action of ['pause', 'stop']) navigator.mediaSession.setActionHandler(action, () => stopAdhan());
    navigator.mediaSession.playbackState = 'playing';
  } catch {}
}

/**
 * Joue un Adhan. Si le fichier choisi manque, essaie les autres Adhans disponibles, puis un bip.
 * Renvoie 'played' | 'fallback' | 'beep' | 'none'. `ended` est appelé à la fin ou à l'arrêt.
 */
export async function playAdhan(id, volume = 0.8, { title = '', ended = null } = {}) {
  stopAdhan();
  const item = ADHANS.find(a => a.id === id);
  if (!item || id === 'none') return 'none';
  onEnded = ended;
  if (id === 'beep') { beep(volume); setTimeout(() => { if (!beepNodes.length) stopAdhan(); }, 2000); return 'played'; }
  const order = [id, ...customAdhans().map(x => x.id), ...FALLBACK_ORDER].filter((x, i, arr) => arr.indexOf(x) === i);
  for (let i = 0; i < order.length; i++) {
    const it = ADHANS.find(a => a.id === order[i]);
    if (!it || !(it.file || it.custom)) continue;
    try {
      audio = await tryFile(await sourceFor(it), volume);
      audio.addEventListener('ended', () => stopAdhan(), { once: true });
      setupMediaSession(title || 'Adhan');
      return i === 0 ? 'played' : 'fallback';
    } catch { audio = null; }
  }
  beep(volume);
  setTimeout(() => stopAdhan(), 2000);
  return 'beep';
}

/** Vérifie quels fichiers existent (pour l'affichage dans les réglages). */
export async function availableAdhans() {
  const out = {};
  await Promise.all(ADHANS.filter(a => a.file).map(async a => {
    try { const r = await fetch(a.file, { method: 'HEAD', cache: 'no-store' }); out[a.id] = r.ok; }
    catch { out[a.id] = false; }
  }));
  return out;
}

export const isPlaying = () => !!(audio && !audio.paused) || beepNodes.length > 0;

function beep(volume) {
  unlockAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  [0, 0.6, 1.2].forEach((dt, i) => {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = i === 2 ? 880 : 660;
    gain.gain.setValueAtTime(0, t0 + dt);
    gain.gain.linearRampToValueAtTime(0.4 * volume, t0 + dt + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dt + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + dt); osc.stop(t0 + dt + 0.5);
    beepNodes.push(osc);
    osc.onended = () => { beepNodes = beepNodes.filter(n => n !== osc); };
  });
}

export function vibrate(pattern = [400, 200, 400, 200, 800]) {
  if ('vibrate' in navigator) try { navigator.vibrate(pattern); } catch {}
}

// ---------- notifications ----------
export const notifSupported = () => 'Notification' in window;
export const notifPermission = () => (notifSupported() ? Notification.permission : 'unsupported');

export async function requestNotifPermission() {
  if (!notifSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}

export async function notify(title, body, { tag, vibrateOn = true } = {}) {
  if (notifPermission() !== 'granted') return false;
  const opts = { body, tag, renotify: true, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', vibrate: vibrateOn ? [300, 150, 300] : undefined };
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) { await reg.showNotification(title, opts); return true; }
    new Notification(title, opts); return true;
  } catch { return false; }
}
