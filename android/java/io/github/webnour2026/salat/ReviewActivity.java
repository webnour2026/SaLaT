package io.github.webnour2026.salat;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Bundle;

import com.google.android.gms.tasks.OnCompleteListener;
import com.google.android.gms.tasks.Task;
import com.google.android.play.core.review.ReviewInfo;
import com.google.android.play.core.review.ReviewManager;
import com.google.android.play.core.review.ReviewManagerFactory;

/**
 * Avis Google Play dans l'appli (In-App Review API) : la petite fenêtre « Noter SaLaTi » de Google Play, sans quitter l'appli.
 * Proposée UNE seule fois, par SyncActivity, quand l'appli est installée depuis au moins 7 jours et que l'Adhan a déjà
 * sonné au moins 10 fois, dont un dans les 6 dernières heures (l'utilisateur vient de le recevoir). Pas de question avant :
 * Google décide lui-même s'il affiche la fenêtre (quota), et rien ne change si elle n'apparaît pas.
 */
public class ReviewActivity extends Activity {
    static final long DAY = 86400000L;

    /** Le moment est-il venu de proposer l'avis ? */
    static boolean due(Context ctx) {
        try {
            SharedPreferences p = ctx.getSharedPreferences(AlarmScheduler.PREFS, MODE_PRIVATE);
            if (p.getLong("revAt", 0) > 0) return false;
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            long now = System.currentTimeMillis();
            return now - pi.firstInstallTime >= 7 * DAY && p.getInt("firedN", 0) >= 10 && now - p.getLong("firedAt", 0) < 6 * 3600000L;
        } catch (Exception e) { return false; }
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getSharedPreferences(AlarmScheduler.PREFS, MODE_PRIVATE).edit().putLong("revAt", System.currentTimeMillis()).apply();
        try {
            final ReviewManager m = ReviewManagerFactory.create(this);
            m.requestReviewFlow().addOnCompleteListener(new OnCompleteListener<ReviewInfo>() {
                @Override public void onComplete(Task<ReviewInfo> t) {
                    if (!t.isSuccessful() || isFinishing()) { done(); return; }
                    m.launchReviewFlow(ReviewActivity.this, t.getResult()).addOnCompleteListener(new OnCompleteListener<Void>() {
                        @Override public void onComplete(Task<Void> x) { done(); }
                    });
                }
            });
        } catch (Exception e) { done(); }
    }

    private void done() { finish(); overridePendingTransition(0, 0); }
}
