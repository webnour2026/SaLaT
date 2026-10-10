package io.github.webnour2026.salat;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONObject;

/** Heure de prière (ou rappel avant) : affiche la notification avec l'Adhan, puis programme la suite. */
public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        final Context app = ctx.getApplicationContext();
        String type0 = intent.getStringExtra(AlarmScheduler.EXTRA_TYPE);
        if ("clock".equals(type0)) {          // contrôle d'horloge peu avant la prière : on remesure l'heure réelle, puis on reprogramme
            checkClock(app, 0);
            return;
        }
        try {
            JSONObject cfg = AlarmScheduler.config(ctx);
            String key = intent.getStringExtra(AlarmScheduler.EXTRA_KEY);
            String type = intent.getStringExtra(AlarmScheduler.EXTRA_TYPE);
            long when = intent.getLongExtra(AlarmScheduler.EXTRA_TIME, 0);
            long now = Clock.now(ctx);
            // alarme très en retard (téléphone éteint, etc.) : on ne joue pas un Adhan périmé
            if (cfg != null && key != null && !"tick".equals(type) && Math.abs(now - when) < 20 * 60000L) {
                String sound = notify(ctx, cfg, key, type, when);
                if ("at".equals(type)) MosqueMode.onPrayer(ctx.getApplicationContext(), cfg, key, when, sound);   // après l'Adhan : sonneries coupées
            }
        } catch (Exception ignored) {
        } finally {
            AlarmScheduler.scheduleNext(ctx);
            Ongoing.update(ctx);
        }
        checkClock(app, 2 * 3600000L);        // après chaque alarme : écart remesuré s'il date de plus de 2 h
    }

    /** Remesure l'écart en arrière-plan (réseau) ; s'il a changé, les alarmes sont reprogrammées. */
    private void checkClock(final Context app, final long minAgeMs) {
        final PendingResult result = goAsync();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    int r = Clock.refresh(app, minAgeMs);
                    if (r == Clock.REFRESH_CHANGED) {
                        AlarmScheduler.scheduleNext(app);
                        Reminders.schedule(app);
                        Ongoing.update(app);
                    } else if (minAgeMs == 0) {
                        AlarmScheduler.scheduleNext(app);          // rien à corriger : on réarme le prochain contrôle d'horloge
                    }
                } catch (Throwable ignored) {
                } finally {
                    result.finish();
                }
            }
        }).start();
    }

    static String notify(Context ctx, JSONObject cfg, String key, String type) {
        return notify(ctx, cfg, key, type, Clock.now(ctx));
    }

    /** Affiche la notification ; renvoie l'Adhan joué (nom res/raw) ou null s'il n'y a pas de son. */
    static String notify(Context ctx, JSONObject cfg, String key, String type, long when) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        String name = AlarmScheduler.prayerName(cfg, key, when);
        boolean vib = cfg.optBoolean("vib", true);
        boolean silent = cfg.optLong("su", 0) > Clock.now(ctx);

        if ("before".equals(type)) {
            String ch = AlarmScheduler.channel(ctx, null, vib && !silent, AlarmScheduler.text(cfg, "chBefore", "Rappels"));
            String msg = AlarmScheduler.text(cfg, "before", "dans {n} min").replace("{n}", String.valueOf(cfg.optInt("nb", 0)));
            Notification.Builder b = AlarmScheduler.builder(ctx, ch).setContentTitle(name).setContentText(msg);
            nm.notify(AlarmScheduler.NOTIF_BEFORE, b.build());
            return null;
        }

        boolean adhan = cfg.optBoolean("en", true) && !silent;
        String sound = null;
        if (adhan) {
            JSONObject ad = cfg.optJSONObject("ad");
            sound = ad == null ? AlarmScheduler.DEFAULT_ADHAN : ad.optString(key, AlarmScheduler.DEFAULT_ADHAN);
            if ("none".equals(sound)) {
                sound = null;                                           // « Aucun » choisi pour cette prière
            } else {
                if (ctx.getResources().getIdentifier(sound, "raw", ctx.getPackageName()) == 0) {
                    sound = sound.endsWith("_court") ? AlarmScheduler.DEFAULT_ADHAN + "_court" : AlarmScheduler.DEFAULT_ADHAN;
                }
                if (ctx.getResources().getIdentifier(sound, "raw", ctx.getPackageName()) == 0) sound = AlarmScheduler.DEFAULT_ADHAN;
                if (ctx.getResources().getIdentifier(sound, "raw", ctx.getPackageName()) == 0) sound = AlarmScheduler.SECOND_ADHAN;   // son par défaut absent : Aaqib
                if (AlarmScheduler.rawId(ctx, sound) == 0) sound = null;   // aucun son intégré : notification simple
            }
        }
        if (sound == null && !cfg.optBoolean("na", false) && !silent) return null;
        if (!adhan && !cfg.optBoolean("na", false)) return null;

        String label = sound != null ? AlarmScheduler.text(cfg, "chAdhan", "Adhan") : AlarmScheduler.text(cfg, "chSilent", "Heure de la prière");
        String ch = AlarmScheduler.channel(ctx, sound, vib && !silent, label);
        String title = AlarmScheduler.text(cfg, "itsTime", "C’est l’heure de") + " " + name;

        Intent stop = new Intent(ctx, StopReceiver.class).setAction("io.github.webnour2026.salat.STOP");
        PendingIntent stopPi = PendingIntent.getBroadcast(ctx, 3, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder b = AlarmScheduler.builder(ctx, ch)
                .setContentTitle(title)
                .setContentText(AlarmScheduler.text(cfg, "city", ""))
                .setCategory(Notification.CATEGORY_ALARM)
                .setDeleteIntent(stopPi);
        if (sound != null) {
            b.addAction(new Notification.Action.Builder(null, AlarmScheduler.text(cfg, "stop", "Arrêter"), stopPi).build());
        }
        if (Build.VERSION.SDK_INT < 26) {
            // avant Android 8 : son et vibration portés par la notification elle-même
            if (sound != null) b.setSound(AlarmScheduler.soundUri(ctx, sound));
            if (vib && !silent) b.setVibrate(new long[]{0, 400, 200, 400, 200, 800});
            b.setPriority(Notification.PRIORITY_HIGH);
        }
        Notification n = b.build();
        nm.notify(AlarmScheduler.NOTIF_ADHAN, n);
        return sound;
    }
}
