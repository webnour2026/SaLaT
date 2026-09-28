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
        try {
            JSONObject cfg = AlarmScheduler.config(ctx);
            String key = intent.getStringExtra(AlarmScheduler.EXTRA_KEY);
            String type = intent.getStringExtra(AlarmScheduler.EXTRA_TYPE);
            long when = intent.getLongExtra(AlarmScheduler.EXTRA_TIME, 0);
            long now = System.currentTimeMillis();
            // alarme très en retard (téléphone éteint, etc.) : on ne joue pas un Adhan périmé
            if (cfg != null && key != null && !"tick".equals(type) && Math.abs(now - when) < 20 * 60000L) notify(ctx, cfg, key, type);
        } catch (Exception ignored) {
        } finally {
            AlarmScheduler.scheduleNext(ctx);
            Ongoing.update(ctx);
        }
    }

    static void notify(Context ctx, JSONObject cfg, String key, String type) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        String name = AlarmScheduler.prayerName(cfg, key);
        boolean vib = cfg.optBoolean("vib", true);
        boolean silent = cfg.optLong("su", 0) > System.currentTimeMillis();

        if ("before".equals(type)) {
            String ch = AlarmScheduler.channel(ctx, null, vib && !silent, AlarmScheduler.text(cfg, "chBefore", "Rappels"));
            String msg = AlarmScheduler.text(cfg, "before", "dans {n} min").replace("{n}", String.valueOf(cfg.optInt("nb", 0)));
            Notification.Builder b = AlarmScheduler.builder(ctx, ch).setContentTitle(name).setContentText(msg);
            nm.notify(AlarmScheduler.NOTIF_BEFORE, b.build());
            return;
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
                if (AlarmScheduler.rawId(ctx, sound) == 0) sound = null;   // aucun son intégré : notification simple
            }
        }
        if (sound == null && !cfg.optBoolean("na", false) && !silent) return;
        if (!adhan && !cfg.optBoolean("na", false)) return;

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
    }
}
