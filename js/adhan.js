// Adhan (audio), vibration et notifications.
// Sons disponibles. Tous sont téléchargés automatiquement par le workflow GitHub
// « Télécharger les Adhans » (Freesound + Wikimedia Commons, licences libres vérifiées).
export const ADHANS = [
  { id: 'morocco', labelKey: 'adhanMorocco', file: 'audio/adhan/morocco.mp3',
    credit: 'Iain McCurdy — Aroumd (Maroc), Freesound, CC BY 4.0' },
  { id: 'madinah', labelKey: 'adhanMadinah', file: 'audio/adhan/madinah.mp3',
    credit: 'ejaz215 — Mosquée du Prophète, Wikimedia Commons, CC BY 3.0' },
  { id: 'adhan1', labelKey: 'adhanCalm', file: 'audio/adhan/adhan1.mp3',
    credit: '« Beautiful adhan », Wikimedia Commons, CC0' },
  { id: 'adhan2', labelKey: 'adhanClassic', file: 'audio/adhan/adhan2.mp3',
    credit: '« Adhan wiki », Wikimedia Commons, CC BY-SA 2.5' },
  { id: 'beep', labelKey: 'beep' },
  { id: 'none', labelKey: 'noneAdhan' },
];
const FALLBACK_ORDER = ['morocco', 'madinah', 'adhan1', 'adhan2'];

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
  const order = [id, ...FALLBACK_ORDER.filter(x => x !== id)];
  for (let i = 0; i < order.length; i++) {
    const it = ADHANS.find(a => a.id === order[i]);
    try {
      audio = await tryFile(it.file, volume);
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
