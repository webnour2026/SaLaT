// Politique de sécurité (CSP) : GitHub Pages n'envoie aucun en-tête HTTP, la CSP est donc une balise <meta> dans index.html.
// Ce test garde la politique cohérente avec le code :
//  · la balise existe, avant toute ressource ; aucun script inline, aucun gestionnaire on*="", aucun eval/Function dans le code ;
//  · tout hôte externe cité dans le code (JS, CSS, HTML, Service Worker) figure dans la politique — sinon la requête serait bloquée en silence ;
//  · le fichier de démarrage js/boot-guard.js (ex-script inline) est bien chargé et pré-caché.
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'ÉCHEC'} ${name}${ok ? '' : `\n     obtenu  : ${JSON.stringify(got)}\n     attendu : ${JSON.stringify(want)}`}`); };

const html = read('index.html');
const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
eq('index.html contient une balise <meta http-equiv="Content-Security-Policy">', !!meta, true);
const csp = meta ? meta[1] : '';
const dir = Object.fromEntries(csp.split(';').map(s => s.trim()).filter(Boolean).map(s => { const [k, ...v] = s.split(/\s+/); return [k, v]; }));

const firstResource = html.search(/<(link|script|img|style)\b/);
eq('la CSP est placée AVANT toute ressource (link, script, img, style)', meta && html.indexOf(meta[0]) < firstResource, true);
eq('default-src \'self\'', dir['default-src'], ["'self'"]);
eq('script-src : \'self\' seulement (ni unsafe-inline, ni unsafe-eval)', dir['script-src'], ["'self'"]);
eq('object-src \'none\' et base-uri \'self\'', [dir['object-src'], dir['base-uri']], [["'none'"], ["'self'"]]);
eq('form-action \'none\'', dir['form-action'], ["'none'"]);
eq('\'unsafe-inline\' réservé aux styles (document d\'impression du mois)', Object.entries(dir).filter(([, v]) => v.includes("'unsafe-inline'")).map(([k]) => k), ['style-src']);

eq('aucun <script> inline dans index.html', [...html.matchAll(/<script\b([^>]*)>/g)].filter(m => !/\bsrc=/.test(m[1])).length, 0);
eq('aucun gestionnaire on*="" ni javascript: dans index.html', /\son[a-z]+\s*=|javascript:/i.test(html), false);
eq('js/boot-guard.js chargé en defer', /<script src="js\/boot-guard\.js" defer><\/script>/.test(html), true);
eq('js/boot-guard.js pré-caché par le Service Worker', /'js\/boot-guard\.js'/.test(read('sw.js')), true);

const files = ['index.html', 'sw.js', 'css/style.css', ...fs.readdirSync(new URL('../js/', import.meta.url)).filter(f => f.endsWith('.js')).map(f => `js/${f}`)];
const code = files.map(f => [f, f === 'index.html' ? html.replace(meta ? meta[0] : '', '') : read(f)]);
eq('aucun eval(), new Function() ni setTimeout/setInterval(chaîne) dans le code', code.flatMap(([f, s]) => (s.match(/\beval\s*\(|new\s+Function\s*\(|set(?:Timeout|Interval)\s*\(\s*['"`]/g) || []).map(m => `${f}: ${m}`)), []);

// hôtes cités : xmlns (jamais chargés) et lien de partage (jamais chargé) mis à part
const IGNORED = new Set(['www.w3.org', 'tinyurl.com']);
const hosts = [...new Set(code.flatMap(([, s]) => [...s.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1].toLowerCase())))].filter(h => !IGNORED.has(h)).sort();
eq('hôtes externes cités dans le code (à connaître, et à ouvrir dans la CSP)', hosts, ['api.aladhan.com', 'api.github.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'nominatim.openstreetmap.org']);
eq('chacun de ces hôtes est autorisé par la CSP', hosts.filter(h => !csp.includes(`https://${h}`)), []);
const allowedHosts = [...csp.matchAll(/https:\/\/([a-z0-9.-]+)/gi)].map(m => m[1].toLowerCase());
eq('la CSP n\'ouvre aucun hôte que le code n\'utilise pas', allowedHosts.filter(h => !hosts.includes(h)), []);
// Service Worker : si UN seul fichier du pré-cache est introuvable, l'installation échoue et l'appli ne se met plus à jour
const shell = [...read('sw.js').match(/APP_SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]).filter(u => u !== './');
eq('tous les fichiers du pré-cache du Service Worker existent', shell.filter(u => !fs.existsSync(new URL(`../${u}`, import.meta.url))), []);
const jsFiles = fs.readdirSync(new URL('../js/', import.meta.url)).filter(f => f.endsWith('.js')).map(f => `js/${f}`);
eq('chaque module js/*.js est dans le pré-cache (sinon hors-ligne cassé)', jsFiles.filter(f => !shell.includes(f)), []);
console.log(fails ? `\n${fails} échec(s)` : '\nTous les tests réussis');
process.exit(fails ? 1 : 0);
