// Bip d'alignement de la boussole : réglage présent et activé par défaut, traduit, câblé à l'alignement, et sans fichier audio externe.
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'ÉCHEC'} ${name}${ok ? '' : `\n     obtenu  : ${JSON.stringify(got)}\n     attendu : ${JSON.stringify(want)}`}`); };
const app = read('js/app.js'), adhan = read('js/adhan.js'), html = read('index.html'), i18n = read('js/i18n.js'), storage = read('js/storage.js');

eq('réglage qiblaBeep activé par défaut (storage.js)', /qiblaBeep:\s*true/.test(storage), true);
eq('interrupteur #sQiblaBeep dans les réglages (index.html)', /id="sQiblaBeep"/.test(html), true);
eq('libellé qiblaBeep traduit en arabe, français et anglais', (i18n.match(/\bqiblaBeep: '/g) || []).length, 3);
eq('playBeep() exporté par adhan.js et construit avec WebAudio (aucun fichier audio)', [/export function playBeep\(/.test(adhan), /createOscillator\(\)/.test(adhan.split('export function playBeep')[1].split('export function stopAdhan')[0])], [true, true]);
eq('le bip est joué UNIQUEMENT à l\'entrée dans l\'alignement et si le réglage n\'est pas désactivé', /if \(!compass\.wasAligned\) \{ vibrate\(60\); if \(S\(\)\.qiblaBeep !== false\) playBeep\(\); \}/.test(app), true);
eq('l\'audio est déverrouillé au premier toucher (exigence du navigateur)', /addEventListener\('pointerdown', \(\) => unlockAudio\(\)/.test(app), true);
console.log(fails ? `\n${fails} échec(s)` : '\nTous les tests réussis');
process.exit(fails ? 1 : 0);
