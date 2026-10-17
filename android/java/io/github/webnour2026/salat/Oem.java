package io.github.webnour2026.salat;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import java.util.Locale;

/**
 * Marques dont l'économiseur de batterie arrête les applis fermées et annule leurs alarmes
 * (Xiaomi/Redmi/Poco, Oppo, Realme, OnePlus, Vivo/iQOO, Huawei, Honor). Sur ces téléphones seulement :
 * l'Adhan est programmé comme un réveil (setAlarmClock, que ces systèmes respectent) et l'écran
 * « Pour ne jamais manquer l'Adhan » ouvre le bon réglage (démarrage automatique / activité en arrière-plan).
 * Les autres téléphones (Samsung, Pixel…) gardent le fonctionnement habituel.
 */
final class Oem {
    private Oem() {}

    static String brand() {
        String m = (Build.MANUFACTURER + " " + Build.BRAND).toLowerCase(Locale.ROOT);
        if (m.contains("xiaomi") || m.contains("redmi") || m.contains("poco")) return "xiaomi";
        if (m.contains("oppo")) return "oppo";
        if (m.contains("realme")) return "realme";
        if (m.contains("oneplus")) return "oneplus";
        if (m.contains("vivo") || m.contains("iqoo")) return "vivo";
        if (m.contains("huawei")) return "huawei";
        if (m.contains("honor")) return "honor";
        if (m.contains("samsung")) return "samsung";
        return "other";
    }

    /** Marque à l'économiseur de batterie agressif. */
    static boolean strict() {
        String b = brand();
        return !"samsung".equals(b) && !"other".equals(b);
    }

    private static Intent comp(String pkg, String cls) {
        return new Intent().setComponent(new ComponentName(pkg, cls)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    /** Écrans « démarrage automatique » connus, du plus récent au plus ancien. */
    private static Intent[] candidates(String b) {
        switch (b) {
            case "xiaomi": return new Intent[]{
                comp("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
                comp("com.miui.powerkeeper", "com.miui.powerkeeper.ui.HiddenAppsConfigActivity")};
            case "oppo": case "realme": case "oneplus": return new Intent[]{
                comp("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
                comp("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"),
                comp("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"),
                comp("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity")};
            case "vivo": return new Intent[]{
                comp("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
                comp("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"),
                comp("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity")};
            case "huawei": case "honor": return new Intent[]{
                comp("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
                comp("com.hihonor.systemmanager", "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
                comp("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity")};
            default: return new Intent[0];
        }
    }

    /** Ouvre l'écran de démarrage automatique de la marque, sinon la fiche de l'appli dans les paramètres. */
    static void openAutostart(Activity a) {
        for (Intent i : candidates(brand())) {
            try { a.startActivity(i); return; } catch (Exception ignored) { }
        }
        openAppDetails(a);
    }

    /** Liste « Optimisation de la batterie » d'Android (sans demander d'autorisation particulière). */
    static void openBattery(Activity a) {
        try { a.startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
        catch (Exception e) { openAppDetails(a); }
    }

    static void openAppDetails(Activity a) {
        try {
            a.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + a.getPackageName()))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception ignored) { }
    }
}
