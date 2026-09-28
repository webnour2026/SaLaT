package io.github.webnour2026.salat;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import android.os.SystemClock;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Notification permanente : « Marrakech | 17 Rabi' al-Thani 1448 » puis « Asr 15:48   1:55:37 ».
 * Le compte à rebours est tenu par Android (Chronometer) : aucune mise à jour chaque seconde,
 * aucun service en arrière-plan. Elle est rafraîchie à chaque prière par l'alarme déjà programmée.
 */
final class Ongoing {
    private Ongoing() {}

    static final int NOTIF_ID = 1004;
    private static final String CHANNEL = "salati2_ongoing";   // ne commence pas par « salati_ » (migration des canaux)

    static void update(Context ctx) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            JSONObject cfg = AlarmScheduler.config(ctx);
            if (cfg == null || !cfg.optBoolean("on", false)) { nm.cancel(NOTIF_ID); return; }

            long now = System.currentTimeMillis();
            AlarmScheduler.Next next = AlarmScheduler.nextPrayer(cfg, now);
            if (next == null) { nm.cancel(NOTIF_ID); return; }

            if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL,
                        AlarmScheduler.text(cfg, "chOngoing", "Prochaine prière"), NotificationManager.IMPORTANCE_LOW);
                ch.setSound(null, null);
                ch.enableVibration(false);
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }

            String tz = cfg.optString("tz", TimeZone.getDefault().getID());
            SimpleDateFormat hm = new SimpleDateFormat("HH:mm", Locale.US);
            hm.setTimeZone(TimeZone.getTimeZone(tz));
            String prayer = AlarmScheduler.prayerName(cfg, next.key) + "  " + hm.format(new Date(next.time));

            String city = AlarmScheduler.text(cfg, "city", "");
            String hijri = "";
            JSONArray hj = cfg.optJSONArray("hj");
            if (hj != null && next.day >= 0 && next.day < hj.length()) hijri = hj.optString(next.day, "");
            String line1 = city.isEmpty() ? hijri : (hijri.isEmpty() ? city : city + "  |  " + hijri);

            Notification.Builder b = AlarmScheduler.builder(ctx, CHANNEL)
                    .setOngoing(true)
                    .setAutoCancel(false)
                    .setOnlyAlertOnce(true)
                    .setCategory(Notification.CATEGORY_STATUS)
                    .setVisibility(Notification.VISIBILITY_PUBLIC);

            int layout = ctx.getResources().getIdentifier("notif_ongoing", "layout", ctx.getPackageName());
            if (Build.VERSION.SDK_INT >= 24 && layout != 0) {
                RemoteViews rv = new RemoteViews(ctx.getPackageName(), layout);
                rv.setTextViewText(id(ctx, "og_line1"), line1);
                rv.setTextViewText(id(ctx, "og_prayer"), prayer);
                int count = id(ctx, "og_count");
                rv.setChronometer(count, SystemClock.elapsedRealtime() + (next.time - now), null, true);
                rv.setChronometerCountDown(count, true);
                b.setStyle(new Notification.DecoratedCustomViewStyle())
                 .setCustomContentView(rv)
                 .setShowWhen(false);
            } else {
                // anciens Android : texte simple, sans compte à rebours
                b.setContentTitle(prayer).setContentText(line1).setShowWhen(false);
                if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_LOW);
            }
            nm.notify(NOTIF_ID, b.build());
        } catch (Exception ignored) {}
    }

    private static int id(Context ctx, String name) {
        return ctx.getResources().getIdentifier(name, "id", ctx.getPackageName());
    }
}
