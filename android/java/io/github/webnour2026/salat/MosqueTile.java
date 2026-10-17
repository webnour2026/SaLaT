package io.github.webnour2026.salat;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

import org.json.JSONObject;

/**
 * Tuile « Mode Mosquée » des réglages rapides (volet tiré du haut de l'écran) : active (toutes les prières) ou désactive
 * le Mode Mosquée d'un geste, sans ouvrir l'appli. Le choix est écrit dans la configuration du module (cfg.mq) et noté
 * (tileAt, tileMode) : à la prochaine ouverture, l'appli le reçoit dans l'adresse (?mqn=…&mqat=…, voir decorate) et
 * l'adopte ; une synchronisation plus ancienne que la tuile ne l'écrase pas (keepTile).
 */
public class MosqueTile extends TileService {
    private static final String AT = "tileAt", MODE = "tileMode", PENDING = "tilePending";

    private static SharedPreferences prefs(Context ctx) { return ctx.getSharedPreferences(AlarmScheduler.PREFS, Context.MODE_PRIVATE); }

    private static String mode(JSONObject cfg) {
        JSONObject m = cfg == null ? null : cfg.optJSONObject("mq");
        return m == null ? "off" : m.optString("m", "off");
    }

    @Override public void onStartListening() { refresh(); }

    @Override
    public void onClick() {
        JSONObject cfg = AlarmScheduler.config(this);
        if (cfg == null) {                                   // module jamais configuré : on ouvre l'appli
            Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    if (Build.VERSION.SDK_INT >= 34) startActivityAndCollapse(android.app.PendingIntent.getActivity(this, 0, launch,
                            android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_UPDATE_CURRENT));
                    else startActivityAndCollapse(launch);
                } catch (Exception ignored) {}
            }
            return;
        }
        String next = "off".equals(mode(cfg)) ? "perm" : "off";
        try {
            JSONObject m = cfg.optJSONObject("mq");
            if (m == null) { m = new JSONObject(); m.put("d", MosqueMath.DUR_DEFAULT); cfg.put("mq", m); }
            m.put("m", next); m.put("t", 0);
            AlarmScheduler.save(this, cfg);
            prefs(this).edit().putLong(AT, System.currentTimeMillis()).putString(MODE, next).putBoolean(PENDING, true).apply();
            AlarmScheduler.scheduleNext(this);
            MosqueMode.onConfig(this);
            Ongoing.update(this);
        } catch (Exception ignored) {}
        refresh();
    }

    private void refresh() {
        Tile t = getQsTile();
        if (t == null) return;
        JSONObject cfg = AlarmScheduler.config(this);
        boolean on = !"off".equals(mode(cfg));
        t.setState(cfg == null ? Tile.STATE_INACTIVE : on ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        t.setLabel(AlarmScheduler.text(cfg, "mqTile", "Mode Mosquée"));
        if (Build.VERSION.SDK_INT >= 29) t.setSubtitle(on ? AlarmScheduler.text(cfg, "mqTileOn", "Activé") : AlarmScheduler.text(cfg, "mqTileOff", "Désactivé"));
        t.updateTile();
    }

    /** Adresse d'ouverture de l'appli (LauncherActivity) : signale le dernier choix fait avec la tuile, une fois. */
    public static Uri decorate(Context ctx, Uri uri) {
        try {
            SharedPreferences p = prefs(ctx);
            if (uri == null || !p.getBoolean(PENDING, false)) return uri;
            p.edit().putBoolean(PENDING, false).apply();
            return uri.buildUpon().appendQueryParameter("mqn", p.getString(MODE, "off")).appendQueryParameter("mqat", String.valueOf(p.getLong(AT, 0))).build();
        } catch (Exception e) { return uri; }
    }

    /** Synchronisation venue de l'appli : si la tuile a été touchée après le dernier choix fait dans l'appli, la tuile l'emporte. */
    static void keepTile(Context ctx, JSONObject cfg) {
        try {
            SharedPreferences p = prefs(ctx);
            long at = p.getLong(AT, 0);
            JSONObject m = cfg == null ? null : cfg.optJSONObject("mq");
            if (at == 0 || m == null || m.optLong("at", 0) >= at) return;
            m.put("m", p.getString(MODE, "off")); m.put("t", 0);
        } catch (Exception ignored) {}
    }

    /** Après un changement de configuration : l'état affiché par la tuile est mis à jour. */
    static void update(Context ctx) {
        try { TileService.requestListeningState(ctx, new android.content.ComponentName(ctx, MosqueTile.class)); } catch (Exception ignored) {}
    }
}
