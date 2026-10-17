// Pages « مواقيت الصلاة في <ville> » : une page statique par localité officielle (191) + une page d'accueil des villes,
// générées depuis data/officiel/<code>.json (tableaux du ministère des Habous). Destinées aux moteurs de recherche :
// le tableau du mois est dans le HTML (lisible sans JavaScript) ; page.js ajoute l'horaire du jour et le compte à rebours.
// Publiées sur Netlify (dossier netlify/, voir netlify.toml) : <PAGES>/<ville>/ ; l'appli reste sur GitHub Pages.
// Heure légale du Maroc = GMT depuis le 20/09/2026 (décret n° 2.26.530) : les heures sont affichées telles quelles (UTC).
// Usage : node scripts/build-mawaqit.mjs   (écrit netlify/ : pages, sitemap.xml, robots.txt ; relancé par le travail « Officiel »)
// PAGES_URL : adresse du site Netlify (par défaut https://miqatsalati.netlify.app/).
import fs from 'node:fs';
import { allLocalities } from '../js/localites.js';

const APP = 'https://webnour2026.github.io/SaLaT/';                                 // l'appli (GitHub Pages)
const PAGES = (process.env.PAGES_URL || 'https://miqatsalati.netlify.app/').replace(/\/?$/, '/');   // les pages des villes (Netlify)
const OUT = 'netlify';
const today = new Date().toISOString().slice(0, 10);
const appSrc = fs.readFileSync('js/app.js', 'utf8');
const PLAY_PUBLIC = /const PLAY_PUBLIC = true/.test(appSrc);
const PLAY_URL = 'https://play.google.com/store/apps/details?id=io.github.webnour2026.salat';
const KEYS_AR = ['الفجر', 'الشروق', 'الظهر', 'العصر', 'المغرب', 'العشاء'];
const KEYS_FR = ['Fajr', 'Chourouk', 'Dhuhr', 'Asr', 'Maghrib', 'Icha'];

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugOf = fr => fr.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hm = s => `${s.slice(0, 2)}:${s.slice(2)}`;
const dayAr = new Intl.DateTimeFormat('ar-MA-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const rowAr = d => `${new Intl.DateTimeFormat('ar-MA-u-nu-latn', { weekday: 'long', timeZone: 'UTC' }).format(d)} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;   // « السبت 17/10 » : tient sur un téléphone
const dayFr = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const km = (a, b) => { const r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };

// localités avec horaires officiels, slugs uniques
const used = new Set();
const cities = allLocalities().map(l => {
  let j; try { j = JSON.parse(fs.readFileSync(`data/officiel/${l.code}.json`, 'utf8')); } catch { return null; }
  const days = Object.entries(j.j).filter(([d]) => d >= today).sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, 31);
  if (!days.length) return null;
  let slug = slugOf(l.fr) || `ville-${l.code}`; if (used.has(slug)) slug += `-${l.code}`; used.add(slug);
  return { ...l, slug, days };
}).filter(Boolean);

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'none'";
const head = ({ title, desc, url, ld }) => `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${PAGES}icons/icon-512.png">
<meta name="theme-color" content="#0B5B4B">
<link rel="icon" href="${url === PAGES ? '' : '../'}icons/icon-192.png">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap">
<link rel="stylesheet" href="${url === PAGES ? '' : '../'}mawaqit.css">
${ld ? `<script type="application/ld+json">${JSON.stringify(ld)}</script>` : ''}
</head>`;

const cta = (prefix) => PLAY_PUBLIC
  ? `<a class="cta" href="${PLAY_URL}">حمّل تطبيق صلاتي مجاناً من Google Play</a>`
  : `<a class="cta" href="${APP}">جرّب تطبيق صلاتي مجاناً</a><p class="soon">تطبيق أندرويد قريباً على Google&nbsp;Play</p>`;

const footer = (prefix) => `<footer>
<p>المواقيت مطابقة للجداول الرسمية لوزارة الأوقاف والشؤون الإسلامية، تُقارَن وتُحدَّث كل شهر.</p>
<p lang="fr" dir="ltr">Horaires conformes aux tableaux officiels du ministère des Habous et des Affaires islamiques, vérifiés chaque mois. SaLaTi est une application indépendante, sans lien avec le ministère.</p>
<p><a href="${prefix}">كل المدن</a> · <a href="${APP}">تطبيق صلاتي</a> · <a href="${APP}confidentialite.html">الخصوصية</a></p>
</footer>`;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync('scripts/mawaqit-assets')) fs.copyFileSync(`scripts/mawaqit-assets/${f}`, `${OUT}/${f}`);   // page.js, mawaqit.css
fs.mkdirSync(`${OUT}/icons`); for (const f of ['icon-192.png', 'icon-512.png']) fs.copyFileSync(`icons/${f}`, `${OUT}/icons/${f}`);

