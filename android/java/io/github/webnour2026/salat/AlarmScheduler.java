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
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.TimeZone;

/**
 * Adhan en arrière-plan : garde la configuration envoyée par l'application web
 * (horaires officiels des 30 prochains jours + réglages) et programme UNE alarme :
 * la prochaine prière (ou le rappel avant la prière). Chaque alarme programme la suivante.
 */
final class AlarmScheduler {
    private AlarmScheduler() {}

    static final String PREFS = "salati_alarm";
    static final String[] KEYS = {"Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"};
    static final String EXTRA_KEY = "k", EXTRA_TYPE = "t", EXTRA_TIME = "w";
    static final int NOTIF_ADHAN = 1001, NOTIF_BEFORE = 1002, NOTIF_INFO = 1003;
    static final String DEFAULT_ADHAN = "aaqib";

    static JSONObject config(Context ctx) {
        try {
            String s = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("cfg", null);
            return s == null ? null : new JSONObject(s);
        } catch (Exception e) { return null; }
    }

    static void save(Context ctx, JSONObject cfg) {
        SharedPreferences.Editor ed = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        ed.putString("cfg", cfg.toString());
        ed.putLong("syncedAt", System.currentTimeMillis());
        ed.apply();
    }

    /** Horaires (ms) d'un jour : d'abord la liste officielle, sinon le calcul local. */
    private static long[] dayTimes(JSONObject cfg, Calendar day) {
        long[] official = new long[5];
        try {
            JSONArray days = cfg.optJSONArray("times");
            if (days != null) {
                long dayStart = day.getTimeInMillis(), dayEnd = dayStart + 36L * 3600000;
                for (int i = 0; i < days.length(); i++) {
                    JSONArray row = days.getJSONArray(i);
                    long fajr = row.getLong(0) * 60000L;
                    if (fajr >= dayStart - 6L * 3600000 && fajr < dayEnd - 12L * 3600000) {
                        for (int k = 0; k < 5; k++) official[k] = row.getLong(k) * 60000L;
                        return official;
                    }
                }
            }
        } catch (Exception ignored) {}
        // secours : calcul astronomique + ajustements de l'utilisateur
        long[] t = PrayerCalc.compute(cfg.optDouble("lat"), cfg.optDouble("lng"),
                day.get(Calendar.YEAR), day.get(Calendar.MONTH) + 1, day.get(Calendar.DAY_OF_MONTH),
                cfg.optInt("method", 21), cfg.optInt("school", 0));
        JSONObject adj = cfg.optJSONObject("adj");
        if (adj != null) for (int k = 0; k < 5; k++) if (t[k] > 0) t[k] += adj.optInt(KEYS[k], 0) * 60000L;
        return t;
    }

    /** Prochaine prière après `now` : clé, heure (ms) et indice du jour dans cfg.times (-1 si calcul local). */
    static final class Next {
        final String key; final long time; final int day;
        Next(String key, long time, int day) { this.key = key; this.time = time; this.day = day; }
    }

    static Next nextPrayer(JSONObject cfg, long now) {
        String tz = cfg.optString("tz", TimeZone.getDefault().getID());
        Calendar day = Calendar.getInstance(TimeZone.getTimeZone(tz));
        for (int i = 0; i < 3; i++) {
            Calendar d = (Calendar) day.clone();
            d.add(Calendar.DAY_OF_MONTH, i);
            Calendar utc = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
            utc.clear();
            utc.set(d.get(Calendar.YEAR), d.get(Calendar.MONTH), d.get(Calendar.DAY_OF_MONTH), 0, 0, 0);
            long[] t = dayTimes(cfg, utc);
            for (int k = 0; k < 5; k++) {
                if (t[k] > now + 1000) return new Next(KEYS[k], t[k], dayIndex(cfg, t[k]));
            }
        }
        return null;
    }

