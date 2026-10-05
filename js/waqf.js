// Signes de pause du Coran (ۖ ۗ ۚ ۛ ۜ…) sur les cartes.
// Les polices les dessinent très haut au-dessus du mot (environ 1,8 em) : entre deux lignes serrées, le signe tombe
// sur le mot de la ligne du dessus. On dessine donc le texte SANS ces signes, puis chaque signe à part, plus petit,
// juste au-dessus de la dernière lettre du mot, comme dans un mushaf.
const WAQF = /[\u06D6-\u06DC]/;
const COMBINING = /[\u064B-\u065F\u0670\u0653-\u0655\u06D6-\u06ED]/;

export const hasWaqf = text => WAQF.test(text);

/** « كُمۡۚ وَهُوَ » → { clean: « كُمۡ وَهُوَ », marks: [{ at: position après « كُمۡ », ch: 'ۚ' }] } */
export function splitWaqf(line) {
  let clean = '';
  const marks = [];
  for (const ch of line) {
    if (WAQF.test(ch)) marks.push({ at: clean.length, ch });
    else clean += ch;
  }
  return { clean, marks };
}

/** Centre horizontal (px) de la dernière lettre avant `at`, pour un texte arabe centré en cx (direction rtl). */
export function lastLetterCenter(g, clean, at, cx) {
  const pre = clean.slice(0, at);
  let b = pre.length;
  while (b > 0 && COMBINING.test(pre[b - 1])) b--;                 // on saute les voyelles : b-1 = la lettre
  const right = cx + g.measureText(clean).width / 2;               // début de la ligne (côté droit en arabe)
  const p1 = g.measureText(pre).width, p0 = g.measureText(pre.slice(0, Math.max(0, b - 1))).width;
  return right - (p0 + p1) / 2;
}

/**
 * Dessine une ligne arabe centrée en cx, ligne de base `base`, police de taille `size` (déjà réglée sur g).
 * markFont(px) → police du signe ; markColor → sa couleur. Retombe sur le dessin normal si le navigateur ne
 * sait pas mesurer l'encre d'un signe isolé.
 */
export function drawArabicLine(g, line, cx, base, size, markFont, markColor, boldPx = 0) {
  const { clean, marks } = splitWaqf(line);
  // `boldPx` : police à une seule graisse (Warsh) — on épaissit le trait en le contournant de la même couleur
  const paint = txt => { g.fillText(txt, cx, base); if (boldPx > 0 && g.strokeText) { const lw = g.lineWidth, lj = g.lineJoin; g.strokeStyle = g.fillStyle; g.lineWidth = boldPx; g.lineJoin = 'round'; g.strokeText(txt, cx, base); g.lineWidth = lw; g.lineJoin = lj; } };
  if (!marks.length) { paint(line); return; }
  const textFont = g.font, align = g.textAlign, fill = g.fillStyle;
  const ms = Math.round(size * .75);
  g.font = markFont(ms); g.textAlign = 'center';
  const probe = g.measureText(marks[0].ch);
  const inkOk = typeof probe.actualBoundingBoxDescent === 'number' && probe.actualBoundingBoxLeft + probe.actualBoundingBoxRight > 0;
  g.font = textFont; g.textAlign = align;
  if (!inkOk) { paint(line); return; }                              // ancien navigateur : rendu natif
  paint(clean);
  const xs = marks.map(m => lastLetterCenter(g, clean, m.at, cx));  // mesures avec la police du texte
  g.font = markFont(ms); g.textAlign = 'center'; g.fillStyle = markColor;
  marks.forEach((m, i) => {
    const mm = g.measureText(m.ch);
    const x = xs[i] - (mm.actualBoundingBoxRight - mm.actualBoundingBoxLeft) / 2;   // centre de l'encre sur la lettre
    const y = base - size * 1.02 - mm.actualBoundingBoxDescent;                      // bas de l'encre ≈ 1 em au-dessus de la ligne
    g.fillText(m.ch, x, y);
  });
  g.font = textFont; g.textAlign = align; g.fillStyle = fill;
}
