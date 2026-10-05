package io.github.webnour2026.salat;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashSet;
import java.util.Set;

/**
 * Rappels de la veille au soir, même appli fermée : jours blancs, début de mois (avec le doua), Aïds (avec le takbir).
 *
 * L'application web envoie dans la configuration une liste cfg.rem :
 *   { id, at, until, title, body, watch? }
 *  - at / until : heure d'envoi (ms) et fin de la période où le rappel reste utile ;
 *  - watch (« AAAA-MM-JJ ») : au Maroc, le début du mois suivant n'est connu qu'après le communiqué du ministère.
 *    Le module lit alors data/habous.json toutes les 10 min et n'envoie que si ce jour est bien un début de mois annoncé.
 * Une seule alarme est programmée à la fois : celle du prochain rappel à traiter.
 */
final class Reminders {
    private Reminders() {}

    static final int REQUEST = 4, NOTIF_BASE = 2000;
    static final long POLL_MS = 10 * 60000L;
    /** Le module ne lit que le calendrier publié sur le site de l'application. */
    static final String SITE = "https://webnour2026.github.io/";
    private static final String DONE = "remDone";

    // ---------- rappels déjà envoyés ----------
    private static SharedPreferences prefs(Context ctx) { return ctx.getSharedPreferences(AlarmScheduler.PREFS, Context.MODE_PRIVATE); }

    static Set<String> doneIds(Context ctx) {
        return new HashSet<String>(prefs(ctx).getStringSet(DONE, new HashSet<String>()));
    }

    static void markDone(Context ctx, String id) {
        Set<String> s = new HashSet<String>(prefs(ctx).getStringSet(DONE, new HashSet<String>()));
        s.add(id);
        if (s.size() > 60) {                       // on garde les plus récents (les identifiants commencent par la date)
            java.util.TreeSet<String> sorted = new java.util.TreeSet<String>(s);
            while (sorted.size() > 40) sorted.pollFirst();
            s = new HashSet<String>(sorted);
        }
        prefs(ctx).edit().putStringSet(DONE, s).apply();
    }

