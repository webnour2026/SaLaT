// Met à jour data/habous.json : début de chaque mois hégirien annoncé par le Ministère des Habous (Maroc).
// Le ministère observe le croissant le soir du 29 et publie un communiqué ; les journaux le relaient aussitôt.
// Le ministère diffuse d'abord par l'agence MAP et la télévision publique (son propre site est vite saturé) ;
// ce script interroge ces sources officielles, puis la presse (2 médias requis). Il n'accepte qu'une date plausible :
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

// ---------- français / anglais (MAP Express publie aussi en français) ----------
const normLatin = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’'`´‑–\-]/g, ' ').replace(/\s+/g, ' ');
const LATIN_HIJRI = {
  1: ['mouharram', 'moharram', 'muharram', 'mouharem', 'moharem'],
  2: ['safar'],
  3: ['rabii al awwal', 'rabii al awal', 'rabii el awal', 'rabi al awwal', 'rabi al awal', 'rabia al awal', 'rabii i', 'rabi i', 'rabii 1'],
  4: ['rabii ath thani', 'rabii al thani', 'rabii thani', 'rabi al thani', 'rabi ath thani', 'rabia ath thani', 'rabii ii', 'rabi ii', 'rabii 2', 'rabii al akhir', 'rabi al akhir'],
  5: ['joumada al oula', 'joumada al ula', 'joumada el oula', 'joumada oula', 'jumada al ula', 'joumada i', 'joumada 1'],
  6: ['joumada ath thania', 'joumada al thania', 'joumada al akhira', 'joumada al akhirah', 'joumada thania', 'jumada al akhira', 'joumada ii', 'joumada 2'],
  7: ['rajab'],
  8: ['chaabane', 'chaaban', 'chabane', 'shaaban', 'shaban'],
  9: ['ramadan', 'ramadhan'],
  10: ['chaoual', 'chaual', 'chawwal', 'shawwal'],
  11: ['dou al qida', 'dou al qi da', 'dou el qida', 'dhou al qida', 'dhou al qi da', 'dhul qadah', 'dhu al qadah', 'doul qida'],
  12: ['dou al hija', 'dou al hijja', 'dou el hija', 'dhou al hija', 'dhou al hijja', 'dhul hijjah', 'dhu al hijjah', 'doul hija'],
};
const LATIN_GREG = { janvier: 1, january: 1, fevrier: 2, february: 2, mars: 3, march: 3, avril: 4, april: 4, mai: 5, may: 5, juin: 6, june: 6,
  juillet: 7, july: 7, aout: 8, august: 8, septembre: 9, september: 9, octobre: 10, october: 10, novembre: 11, november: 11, decembre: 12, december: 12 };
const LATIN_WEEK = { dimanche: 0, sunday: 0, lundi: 1, monday: 1, mardi: 2, tuesday: 2, mercredi: 3, wednesday: 3, jeudi: 4, thursday: 4, vendredi: 5, friday: 5, samedi: 6, saturday: 6 };
const RE_LGREG = Object.keys(LATIN_GREG).join('|'), RE_LWEEK = Object.keys(LATIN_WEEK).join('|');

/** Comme extractStart, pour un texte français ou anglais. */
export function extractStartLatin(raw, last, expected) {
  const text = normLatin(raw);
  if (!/habous|affaires islamiques|awqaf|islamic affairs/.test(text)) return null;     // doit venir du ministère
  const out = new Set(), plausible = day => day - last === 29 || day - last === 30;
  const names = LATIN_HIJRI[expected].map(n => `(?<![a-z0-9])${n}(?![a-z0-9])`).join('|');
  for (const mt of text.matchAll(new RegExp(names, 'g'))) {
    const after = text.slice(mt.index, mt.index + 260);
    let found = false;
    for (const dm of after.matchAll(new RegExp(`(\\d{1,2})(?:er|st|nd|rd|th)?\\s+(${RE_LGREG})\\s+(20\\d\\d)`, 'g'))) {
      const day = Date.UTC(+dm[3], LATIN_GREG[dm[2]] - 1, +dm[1]) / DAY;
      if (plausible(day)) { out.add(day); found = true; }
    }
    if (found) continue;
    const around = text.slice(Math.max(0, mt.index - 80), mt.index + 160);
    const days = new Set([...around.matchAll(new RegExp(`(?<![a-z])(${RE_LWEEK})(?![a-z])`, 'g'))].map(x => LATIN_WEEK[x[1]]));
    const opts = [last + 29, last + 30].filter(d => days.has(dow(d)));
    if (opts.length === 1) out.add(opts[0]);
  }
  return out.size === 1 ? [...out][0] : null;
}

/** Arabe + français/anglais. */
export function extractAny(raw, last, expected) {
  const r = [extractStart(raw, last, expected), extractStartLatin(raw, last, expected)].filter(x => x !== null);
  return r.length && r.every(x => x === r[0]) ? r[0] : null;
}

// ---------- décision : qui croire ? ----------
// Le ministère l'a lui-même signalé : de faux communiqués circulent. Donc :
//  • source OFFICIELLE (MAP, télévision publique SNRT, site du ministère) : suffit à elle seule ;
//  • presse ordinaire : au moins 2 médias DIFFÉRENTS doivent donner la même date ;
//  • désaccord : on ne change rien (l'officiel l'emporte sur la presse).
export function decide(cands) {
  const off = new Set(cands.filter(c => c.trust === 'official').map(c => c.day));
  if (off.size === 1) return { day: [...off][0], why: 'source officielle' };
  if (off.size > 1) return { day: null, why: 'sources officielles en désaccord' };
  const hosts = new Map();
  for (const c of cands) { if (!hosts.has(c.day)) hosts.set(c.day, new Set()); hosts.get(c.day).add(c.host || '?'); }
  const strong = [...hosts].filter(([, h]) => h.size >= 2).map(([d]) => d);
  if (strong.length === 1) return { day: strong[0], why: `${hosts.get(strong[0]).size} médias concordent` };
  if (strong.length > 1) return { day: null, why: 'presse en désaccord' };
  return { day: null, why: cands.length ? 'un seul média : pas assez fiable' : 'aucune annonce trouvée' };
}

