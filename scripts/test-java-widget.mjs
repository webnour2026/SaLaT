// Widget d'écran d'accueil (module Android) : règles pures de WidgetMath.java.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'salat-widget-'));
fs.copyFileSync(path.join(root, 'android/java/io/github/webnour2026/salat/WidgetMath.java'), path.join(dir, 'WidgetMath.java'));
fs.writeFileSync(path.join(dir, 'Main.java'), `
package io.github.webnour2026.salat;
public class Main {
  public static void main(String[] a) {
    // tailles : 4×1 (≈ 300×70), 2×2 étroit (≈ 150×180), 4×2 bas (≈ 300×130), 4×2 (≈ 320×180), inconnue (0×0)
    System.out.println("A " + WidgetMath.layout(300, 70) + WidgetMath.layout(150, 180) + WidgetMath.layout(300, 130) + WidgetMath.layout(320, 180) + WidgetMath.layout(0, 0));
    System.out.println("B " + WidgetMath.rtl("العصر") + "," + WidgetMath.rtl("Asr") + "," + WidgetMath.rtl(null) + "," + WidgetMath.rtl("Joumou'a الجمعة"));
    StringBuilder s = new StringBuilder();
    for (int k = 0; k < 5; k++) s.append(WidgetMath.slot(k, true));
    s.append('|');
    for (int k = 0; k < 5; k++) s.append(WidgetMath.slot(k, false));
    System.out.println("C " + s);
    long now = 1000000000000L, H = 3600000L;
    System.out.println("D " + (WidgetMath.nextRefresh(now, 0, now + 2 * H) - now) + "," + (WidgetMath.nextRefresh(now, now + 10 * 60000L, now + 3 * H) - now)
      + "," + (WidgetMath.nextRefresh(now, now - 1, now + 9 * H) - now) + "," + (WidgetMath.nextRefresh(now, 0, now - 5) - now));
  }
}
`);
execFileSync('javac', ['-encoding', 'UTF-8', '-d', dir, path.join(dir, 'WidgetMath.java'), path.join(dir, 'Main.java')], { stdio: ['ignore', 'ignore', 'inherit'] });
const out = Object.fromEntries(execFileSync('java', ['-cp', dir, 'io.github.webnour2026.salat.Main'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').map(l => [l[0], l.slice(2)]));
let fails = 0;
const eq = (n, g, w) => { const ok = String(g) === String(w); if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'ÉCHEC'} ${n}${ok ? '' : ` (obtenu ${g}, attendu ${w})`}`); };
eq('mise en page : 4×1 petit, étroit petit, 4×2 bas moyen, 4×2 grand, taille inconnue grand', out.A, '00122');
eq('arabe détecté dans le nom de la prière', out.B, 'true,false,false,true');
eq('rangée des 5 horaires : Fajr à droite en arabe, à gauche sinon', out.C, '43210|01234');
eq('rafraîchissement : prochaine prière, fin du « depuis », plafond 6 h, jamais dans le passé', out.D, `${2 * 3600000},${10 * 60000},${6 * 3600000},60000`);
console.log(fails ? `\n${fails} échec(s)` : '\nTous les tests réussis');
process.exit(fails ? 1 : 0);