    /** Prière dont l'heure est passée depuis moins de `gr` minutes (cfg), sinon null. */
    static Next elapsedPrayer(JSONObject cfg, long now) {
        long grace = cfg.optInt("gr", 30) * 60000L;
        if (grace <= 0) return null;
        String tz = cfg.optString("tz", TimeZone.getDefault().getID());
        Calendar d = Calendar.getInstance(TimeZone.getTimeZone(tz));
        Calendar utc = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        utc.clear();
        utc.set(d.get(Calendar.YEAR), d.get(Calendar.MONTH), d.get(Calendar.DAY_OF_MONTH), 0, 0, 0);
        long[] t = dayTimes(cfg, utc);
        for (int k = 4; k >= 0; k--) {
            if (t[k] <= 0 || t[k] > now) continue;
            return now < t[k] + grace ? new Next(KEYS[k], t[k], dayIndex(cfg, t[k])) : null;
        }
        return null;
    }

    /** Indice de la ligne de cfg.times qui contient cet horaire, sinon -1. */
    private static int dayIndex(JSONObject cfg, long time) {
        try {
            JSONArray days = cfg.optJSONArray("times");
            long min = time / 60000L;
            if (days != null) for (int i = 0; i < days.length(); i++) {
                JSONArray row = days.getJSONArray(i);
                for (int k = 0; k < row.length(); k++) if (row.getLong(k) == min) return i;
            }
        } catch (Exception ignored) {}
        return -1;
    }