// ---------- sources ----------
const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&#8217;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const strip = s => decode(String(s)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const hostOf = u => { try { const h = new URL(u).hostname.replace(/^www\./, '').split('.'); return h.slice(-2).join('.'); } catch { return ''; } };

export function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const g = tag => { const x = m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)); return x ? x[1].replace(/<!\[CDATA\[|\]\]>/g, '') : ''; };
    const src = m[1].match(/<source[^>]*url="([^"]+)"/);
    return { text: strip(`${g('title')} ${g('description')} ${g('content:encoded')}`), pub: Date.parse(g('pubDate')) || 0, host: hostOf(src ? src[1] : g('link')) };
  });
}
/** API REST WordPress (MAP Express) : [{ title:{rendered}, excerpt:{rendered}, date_gmt, link }] */
export function parseWpJson(json) {
  const arr = Array.isArray(json) ? json : [];
  return arr.map(p => ({ text: strip(`${p.title?.rendered || ''} ${p.excerpt?.rendered || ''} ${p.content?.rendered || ''}`),
    pub: Date.parse((p.date_gmt || p.date || '') + (p.date_gmt ? 'Z' : '')) || 0, host: hostOf(p.link || '') }));
}
const parseAny = (body, host) => {
  const t = body.trim();
  if (t.startsWith('[') || t.startsWith('{')) { try { return parseWpJson(JSON.parse(t)).map(i => ({ ...i, host: i.host || host })); } catch { /* pas du JSON */ } }
  if (/<item>/.test(t)) return parseRss(t).map(i => ({ ...i, host: i.host || host }));
  return [{ text: strip(t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ')), pub: 0, host }];      // page HTML
};

const enc = encodeURIComponent;
export const sources = (m, y) => {
  const ar = `فاتح شهر ${HIJRI_AR[m]}`;
  return [
    // ----- officielles : l'agence MAP (canal utilisé par le ministère), la télévision publique, le site du ministère -----
    { name: 'MAP Express (ar, flux)', trust: 'official', url: `https://www.mapexpress.ma/ar/?s=${enc(ar)}&feed=rss2` },
    { name: 'MAP Express (ar, API)', trust: 'official', url: `https://www.mapexpress.ma/wp-json/wp/v2/posts?search=${enc(ar)}&per_page=12&lang=ar` },
    { name: 'MAP Express (fr, flux)', trust: 'official', url: `https://www.mapexpress.ma/?s=${enc('Habous croissant')}&feed=rss2` },
    { name: 'MAP Express (fr, API)', trust: 'official', url: `https://www.mapexpress.ma/wp-json/wp/v2/posts?search=${enc('Habous')}&per_page=12` },
    { name: 'MAP Express (ar, récents)', trust: 'official', url: 'https://www.mapexpress.ma/ar/feed/' },
    { name: 'SNRT News (« هلال »)', trust: 'official', url: 'https://snrtnews.com/taxonomy/term/174/feed' },
    { name: 'Ministère des Habous (site)', trust: 'official', url: 'https://www.habous.gov.ma/' },      // souvent saturé la veille d'une fête : simple bonus
    // ----- presse : il faut 2 médias différents -----
    { name: 'Google Actualités (mois)', trust: 'press', url: `https://news.google.com/rss/search?q=${enc(`${ar} ${y} الأوقاف`)}&hl=ar&gl=MA&ceid=MA:ar` },
    { name: 'Google Actualités (5 j)', trust: 'press', url: `https://news.google.com/rss/search?q=${enc('فاتح شهر وزارة الأوقاف هلال')}+when:5d&hl=ar&gl=MA&ceid=MA:ar` },
    { name: 'Bing Actualités', trust: 'press', url: `https://www.bing.com/news/search?q=${enc(`${ar} ${y} الأوقاف`)}&format=rss&setlang=ar` },
  ];
};
async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; SaLaT-habous/1.1)', 'accept-language': 'ar,fr;q=0.8,en;q=0.5' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
    const list = sources(next.m, next.y);
    const cands = [];
    const res = await Promise.allSettled(list.map(async src => {
      const items = parseAny(await get(src.url), hostOf(src.url)).filter(i => !i.pub || i.pub >= (last + 27) * DAY);   // ignore les vieux articles
      let n = 0;
      for (const it of items) {
        const d = extractAny(it.text, last, next.m);
        if (d) { cands.push({ day: d, trust: src.trust, host: it.host || hostOf(src.url), src: src.name }); n++; }
      }
      return `${items.length} article(s), ${n} annonce(s)`;
    }));
    res.forEach((r, i) => console.log(`  ${list[i].trust === 'official' ? '★' : '·'} ${list[i].name} : ${r.status === 'fulfilled' ? r.value : 'indisponible (' + r.reason.message + ')'}`));
    const verdict = decide(cands);
    console.log(`Décision : ${verdict.day ? iso(verdict.day) : 'aucune'} — ${verdict.why}`);
    if (verdict.day) start = verdict.day;
  }
  if (!start) { console.log(`Aucune annonce trouvée pour ${HIJRI_AR[next.m]} ${next.y}.`); return; }
  t.months.push({ y: next.y, m: next.m, start: iso(start) });
  t.updated = iso(today);
  save(t);
  console.log(`Ajouté : ${HIJRI_AR[next.m]} ${next.y} commence le ${iso(start)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
