package io.github.webnour2026.salat;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Alarmes du Mode Mosquée : début du silence, Iqama, fin ; et bouton « Réactiver maintenant ». */
public class MosqueReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        Context app = ctx.getApplicationContext();
        String a = intent == null ? null : intent.getAction();
        try {
            if (MosqueMode.A_START.equals(a)) MosqueMode.startSilence(app);
            else if (MosqueMode.A_IQAMA.equals(a)) MosqueMode.showIqama(app);
            else if (MosqueMode.A_END.equals(a)) MosqueMode.finish(app, true);
            else if (MosqueMode.A_STOP.equals(a)) MosqueMode.finish(app, false);
        } catch (Exception ignored) {}
    }
}
