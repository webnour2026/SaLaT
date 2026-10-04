// Le numéro affiché dans les réglages (APP_VERSION) doit toujours être celui du service worker (VERSION) : il était resté à 2.5.1.
import fs from 'node:fs';
const read = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const app = read('js/app.js').match(/APP_VERSION = '([^']+)'/)?.[1];
const sw = read('sw.js').match(/VERSION = 'salati-v([^']+)'/)?.[1];
const ok = !!app && app === sw;
console.log(`${ok ? 'ok  ' : 'ÉCHEC'} version affichée (${app}) = version du service worker (${sw})`);
console.log(ok ? '\nTous les tests réussis' : '\nÉchec : mets APP_VERSION (js/app.js) et VERSION (sw.js) à la même valeur');
process.exit(ok ? 0 : 1);
