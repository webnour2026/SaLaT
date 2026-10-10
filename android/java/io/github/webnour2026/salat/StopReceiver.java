package io.github.webnour2026.salat;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** « Arrêter » ou notification balayée : supprimer la notification coupe l'Adhan (et lance tout de suite le silence du Mode Mosquée). */
public class StopReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.cancel(AlarmScheduler.NOTIF_ADHAN);
        MosqueMode.adhanStopped(ctx.getApplicationContext());   // Mode Mosquée : silence dès l'arrêt de l'Adhan
    }
}
