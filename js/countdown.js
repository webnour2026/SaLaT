// Compte à rebours basé sur un timestamp cible : restant = cible - maintenant.
// Aucune décrémentation de compteur : pas de dérive, même si le navigateur
// ralentit les minuteurs en arrière-plan.
import { now } from './clock.js';

export class Countdown {
  constructor({ onTick, onReach }) {
    this.onTick = onTick;
    this.onReach = onReach;
    this.target = null;
    this.reached = false;
    this.timer = null;
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.tick(); });
  }
  setTarget(ts) { this.target = ts; this.reached = false; this.tick(); }
  start() { this.tick(); }
  tick() {
    clearTimeout(this.timer);
    const t = now();
    if (this.target != null) {
      const remaining = this.target - t;
      this.onTick(Math.max(0, remaining), t);
      if (remaining <= 0 && !this.reached) { this.reached = true; this.onReach(t); }
    } else {
      this.onTick(null, t);
    }
    // se recale sur le début de chaque seconde
    this.timer = setTimeout(() => this.tick(), 1000 - (now() % 1000) + 10);
  }
}

export function formatHMS(ms) {
  const s = Math.ceil(ms / 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}
