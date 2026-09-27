package io.github.webnour2026.salat;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** « Arrêter » ou notification balayée : supprimer la notification coupe l'Adhan. */
public class StopReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.cancel(AlarmScheduler.NOTIF_ADHAN);
    }
}
