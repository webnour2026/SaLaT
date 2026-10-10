// Mode Mosquée — règles pures (sans DOM), identiques à MosqueMath.java (module Android).
//
// Cycle d'une prière T :
//   T        Adhan
//   start    fin de l'Adhan → sonneries du téléphone coupées (module Android)
//   iqama    T + 15 min (Maghrib : 10 min ; Maghrib de Ramadan : dès la fin de l'Adhan) → écran « Iqama » 1 min, puis écran « Prière » 5 min
//   end      T + durée choisie, jamais avant la fin de la prière → état audio d'avant restauré
// Modes : 'off' | 'once' (prochaine prière uniquement) | 'perm' (toutes les prières, jusqu'à désactivation).

export const MIN = 60000;
export const DUR_DEFAULT = 25, DUR_MIN = 10, DUR_MAX = 90, DUR_STEP = 5;
export const MAX_ADHAN = 6 * MIN;
export const IQAMA_SCREEN = MIN;          // écran « Iqama »
export const PRAYER_SCREEN = 5 * MIN;     // écran « Prière »
export const PRAYER_SPAN = IQAMA_SCREEN + PRAYER_SCREEN;

export const clampDur = d => (!(d > 0) ? DUR_DEFAULT : Math.max(DUR_MIN, Math.min(DUR_MAX, Math.round(d))));
export const stepDur = (d, dir) => clampDur(clampDur(d) + dir * DUR_STEP);
export const iqamaMin = (key, ramadan) => (key === 'Maghrib' ? (ramadan ? 0 : 10) : 15);

export function windowOf(T, adhanMs, dur, iqMin) {
  const a = Math.max(0, Math.min(adhanMs || 0, MAX_ADHAN));
  const start = T + a;
  const iqama = Math.max(T + iqMin * MIN, start);
  const end = Math.max(T + clampDur(dur) * MIN, iqama + PRAYER_SPAN);
  return { start, iqama, end };
}

/** Le cycle s'applique-t-il à la prière d'heure T ? (perm : seulement les prières après l'activation) */
export function runsFor(mq, T) {
  if (!mq) return false;
  if (mq.mode === 'perm') return T >= (mq.since || 0) - MIN;
  if (mq.mode === 'once') return !!mq.once && Math.abs(mq.once.ts - T) < MIN;
  return false;
}

/** Fin du mode « once » (après la prière visée) — au-delà, le mode est éteint. */
export function onceEnd(mq, ramadan = false) {
  if (!mq || mq.mode !== 'once' || !mq.once) return 0;
  return windowOf(mq.once.ts, 0, mq.dur, iqamaMin(mq.once.key, ramadan)).end;
}

/** Mode effectif à cet instant : un « once » échu redevient 'off'. */
export function effectiveMode(mq, now) {
  if (!mq) return 'off';
  if (mq.mode === 'once') return mq.once && now < onceEnd(mq) ? 'once' : 'off';
  return mq.mode === 'perm' ? 'perm' : 'off';
}

/**
 * Phase en cours. prayers : [{ key, ts, ramadan, adhanMs }] (prières passées récentes).
 * → { phase: 'silence' | 'iqama' | 'prayer', key, T, start, iqama, end } ou null.
 */
export function phaseAt(mq, prayers, now) {
  for (const p of [...prayers].sort((a, b) => b.ts - a.ts)) {
    if (!p.ts || p.ts > now || !runsFor(mq, p.ts)) continue;
    const w = windowOf(p.ts, p.adhanMs, mq.dur, iqamaMin(p.key, p.ramadan));
    if (now >= w.end) return null;                         // la plus récente est terminée : rien d'autre en cours
    let phase = null;
    if (now >= w.iqama && now < w.iqama + IQAMA_SCREEN) phase = 'iqama';
    else if (now >= w.iqama + IQAMA_SCREEN && now < w.iqama + PRAYER_SPAN) phase = 'prayer';
    else if (now >= w.start) phase = 'silence';
    else phase = 'adhan';
    return { phase, key: p.key, T: p.ts, ...w };
  }
  return null;
}
