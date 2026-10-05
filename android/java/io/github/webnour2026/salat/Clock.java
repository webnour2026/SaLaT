package io.github.webnour2026.salat;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.provider.Settings;

/** Heure réelle pour le module : horloge du téléphone + écart mesuré par la page (voir ClockMath). */
final class Clock {
    private Clock() {}

    private static SharedPreferences prefs(Context ctx) { return ctx.getSharedPreferences(AlarmScheduler.PREFS, Context.MODE_PRIVATE); }

    private static int bootCount(Context ctx) {
        try { return Settings.Global.getInt(ctx.getContentResolver(), Settings.Global.BOOT_COUNT, -1); } catch (Exception e) { return -1; }
    }

    /** Appelé à chaque synchronisation avec la page : on retient l'écart et la référence de l'horloge à cet instant. */
    static void store(Context ctx, long offsetMs) {
        prefs(ctx).edit()
                .putLong("clkOff", offsetMs)
                .putLong("clkRef", System.currentTimeMillis() - SystemClock.elapsedRealtime())
                .putInt("clkBoot", bootCount(ctx))
                .apply();
    }

    static long offset(Context ctx) {
        SharedPreferences sp = prefs(ctx);
        long off = sp.getLong("clkOff", 0);
        long ref = sp.contains("clkRef") ? sp.getLong("clkRef", ClockMath.NO_REF) : ClockMath.NO_REF;
        boolean same = sp.getInt("clkBoot", -2) == bootCount(ctx);
        return ClockMath.adjust(off, ref, System.currentTimeMillis(), SystemClock.elapsedRealtime(), same);
    }

    static final int REFRESH_FAILED = -1, REFRESH_SAME = 0, REFRESH_CHANGED = 1;

    /** L'écart a-t-il été mesuré avec succès depuis le dernier démarrage du téléphone ? */
    static boolean measuredThisBoot(Context ctx) { return prefs(ctx).getInt("clkMeasBoot", -2) == bootCount(ctx); }

    /**
     * Mesure l'écart auprès du serveur et le retient. Renvoie REFRESH_CHANGED s'il a changé (alarmes à reprogrammer),
     * REFRESH_FAILED si la mesure est impossible (hors ligne). Bloquant (réseau) : à appeler depuis un thread d'arrière-plan.
     * `minAgeMs` : on ne remesure pas plus souvent (0 = toujours).
     */
    static int refresh(Context ctx, long minAgeMs) {
        SharedPreferences sp = prefs(ctx);
        boolean sameBoot = measuredThisBoot(ctx);
        long age = SystemClock.elapsedRealtime() - sp.getLong("clkMeasEl", Long.MIN_VALUE / 2);
        if (minAgeMs > 0 && sameBoot && age >= 0 && age < minAgeMs) return REFRESH_SAME;
        org.json.JSONObject cfg = AlarmScheduler.config(ctx);
        Long m = ClockSync.measure(cfg == null ? null : cfg.optString("base", ""));
        if (m == null) return REFRESH_FAILED;                            // hors ligne : on garde l'écart connu
        long before = offset(ctx);
        store(ctx, m);
        sp.edit().putLong("clkMeasEl", SystemClock.elapsedRealtime()).putInt("clkMeasBoot", bootCount(ctx)).apply();
        return ClockMath.changed(before, m) ? REFRESH_CHANGED : REFRESH_SAME;
    }

    /** Heure réelle (ms). */
    static long now(Context ctx) { return ClockMath.real(System.currentTimeMillis(), offset(ctx)); }

    /** Instant, sur l'horloge du téléphone, où une alarme prévue à l'heure réelle `realMs` doit sonner. */
    static long toDevice(Context ctx, long realMs) { return ClockMath.device(realMs, offset(ctx)); }
}
