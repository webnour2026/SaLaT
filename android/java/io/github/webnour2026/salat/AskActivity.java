package io.github.webnour2026.salat;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

/**
 * Bouton de la notification « le mois a-t-il commencé aujourd'hui dans votre pays ? » (hors Maroc) :
 * retire la notification puis ouvre SaLaTi sur …?hjo=<correction>&hjk=<jour>, que la page applique (js/app.js).
 * Activité invisible : elle se ferme aussitôt.
 */
public class AskActivity extends Activity {
    static final String URL = "url", NOTIF = "notif";
    static final int LEVEL = 19;   // version du module (même nombre que native= dans le workflow Android)

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        try {
            Intent in = getIntent();
            int id = in != null ? in.getIntExtra(NOTIF, 0) : 0;
            if (id != 0) ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(id);
            String url = in != null ? in.getStringExtra(URL) : null;
            if (url != null && url.startsWith(Reminders.SITE)) {
                Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(getPackageName())
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try { startActivity(open); }
                catch (Exception e) {                      // au cas où : ouverture simple de l'appli
                    Intent l = getPackageManager().getLaunchIntentForPackage(getPackageName());
                    if (l != null) startActivity(l.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                }
            }
        } catch (Exception ignored) {}
        finish();
    }
}
