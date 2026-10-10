// Rappels du croissant préparés par le module Android seul (appli jamais rouverte) : arithmétique d'AutoMonthMath.java.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'salat-automonth-'));
fs.copyFileSync(path.join(root, 'android/java/io/github/webnour2026/salat/AutoMonthMath.java'), path.join(dir, 'AutoMonthMath.java'));
fs.writeFileSync(path.join(dir, 'Main.java'), `
package io.github.webnour2026.salat;
public class Main {
  public static void main(String[] a) {
    long d = AutoMonthMath.dayOf("2026-09-13");
    System.out.println("A " + AutoMonthMath.iso(d) + " " + d + " " + AutoMonthMath.iso(AutoMonthMath.dayOf("2028-02-29")) + " " + AutoMonthMath.iso(AutoMonthMath.dayOf("1999-12-31") + 1));
    System.out.println("B " + AutoMonthMath.iso(d + 28) + " " + AutoMonthMath.iso(d + 29) + " " + AutoMonthMath.iso(d + 30));
    System.out.println("C " + new java.util.Date(AutoMonthMath.refreshAt(d)).toInstant());
    // accept : plus récent → oui ; plus ancien → non ; estimation corrigée d'un jour → oui ; même jour → non
    System.out.println("D " + AutoMonthMath.accept(d, false, d + 29) + "," + AutoMonthMath.accept(d, false, d - 29) + "," + AutoMonthMath.accept(d + 30, true, d + 29) + "," + AutoMonthMath.accept(d + 30, false, d + 29) + "," + AutoMonthMath.accept(d, false, d) + "," + AutoMonthMath.accept(-1, false, d));
    System.out.println("E " + AutoMonthMath.nextMonth(12) + "," + AutoMonthMath.nextYear(12, 1447) + "," + AutoMonthMath.nextMonth(8) + "," + AutoMonthMath.nextYear(8, 1447));
    System.out.println("F " + AutoMonthMath.watched(1) + AutoMonthMath.watched(9) + AutoMonthMath.watched(10) + AutoMonthMath.watched(12) + AutoMonthMath.watched(5) + AutoMonthMath.watched(11));
    // une année appli fermée : chaque mois, le module apprend le début (29 ou 30 jours) ou, sans réseau, suppose 30 jours puis se corrige
    long last = d; int m = 4, y = 1448; boolean est = false; StringBuilder log = new StringBuilder();
    int[] real = {29, 30, 29, 30, 30, 29, 30, 29, 30, 29, 30, 29};      // longueurs réelles (exemple)
    boolean[] offline = {false, false, true, false, false, false, true, false, false, false, false, false};
    long truth = d;
    for (int i = 0; i < 12; i++) {
      truth += real[i];
      int nm = AutoMonthMath.nextMonth(m), ny = AutoMonthMath.nextYear(m, y);
      if (offline[i]) { last = last + 30; est = true; }                          // relecture de secours : 30 jours supposés
      else if (AutoMonthMath.accept(last, est, truth)) { last = truth; est = false; }
      m = nm; y = ny;
      // le mois suivant, la lecture du soir du 29 corrige une estimation fausse d'un jour
      if (est && last != truth && AutoMonthMath.accept(last, est, truth)) { last = truth; est = false; }
      log.append(m).append(':').append(last == truth ? "ok" : "KO").append(' ');
    }
    System.out.println("G " + log.toString().trim() + " | " + y + " " + m);
  }
}
`);
execFileSync('javac', ['-encoding', 'UTF-8', '-d', dir, path.join(dir, 'AutoMonthMath.java'), path.join(dir, 'Main.java')], { stdio: ['ignore', 'ignore', 'inherit'] });
const out = Object.fromEntries(execFileSync('java', ['-cp', dir, 'io.github.webnour2026.salat.Main'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').map(l => [l[0], l.slice(2)]));
let fails = 0;
const eq = (n, g, w) => { const ok = String(g) === String(w); if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'ÉCHEC'} ${n}${ok ? '' : ` (obtenu ${g}, attendu ${w})`}`); };
eq('dates : aller-retour, années bissextiles, passage d\'année', out.A, `2026-09-13 ${Date.parse('2026-09-13') / 864e5} 2028-02-29 2000-01-01`);
eq('Rabi II 1448 : soir d\'observation 11 oct., 30e jour 12 oct., surlendemain 13 oct.', out.B, '2026-10-11 2026-10-12 2026-10-13');
eq('relecture de secours : 14 oct. 09:00 UTC', out.C, '2026-10-14T09:00:00Z');
eq('apprentissage : récent oui, ancien non, estimation corrigée oui, vrai début jamais reculé, doublon non, premier oui', out.D, 'true,false,true,false,false,true');
eq('Dhou al-Hijja → Mouharram de l\'année suivante', out.E, '1,1448,9,1447');
eq('mois surveillés : Mouharram, Ramadan, Chawwal, Dhou al-Hijja', out.F, 'truetruetruetruefalsefalse');
eq('une année entière appli fermée, 2 soirs sans réseau : chaque mois retrouvé', out.G, '5:ok 6:ok 7:ok 8:ok 9:ok 10:ok 11:ok 12:ok 1:ok 2:ok 3:ok 4:ok | 1449 4');
console.log(fails ? `\n${fails} échec(s)` : '\nTous les tests réussis');
process.exit(fails ? 1 : 0);
