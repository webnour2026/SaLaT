package io.github.webnour2026.salat;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.widget.Toast;

import org.json.JSONObject;

/**
 * Bouton « Rappel de l'Iqama » de la notification de l'Adhan : programme une notification (avec vibration) à l'heure de
 * l'Iqama de CETTE prière = heure de l'Adhan + délai. Délais : ceux de l'écran de mosquée (cfg.iq, réglés dans l'appli,
 * Joumou'a à part le vendredi), sinon 15 min (Maghrib : 10 min).
 */
public class IqamaReceiver extends BroadcastReceiver {
    static final String A_SET = "io.github.webnour2026.salat.IQ_SET", A_FIRE = "io.github.webnour2026.salat.IQ_FIRE";
    static final String EX_KEY = "k", EX_WHEN = "w";
    static final int NOTIF_IQ = 1008, RQ_SET = 4, RQ_FIRE = 31;

    /** Action à ajouter à la notification de l'Adhan. */
    static Notification.Action action(Context ctx, JSONObject cfg, String key, long when) {
        Intent i = new Intent(ctx, IqamaReceiver.class).setAction(A_SET).putExtra(EX_KEY, key).putExtra(EX_WHEN, when);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, RQ_SET, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Action.Builder(null, AlarmScheduler.text(cfg, "iqBtn", "Rappel de l’Iqama"), pi).build();
    }

    static int minutes(JSONObject cfg, String key, long when) {
        JSONObject iq = cfg == null ? null : cfg.optJSONObject("iq");
        boolean jumua = "Dhuhr".equals(key) && PrayerNames.isFriday(cfg == null ? java.util.TimeZone.getDefault().getID()
                : cfg.optString("tz", java.util.TimeZone.getDefault().getID()), when);
        int def = MosqueMath.iqamaMin(key, false);
        int m = iq == null ? def : iq.optInt(jumua ? "Jumuah" : key, def);
        return Math.max(1, Math.min(90, m));
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        JSONObject cfg = AlarmScheduler.config(ctx);
        String key = intent.getStringExtra(EX_KEY);
        long when = intent.getLongExtra(EX_WHEN, 0);
        if (key == null || when == 0) return;
        if (A_FIRE.equals(intent.getAction())) { fire(ctx, cfg, key, when); return; }
        int min = minutes(cfg, key, when);
        long at = when + min * 60000L, now = Clock.now(ctx), left = at - now;
        if (left < 30000L) { fire(ctx, cfg, key, when); return; }
        long sysAt = System.currentTimeMillis() + left;          // AlarmManager suit l'horloge du téléphone (Clock corrige l'heure réelle)
        Intent f = new Intent(ctx, IqamaReceiver.class).setAction(A_FIRE).putExtra(EX_KEY, key).putExtra(EX_WHEN, when);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, RQ_FIRE, f, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        try {
            if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, sysAt, pi);
            else am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, sysAt, pi);
        } catch (Exception e) { am.set(AlarmManager.RTC_WAKEUP, sysAt, pi); }
        long n = Math.max(1, Math.round(left / 60000.0));
        Toast.makeText(ctx, AlarmScheduler.text(cfg, "iqSet", "⏰ Rappel de l’Iqama dans {n} min").replace("{n}", String.valueOf(n)), Toast.LENGTH_LONG).show();
    }

    private static void fire(Context ctx, JSONObject cfg, String key, long when) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        String name = AlarmScheduler.prayerName(cfg, key, when);
        String ch = AlarmScheduler.channel(ctx, null, true, AlarmScheduler.text(cfg, "chReminder", "Rappels"));
        Notification.Builder b = AlarmScheduler.builder(ctx, ch)
                .setContentTitle(AlarmScheduler.text(cfg, "iqTitle", "🕌 Iqama : {p}").replace("{p}", name))
                .setContentText(AlarmScheduler.text(cfg, "iqBody", "La prière va commencer."))
                .setCategory(Notification.CATEGORY_REMINDER);
        if (Build.VERSION.SDK_INT < 26) { b.setVibrate(new long[]{0, 400, 200, 400, 200, 800}); b.setPriority(Notification.PRIORITY_HIGH); }
        nm.notify(NOTIF_IQ, b.build());
    }
}
