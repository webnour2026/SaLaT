package io.github.webnour2026.salat;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Redémarrage, mise à jour de l'appli, changement d'heure ou de fuseau, changement d'autorisation : on reprogramme tout de suite
 * avec l'écart connu, puis on remesure l'heure réelle (le réseau mobile peut avoir remis l'horloge à une heure fausse) et on reprogramme si besoin.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        final Context app = ctx.getApplicationContext();
        AlarmScheduler.scheduleNext(app);
        Reminders.schedule(app);
        Ongoing.update(app);
        final PendingResult result = goAsync();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (Clock.refresh(app, 0) == Clock.REFRESH_CHANGED) {      // pas de réseau au démarrage : le contrôle avant la prochaine prière réessaiera
                        AlarmScheduler.scheduleNext(app);
                        Reminders.schedule(app);
                        Ongoing.update(app);
                    }
                } catch (Throwable ignored) {
                } finally {
                    result.finish();
                }
            }
        }).start();
    }
}
