package io.github.webnour2026.salat;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Redémarrage, mise à jour de l'appli, changement d'heure ou d'autorisation : on reprogramme. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        AlarmScheduler.scheduleNext(ctx);
        Reminders.schedule(ctx);
        Ongoing.update(ctx);
    }
}
