package io.github.webnour2026.salat;

import org.json.JSONObject;

import java.util.Calendar;
import java.util.TimeZone;

/** Nom d'une prière dans les notifications : le vendredi, le Dhuhr devient la Joumou'a (nom fourni par le site : names.Jumuah). */
final class PrayerNames {
    private PrayerNames() {}

    static String of(JSONObject cfg, String key, long when) {
        JSONObject n = cfg == null ? null : cfg.optJSONObject("names");
        String base = n == null ? key : n.optString(key, key);
        if (n == null || !"Dhuhr".equals(key)) return base;
        String jumua = n.optString("Jumuah", "");
        if (jumua.length() == 0) return base;
        return isFriday(cfg.optString("tz", TimeZone.getDefault().getID()), when) ? jumua : base;
    }

    /** Vendredi dans le fuseau du lieu (pas celui du téléphone). */
    static boolean isFriday(String tz, long when) {
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone(tz));
        c.setTimeInMillis(when);
        return c.get(Calendar.DAY_OF_WEEK) == Calendar.FRIDAY;
    }
}
