// Adhan (audio), vibration et notifications.
// Les fichiers MP3 ne sont PAS fournis : déposer des enregistrements libres de droits
// ou sous licence dans /audio/adhan/ avec les noms ci-dessous.
export const ADHANS = [
  { id: 'morocco', labelKey: 'adhanMorocco', file: 'audio/adhan/morocco.mp3' },
  { id: 'makkah',  labelKey: 'adhanMakkah',  file: 'audio/adhan/makkah.mp3' },
  { id: 'madinah', labelKey: 'adhanMadinah', file: 'audio/adhan/madinah.mp3' },
  { id: 'egypt',   labelKey: 'adhanEgypt',   file: 'audio/adhan/egypt.mp3' },
  { id: 'adhan1',  label: 'Adhan 1', file: 'audio/adhan/adhan1.mp3' },
  { id: 'adhan2',  label: 'Adhan 2', file: 'audio/adhan/adhan2.mp3' },
  { id: 'adhan3',  label: 'Adhan 3', file: 'audio/adhan/adhan3.mp3' },
  { id: 'beep',    labelKey: 'beep' },
  { id: 'none',    labelKey: 'noneAdhan' },
];

let audio = null;
let ctx = null;
let beepNodes = [];

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
}

/** Joue un Adhan. Renvoie 'played' | 'fallback' (fichier absent → bip) | 'none'. */
export async function playAdhan(id, volume = 0.8) {
  stopAdhan();
  const item = ADHANS.find(a => a.id === id);
  if (!item || id === 'none') return 'none';
  if (id === 'beep') { beep(volume); return 'played'; }
  audio = new Audio(item.file);
  audio.volume = Math.min(1, Math.max(0, volume));
  try { await audio.play(); return 'played'; }
  catch { audio = null; beep(volume); return 'fallback'; }
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
