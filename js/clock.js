// Horloge : heure système + correction si le téléphone est déréglé.
// La synchro lit l'en-tête HTTP "Date" du propre serveur de l'appli (même origine,
// donc lisible), en compensant le temps d'aller-retour.
const KEY = 'priere.clockOffset';
const THRESHOLD = 2000; // l'en-tête Date est à la seconde : on ignore les écarts < 2 s

let offset = Number(localStorage.getItem(KEY)) || 0;

export const now = () => Date.now() + offset;
export const getOffset = () => offset;

export async function syncClock() {
  if (!navigator.onLine) return null;
  const samples = [];
  for (let i = 0; i < 3; i++) {
    try {
      const t0 = Date.now();
      const res = await fetch(`./index.html?__clock=${t0}`, { method: 'HEAD', cache: 'no-store' });
      const t1 = Date.now();
      const header = res.headers.get('Date');
      if (!header) continue;
      // +500 ms : milieu de la seconde annoncée par le serveur
      samples.push({ rtt: t1 - t0, off: new Date(header).getTime() + 500 - (t0 + t1) / 2 });
    } catch { /* hors ligne */ }
  }
  if (!samples.length) return null;
  samples.sort((a, b) => a.rtt - b.rtt);
  const measured = samples[0].off;
  offset = Math.abs(measured) >= THRESHOLD ? Math.round(measured) : 0;
  try { localStorage.setItem(KEY, String(offset)); } catch {}
  return offset;
}
