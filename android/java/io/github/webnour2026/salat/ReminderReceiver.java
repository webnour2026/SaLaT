package io.github.webnour2026.salat;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Heure d'un rappel (jours blancs, début de mois, Aïd). Le contrôle du calendrier des Habous demande le réseau :
 * on travaille sur un thread d'arrière-plan (goAsync), puis on programme le rappel suivant.
 */
public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(final Context ctx, Intent intent) {
        final PendingResult result = goAsync();
        final Context app = ctx.getApplicationContext();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    Reminders.run(app);
                } catch (Throwable ignored) {
                } finally {
                    try { Reminders.schedule(app); } catch (Throwable ignored) { }
                    result.finish();
                }
            }
        }).start();
    }
}
