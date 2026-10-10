package io.github.webnour2026.salat;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Mode Mosquée : après l'Adhan, coupe les sonneries du téléphone pendant la durée choisie, puis remet EXACTEMENT
 * l'état d'avant (sonnerie, vibreur, « Ne pas déranger »).
 *
 * Configuration (envoyée par l'application web dans cfg.mq) :
 *   { m: "off" | "once" | "perm", d: minutes, t: heure de la prière visée (ms, mode « once »), rm: [31 × 0/1 Ramadan, par ligne de cfg.times] }
 *
 * Un seul cycle à la fois, gardé dans les préférences (« mq_state ») : il survit à la fermeture de l'appli et au redémarrage.
 * Trois alarmes à identifiant fixe (début, Iqama, fin) : reprogrammer remplace, jamais de doublon.
 */
final class MosqueMode {
    private MosqueMode() {}

    private static final String STATE = "mq_state", DONE = "mq_done";
    static final String A_START = "io.github.webnour2026.salat.MQ_START";
    static final String A_IQAMA = "io.github.webnour2026.salat.MQ_IQAMA";
    static final String A_END = "io.github.webnour2026.salat.MQ_END";
    static final String A_STOP = "io.github.webnour2026.salat.MQ_STOP";
    private static final int RQ_START = 20, RQ_IQAMA = 21, RQ_END = 22, RQ_STOP = 23;
    static final int NOTIF_ON = 1005, NOTIF_IQAMA = 1006, NOTIF_END = 1007;
    private static final String CHANNEL = "salati2_mosque";

    // ---------- configuration ----------
    private static JSONObject mq(JSONObject cfg) { return cfg == null ? null : cfg.optJSONObject("mq"); }
    private static String mode(JSONObject cfg) { JSONObject m = mq(cfg); return m == null ? "off" : m.optString("m", "off"); }
    private static long onceT(JSONObject cfg) { JSONObject m = mq(cfg); return m == null ? 0 : m.optLong("t", 0); }

    /** Faut-il une alarme à l'heure des prières pour le Mode Mosquée ? */
    static boolean wanted(JSONObject cfg, long now) {
        return MosqueMath.wanted(mode(cfg), onceT(cfg), now);
    }

    private static SharedPreferences prefs(Context ctx) { return ctx.getSharedPreferences(AlarmScheduler.PREFS, Context.MODE_PRIVATE); }

    private static JSONObject state(Context ctx) {
        try {
            String s = prefs(ctx).getString(STATE, null);
            return s == null ? null : new JSONObject(s);
        } catch (Exception e) { return null; }
    }
    private static void saveState(Context ctx, JSONObject st) {
        if (st == null) prefs(ctx).edit().remove(STATE).commit();
        else prefs(ctx).edit().putString(STATE, st.toString()).commit();   // commit : l'état doit être écrit avant de toucher au son
    }

    // ---------- heure de la prière ----------
    /** Appelé par AlarmReceiver à l'heure de chaque prière. `sound` : Adhan joué (res/raw), ou null. */
    static void onPrayer(Context ctx, JSONObject cfg, String key, long t, String sound) {
        JSONObject m = mq(cfg);
        if (m == null) return;
        String mode = m.optString("m", "off");
        if (!MosqueMath.runs(mode, m.optLong("t", 0), prefs(ctx).getLong(DONE, 0), t)) return;
        JSONObject old = state(ctx);
        if (old != null && Math.abs(old.optLong("T") - t) < MosqueMath.MIN) return;      // déjà traité (alarme reçue deux fois)
        if (old != null) finish(ctx, false);                                              // cycle précédent pas terminé : on rend le son d'abord
        try {
            long adhanMs = sound == null ? 0 : durationOf(ctx, sound);
            long[] w = MosqueMath.window(t, adhanMs, m.optInt("d", MosqueMath.DUR_DEFAULT),
                    MosqueMath.iqamaMin(key, ramadan(cfg, t)));
            JSONObject st = new JSONObject();
            st.put("T", t); st.put("key", key);
            st.put("start", w[0]); st.put("iqama", w[1]); st.put("end", w[2]);
            st.put("started", false); st.put("set", MosqueMath.NONE);
            if ("once".equals(mode)) prefs(ctx).edit().putLong(DONE, m.optLong("t", 0)).commit();   // « cette prière uniquement » : consommé
            saveState(ctx, st);
            if (Clock.now(ctx) >= w[0]) startSilence(ctx); else arm(ctx);
        } catch (Exception ignored) {}
    }

    /** Ramadan ce jour-là ? (cfg.mq.rm, aligné sur les lignes de cfg.times) */
    private static boolean ramadan(JSONObject cfg, long t) {
        JSONObject m = mq(cfg);
        JSONArray rm = m == null ? null : m.optJSONArray("rm");
        int i = AlarmScheduler.dayIndexOf(cfg, t);
        return rm != null && i >= 0 && i < rm.length() && rm.optInt(i, 0) == 1;
    }

    /** Durée réelle du fichier de l'Adhan ; à défaut, estimation (20 s pour la version courte, 4 min sinon). */
    static long durationOf(Context ctx, String sound) {
        long guess = sound.endsWith("_court") ? 20000L : 240000L;
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        try {
            Uri u = AlarmScheduler.soundUri(ctx, sound);
            if (u == null) return guess;
            r.setDataSource(ctx, u);
            String d = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            long ms = d == null ? 0 : Long.parseLong(d);
            return ms > 0 ? ms + 2000L : guess;          // +2 s : fin du son et de la vibration
        } catch (Exception e) {
            return guess;
        } finally {
            try { r.release(); } catch (Exception ignored) {}
        }
    }

    // ---------- alarmes ----------
    private static PendingIntent pi(Context ctx, String action, int rq) {
        Intent i = new Intent(ctx, MosqueReceiver.class).setAction(action);
        return PendingIntent.getBroadcast(ctx, rq, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void set(Context ctx, AlarmManager am, long when, PendingIntent p) {
        long trigger = Clock.toDevice(ctx, when);
        boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
        try {
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, p);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, p);
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, p);
        }
    }

    private static void cancelAlarms(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        am.cancel(pi(ctx, A_START, RQ_START));
        am.cancel(pi(ctx, A_IQAMA, RQ_IQAMA));
        am.cancel(pi(ctx, A_END, RQ_END));
    }

    /** (Re)programme les alarmes du cycle en cours ; chaque identifiant est fixe : pas de doublon. */
    private static void arm(Context ctx) {
        JSONObject st = state(ctx);
        cancelAlarms(ctx);
        if (st == null) return;
        long now = Clock.now(ctx);
        long end = st.optLong("end");
        if (now >= end) { finish(ctx, st.optBoolean("started")); return; }
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (!st.optBoolean("started") && st.optLong("start") > now) set(ctx, am, st.optLong("start"), pi(ctx, A_START, RQ_START));
        if (st.optLong("iqama") > now) set(ctx, am, st.optLong("iqama"), pi(ctx, A_IQAMA, RQ_IQAMA));
        set(ctx, am, end, pi(ctx, A_END, RQ_END));
    }

    // ---------- son ----------
    private static boolean dndAccess(NotificationManager nm) {
        return Build.VERSION.SDK_INT < 23 || nm.isNotificationPolicyAccessGranted();
    }

    /** Début de la période : on note l'état audio actuel, puis on coupe les sonneries. */
    static void startSilence(Context ctx) {
        JSONObject st = state(ctx);
        if (st == null || st.optBoolean("started")) { arm(ctx); return; }
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        try {
            int prev = am.getRingerMode();
            int filter = Build.VERSION.SDK_INT >= 23 ? nm.getCurrentInterruptionFilter() : -1;
            int target = MosqueMath.target(prev, dndAccess(nm));
            st.put("prev", prev); st.put("filter", filter); st.put("started", true); st.put("set", MosqueMath.NONE);
            saveState(ctx, st);                          // état d'avant enregistré AVANT de toucher au son
            if (target != MosqueMath.NONE) {
                try { am.setRingerMode(target); }
                catch (SecurityException e) {             // accès « Ne pas déranger » retiré entre-temps : vibreur
                    target = prev == MosqueMath.VIBRATE ? MosqueMath.NONE : MosqueMath.VIBRATE;
                    if (target != MosqueMath.NONE) am.setRingerMode(target);
                }
                st.put("set", target == MosqueMath.NONE ? MosqueMath.NONE : am.getRingerMode());
                saveState(ctx, st);
            }
        } catch (Exception ignored) {}
        showOn(ctx, st);
        arm(ctx);
    }

    /** Fin du cycle : état audio d'avant (si l'utilisateur n'y a pas touché), notifications retirées. */
    static void finish(Context ctx, boolean notifyEnd) {
        JSONObject st = state(ctx);
        cancelAlarms(ctx);
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.cancel(NOTIF_ON);
        nm.cancel(NOTIF_IQAMA);
        if (st == null) return;
        boolean restored = false;
        int set = st.optInt("set", MosqueMath.NONE);
        if (st.optBoolean("started") && set != MosqueMath.NONE) {
            AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
            try {
                if (MosqueMath.restore(am.getRingerMode(), set)) {
                    int filter = st.optInt("filter", -1);
                    if (Build.VERSION.SDK_INT >= 23 && filter > 0 && dndAccess(nm) && nm.getCurrentInterruptionFilter() != filter) {
                        nm.setInterruptionFilter(filter);
                    }
                    am.setRingerMode(st.optInt("prev", MosqueMath.NORMAL));
                    restored = true;
                }
            } catch (Exception ignored) {}
        }
        saveState(ctx, null);
        if (notifyEnd && st.optBoolean("started")) showEnd(ctx, restored);
    }

    // ---------- événements ----------
    /** Adhan arrêté ou balayé : la période de silence commence tout de suite. */
    static void adhanStopped(Context ctx) {
        JSONObject st = state(ctx);
        if (st == null || st.optBoolean("started")) return;
        long now = Clock.now(ctx);
        if (now < st.optLong("T")) return;
        try { st.put("start", now); saveState(ctx, st); } catch (Exception ignored) {}
        startSilence(ctx);
    }

    /** Nouvelle configuration (activation, désactivation, durée) : on ajuste le cycle en cours. */
    static void onConfig(Context ctx) {
        JSONObject cfg = AlarmScheduler.config(ctx);
        JSONObject st = state(ctx);
        if (st == null) return;
        String mode = mode(cfg);
        long t = st.optLong("T");
        boolean keep = "perm".equals(mode) || ("once".equals(mode) && Math.abs(onceT(cfg) - t) < MosqueMath.MIN);
        if (!keep) { finish(ctx, false); return; }       // désactivé à la main : son rendu tout de suite
        try {
            JSONObject m = mq(cfg);
            long end = Math.max(t + MosqueMath.clampDur(m.optInt("d", MosqueMath.DUR_DEFAULT)) * MosqueMath.MIN,
                    st.optLong("iqama") + MosqueMath.PRAYER_SPAN);
            if (end != st.optLong("end")) { st.put("end", end); saveState(ctx, st); if (st.optBoolean("started")) showOn(ctx, st); }
        } catch (Exception ignored) {}
        arm(ctx);
    }

    /** Démarrage du téléphone, changement d'heure : le cycle en cours reprend (ou se termine s'il est échu). */
    static void resume(Context ctx) {
        JSONObject st = state(ctx);
        if (st == null) return;
        long now = Clock.now(ctx);
        if (now >= st.optLong("end")) { finish(ctx, st.optBoolean("started")); return; }
        if (!st.optBoolean("started") && now >= st.optLong("start")) { startSilence(ctx); return; }
        if (st.optBoolean("started")) showOn(ctx, st);
        arm(ctx);
    }

    // ---------- notifications ----------
    private static String channel(Context ctx, JSONObject cfg) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            if (nm.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, AlarmScheduler.text(cfg, "chMosque", "Mode Mosquée"),
                        NotificationManager.IMPORTANCE_LOW);
                ch.setSound(null, null);
                ch.enableVibration(false);
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
        }
        return CHANNEL;
    }

    private static String hm(JSONObject cfg, long t) {
        SimpleDateFormat f = new SimpleDateFormat("HH:mm", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone(cfg.optString("tz", TimeZone.getDefault().getID())));
        return f.format(new Date(t));
    }

    @SuppressWarnings("deprecation")
    private static void showOn(Context ctx, JSONObject st) {
        try {
            JSONObject cfg = AlarmScheduler.config(ctx);
            long end = st.optLong("end");
            Notification.Builder b = AlarmScheduler.builder(ctx, channel(ctx, cfg))
                    .setContentTitle(AlarmScheduler.text(cfg, "mqOn", "Mode Mosquée actif"))
                    .setContentText(AlarmScheduler.text(cfg, "mqUntil", "Sonneries désactivées jusqu’à {t}").replace("{t}", hm(cfg, end)))
                    .setOngoing(true).setAutoCancel(false).setOnlyAlertOnce(true)
                    .setCategory(Notification.CATEGORY_STATUS)
                    .setShowWhen(true).setWhen(Clock.toDevice(ctx, end)).setUsesChronometer(true)
                    .addAction(new Notification.Action.Builder(null, AlarmScheduler.text(cfg, "mqStopNow", "Réactiver maintenant"),
                            pi(ctx, A_STOP, RQ_STOP)).build());
            if (Build.VERSION.SDK_INT >= 24) b.setChronometerCountDown(true);
            if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_LOW);
            ((NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE)).notify(NOTIF_ON, b.build());
        } catch (Exception ignored) {}
    }

    @SuppressWarnings("deprecation")
    static void showIqama(Context ctx) {
        try {
            JSONObject st = state(ctx);
            if (st == null) return;
            JSONObject cfg = AlarmScheduler.config(ctx);
            String name = AlarmScheduler.prayerName(cfg, st.optString("key"), st.optLong("T"));
            Notification.Builder b = AlarmScheduler.builder(ctx, channel(ctx, cfg))
                    .setContentTitle(AlarmScheduler.text(cfg, "mqIqama", "Iqama") + " — " + name)
                    .setContentText(AlarmScheduler.text(cfg, "mqIqamaBody", "La prière commence"))
                    .setCategory(Notification.CATEGORY_REMINDER);
            if (Build.VERSION.SDK_INT >= 26) b.setTimeoutAfter(MosqueMath.PRAYER_SPAN);
            ((NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE)).notify(NOTIF_IQAMA, b.build());
        } catch (Exception ignored) {}
    }

    @SuppressWarnings("deprecation")
    private static void showEnd(Context ctx, boolean restored) {
        try {
            JSONObject cfg = AlarmScheduler.config(ctx);
            Notification.Builder b = AlarmScheduler.builder(ctx, channel(ctx, cfg))
                    .setContentTitle(AlarmScheduler.text(cfg, "mqEnd", "Fin de la période de silence"))
                    .setContentText(restored ? AlarmScheduler.text(cfg, "mqEndBody", "Les sonneries du téléphone sont réactivées.")
                                             : AlarmScheduler.text(cfg, "mqEndKept", "Mode Mosquée terminé."));
            if (Build.VERSION.SDK_INT >= 26) b.setTimeoutAfter(30 * MosqueMath.MIN);
            ((NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE)).notify(NOTIF_END, b.build());
        } catch (Exception ignored) {}
    }
}
