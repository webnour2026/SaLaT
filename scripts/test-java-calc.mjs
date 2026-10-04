// Le calcul de secours du module Android (PrayerCalc.java) doit donner EXACTEMENT les mêmes heures que le site (prayer-calc.js).
// Nécessite javac ; sans lui, le test est ignoré (code 0) avec un message.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { computeDay } from '../js/prayer-calc.js';
import { LOCALITES } from '../js/localites-data.js';

const root = new URL('..', import.meta.url).pathname;
if (spawnSync('javac', ['-version']).status !== 0) { console.log('javac absent : test ignoré'); process.exit(0); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pcalc-'));
fs.writeFileSync(path.join(tmp, 'Harness.java'), `import java.io.*; import java.lang.reflect.*;
public class Harness { public static void main(String[] a) throws Exception {
  Class<?> c = Class.forName("io.github.webnour2026.salat.PrayerCalc");
  Method m = c.getDeclaredMethod("compute", double.class, double.class, int.class, int.class, int.class, int.class, int.class, boolean.class, int.class); m.setAccessible(true);
  BufferedReader r = new BufferedReader(new FileReader(a[0])); String l;
  while ((l = r.readLine()) != null) { String[] p = l.trim().split(" ");
    long[] t = (long[]) m.invoke(null, Double.parseDouble(p[0]), Double.parseDouble(p[1]), Integer.parseInt(p[2]), Integer.parseInt(p[3]), Integer.parseInt(p[4]), Integer.parseInt(p[5]), Integer.parseInt(p[6]), p[7].equals("1"), Integer.parseInt(p[8]));
    System.out.println(t[0] + " " + t[1] + " " + t[2] + " " + t[3] + " " + t[4]); } } }`);
execFileSync('javac', ['-encoding', 'UTF-8', '-d', tmp, path.join(root, 'android/java/io/github/webnour2026/salat/PrayerCalc.java'), path.join(tmp, 'Harness.java')]);

let seed = 20261004; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const world = [[34.02, -6.84], [23.68, -15.96], [48.86, 2.35], [51.51, -0.13], [52.52, 13.4], [59.91, 10.75], [69.65, 18.96], [21.42, 39.83], [-6.2, 106.85], [-33.87, 151.21], [40.71, -74.0], [41.01, 28.98], [55.75, 37.62]];
const methods = [21, 3, 5, 4, 1, 2, 13, 12, 19, 18, 8, 16, 15, 99];
const cases = [];
for (let i = 0; i < 600; i++) {
  let lat, lng;
  if (i % 3 === 0) { const r = LOCALITES[Math.floor(rnd() * LOCALITES.length)]; lat = r[3] + (rnd() - 0.5) * 0.5; lng = r[4] + (rnd() - 0.5) * 0.5; }
  else if (i % 3 === 1) { const w = world[Math.floor(rnd() * world.length)]; lat = w[0] + (rnd() - 0.5) * 0.2; lng = w[1] + (rnd() - 0.5) * 0.2; }
  else { lat = 20 + rnd() * 15; lng = -17 + rnd() * 16; }
  const d = new Date(Date.UTC(2026, 0, 1) + Math.floor(rnd() * 800) * 864e5);
  cases.push({ lat, lng, y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), method: i % 2 ? 21 : methods[Math.floor(rnd() * methods.length)], school: rnd() < 0.3 ? 1 : 0, snap: rnd() < 0.8, code: rnd() < 0.12 ? LOCALITES[Math.floor(rnd() * LOCALITES.length)][0] : -1 });
}
fs.writeFileSync(path.join(tmp, 'cases.txt'), cases.map(c => [c.lat, c.lng, c.y, c.m, c.d, c.method, c.school, c.snap ? 1 : 0, c.code].join(' ')).join('\n') + '\n');
const got = execFileSync('java', ['-cp', tmp, 'Harness', path.join(tmp, 'cases.txt')], { encoding: 'utf8' }).trim().split('\n');
let diff = 0, total = 0;
cases.forEach((c, i) => {
  const r = computeDay({ lat: c.lat, lng: c.lng, snap: c.snap, code: c.code >= 0 ? c.code : null }, `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`, c.method, c.school);
  const exp = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].map(k => r[k] == null ? 0 : r[k]), g = got[i].split(' ').map(Number);
  exp.forEach((v, j) => { total++; if (v !== g[j]) { diff++; if (diff <= 5) console.log('  écart', JSON.stringify(c), ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'][j], v, g[j]); } });
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${diff === 0 ? 'ok  ' : 'ÉCHEC'} Java = JavaScript : ${total - diff}/${total} heures identiques (600 cas : Maroc, localités, monde, hautes latitudes, 14 méthodes)`);
console.log(diff ? '\nÉchec' : '\nTous les tests réussis');
process.exit(diff ? 1 : 0);
