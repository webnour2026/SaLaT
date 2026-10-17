package io.github.webnour2026.salat;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.provider.Settings;
import android.widget.Toast;

import org.json.JSONObject;

/**
 * Reçoit la configuration de l'application web : salati://sync?d=<json>&ask=1&quiet=1
 * (horaires officiels des 30 jours + réglages Adhan), l'enregistre et programme l'alarme.
 * Activité invisible : elle se ferme aussitôt et on revient dans SaLaTi.
 */
public class SyncActivity extends Activity {
    private boolean ask, quiet, test, mosque, missed;
    private JSONObject cfg;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        missed = missedAdhan(this);          // avant de reprogrammer : l'Adhan attendu a-t-il sonné ?
        try {
            Uri data = getIntent() != null ? getIntent().getData() : null;
            String d = data != null ? data.getQueryParameter("d") : null;
            ask = data != null && "1".equals(data.getQueryParameter("ask"));
            quiet = data != null && "1".equals(data.getQueryParameter("quiet"));
            test = data != null && "1".equals(data.getQueryParameter("test"));
            mosque = data != null && "1".equals(data.getQueryParameter("mq"));   // activation du Mode Mosquée : accès « Ne pas déranger »
            if (d != null && d.length() < 60000) {
                cfg = new JSONObject(d);
                MosqueTile.keepTile(this, cfg);      // module ≥ 22 : choix fait avec la tuile après celui de l'appli
                AlarmScheduler.save(this, cfg);
                AutoMonth.learnConfig(this, cfg);   // dernier début de mois officiel connu de la page
                AlarmScheduler.scheduleNext(this);
                Reminders.schedule(this);
                MosqueMode.onConfig(this);       // Mode Mosquée désactivé / durée changée pendant un cycle
                MosqueTile.update(this);
            }
        } catch (Exception e) {
            cfg = null;
        }
        // Android 13+ : autorisation des notifications
        if (ask && Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7);
            return;   // suite dans onRequestPermissionsResult
        }
        finishSync();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        finishSync();
    }

    private void finishSync() {
        Ongoing.update(this);
        // « Tester la notification » : vraie notification native, avec l'Adhan choisi pour Asr
        if (test && cfg != null) {
            try { AlarmReceiver.notify(this, cfg, "Asr", "at"); } catch (Exception ignored) {}
        }
        if (cfg != null && !quiet) {
            Toast.makeText(this, AlarmScheduler.text(cfg, "ok", "Adhan en arrière-plan activé ✓"), Toast.LENGTH_LONG).show();
        }
        // Android 12+ : autorisation « Alarmes et rappels » pour l'heure exacte
        if (ask && Build.VERSION.SDK_INT >= 31) {
            AlarmManager am = (AlarmManager) getSystemService(ALARM_SERVICE);
            if (!am.canScheduleExactAlarms()) {
                try {
                    startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getPackageName())));
                } catch (Exception ignored) {}
            }
        }
        // Mode Mosquée : couper la sonnerie (et pas seulement passer en vibreur) demande l'accès « Ne pas déranger »
        if (mosque && Build.VERSION.SDK_INT >= 23) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (!nm.isNotificationPolicyAccessGranted()) {
                try {
                    if (cfg != null) Toast.makeText(this, AlarmScheduler.text(cfg, "mqDnd", "Autorisez SaLaTi à couper la sonnerie"), Toast.LENGTH_LONG).show();
                    startActivity(new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS));
                } catch (Exception ignored) {}
            }
        }
        // « Pour ne jamais manquer l'Adhan » : après l'activation sur les marques concernées (une fois, quand l'heure exacte
        // est autorisée), ou si un Adhan n'a pas sonné (au plus tous les 3 jours, toutes marques)
        try {
            SharedPreferences p = getSharedPreferences(AlarmScheduler.PREFS, MODE_PRIVATE);
            boolean exactOk = Build.VERSION.SDK_INT < 31 || ((AlarmManager) getSystemService(ALARM_SERVICE)).canScheduleExactAlarms();
            long now = System.currentTimeMillis();
            boolean first = Oem.strict() && ((ask && !p.getBoolean("batShown", false)) || p.getBoolean("batPending", false));
            boolean late = missed && now - p.getLong("batMissedAt", 0) > 3 * 86400000L;
            if ((first || late) && exactOk && !mosque) {
                p.edit().putBoolean("batShown", true).putBoolean("batPending", false).putLong("batMissedAt", late ? now : p.getLong("batMissedAt", 0)).apply();
                startActivity(new Intent(this, BatteryActivity.class).putExtra(BatteryActivity.MISSED, late));
            } else if (first) p.edit().putBoolean("batPending", true).apply();   // d'abord l'autorisation « Alarmes et rappels »
            // avis Google Play (une seule fois) : synchronisation ordinaire, rien d'autre affiché, une semaine d'usage et l'Adhan reçu
            else if (!ask && !test && !mosque && !late && ReviewActivity.due(this))
                startActivity(new Intent(this, ReviewActivity.class));
        } catch (Exception ignored) {}
        finish();
        overridePendingTransition(0, 0);
    }

    /** L'Adhan programmé est passé depuis plus de 3 min sans avoir été déclenché, alors que le téléphone était allumé. */
    static boolean missedAdhan(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(AlarmScheduler.PREFS, MODE_PRIVATE);
        long exp = p.getLong("expAt", 0), fired = p.getLong("firedAt", 0), now = Clock.now(ctx);
        long boot = System.currentTimeMillis() - SystemClock.elapsedRealtime();
        return exp > 0 && now > exp + 3 * 60000L && now - exp < 2 * 86400000L && fired < exp - 60000L && boot < exp - 60000L;
    }
}
