// Met à jour data/habous.json : début de chaque mois hégirien annoncé par le Ministère des Habous (Maroc).
// Le ministère observe le croissant le soir du 29 et publie un communiqué ; les journaux le relaient aussitôt.
// Ce script cherche ce communiqué dans des flux d'actualités et n'accepte qu'une date plausible :
// le mois attendu (le suivant du dernier connu), 29 ou 30 jours après le dernier début de mois.
// Saisie manuelle possible : variable MANUAL_START=AAAA-MM-JJ (workflow_dispatch).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DAY = 864e5;
const FILE = new URL('../data/habous.json', import.meta.url);

// ---------- normalisation du texte arabe ----------
export const norm = s => String(s)
  .replace(/[\u064B-\u065F\u0670\u0640\u200c\u200d]/g, '')
  .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/\s+/g, ' ');

const HIJRI = { 'محرم': 1, 'صفر': 2, 'ربيع الاول': 3, 'ربيع الاخر': 4, 'ربيع الثاني': 4, 'جمادي الاولي': 5, 'جمادي الاول': 5,
  'جمادي الاخره': 6, 'جمادي الاخر': 6, 'جمادي الثانيه': 6, 'رجب': 7, 'شعبان': 8, 'رمضان': 9, 'شوال': 10,
  'ذي القعده': 11, 'ذو القعده': 11, 'ذي الحجه': 12, 'ذو الحجه': 12 };
const HIJRI_AR = ['', 'محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'];
const GREG = { 'يناير': 1, 'فبراير': 2, 'مارس': 3, 'ابريل': 4, 'ماي': 5, 'مايو': 5, 'يونيو': 6, 'يونيه': 6, 'يوليوز': 7, 'يوليو': 7,
  'غشت': 8, 'اغسطس': 8, 'شتنبر': 9, 'سبتمبر': 9, 'اكتوبر': 10, 'نونبر': 11, 'نوفمبر': 11, 'دجنبر': 12, 'ديسمبر': 12 };
const WEEK = { 'الاحد': 0, 'الاثنين': 1, 'الاتنين': 1, 'الثلاثاء': 2, 'الاربعاء': 3, 'الخميس': 4, 'الجمعه': 5, 'السبت': 6 };
const alt = obj => Object.keys(obj).sort((a, b) => b.length - a.length).join('|');
const RE_HIJRI = alt(HIJRI), RE_GREG = alt(GREG), RE_WEEK = alt(WEEK);
const dow = day => new Date(day * DAY).getUTCDay();
const iso = day => new Date(day * DAY).toISOString().slice(0, 10);

/**
 * Cherche dans `raw` le début du mois `expected` (numéro 1-12). `last` = jour (époque/86400000) du dernier début connu.
 * Renvoie le jour (nombre) ou null.
 */
export function extractStart(raw, last, expected) {
  const text = norm(raw), out = new Set();
  const plausible = day => day - last === 29 || day - last === 30;
  const re = new RegExp(`فاتح\\s+(?:شهر\\s+)?(${RE_HIJRI})`, 'g');
  for (const mt of text.matchAll(re)) {
    if (HIJRI[mt[1]] !== expected) continue;
    const after = text.slice(mt.index, mt.index + 260);
    // 1) date numérique plausible (on ignore la date d'observation « 29 … » et les autres dates)
    let found = false;
    for (const dm of after.matchAll(new RegExp(`(\\d{1,2})\\s+(${RE_GREG})\\s+(20\\d\\d)`, 'g'))) {
      const day = Date.UTC(+dm[3], GREG[dm[2]] - 1, +dm[1]) / DAY;
      if (plausible(day)) { out.add(day); found = true; }
    }
    if (found) continue;
    // 2) sinon : jour de la semaine cité (29 ou 30 jours après le dernier début : un seul correspond)
    const around = text.slice(Math.max(0, mt.index - 60), mt.index + 140);
    const days = new Set([...around.matchAll(new RegExp(`(${RE_WEEK})`, 'g'))].map(x => WEEK[x[1]]));
    const opts = [last + 29, last + 30].filter(d => days.has(dow(d)));
    if (opts.length === 1) out.add(opts[0]);
  }
  return out.size === 1 ? [...out][0] : null;
}