    // ---------- alarme ----------
    private static PendingIntent pending(Context ctx) {
        Intent i = new Intent(ctx, ReminderReceiver.class).setAction("io.github.webnour2026.salat.REMINDER");
        return PendingIntent.getBroadcast(ctx, REQUEST, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Programme l'alarme du prochain rappel à traiter (annule s'il n'y en a plus). */
    static void schedule(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        am.cancel(pending(ctx));
        long next = nextDue(AlarmScheduler.config(ctx), doneIds(ctx), Clock.now(ctx));
        if (next == Long.MAX_VALUE) return;
        long trigger = Clock.toDevice(ctx, next);   // alarme sur l'horloge du téléphone, corrigée de l'écart mesuré
        boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
        try {
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pending(ctx));
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pending(ctx));   // sans autorisation : à quelques minutes près
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pending(ctx));
        }
    }

    /** Prochain instant où un rappel doit être traité (ms), ou Long.MAX_VALUE. */
    static long nextDue(JSONObject cfg, Set<String> done, long now) {
        JSONArray rem = cfg == null ? null : cfg.optJSONArray("rem");
        long next = Long.MAX_VALUE;
        if (rem == null) return next;
        for (int i = 0; i < rem.length(); i++) {
            JSONObject e = rem.optJSONObject(i);
            if (e == null) continue;
            String id = e.optString("id", "");
            long at = e.optLong("at", 0), until = e.optLong("until", 0);
            if (id.length() == 0 || at <= 0 || until <= now || done.contains(id)) continue;
            boolean watch = e.optString("watch", "").length() > 0;
            long t;
            if (now < at) t = at;                       // pas encore l'heure
            else if (watch) t = now + POLL_MS;          // à surveiller : on revient dans 10 min
            else t = now + 1000;                        // certain et déjà dû (téléphone éteint, etc.) : tout de suite
            if (t >= until) continue;
            if (t < next) next = t;
        }
        return next;
    }

    // ---------- traitement (thread d'arrière-plan) ----------
    /** Source des débuts de mois annoncés (interrogée seulement si un rappel « à surveiller » est à traiter). */
    interface Starts { Set<String> get(); }

    /** Rappels à envoyer maintenant : dans leur période, pas encore envoyés, et (si « à surveiller ») confirmés par le calendrier. */
    static java.util.List<JSONObject> due(JSONObject cfg, Set<String> done, long now, Starts starts) {
        java.util.List<JSONObject> out = new java.util.ArrayList<JSONObject>();
        JSONArray rem = cfg == null ? null : cfg.optJSONArray("rem");
        if (rem == null) return out;
        boolean fetched = false;
        Set<String> known = null;
        for (int i = 0; i < rem.length(); i++) {
            JSONObject e = rem.optJSONObject(i);
            if (e == null) continue;
            String id = e.optString("id", "");
            long at = e.optLong("at", 0), until = e.optLong("until", 0);
            if (id.length() == 0 || done.contains(id) || now < at || now >= until) continue;
            String watch = e.optString("watch", "");
            if (watch.length() > 0) {
                if (!fetched) { known = starts.get(); fetched = true; }
                if (known == null || !known.contains(watch)) continue;       // pas (encore) annoncé, ou réseau indisponible
            }
            out.add(e);
        }
        return out;
    }

    static void run(final Context ctx) {
        final JSONObject cfg = AlarmScheduler.config(ctx);
        if (cfg == null) return;
        Set<String> done = doneIds(ctx);
        for (JSONObject e : due(cfg, done, Clock.now(ctx), new Starts() {
            @Override public Set<String> get() { return fetchStarts(cfg.optString("base", "")); }
        })) {
            show(ctx, cfg, e);
            markDone(ctx, e.optString("id", ""));
        }
    }

    /** Débuts de mois annoncés par le ministère : data/habous.json du site de l'application. */
    static Set<String> fetchStarts(String base) {
        HttpURLConnection c = null;
        try {
            if (base == null || !base.startsWith(SITE)) return null;
            String url = base + (base.endsWith("/") ? "" : "/") + "data/habous.json?t=" + (System.currentTimeMillis() / 60000L);
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(5000);
            c.setReadTimeout(5000);
            c.setUseCaches(false);
            c.setRequestProperty("Cache-Control", "no-cache");
            if (c.getResponseCode() != 200) return null;
            StringBuilder sb = new StringBuilder();
            BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"));
            String line;
            while ((line = r.readLine()) != null && sb.length() < 200000) sb.append(line).append('\n');
            r.close();
            return parseStarts(sb.toString());
        } catch (Exception ex) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** Contenu de data/habous.json → ensemble des jours « AAAA-MM-JJ » où un mois commence ; null si illisible ou vide. */
    static Set<String> parseStarts(String json) {
        try {
            JSONArray months = new JSONObject(json).getJSONArray("months");
            Set<String> out = new HashSet<String>();
            for (int i = 0; i < months.length(); i++) {
                String d = months.getJSONObject(i).optString("start", "");
                if (d.matches("\\d{4}-\\d{2}-\\d{2}")) out.add(d);
            }
            return out.isEmpty() ? null : out;
        } catch (Exception ex) {
            return null;
        }
    }

    // ---------- notification ----------
    private static String channel(Context ctx, JSONObject cfg, boolean silent, boolean vib) {
        String id = "salati_rem_" + (silent ? "s" : (vib ? "v" : "nv"));
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            if (nm.getNotificationChannel(id) == null) {
                NotificationChannel ch = new NotificationChannel(id, AlarmScheduler.text(cfg, "chReminder", "Rappels"),
                        silent ? NotificationManager.IMPORTANCE_LOW : NotificationManager.IMPORTANCE_HIGH);
                if (silent) ch.setSound(null, null);
                else ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
                ch.enableVibration(vib);
                if (vib) ch.setVibrationPattern(new long[]{0, 300, 150, 300});
                nm.createNotificationChannel(ch);
            }
        }
        return id;
    }

    @SuppressWarnings("deprecation")
    static void show(Context ctx, JSONObject cfg, JSONObject e) {
        boolean silent = cfg.optLong("su", 0) > Clock.now(ctx);
        boolean vib = cfg.optBoolean("vib", true) && !silent;
        String title = e.optString("title", ""), body = e.optString("body", "");
        String first = body.indexOf('\n') > 0 ? body.substring(0, body.indexOf('\n')) : body;
        Notification.Builder b = AlarmScheduler.builder(ctx, channel(ctx, cfg, silent, vib))
                .setContentTitle(title)
                .setContentText(first)
                .setStyle(new Notification.BigTextStyle().bigText(body));
        if (Build.VERSION.SDK_INT < 26) {
            if (!silent) b.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION));
            if (vib) b.setVibrate(new long[]{0, 300, 150, 300});
            b.setPriority(Notification.PRIORITY_HIGH);
        }
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.notify(NOTIF_BASE + (e.optString("id", "").hashCode() & 0x7fff), b.build());
    }
}
