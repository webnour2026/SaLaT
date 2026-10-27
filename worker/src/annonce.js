// Page privée « annonce manuelle du croissant » : filet de sécurité si le robot ne trouve pas le communiqué du ministère.
//  • GET  /annonce  → formulaire (code secret + 1er jour du mois annoncé)
//  • POST /annonce  → vérifie le code (secret ANNONCE_KEY), la date (aujourd'hui → +2 jours), limite les essais (KV),
//                     puis lance le travail GitHub « Habous » avec cette date (secret GH_DISPATCH_TOKEN, droit Actions seulement).
//    Le travail met à jour data/habous.json puis appelle /check : la notification part comme pour une annonce automatique.
const REPO = 'webnour2026/SaLaT', WORKFLOW = 'habous.yml';
const MAX_TRIES = 5;                     // essais de code par heure, au-delà : bloqué une heure

const page = (msg = '', ok = false) => `<!doctype html><html lang="ar" dir="rtl" translate="no"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<meta name="google" content="notranslate"><title>صلاتي – إعلان الهلال</title>
<style>body{font:17px/1.6 system-ui,sans-serif;background:#F5EFE4;color:#14302A;margin:0;padding:18px}main{max-width:420px;margin:auto}
h1{font-size:1.3rem;margin:.2em 0 .6em}label{display:block;margin:.9em 0 .3em;font-weight:600}
input,button{width:100%;box-sizing:border-box;font:inherit;padding:12px;border-radius:12px;border:1px solid #CBBFA8;background:#fff}
button{background:#0B5B4B;color:#fff;border:0;font-weight:700;margin-top:1.2em}.q{display:flex;gap:8px}.q button{background:#E6DCC8;color:#14302A;margin-top:.5em}
.m{padding:12px;border-radius:12px;margin-top:1em;background:${ok ? '#DDEFE6' : '#F6E0DA'}}small{color:#6B6253}</style></head>
<body><main><h1>🌙 إعلان بداية الشهر</h1>
<p><small>لا تُستعمل إلا بعد صدور بلاغ وزارة الأوقاف الرسمي. · À n'utiliser qu'après le communiqué officiel du ministère.</small></p>
${msg ? `<p class="m">${msg}</p>` : ''}
<form method="post" onsubmit="return confirm('تأكيد: فاتح الشهر يوم ' + this.start.value + ' ؟')">
<label for="k">الرمز السري · Code</label><input id="k" name="key" type="password" autocomplete="current-password" required>
<label for="s">فاتح الشهر (اليوم الأول) · 1er jour du mois</label><input id="s" name="start" type="date" required>
<div class="q"><button type="button" onclick="d(1)">غدًا</button><button type="button" onclick="d(2)">بعد غد</button></div>
<button type="submit">إرسال الإعلان · Envoyer</button></form>
<script>function d(n){const t=new Date(Date.now()+n*864e5);document.getElementById('s').value=t.toISOString().slice(0,10)}</script>
</main></body></html>`;

const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
  'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'" } });

/** Comparaison à temps constant (le code ne se devine pas au chronomètre). */
async function same(a, b) {
  const h = async s => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s))));
  const [x, y] = await Promise.all([h(a), h(b)]); let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]; return d === 0;
}
const daysFromToday = (ymd, now = new Date()) => Math.round((Date.parse(ymd + 'T00:00:00Z') - Date.parse(now.toISOString().slice(0, 10) + 'T00:00:00Z')) / 864e5);

export async function annonce(req, env) {
  if (!env.ANNONCE_KEY || !env.GH_DISPATCH_TOKEN) return html(page('الصفحة غير مفعّلة بعد (الأسرار ANNONCE_KEY و GH_DISPATCH_TOKEN غير موجودة). · Page non activée.'), 503);
  if (req.method === 'GET') return html(page());
  if (req.method !== 'POST') return html(page(), 405);
  const ip = req.headers.get('CF-Connecting-IP') || 'x', slot = `tries:${ip}:${new Date().toISOString().slice(0, 13)}`;
  const tries = Number(await env.KV.get(slot)) || 0;
  if (tries >= MAX_TRIES) return html(page('محاولات كثيرة، أعد بعد ساعة. · Trop d\'essais, réessayez dans une heure.'), 429);
  const f = await req.formData().catch(() => null);
  const key = f && String(f.get('key') || ''), start = f && String(f.get('start') || '');
  if (!(await same(key, env.ANNONCE_KEY))) {
    await env.KV.put(slot, String(tries + 1), { expirationTtl: 3600 });
    return html(page('الرمز غير صحيح. · Code incorrect.'), 403);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || daysFromToday(start) < 0 || daysFromToday(start) > 2)
    return html(page('التاريخ يجب أن يكون اليوم أو غدًا أو بعد غد. · Date : aujourd\'hui, demain ou après-demain.'), 400);
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, { method: 'POST',
    headers: { Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'salati-push', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main', inputs: { start } }) });
  if (r.status !== 204) return html(page(`تعذّر تشغيل الإرسال (GitHub ${r.status}). · Échec du lancement (GitHub ${r.status}).`), 502);
  return html(page(`✅ تم. فاتح الشهر: ${start}. يصل الإشعار إلى المستعملين خلال دقيقتين تقريبًا. · C'est parti : la notification arrive d'ici ~2 minutes.`, true));
}

/** GET /annonce/etat : la page est-elle activée, le jeton GitHub est-il valable, combien de jours avant son expiration ?
 *  Ne révèle aucun secret. Appelé chaque semaine par le travail GitHub « Annonce manuelle (contrôle) ». */
export async function annonceEtat(env) {
  const out = { activee: !!(env.ANNONCE_KEY && env.GH_DISPATCH_TOKEN) };
  if (out.activee) {
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}`, {
      headers: { Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'salati-push' } });
    out.jeton = r.status === 200 ? 'valable' : `refusé (GitHub ${r.status})`;
    const exp = r.headers.get('github-authentication-token-expiration');          // ex. « 2027-10-27 20:05:00 +0000 »
    if (exp) { const t = Date.parse(exp.replace(' ', 'T').replace(' ', '')); if (Number.isFinite(t)) { out.expiration = new Date(t).toISOString().slice(0, 10); out.joursRestants = Math.floor((t - Date.now()) / 864e5); } }
  }
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
