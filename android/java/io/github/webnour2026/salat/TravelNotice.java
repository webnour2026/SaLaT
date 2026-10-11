package io.github.webnour2026.salat;

import android.app.NotificationManager;
import android.content.Context;

import org.json.JSONObject;

import java.util.TimeZone;

/**
 * Voyage : le téléphone change de fuseau horaire alors que les horaires synchronisés sont ceux d'une ville d'un autre fuseau.
 * Le module ne lit pas la position (pas d'autorisation de localisation en arrière-plan) : il invite à ouvrir l'appli,
 * qui relit le GPS, trouve la nouvelle ville et resynchronise tout.
 */
final class TravelNotice {
    private TravelNotice() {}

    static final int NOTIF_ID = 1008;

    static void check(Context ctx) {
        try {
            JSONObject cfg = AlarmScheduler.config(ctx);
            if (cfg == null) return;
            String cfgTz = cfg.optString("tz", "");
            TimeZone dev = TimeZone.getDefault();
            long now = System.currentTimeMillis();
            // même décalage qu'au lieu enregistré (ex. retour au pays) : rien à signaler
            if (cfgTz.isEmpty() || TimeZone.getTimeZone(cfgTz).getOffset(now) == dev.getOffset(now)) {
                ((NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(NOTIF_ID);
                return;
            }
            String ch = AlarmScheduler.channel(ctx, null, false, AlarmScheduler.text(cfg, "chReminder", "Rappels"));
            android.app.Notification n = AlarmScheduler.builder(ctx, ch)
                    .setContentTitle(AlarmScheduler.text(cfg, "tzTitle", "\uD83C\uDF0D Nouveau fuseau horaire"))
                    .setContentText(AlarmScheduler.text(cfg, "tzBody", "Ouvrez SaLaTi pour mettre \u00e0 jour les horaires de votre nouvelle ville."))
                    .setStyle(new android.app.Notification.BigTextStyle().bigText(AlarmScheduler.text(cfg, "tzBody", "Ouvrez SaLaTi pour mettre \u00e0 jour les horaires de votre nouvelle ville.")))
                    .build();
            ((NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE)).notify(NOTIF_ID, n);
        } catch (Exception ignored) {}
    }
}
