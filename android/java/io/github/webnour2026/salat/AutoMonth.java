package io.github.webnour2026.salat;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Rappels du croissant préparés par le module lui-même, mois après mois, même si l'appli n'est plus ouverte.
 *
 * L'appli web envoie :
 *   cfg.hb  = { y, m, d } : dernier début de mois officiel connu (d = jour d'époque) — seulement au Maroc ;
 *   cfg.amt = { "1": { s:[titre, texte], o:[…], n:[…] }, … } : textes par mois (s = vu, o = observation, n = non vu ; « {y} » = année).
 * Le module retient le dernier début connu (préférences) et l'avance à chaque lecture du calendrier des Habous.
 * Les rappels portent les mêmes identifiants que ceux de la page : jamais de doublon.
 */
final class AutoMonth {
    private AutoMonth() {}

    private static final String K_DAY = "amDay", K_Y = "amY", K_M = "amM", K_EST = "amEst";

    private static SharedPreferences prefs(Context ctx) { return ctx.getSharedPreferences(AlarmScheduler.PREFS, Context.MODE_PRIVATE); }

    /** Retient le dernier début de mois (s'il est plus récent, ou s'il corrige une estimation). */
    static void learn(Context ctx, int y, int m, long day, boolean estimated) {
        SharedPreferences p = prefs(ctx);
        long stored = p.getLong(K_DAY, -1);
        boolean est = p.getBoolean(K_EST, false);
        if (!estimated && !AutoMonthMath.accept(stored, est, day)) return;
        if (estimated && day <= stored) return;
        p.edit().putLong(K_DAY, day).putInt(K_Y, y).putInt(K_M, m).putBoolean(K_EST, estimated).commit();
    }

    /** Configuration reçue de la page : son dernier début officiel. */
    static void learnConfig(Context ctx, JSONObject cfg) {
        JSONObject hb = cfg == null ? null : cfg.optJSONObject("hb");
        if (hb != null && hb.optLong("d", -1) > 0) learn(ctx, hb.optInt("y"), hb.optInt("m"), hb.optLong("d"), false);
    }

    /** Contenu de data/habous.json : le début le plus récent. */
    static void learnJson(Context ctx, String json) {
        try {
            JSONArray months = new JSONObject(json).getJSONArray("months");
            long best = -1; int y = 0, m = 0;
            for (int i = 0; i < months.length(); i++) {
                JSONObject o = months.getJSONObject(i);
                long d = AutoMonthMath.dayOf(o.optString("start", ""));
                if (d > best) { best = d; y = o.optInt("y"); m = o.optInt("m"); }
            }
            if (best > 0 && m >= 1 && m <= 12) learn(ctx, y, m, best, false);
        } catch (Exception ignored) {}
    }

    /** Ramadan à l'instant t ? (dernier début connu = Ramadan) — secours au-delà des 31 jours envoyés par la page. */
    static boolean isRamadan(Context ctx, long t) {
        SharedPreferences p = prefs(ctx);
        long last = p.getLong(K_DAY, -1), day = Math.floorDiv(t, AutoMonthMath.DAY);
        return last > 0 && p.getInt(K_M, 0) == 9 && day >= last && day < last + 30;
    }

    /** Relecture de secours sans réseau : on suppose un mois de 30 jours. */
    static void estimate(Context ctx) {
        SharedPreferences p = prefs(ctx);
        long last = p.getLong(K_DAY, -1);
        if (last <= 0) return;
        int m = p.getInt(K_M, 1), y = p.getInt(K_Y, 1448);
        learn(ctx, AutoMonthMath.nextYear(m, y), AutoMonthMath.nextMonth(m), last + 30, true);
    }

    private static JSONObject entry(String id, String kind, long at, long until, String watch, JSONArray txt, int year) throws Exception {
        JSONObject e = new JSONObject();
        e.put("id", id); e.put("kind", kind); e.put("at", at); e.put("until", until);
        if (watch != null) e.put("watch", watch);
        e.put("title", txt.optString(0, "").replace("{y}", String.valueOf(year)));
        e.put("body", txt.optString(1, "").replace("{y}", String.valueOf(year)));
        return e;
    }

    /** Rappels du mois suivant le dernier début connu (au Maroc seulement : cfg.hb présent). */
    static JSONArray entries(Context ctx, JSONObject cfg) {
        JSONArray out = new JSONArray();
        try {
            JSONObject amt = cfg == null ? null : cfg.optJSONObject("amt");
            if (amt == null || cfg.optJSONObject("hb") == null) return out;
            SharedPreferences p = prefs(ctx);
            long last = p.getLong(K_DAY, -1);
            if (last <= 0) return out;
            int nm = AutoMonthMath.nextMonth(p.getInt(K_M, 1)), ny = AutoMonthMath.nextYear(p.getInt(K_M, 1), p.getInt(K_Y, 1448));
            // relecture de secours (pas de réseau le soir de l'annonce) : identifiant propre à ce mois
            JSONObject r = new JSONObject();
            r.put("id", "am-refresh-" + AutoMonthMath.iso(last)); r.put("kind", "refresh"); r.put("refresh", true);
            r.put("at", AutoMonthMath.refreshAt(last)); r.put("until", AutoMonthMath.refreshAt(last) + 40 * AutoMonthMath.DAY);
            out.put(r);

            JSONObject tx = amt.optJSONObject(String.valueOf(nm));
            if (tx == null) return out;
            long[] t29 = AlarmScheduler.timesOn(cfg, last + 28), t30 = AlarmScheduler.timesOn(cfg, last + 29);
            String eve29 = AutoMonthMath.iso(last + 28), eve30 = AutoMonthMath.iso(last + 29);
            String kind = nm == 10 ? "eid" : "month";
            JSONArray s = tx.optJSONArray("s"), o = tx.optJSONArray("o"), n = tx.optJSONArray("n");
            if (o != null && t29[2] > 0 && t29[3] > 0)
                out.put(entry(eve29 + "-obs", "obs", t29[2], t29[3] + 30 * AutoMonthMath.MIN, null, o, ny));
            if (s != null && t29[3] > 0) {
                long at = t29[3] + 20 * AutoMonthMath.MIN;
                out.put(entry(eve29 + "-" + kind, kind, at, at + AutoMonthMath.WATCH, AutoMonthMath.iso(last + 29), s, ny));
            }
            if (n != null && t29[3] > 0) {
                long at = t29[3] + 20 * AutoMonthMath.MIN;
                out.put(entry(eve29 + "-nosight", "nosight", at, at + AutoMonthMath.WATCH, AutoMonthMath.iso(last + 30), n, ny));
            }
            if (s != null && t30[3] > 0) {
                long at = t30[3] + 20 * AutoMonthMath.MIN;
                out.put(entry(eve30 + "-" + kind, kind, at, at + AutoMonthMath.WATCH, AutoMonthMath.iso(last + 30), s, ny));
            }
        } catch (Exception ignored) {}
        return out;
    }

    /** cfg.rem (page) + rappels calculés ici, sans doublon d'identifiant (la page l'emporte). */
    static JSONObject merged(Context ctx, JSONObject cfg) {
        JSONObject m = new JSONObject();
        try {
            JSONArray all = new JSONArray();
            java.util.Set<String> ids = new java.util.HashSet<String>();
            JSONArray rem = cfg == null ? null : cfg.optJSONArray("rem");
            if (rem != null) for (int i = 0; i < rem.length(); i++) {
                JSONObject e = rem.optJSONObject(i);
                if (e != null && ids.add(e.optString("id", ""))) all.put(e);
            }
            JSONArray auto = entries(ctx, cfg);
            for (int i = 0; i < auto.length(); i++) {
                JSONObject e = auto.optJSONObject(i);
                if (e != null && ids.add(e.optString("id", ""))) all.put(e);
            }
            m.put("rem", all);
            if (cfg != null) m.put("base", cfg.optString("base", ""));
        } catch (Exception ignored) {}
        return m;
    }
}