for (const c of cities) {
  const url = `${PAGES}${c.slug}/`;
  const t0 = c.days[0][1].split(' ');
  const title = `مواقيت الصلاة في ${c.ar} اليوم | Horaires de prière ${c.fr} – SaLaTi`;
  const desc = `أوقات الصلاة في ${c.ar} حسب وزارة الأوقاف: الفجر ${hm(t0[0])}، الظهر ${hm(t0[2])}، العصر ${hm(t0[3])}، المغرب ${hm(t0[4])}، العشاء ${hm(t0[5])}. Horaires de prière à ${c.fr} conformes au ministère des Habous.`;
  const near = cities.filter(o => o !== c).map(o => [km(c, o), o]).sort((a, b) => a[0] - b[0]).slice(0, 8).map(([, o]) => o);
  const rows = c.days.map(([d, line]) => `<tr data-d="${d}"><th scope="row">${esc(rowAr(new Date(d + 'T12:00:00Z')))}</th>${line.split(' ').map(x => `<td>${hm(x)}</td>`).join('')}</tr>`).join('\n');
  const ld = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'مواقيت الصلاة في المغرب', item: PAGES },
    { '@type': 'ListItem', position: 2, name: `مواقيت الصلاة في ${c.ar}`, item: url }] };
  const html = `${head({ title, desc, url, ld })}
<body>
<header><a class="brand" href="../"><img src="../icons/icon-192.png" alt="" width="36" height="36">صلاتي SaLaTi</a></header>
<main>
<nav class="crumbs"><a href="../">مواقيت الصلاة في المغرب</a> › ${esc(c.ar)}</nav>
<h1>مواقيت الصلاة في ${esc(c.ar)}</h1>
<p class="sub" lang="fr" dir="ltr">Horaires de prière à ${esc(c.fr)} – ministère des Habous</p>
<section class="today" id="today" hidden>
  <p class="date" id="tDate"></p>
  <p class="next"><span id="nName"></span> <strong id="nTime"></strong> · <span id="nLeft"></span></p>
  <ol class="grid" id="tGrid"></ol>
</section>
<script type="application/json" id="data">${JSON.stringify({ days: c.days })}</script>
${cta('../')}
<h2>جدول مواقيت الصلاة في ${esc(c.ar)} لهذا الشهر</h2>
<div class="tbl"><table>
<thead><tr><th>اليوم</th>${KEYS_AR.map((k, i) => `<th>${k}<small lang="fr">${KEYS_FR[i]}</small></th>`).join('')}</tr></thead>
<tbody>
${rows}
</tbody></table></div>
<p class="note">بالتوقيت القانوني للمملكة (GMT). آخر تحديث: ${esc(dayAr.format(new Date(today + 'T12:00:00Z')))}.</p>
<section lang="fr" dir="ltr" class="fr">
<h2>Horaires de prière à ${esc(c.fr)}</h2>
<p>Aujourd’hui (${esc(dayFr.format(new Date(c.days[0][0] + 'T12:00:00Z')))}) à ${esc(c.fr)} : Fajr ${hm(t0[0])}, lever du soleil ${hm(t0[1])}, Dhuhr ${hm(t0[2])}, Asr ${hm(t0[3])}, Maghrib ${hm(t0[4])}, Icha ${hm(t0[5])}. Horaires officiels du ministère des Habous, à l’heure légale du Maroc (GMT).</p>
</section>
<h2>مدن قريبة</h2>
<ul class="near">${near.map(o => `<li><a href="../${o.slug}/">${esc(o.ar)}</a></li>`).join('')}</ul>
</main>
${footer('../')}
<script src="../page.js"></script>
</body>
</html>
`;
  fs.mkdirSync(`${OUT}/${c.slug}`, { recursive: true });
  fs.writeFileSync(`${OUT}/${c.slug}/index.html`, html);
}

// page d'accueil des villes
const byAr = [...cities].sort((a, b) => a.ar.localeCompare(b.ar, 'ar'));
const indexHtml = `${head({ title: 'مواقيت الصلاة في المغرب حسب وزارة الأوقاف – 191 مدينة | Horaires de prière Maroc – SaLaTi',
  desc: 'مواقيت الصلاة اليوم في جميع مدن المغرب (191 مدينة ومركزاً) مطابقة لجداول وزارة الأوقاف والشؤون الإسلامية. Horaires de prière au Maroc, conformes au ministère des Habous.',
  url: PAGES })}
<body>
<header><a class="brand" href="./"><img src="icons/icon-192.png" alt="" width="36" height="36">صلاتي SaLaTi</a></header>
<main>
<h1>مواقيت الصلاة في المغرب</h1>
<p class="sub" lang="fr" dir="ltr">Horaires de prière au Maroc – 191 villes et centres, ministère des Habous</p>
${cta('')}
<input type="search" id="q" class="q" placeholder="ابحث عن مدينتك · Chercher une ville" aria-label="ابحث عن مدينتك">
<ul class="cities" id="cities">${byAr.map(c => `<li><a href="${c.slug}/">${esc(c.ar)} <small lang="fr">${esc(c.fr)}</small></a></li>`).join('')}</ul>
</main>
${footer('')}
<script src="page.js"></script>
</body>
</html>
`;
fs.writeFileSync(`${OUT}/index.html`, indexHtml);

// sitemap
const lastmod = today;
fs.writeFileSync(`${OUT}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${PAGES}</loc><lastmod>${lastmod}</lastmod></url>
${cities.map(c => `<url><loc>${PAGES}${c.slug}/</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')}
</urlset>
`);
fs.writeFileSync(`${OUT}/robots.txt`, `User-agent: *\nAllow: /\nSitemap: ${PAGES}sitemap.xml\n`);
console.log(`${cities.length} pages de villes écrites dans ${OUT}/ pour ${PAGES} (+ index, sitemap.xml, robots.txt)`);
