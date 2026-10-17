package io.github.webnour2026.salat;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.net.Uri;
import android.os.Bundle;

import org.json.JSONObject;

/**
 * « Pour ne jamais manquer l'Adhan » : explique, selon la marque du téléphone, le réglage à faire
 * (démarrage automatique, activité en arrière-plan, batterie) et ouvre l'écran correspondant.
 * Ouverte depuis les réglages de l'appli (salati://battery?l=fr), après l'activation de l'Adhan
 * sur les marques concernées, ou quand un Adhan n'a pas sonné (extra « missed »).
 */
public class BatteryActivity extends Activity {
    static final String MISSED = "missed";

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Uri data = getIntent() != null ? getIntent().getData() : null;
        String l = data != null ? data.getQueryParameter("l") : null;
        if (l == null) { JSONObject cfg = AlarmScheduler.config(this); l = cfg != null ? cfg.optString("lang", "fr") : "fr"; }
        boolean missed = getIntent() != null && getIntent().getBooleanExtra(MISSED, false);
        int L = "ar".equals(l) ? 1 : "en".equals(l) ? 2 : 0;
        String b = Oem.brand();
        final boolean strict = Oem.strict();

        String[] title = {"Pour ne jamais manquer l’Adhan", "حتى لا يفوتك الأذان", "Never miss the Adhan"};
        String[] miss = {"Un Adhan n’a pas sonné à l’heure : le téléphone a arrêté SaLaTi pour économiser la batterie.\n\n",
                "لم يُرفع أحد الأذانات في وقته: أوقف الهاتف تطبيق صلاتي لتوفير البطارية.\n\n",
                "An Adhan did not sound on time: the phone stopped SaLaTi to save battery.\n\n"};
        String steps;
        switch (b) {
            case "xiaomi": steps = new String[]{
                    "Sur Xiaomi / Redmi / Poco :\n1. « Démarrage auto » : activez SaLaTi.\n2. Batterie → « Économiseur de batterie » de SaLaTi : « Aucune restriction ».",
                    "على شاومي / ريدمي / بوكو:\n1. «التشغيل التلقائي»: فعّل صلاتي.\n2. البطارية ← «موفر البطارية» لتطبيق صلاتي: «بدون قيود».",
                    "On Xiaomi / Redmi / Poco:\n1. “Autostart”: turn SaLaTi on.\n2. Battery → SaLaTi’s “Battery saver”: “No restrictions”."}[L]; break;
            case "oppo": case "realme": case "oneplus": steps = new String[]{
                    "Sur Oppo / Realme / OnePlus :\n1. « Démarrage automatique » : activez SaLaTi.\n2. Batterie de SaLaTi : « Autoriser l’activité en arrière-plan ».",
                    "على أوبو / ريلمي / ون بلس:\n1. «التشغيل التلقائي»: فعّل صلاتي.\n2. بطارية صلاتي: «السماح بالنشاط في الخلفية».",
                    "On Oppo / Realme / OnePlus:\n1. “Auto launch”: turn SaLaTi on.\n2. SaLaTi’s battery: “Allow background activity”."}[L]; break;
            case "vivo": steps = new String[]{
                    "Sur Vivo / iQOO :\n1. « Démarrage automatique » : activez SaLaTi.\n2. Batterie → « Consommation élevée en arrière-plan » : autorisez SaLaTi.",
                    "على فيفو / iQOO:\n1. «التشغيل التلقائي»: فعّل صلاتي.\n2. البطارية ← «استهلاك عالٍ في الخلفية»: اسمح لصلاتي.",
                    "On Vivo / iQOO:\n1. “Autostart”: turn SaLaTi on.\n2. Battery → “High background power usage”: allow SaLaTi."}[L]; break;
            case "huawei": case "honor": steps = new String[]{
                    "Sur Huawei / Honor :\n« Lancement d’applications » → SaLaTi → « Gérer manuellement », puis activez les 3 options (lancement auto, lancement secondaire, exécution en arrière-plan).",
                    "على هواوي / هونر:\n«تشغيل التطبيقات» ← صلاتي ← «الإدارة يدوياً»، ثم فعّل الخيارات الثلاثة (التشغيل التلقائي، التشغيل الثانوي، التشغيل في الخلفية).",
                    "On Huawei / Honor:\n“App launch” → SaLaTi → “Manage manually”, then turn on all 3 options (auto-launch, secondary launch, run in background)."}[L]; break;
            case "samsung": steps = new String[]{
                    "Sur Samsung :\nParamètres → Applications → SaLaTi → Batterie : « Non restreinte ».",
                    "على سامسونج:\nالإعدادات ← التطبيقات ← صلاتي ← البطارية: «غير مقيّد».",
                    "On Samsung:\nSettings → Apps → SaLaTi → Battery: “Unrestricted”."}[L]; break;
            default: steps = new String[]{
                    "Dans les paramètres de SaLaTi → Batterie : choisissez « Non restreinte » (ou « Ne pas optimiser »).",
                    "في إعدادات صلاتي ← البطارية: اختر «غير مقيّد» (أو «عدم التحسين»).",
                    "In SaLaTi’s settings → Battery: choose “Unrestricted” (or “Don’t optimize”)."}[L];
        }
        String[] open = {"Ouvrir le réglage", "فتح الإعداد", "Open setting"};
        String[] batt = {"Batterie", "البطارية", "Battery"};
        String[] close = {"Fermer", "إغلاق", "Close"};

        final Activity me = this;
        AlertDialog.Builder d = new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Light_Dialog_Alert)
                .setTitle(title[L])
                .setMessage((missed ? miss[L] : "") + steps)
                .setPositiveButton(open[L], new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface x, int w) { if (strict) Oem.openAutostart(me); else Oem.openAppDetails(me); finish(); }
                })
                .setNegativeButton(close[L], new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface x, int w) { finish(); }
                })
                .setOnCancelListener(new DialogInterface.OnCancelListener() {
                    @Override public void onCancel(DialogInterface x) { finish(); }
                });
        if (strict) d.setNeutralButton(batt[L], new DialogInterface.OnClickListener() {
            @Override public void onClick(DialogInterface x, int w) { Oem.openBattery(me); finish(); }
        });
        d.show();
    }
}
