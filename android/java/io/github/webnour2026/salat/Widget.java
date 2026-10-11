package io.github.webnour2026.salat;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Widget d'écran d'accueil : prochaine prière + compte à rebours (tenu par Android : Chronometer, aucune mise à jour
 * chaque seconde), et, s'il y a la place, les 5 horaires du jour, la ville et la date hégirienne.
 * Données : la configuration déjà envoyée par la page au module (fonctionne appli fermée, horaires officiels compris).
 * Rafraîchi à chaque prière par une alarme non réveillante, à chaque synchronisation, au redémarrage et au redimensionnement.
 */
public class Widget extends AppWidgetProvider {
    static final String ACTION_TICK = "io.github.webnour2026.salat.WIDGET_TICK";
    private static final int RQ_TICK = 30;

    private static final int CREAM = 0xFFF4F1E6, SUB = 0xFFBFD8CF, GOLD = 0xFFEFCB72, DIM = 0x80BFD8CF;

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        if (ACTION_TICK.equals(intent.getAction())) refresh(ctx);
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) { refresh(ctx); }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, Bundle options) { refresh(ctx); }

    @Override
    public void onDisabled(Context ctx) { cancelTick(ctx); }

    /** Met à jour tous les widgets posés (sans effet s'il n'y en a aucun). */
    static void refresh(Context ctx) {
        try {
            Context app = ctx.getApplicationContext() != null ? ctx.getApplicationContext() : ctx;
            AppWidgetManager mgr = AppWidgetManager.getInstance(app);
            int[] ids = mgr.getAppWidgetIds(new ComponentName(app, Widget.class));
            if (ids == null || ids.length == 0) { cancelTick(app); return; }

            JSONObject cfg = AlarmScheduler.config(app);
            long now = Clock.now(app);
            AlarmScheduler.Next cur = cfg == null ? null : AlarmScheduler.elapsedPrayer(cfg, now);
            AlarmScheduler.Next next = cfg == null ? null : AlarmScheduler.nextPrayer(cfg, now);

            for (int id : ids) {
                Bundle o = mgr.getAppWidgetOptions(id);
                int w = o == null ? 0 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
                int h = o == null ? 0 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
                mgr.updateAppWidget(id, build(app, cfg, now, cur, next, WidgetMath.layout(w, h)));
            }

            if (next != null) {
                long gr = cfg.optInt("gr", 30) * 60000L;
                schedule(app, WidgetMath.nextRefresh(now, cur != null ? cur.time + gr : 0, next.time));
            }
        } catch (Exception ignored) {}
    }

    private static RemoteViews build(Context ctx, JSONObject cfg, long now,
                                     AlarmScheduler.Next cur, AlarmScheduler.Next next, int size) {
        AlarmScheduler.Next shown = cur != null ? cur : next;
        String name = cfg == null || shown == null ? "SaLaTi" : AlarmScheduler.prayerName(cfg, shown.key, shown.time);
        boolean rtl = cfg == null || shown == null || WidgetMath.rtl(name);
        String base = size == WidgetMath.TINY ? "widget_tiny" : size == WidgetMath.COMPACT ? "widget_compact" : "widget_large";
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), res(ctx, base + (rtl ? "_ar" : "_ltr"), "layout"));
        rv.setOnClickPendingIntent(id(ctx, "w_root"), AlarmScheduler.openApp(ctx));
        boolean large = size == WidgetMath.LARGE || size == WidgetMath.MEDIUM;

        if (cfg == null || shown == null) {
            // module jamais synchronisé : on invite à ouvrir l'appli une fois
            rv.setTextViewText(id(ctx, "w_prayer"), "SaLaTi");
            rv.setTextViewText(id(ctx, "w_time"), "افتح التطبيق · Ouvrir");
            rv.setViewVisibility(id(ctx, "w_count"), View.GONE);
            if (large) {
                rv.setViewVisibility(id(ctx, "w_label"), View.GONE);
                rv.setViewVisibility(id(ctx, "w_clabel"), View.GONE);
                rv.setViewVisibility(id(ctx, "w_row"), View.GONE);
                rv.setViewVisibility(id(ctx, "w_head"), View.GONE);
            }
            return rv;
        }

        String tz = cfg.optString("tz", TimeZone.getDefault().getID());
        SimpleDateFormat hm = new SimpleDateFormat("HH:mm", Locale.US);
        hm.setTimeZone(TimeZone.getTimeZone(tz));

        setName(ctx, rv, name, size == WidgetMath.TINY ? 17 : size == WidgetMath.COMPACT ? 22 : 30);
        rv.setTextViewText(id(ctx, "w_time"), hm.format(new Date(shown.time)));
        // « −1:24:10 » avant l'heure ; juste après, « +04:21 » en doré (jusqu'à la fin du délai), puis la prière suivante
        int count = id(ctx, "w_count");
        rv.setViewVisibility(count, View.VISIBLE);
        rv.setChronometer(count, SystemClock.elapsedRealtime() + (shown.time - now), cur != null ? "+%s" : "\u2212%s", true);
        if (Build.VERSION.SDK_INT >= 24) rv.setChronometerCountDown(count, cur == null);
        rv.setTextColor(count, cur != null ? GOLD : CREAM);

        if (!large) return rv;

        rv.setTextViewText(id(ctx, "w_label"), cur != null
                ? AlarmScheduler.text(cfg, "itsTime", rtl ? "حان وقت صلاة" : "C\u2019est l\u2019heure de")
                : AlarmScheduler.text(cfg, "wNext", rtl ? "الصلاة القادمة" : "Prochaine prière"));
        rv.setTextViewText(id(ctx, "w_clabel"), cur != null
                ? AlarmScheduler.text(cfg, "wSince", rtl ? "منذ" : "Depuis")
                : AlarmScheduler.text(cfg, "wIn", rtl ? "بعد" : "Dans"));

        // en-tête : ville et date hégirienne (grand format seulement) — gauche → droite fixe : en arabe, la ville à droite
        if (size == WidgetMath.LARGE) {
            String city = AlarmScheduler.text(cfg, "city", "");
            String hijri = "";
            JSONArray hj = cfg.optJSONArray("hj");
            if (hj != null && shown.day >= 0 && shown.day < hj.length()) hijri = hj.optString(shown.day, "");
            rv.setTextViewText(id(ctx, "w_left"), rtl ? hijri : city);
            rv.setTextViewText(id(ctx, "w_right"), rtl ? city : hijri);
            rv.setTextColor(id(ctx, "w_left"), rtl ? GOLD : SUB);
            rv.setTextColor(id(ctx, "w_right"), rtl ? SUB : GOLD);
            rv.setViewVisibility(id(ctx, "w_head"), View.VISIBLE);
        } else {
            rv.setViewVisibility(id(ctx, "w_head"), View.GONE);
        }

        // les 5 horaires du jour de la prière affichée (après l'Isha : ceux de demain)
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone(tz));
        c.setTimeInMillis(shown.time);
        Calendar utc = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        utc.clear();
        utc.set(c.get(Calendar.YEAR), c.get(Calendar.MONTH), c.get(Calendar.DAY_OF_MONTH), 0, 0, 0);
        long[] t = AlarmScheduler.timesOn(cfg, Math.floorDiv(utc.getTimeInMillis(), 86400000L));
        int pill = res(ctx, "widget_pill", "drawable");
        for (int k = 0; k < 5; k++) {
            int s = WidgetMath.slot(k, rtl);
            int nId = id(ctx, "w_n" + s), tId = id(ctx, "w_t" + s), sId = id(ctx, "w_s" + s);
            boolean on = AlarmScheduler.KEYS[k].equals(shown.key);
            boolean past = !on && t[k] > 0 && t[k] <= now;
            rv.setTextViewText(nId, AlarmScheduler.prayerName(cfg, AlarmScheduler.KEYS[k], t[k] > 0 ? t[k] : shown.time));
            rv.setTextViewText(tId, t[k] > 0 ? hm.format(new Date(t[k])) : "—");
            rv.setTextColor(nId, on ? GOLD : past ? DIM : SUB);
            rv.setTextColor(tId, on ? GOLD : past ? DIM : CREAM);
            rv.setInt(sId, "setBackgroundResource", on ? pill : 0);
        }
        rv.setViewVisibility(id(ctx, "w_row"), View.VISIBLE);
        return rv;
    }

    /**
     * Nom de la prière en Reem Kufi, comme dans l'appli. Un widget ne peut pas utiliser les polices de l'appli (le lanceur les ignore) :
     * on dessine le nom dans une image. À défaut (Android < 8, police absente, erreur), texte simple dans la police du système.
     */
    private static void setName(Context ctx, RemoteViews rv, String name, int sp) {
        int img = id(ctx, "w_prayer_img"), txt = id(ctx, "w_prayer");
        Bitmap b = null;
        try { b = kufi(ctx, name, sp, CREAM); } catch (Throwable ignored) {}
        if (b != null && img != 0) {
            rv.setImageViewBitmap(img, b);
            rv.setViewVisibility(img, View.VISIBLE);
            rv.setViewVisibility(txt, View.GONE);
            rv.setContentDescription(img, name);
        } else {
            rv.setTextViewText(txt, name);
            rv.setViewVisibility(txt, View.VISIBLE);
            if (img != 0) rv.setViewVisibility(img, View.GONE);
        }
    }

    private static Bitmap kufi(Context ctx, String text, int sp, int color) {
        if (Build.VERSION.SDK_INT < 26) return null;
        int font = res(ctx, "salati_kufi", "font");
        if (font == 0) return null;
        Typeface tf = ctx.getResources().getFont(font);
        android.util.DisplayMetrics dm = ctx.getResources().getDisplayMetrics();
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
        p.setTypeface(tf);
        p.setColor(color);
        p.setTextSize(sp * dm.scaledDensity);
        Paint.FontMetrics fm = p.getFontMetrics();
        int pad = Math.round(2 * dm.density);
        int w = (int) Math.ceil(p.measureText(text)) + 2 * pad;
        int h = (int) Math.ceil(fm.descent - fm.ascent) + pad;
        if (w <= 2 * pad || h <= pad) return null;
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        new Canvas(b).drawText(text, pad, -fm.ascent, p);
        return b;
    }

    // ---------- rafraîchissement à l'heure de chaque prière ----------
    private static PendingIntent tickIntent(Context ctx) {
        Intent i = new Intent(ctx, Widget.class).setAction(ACTION_TICK);
        return PendingIntent.getBroadcast(ctx, RQ_TICK, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Alarme NON réveillante (RTC) : un widget ne se voit qu'écran allumé ; Android la livre au réveil du téléphone. */
    private static void schedule(Context ctx, long realMs) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        long at = Clock.toDevice(ctx, realMs);
        PendingIntent pi = tickIntent(ctx);
        try {
            if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) { am.setExact(AlarmManager.RTC, at, pi); return; }
        } catch (SecurityException ignored) {}
        am.setWindow(AlarmManager.RTC, at, 60000L, pi);
    }

    private static void cancelTick(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(tickIntent(ctx));
    }

    private static int id(Context ctx, String name) { return res(ctx, name, "id"); }

    private static int res(Context ctx, String name, String type) {
        return ctx.getResources().getIdentifier(name, type, ctx.getPackageName());
    }
}