// ---------- flux d'actualités ----------
const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
export function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const g = tag => { const x = m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)); return x ? x[1].replace(/<!\[CDATA\[|\]\]>/g, '') : ''; };
    const text = decode(`${g('title')} ${g('description')}`).replace(/<[^>]+>/g, ' ');
    return { text, pub: Date.parse(g('pubDate')) || 0 };
  });
}
const feeds = (m, y) => {
  const q1 = encodeURIComponent('فاتح شهر وزارة الأوقاف هلال');
  const q2 = encodeURIComponent(`فاتح شهر ${HIJRI_AR[m]} ${y} الأوقاف`);
  return [
    `https://news.google.com/rss/search?q=${q2}&hl=ar&gl=MA&ceid=MA:ar`,
    `https://news.google.com/rss/search?q=${q1}+when:5d&hl=ar&gl=MA&ceid=MA:ar`,
    `https://www.bing.com/news/search?q=${q2}&format=rss&setlang=ar`,
  ];
};
async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; SaLaT-habous/1.0)', 'accept-language': 'ar,fr;q=0.8' }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

// ---------- fichier de données ----------
const load = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));
const dayOf = s => Date.parse(s + 'T00:00:00Z') / DAY;
function save(t) {
  const rows = t.months.map((m, i) => ` ${JSON.stringify({ y: m.y, m: m.m, start: m.start })}${i < t.months.length - 1 ? ',' : ''}`);
  fs.writeFileSync(FILE, `{\n"updated": ${JSON.stringify(t.updated)},\n"source": ${JSON.stringify(t.source)},\n"months": [\n${rows.join('\n')}\n]\n}\n`);
}

async function main() {
  const t = load();
  t.months.sort((a, b) => a.start.localeCompare(b.start));
  const lastRow = t.months.at(-1), last = dayOf(lastRow.start);
  const next = lastRow.m === 12 ? { y: lastRow.y + 1, m: 1 } : { y: lastRow.y, m: lastRow.m + 1 };
  const today = Math.floor(Date.now() / DAY);
  const manual = (process.env.MANUAL_START || '').trim();
  let start = null;

  if (manual) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(manual)) throw new Error('MANUAL_START doit être AAAA-MM-JJ');
    const d = dayOf(manual);
    if (![29, 30].includes(d - last)) throw new Error(`Date refusée : ${manual} n'est pas 29 ou 30 jours après ${lastRow.start}`);
    start = d; console.log('Saisie manuelle :', manual);
  } else {
    if (today < last + 27) { console.log(`Pas encore la période d'annonce (dernier début : ${lastRow.start}).`); return; }
    for (const url of feeds(next.m, next.y)) {
      try {
        const items = parseRss(await get(url)).filter(i => !i.pub || i.pub >= (last + 27) * DAY);   // ignore les vieux articles
        for (const it of items) {
          if (!/الاوقاف|الأوقاف/.test(it.text) && !/وزاره/.test(norm(it.text))) continue;
          const d = extractStart(it.text, last, next.m);
          if (d) { start = d; console.log('Trouvé :', iso(d), '←', it.text.slice(0, 110).replace(/\s+/g, ' ')); break; }
        }
      } catch (e) { console.log('Source ignorée :', e.message); }
      if (start) break;
    }
  }
  if (!start) { console.log(`Aucune annonce trouvée pour ${HIJRI_AR[next.m]} ${next.y}.`); return; }
  t.months.push({ y: next.y, m: next.m, start: iso(start) });
  t.updated = iso(today);
  save(t);
  console.log(`Ajouté : ${HIJRI_AR[next.m]} ${next.y} commence le ${iso(start)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
