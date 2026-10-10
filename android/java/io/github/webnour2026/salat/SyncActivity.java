package io.github.webnour2026.salat;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.Toast;

import org.json.JSONObject;

/**
 * Reçoit la configuration de l'application web : salati://sync?d=<json>&ask=1&quiet=1
 * (horaires officiels des 30 jours + réglages Adhan), l'enregistre et programme l'alarme.
 * Activité invisible : elle se ferme aussitôt et on revient dans SaLaTi.
 */
public class SyncActivity extends Activity {
    private boolean ask, quiet, test, mosque;
    private JSONObject cfg;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        try {
            Uri data = getIntent() != null ? getIntent().getData() : null;
            String d = data != null ? data.getQueryParameter("d") : null;
            ask = data != null && "1".equals(data.getQueryParameter("ask"));
            quiet = data != null && "1".equals(data.getQueryParameter("quiet"));
            test = data != null && "1".equals(data.getQueryParameter("test"));
            mosque = data != null && "1".equals(data.getQueryParameter("mq"));   // activation du Mode Mosquée : accès « Ne pas déranger »
            if (d != null && d.length() < 60000) {
                cfg = new JSONObject(d);
                AlarmScheduler.save(this, cfg);
                AutoMonth.learnConfig(this, cfg);   // dernier début de mois officiel connu de la page
                AlarmScheduler.scheduleNext(this);
                Reminders.schedule(this);
                MosqueMode.onConfig(this);       // Mode Mosquée désactivé / durée changée pendant un cycle
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
        finish();
        overridePendingTransition(0, 0);
    }
}
