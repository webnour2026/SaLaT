// Téléphone déréglé (cas réel : horloge en retard de 3 624 s → Adhan sonnant 1 h trop tard).
// On compile ClockMath.java (arithmétique pure) et on rejoue le scénario : alarmes décalées de l'écart, correction si l'utilisateur
// règle son horloge, aucun effet de bord quand l'horloge est juste.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'salat-clock-'));
fs.copyFileSync(path.join(root, 'android/java/io/github/webnour2026/salat/ClockMath.java'), path.join(dir, 'ClockMath.java'));
fs.writeFileSync(path.join(dir, 'Main.java'), `
package io.github.webnour2026.salat;
public class Main {
  public static void main(String[] a) {
    long N = ClockMath.NO_REF;
    long T = 1790000000000L;                        // un instant réel quelconque (l'heure d'une prière)
    long off = 3624000L;                            // téléphone en retard de 3 624 s
    // 1) téléphone en retard : l'alarme est programmée plus tôt sur SON horloge ; à cet instant, l'heure réelle est T
    long trig = ClockMath.device(T, off);
    System.out.println("A " + (T - trig) + " " + (ClockMath.real(trig, off) - T));
    // 2) horloge juste : rien ne change
    System.out.println("B " + ClockMath.device(T, 0) + " " + (ClockMath.device(T, 0) == T));
    // 3) l'utilisateur règle son horloge de +1 h : (horloge − temps écoulé) augmente de 3 600 000 → écart ≈ 24 000
    long ref = 5000000L, elapsed = 1000000L;
    System.out.println("C " + ClockMath.adjust(off, ref, ref + elapsed + 3600000L, elapsed, true));
    // 4) horloge reculée de 30 min : l'écart augmente
    System.out.println("D " + ClockMath.adjust(off, ref, ref + elapsed - 1800000L, elapsed, true));
    // 5) horloge inchangée (le temps passe normalement) : écart inchangé
    System.out.println("E " + ClockMath.adjust(off, ref, ref + elapsed + 7200000L, elapsed + 7200000L, true));
    // 6) redémarrage : référence non comparable → dernier écart connu
    System.out.println("F " + ClockMath.adjust(off, ref, ref + 99999999L, 5L, false));
    // 7) aucune référence enregistrée (ancienne version) → écart tel quel
    System.out.println("G " + ClockMath.adjust(off, N, 123L, 45L, true));
    // 8) téléphone en avance de 1 h (écart négatif) : l'alarme est programmée plus tard sur son horloge
    System.out.println("H " + (ClockMath.device(T, -3600000L) - T));
    // 9) deux corrections successives : +1 h puis −10 min
    long o2 = ClockMath.adjust(off, ref, ref + elapsed + 3600000L, elapsed, true);
    long o3 = ClockMath.adjust(off, ref, ref + elapsed + 3600000L - 600000L, elapsed, true);
    System.out.println("I " + o2 + " " + o3);
    // 10) mesure par le module (en-tête Date du serveur, arrondi à la seconde) : horloge du téléphone en retard de 3 624,3 s, aller-retour de 200 ms
    long trueOff = 3624300L, d0 = 1790000000000L, d1 = d0 + 200;
    long serverMs = ((d0 + 100 + trueOff) / 1000L) * 1000L;                // le serveur annonce la seconde entière
    System.out.println("J " + Math.abs(ClockMath.sample(d0, d1, serverMs) - trueOff));
    // 11) trois échantillons : on garde celui dont l'aller-retour est le plus court
    System.out.println("K " + ClockMath.pick(new long[]{900, 150, 400}, new long[]{3700000L, 3624100L, 3650000L}, 3));
    // 12) écart négligeable (< 2 s) ignoré ; au-dessus, conservé (y compris négatif)
    System.out.println("L " + ClockMath.pick(new long[]{100}, new long[]{1500L}, 1) + " " + ClockMath.pick(new long[]{100}, new long[]{-2500L}, 1));
    // 13) reprogrammer seulement si l'écart a changé de plus de 5 s : dérive normale = non ; le réseau remet l'horloge à l'heure (3 624 s -> 24 s) = oui
    System.out.println("M " + ClockMath.changed(3624000L, 3624800L) + " " + ClockMath.changed(3624000L, 24000L) + " " + ClockMath.changed(0L, -3600000L));
    // 14) scénario complet du téléphone d'Hakim : alarme programmée avec l'écart mesuré par le module, sans aucune synchronisation de la page
    long E = 1790000000000L;                                              // heure réelle de la prière
    long measured = ClockMath.pick(new long[]{200}, new long[]{ClockMath.sample(d0, d1, serverMs)}, 1);
    long trig14 = ClockMath.device(E, measured);                          // instant sur l'horloge du téléphone
    System.out.println("N " + Math.abs(ClockMath.real(trig14, measured) - E));
    // 15) le cas observé le 1er octobre sur le téléphone d'Hakim : horloge interne en retard de 3 624 s, module sans écart (écart = 0)
    //     la notification permanente affichait « Maghrib 18:20, dans 9 min 43 » alors qu'il était 19:10 : le module se croyait 1 h en arrière
    long maghrib = 1790000000000L;                                        // 18:20 réelle
    long deviceNow = maghrib - (9 * 60 + 43) * 1000L;                     // horloge interne : 18:10:17
    long realNow = ClockMath.real(deviceNow, 3624000L);                   // heure réelle : 19:10:41
    System.out.println("O " + (maghrib - ClockMath.real(deviceNow, 0L)) + " " + (maghrib - realNow));
    // 16) garde-fou : un écart de 3 624 s est plausible, un écart de 30 h ne l'est pas
    System.out.println("P " + ClockMath.plausible(3624000L) + " " + ClockMath.plausible(30L * 3600000L) + " " + ClockMath.plausible(-23L * 3600000L));
  }
}
`);
execFileSync('javac', ['-encoding', 'UTF-8', '-d', dir, path.join(dir, 'ClockMath.java'), path.join(dir, 'Main.java')], { stdio: 'inherit' });
const out = Object.fromEntries(execFileSync('java', ['-cp', dir, 'io.github.webnour2026.salat.Main'], { encoding: 'utf8' }).trim().split('\n').map(l => [l[0], l.slice(2)]));

