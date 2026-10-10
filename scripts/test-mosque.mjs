// Mode Mosquée : règles de la page (js/mosque.js) ET du module Android (MosqueMath.java) — mêmes résultats attendus.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { clampDur, stepDur, iqamaMin, windowOf, runsFor, effectiveMode, phaseAt, MIN } from '../js/mosque.js';

let fails = 0;
const eq = (name, got, want) => { const ok = String(got) === String(want); if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'ÉCHEC'} ${name}${ok ? '' : ` (obtenu ${got}, attendu ${want})`}`); };

const T = Date.parse('2026-10-10T19:05:00Z');          // Maghrib 19:05 (Maroc = UTC)
// ---- durée ----
eq('durée par défaut 25 min', clampDur(undefined), 25);
eq('durée : pas de valeur négative', clampDur(-5), 25);
eq('durée : minimum 10 min', clampDur(3), 10);
eq('durée : maximum 90 min', clampDur(500), 90);
eq('durée : pas de 5 min (+)', stepDur(25, 1), 30);
eq('durée : pas de 5 min (−) borné', stepDur(10, -1), 10);
eq('durée : pas de 5 min (+) borné', stepDur(90, 1), 90);
// ---- iqama ----
eq('iqama : 15 min (Asr)', iqamaMin('Asr', false), 15);
eq('iqama : 10 min (Maghrib)', iqamaMin('Maghrib', false), 10);
eq('iqama : Maghrib de Ramadan dès la fin de l\'Adhan', iqamaMin('Maghrib', true), 0);
eq('iqama : Ramadan ne change pas l\'Isha', iqamaMin('Isha', true), 15);
// ---- fenêtre ----
let w = windowOf(T, 180000, 25, 10);
eq('exemple du cahier des charges : silence à la fin de l\'Adhan (3 min)', (w.start - T) / MIN, 3);
eq('… iqama à 19:15', new Date(w.iqama).toISOString().slice(11, 16), '19:15');
eq('… sonneries rendues à 19:30', new Date(w.end).toISOString().slice(11, 16), '19:30');
w = windowOf(T, 0, 25, 10);
eq('sans Adhan : silence dès 19:05', new Date(w.start).toISOString().slice(11, 16), '19:05');
w = windowOf(T, 3600000, 25, 15);
eq('Adhan anormalement long : coupure au plus tard 6 min après', (w.start - T) / MIN, 6);
w = windowOf(T, 0, 10, 15);
eq('durée courte : jamais rendues avant la fin de la prière (15 + 6 min)', (w.end - T) / MIN, 21);
w = windowOf(T, 240000, 25, 0);
eq('Maghrib de Ramadan : iqama dès la fin de l\'Adhan', (w.iqama - T) / MIN, 4);
// ---- modes ----
const once = { mode: 'once', dur: 25, once: { key: 'Maghrib', ts: T } };
eq('once : s\'applique à la prière visée', runsFor(once, T), true);
eq('once : pas aux prières suivantes', runsFor(once, T + 90 * MIN), false);
eq('once : actif avant la prière', effectiveMode(once, T - 45 * MIN), 'once');
eq('once : actif pendant le silence', effectiveMode(once, T + 20 * MIN), 'once');
eq('once : désactivé seul après la période', effectiveMode(once, T + 26 * MIN), 'off');
const perm = { mode: 'perm', dur: 25, since: T - 3 * 3600e3 };
eq('perm : toutes les prières après l\'activation', runsFor(perm, T) && runsFor(perm, T + 86400e3), true);
eq('perm : pas une prière passée avant l\'activation', runsFor({ ...perm, since: T + 10 * MIN }, T), false);
eq('perm : reste actif', effectiveMode(perm, T + 30 * 86400e3), 'perm');
eq('off : rien', runsFor({ mode: 'off', dur: 25 }, T), false);
// ---- phases (écrans de l'appli ouverte) ----
const pr = [{ key: 'Asr', ts: T - 3 * 3600e3, adhanMs: 0 }, { key: 'Maghrib', ts: T, adhanMs: 180000, ramadan: false }];
eq('phase : Adhan en cours', phaseAt(perm, pr, T + MIN)?.phase, 'adhan');
eq('phase : silence', phaseAt(perm, pr, T + 5 * MIN)?.phase, 'silence');
eq('phase : écran Iqama à 19:15', phaseAt(perm, pr, T + 10 * MIN + 1000)?.phase, 'iqama');
eq('phase : écran Prière pendant 5 min', phaseAt(perm, pr, T + 13 * MIN)?.phase, 'prayer');
eq('phase : de nouveau silence après la prière', phaseAt(perm, pr, T + 17 * MIN)?.phase, 'silence');
eq('phase : rien après la fin', phaseAt(perm, pr, T + 26 * MIN), null);
eq('phase : once ne touche pas l\'Asr', phaseAt(once, pr, T - 3 * 3600e3 + 16 * MIN), null);

// ---- même règles côté Android (MosqueMath.java) ----
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'salat-mosque-'));
fs.copyFileSync(path.join(root, 'android/java/io/github/webnour2026/salat/MosqueMath.java'), path.join(dir, 'MosqueMath.java'));
fs.writeFileSync(path.join(dir, 'Main.java'), `
package io.github.webnour2026.salat;
public class Main {
  static String w(long[] a, long t) { return ((a[0]-t)/60000) + "," + ((a[1]-t)/60000) + "," + ((a[2]-t)/60000); }
  public static void main(String[] x) {
    long T = ${T}L;
    System.out.println("A " + w(MosqueMath.window(T, 180000, 25, 10), T));
    System.out.println("B " + w(MosqueMath.window(T, 3600000, 25, 15), T));
    System.out.println("C " + w(MosqueMath.window(T, 0, 10, 15), T));
    System.out.println("D " + MosqueMath.clampDur(-5) + "," + MosqueMath.clampDur(3) + "," + MosqueMath.clampDur(500) + "," + MosqueMath.clampDur(30));
    System.out.println("E " + MosqueMath.iqamaMin("Maghrib", false) + "," + MosqueMath.iqamaMin("Maghrib", true) + "," + MosqueMath.iqamaMin("Fajr", true));
    System.out.println("F " + MosqueMath.runs("once", T, 0, T) + "," + MosqueMath.runs("once", T, T, T) + "," + MosqueMath.runs("once", T, 0, T + 5400000L) + "," + MosqueMath.runs("perm", 0, 0, T) + "," + MosqueMath.runs("off", T, 0, T));
    System.out.println("G " + MosqueMath.wanted("once", T, T - 60000) + "," + MosqueMath.wanted("once", T, T + 120000) + "," + MosqueMath.wanted("perm", 0, T));
    // état audio : sonnerie → silencieux (avec accès) ou vibreur (sans) ; vibreur sans accès → rien ; déjà silencieux → rien
    System.out.println("H " + MosqueMath.target(2, true) + "," + MosqueMath.target(2, false) + "," + MosqueMath.target(1, true) + "," + MosqueMath.target(1, false) + "," + MosqueMath.target(0, true));
    // restauration seulement si l'utilisateur n'a pas changé le mode entre-temps
    System.out.println("I " + MosqueMath.restore(0, 0) + "," + MosqueMath.restore(2, 0) + "," + MosqueMath.restore(1, -1));
  }
}
`);
execFileSync('javac', ['-encoding', 'UTF-8', '-d', dir, path.join(dir, 'MosqueMath.java'), path.join(dir, 'Main.java')], { stdio: ['ignore', 'ignore', 'inherit'] });
const out = Object.fromEntries(execFileSync('java', ['-cp', dir, 'io.github.webnour2026.salat.Main'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').map(l => [l[0], l.slice(2)]));
const js = (a, b, c, d) => { const r = windowOf(T, a, b, d); return `${(r.start - T) / MIN},${(r.iqama - T) / MIN},${(r.end - T) / MIN}`; };
eq('Java = JS : fenêtre standard', out.A, js(180000, 25, 0, 10));
eq('Java = JS : Adhan trop long', out.B, js(3600000, 25, 0, 15));
eq('Java = JS : durée courte prolongée jusqu\'à la fin de la prière', out.C, js(0, 10, 0, 15));
eq('Java : bornes de durée', out.D, '25,10,90,30');
eq('Java : iqama', out.E, '10,0,15');
eq('Java : once une seule fois, prière visée seulement ; perm toujours ; off jamais', out.F, 'true,false,false,true,false');
eq('Java : alarmes gardées tant que la prière visée n\'est pas passée', out.G, 'true,false,true');
eq('Java : état audio imposé', out.H, '0,1,0,-1,-1');
eq('Java : restauration prudente', out.I, 'true,false,false');

console.log(fails ? `\n${fails} échec(s)` : '\nTous les tests réussis');
process.exit(fails ? 1 : 0);