    /** Programme la prochaine alarme (ou annule s'il n'y a rien à faire). */
    static void scheduleNext(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = alarmIntent(ctx, null, null, 0);
        am.cancel(pi);
        JSONObject cfg = config(ctx);
        if (cfg == null) return;
        boolean adhan = cfg.optBoolean("en", true), at = cfg.optBoolean("na", false);
        int before = cfg.optInt("nb", 0);
        boolean ongoing = cfg.optBoolean("on", false);   // notification permanente : à rafraîchir à chaque prière
        if (!adhan && !at && before <= 0 && !ongoing) return;

        long now = System.currentTimeMillis();
        long bestTime = Long.MAX_VALUE; String bestKey = null, bestType = null;
        String tz = cfg.optString("tz", TimeZone.getDefault().getID());
        Calendar day = Calendar.getInstance(TimeZone.getTimeZone(tz));
        for (int i = 0; i < 3 && bestKey == null; i++) {
            Calendar d = (Calendar) day.clone();
            d.add(Calendar.DAY_OF_MONTH, i);
            Calendar utc = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
            utc.clear();
            utc.set(d.get(Calendar.YEAR), d.get(Calendar.MONTH), d.get(Calendar.DAY_OF_MONTH), 0, 0, 0);
            long[] t = dayTimes(cfg, utc);
            for (int k = 0; k < 5; k++) {
                if (t[k] <= 0) continue;
                if (before > 0) {
                    long b = t[k] - before * 60000L;
                    if (b > now + 1000 && b < bestTime) { bestTime = b; bestKey = KEYS[k]; bestType = "before"; }
                }
                if ((adhan || at || ongoing) && t[k] > now + 1000 && t[k] < bestTime) {
                    bestTime = t[k]; bestKey = KEYS[k]; bestType = (adhan || at) ? "at" : "tick";
                }
                // notification permanente : fin de la période « c'est l'heure » -> prière suivante
                long end = t[k] + cfg.optInt("gr", 30) * 60000L;
                if (ongoing && end > now + 1000 && end < bestTime) { bestTime = end; bestKey = KEYS[k]; bestType = "tick"; }
            }
        }
        if (bestKey == null) return;
        pi = alarmIntent(ctx, bestKey, bestType, bestTime);
        boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
        try {
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, bestTime, pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, bestTime, pi);   // sans autorisation : à quelques minutes près
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, bestTime, pi);
        }
    }

    private static PendingIntent alarmIntent(Context ctx, String key, String type, long when) {
        Intent i = new Intent(ctx, AlarmReceiver.class).setAction("io.github.webnour2026.salat.ALARM");
        if (key != null) { i.putExtra(EXTRA_KEY, key); i.putExtra(EXTRA_TYPE, type); i.putExtra(EXTRA_TIME, when); }
        return PendingIntent.getBroadcast(ctx, 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // ---------- notifications ----------
    static String text(JSONObject cfg, String name, String def) {
        JSONObject txt = cfg == null ? null : cfg.optJSONObject("txt");
        return txt == null ? def : txt.optString(name, def);
    }
    /** Nom affiché de la prière à l'instant `when` (le Dhuhr s'appelle « Joumou'a » le vendredi). */
    static String prayerName(JSONObject cfg, String key, long when) {
        return PrayerNames.of(cfg, key, when);
    }

    /** Identifiant d'un fichier audio intégré (res/raw), sinon l'Adhan par défaut, sinon 0. */
    static int rawId(Context ctx, String id) {
        int r = id == null ? 0 : ctx.getResources().getIdentifier(id, "raw", ctx.getPackageName());
        if (r == 0) r = ctx.getResources().getIdentifier(DEFAULT_ADHAN, "raw", ctx.getPackageName());
        return r;
    }

    /**
     * URI d'un son intégré, par son NOM (…/raw/aaqib) et non par son identifiant numérique :
     * les identifiants changent d'un build à l'autre dès qu'on ajoute ou retire un mp3,
     * alors qu'un canal Android garde son son pour toujours.
     */
    static Uri soundUri(Context ctx, String sound) {
        int raw = rawId(ctx, sound);
        if (raw == 0) return null;
        return Uri.parse("android.resource://" + ctx.getPackageName() + "/raw/"
                + ctx.getResources().getResourceEntryName(raw));
    }

    /** Une seule fois : supprime les anciens canaux (« salati_… ») créés avec l'URI numérique. */
    private static void migrateChannels(Context ctx, NotificationManager nm) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (prefs.getBoolean("channels2", false)) return;
        for (NotificationChannel c : nm.getNotificationChannels()) {
            if (c.getId().startsWith("salati_")) nm.deleteNotificationChannel(c.getId());
        }
        prefs.edit().putBoolean("channels2", true).apply();
    }

    /** Un canal par (son, vibration) : les réglages d'un canal Android ne peuvent plus changer. */
    static String channel(Context ctx, String sound, boolean vibrate, String label) {
        String id = "salati2_" + (sound == null ? "silent" : sound) + (vibrate ? "_v" : "_nv");
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            migrateChannels(ctx, nm);
            if (nm.getNotificationChannel(id) == null) {
                NotificationChannel ch = new NotificationChannel(id, label,
                        sound == null ? NotificationManager.IMPORTANCE_DEFAULT : NotificationManager.IMPORTANCE_HIGH);
                if (sound == null) ch.setSound(null, null);
                else {
                    ch.setSound(soundUri(ctx, sound), new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
                }
                ch.enableVibration(vibrate);
                if (vibrate) ch.setVibrationPattern(new long[]{0, 400, 200, 400, 200, 800});
                nm.createNotificationChannel(ch);
            }
        }
        return id;
    }

    static PendingIntent openApp(Context ctx) {
        Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (launch == null) launch = new Intent();
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        return PendingIntent.getActivity(ctx, 2, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @SuppressWarnings("deprecation")
    static Notification.Builder builder(Context ctx, String channel) {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, channel) : new Notification.Builder(ctx);
        int icon = ctx.getResources().getIdentifier("ic_salati_notif", "drawable", ctx.getPackageName());
        b.setSmallIcon(icon != 0 ? icon : android.R.drawable.ic_popup_reminder)
         .setContentIntent(openApp(ctx))
         .setAutoCancel(true)
         .setColor(0xFF0E6B58);
        return b;
    }
}