let fails = 0;
const eq = (name, got, want) => { const ok = String(got) === String(want); if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'ÉCHEC'} ${name}${ok ? '' : ` (obtenu ${got}, attendu ${want})`}`); };
eq('téléphone −3 624 s : alarme programmée 3 624 s plus tôt sur son horloge', out.A.split(' ')[0], 3624000);
eq('… et à cet instant l\'heure réelle est exactement celle de la prière', out.A.split(' ')[1], 0);
eq('horloge juste : alarme inchangée', out.B.split(' ')[1], 'true');
eq('l\'utilisateur avance son horloge de +1 h : l\'écart tombe à 24 s (dérive résiduelle)', out.C, 24000);
eq('l\'utilisateur recule son horloge de 30 min : l\'écart augmente de 30 min', out.D, 3624000 + 1800000);
eq('horloge qui avance normalement : écart inchangé', out.E, 3624000);
eq('après redémarrage : dernier écart connu conservé', out.F, 3624000);
eq('sans référence (ancienne version) : écart conservé', out.G, 3624000);
eq('téléphone en avance de 1 h : alarme 1 h plus tard sur son horloge', out.H, 3600000);
eq('deux réglages successifs (+1 h puis −10 min) : écarts cumulés correctement', out.I, '24000 624000');
eq('mesure par le module : écart retrouvé à moins de 700 ms près (arrondi du serveur + aller-retour)', Number(out.J) <= 700, true);
eq('trois mesures : retient celle dont l\'aller-retour est le plus court', out.K, 3624100);
eq('écart < 2 s ignoré ; écart négatif ≥ 2 s conservé', out.L, '0 -2500');
eq('reprogrammation seulement si l\'écart change de plus de 5 s', out.M, 'false true true');
eq('téléphone d\'Hakim, sans synchro de la page : l\'alarme tombe à l\'heure réelle de la prière (à 1 s près)', Number(out.N) <= 1000, true);
eq('1er octobre (capture) : sans écart le module compte 9 min 43 avant le Maghrib ; avec l\'écart, le Maghrib est passé depuis 50 min 41', out.O, '583000 -3041000');
eq('garde-fou : 3 624 s et −23 h acceptés, 30 h refusé', out.P, 'true false true');
console.log(fails ? `\n${fails} échec(s)` : '\nTous les tests réussis');
process.exit(fails ? 1 : 0);
