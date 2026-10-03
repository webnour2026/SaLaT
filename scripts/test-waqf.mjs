// Tests du dessin des signes de pause (ۖ ۗ ۚ…) : sur les 211 versets, chaque signe doit être dessiné une fois,
// au-dessus de la bonne lettre, et le texte dessiné ne doit plus contenir ces signes.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'salat-waqf-'));
fs.copyFileSync(path.join(root, 'js', 'waqf.js'), path.join(tmp, 'waqf.js'));
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
const { hasWaqf, splitWaqf, lastLetterCenter, drawArabicLine } = await import(pathToFileURL(path.join(tmp, 'waqf.js')).href);

const MARK = /[\u06D6-\u06DC]/g, COMB = /[\u064B-\u065F\u0670\u0653-\u0655\u06D6-\u06ED]/;
// canevas simulé : chaque lettre mesure 40 px, les voyelles 0 ; un signe isolé a une encre de 30×25 px, posée à 70 px au-dessus de sa ligne de base
const mk = (ink = true) => {
  const calls = [];
  const g = {
    font: '700 72px Amiri', textAlign: 'center', fillStyle: '#000', direction: 'rtl',
    measureText(s) {
      const w = [...s].filter(c => !COMB.test(c)).length * 40;
      const isMark = s.length === 1 && /[\u06D6-\u06DC]/.test(s);
      // texte centré : l'encre d'un signe s'étend de 15 px de chaque côté de son point d'ancrage
      return { width: w, actualBoundingBoxLeft: ink ? (isMark ? 15 : 0) : 0, actualBoundingBoxRight: ink ? (isMark ? 15 : w) : 0, actualBoundingBoxDescent: isMark ? -70 : 10 };
    },
    fillText(s, x, y) { calls.push({ s, x, y, font: this.font, fill: this.fillStyle }); },
  };
  return { g, calls };
};
let ko = 0;
const eq = (n, got, exp) => { if (String(got) !== String(exp)) { ko++; console.error('ÉCHEC', n, '\n   obtenu :', got, '\n   attendu:', exp); } else console.log('ok  ', n); };

// 1) découpage
const line = 'يَرۡزُقُهَا وَإِيَّاكُمۡۚ وَهُوَ';
const sp = splitWaqf(line);
eq('découpage : le texte dessiné n\'a plus de signe de pause', MARK.test(sp.clean), false); MARK.lastIndex = 0;
eq('découpage : un signe repéré', sp.marks.length, 1);
eq('découpage : c\'est ۚ', sp.marks[0].ch, '\u06DA');
eq('découpage : il suit le mim et son soukoun', sp.clean.slice(sp.marks[0].at - 2, sp.marks[0].at), 'مۡ');
eq('hasWaqf', `${hasWaqf(line)} ${hasWaqf('وَهُوَ')}`, 'true false');

// 2) position horizontale : centre de la dernière lettre « م » de « وإياكم »
{
  const { g } = mk();
  const cx = 540, clean = sp.clean, at = sp.marks[0].at;
  const x = lastLetterCenter(g, clean, at, cx);
  const total = g.measureText(clean).width, right = cx + total / 2;
  const lettersBefore = [...clean.slice(0, at)].filter(c => !COMB.test(c)).length;   // la lettre est la dernière
  const expected = right - (lettersBefore - 1) * 40 - 20;
  eq('position : centre de la lettre « م » (à 20 px près de la valeur calculée à la main)', Math.abs(x - expected) < 0.01, true);
}

// 3) dessin d'une ligne : texte propre + un signe
{
  const { g, calls } = mk();
  drawArabicLine(g, line, 540, 1000, 72, px => `400 ${px}px Amiri`, '#1B6E80');
  eq('dessin : 2 appels (texte + signe)', calls.length, 2);
  eq('dessin : le texte est sans signe', MARK.test(calls[0].s), false); MARK.lastIndex = 0;
  eq('dessin : le signe est ۚ', calls[1].s, '\u06DA');
  eq('dessin : le signe est plus petit (54 px)', calls[1].font, '400 54px Amiri');
  eq('dessin : le signe a la couleur de la référence', calls[1].fill, '#1B6E80');
  // encre à 1,02 em ≈ 73 px au-dessus de la ligne (1000) : bas de l'encre = y + descent = y − 70 → y = 1000 − 73,4 + 70
  eq('dessin : bas de l\'encre ≈ 73 px au-dessus de la ligne', Math.round(1000 - (calls[1].y - 70)), 73);
  eq('dessin : la police et la couleur du texte sont rétablies', `${g.font} | ${g.fillStyle}`, '700 72px Amiri | #000');
}
// 4) ligne sans signe : un seul appel, texte intact
{
  const { g, calls } = mk(); drawArabicLine(g, 'وَهُوَ ٱلسَّمِيعُ', 540, 900, 72, px => `400 ${px}px Amiri`, '#000');
  eq('sans signe : un seul appel, texte intact', `${calls.length} ${calls[0].s}`, '1 وَهُوَ ٱلسَّمِيعُ');
}
// 5) navigateur sans mesure d'encre : rendu natif (rien ne disparaît)
{
  const { g, calls } = mk(false); drawArabicLine(g, line, 540, 1000, 72, px => `400 ${px}px Amiri`, '#000');
  eq('sans mesure d\'encre : le texte complet (avec signe) est dessiné tel quel', `${calls.length} ${calls[0].s === line}`, '1 true');
}

// 6) les 211 versets + les douaa : chaque signe dessiné exactement une fois
const src = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const texts = [...src.matchAll(/\{ q: true, t: '([^']*)'/g)].map(m => m[1]);
const duaBlock = src.slice(src.indexOf('  dua: ['), src.indexOf('\n  ],', src.indexOf('  dua: [')));
texts.push(...[...duaBlock.matchAll(/t: '([^']*)'/g)].map(m => m[1]));
let wanted = 0, drawn = 0, leaks = 0, lines = 0;
for (const t of texts) {
  for (const ln of `﴿ ${t} ﴾`.split(/(?<=\S{14}) /)) {            // découpage grossier en lignes (la forme exacte importe peu ici)
    const { g, calls } = mk(); lines++;
    const n = (ln.match(MARK) || []).length; wanted += n;
    drawArabicLine(g, ln, 540, 1000, 72, px => `400 ${px}px Amiri`, '#000');
    drawn += calls.filter(c => c.s.length === 1 && /[\u06D6-\u06DC]/.test(c.s)).length;
    if (n && MARK.test(calls[0].s)) leaks++;
    MARK.lastIndex = 0;
  }
}
eq(`${texts.length} textes, ${lines} lignes : signes voulus = signes dessinés`, `${wanted} = ${drawn}`, `${wanted} = ${wanted}`);
eq('aucun signe de pause ne reste dans le texte dessiné', leaks, 0);

fs.rmSync(tmp, { recursive: true, force: true });
if (ko) { console.error(ko, 'échec(s)'); process.exit(1); }
console.log('Tous les tests réussis');
