package io.github.webnour2026.salat;

import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Mesure, par le module lui-même, l'écart entre l'horloge du téléphone et l'heure réelle : en-tête HTTP « Date » du site de l'appli,
 * comme le fait la page (clock.js). Le module n'attend plus que la page lui envoie l'écart : après un redémarrage, un changement
 * d'heure imposé par le réseau mobile ou une longue absence de la page, il le retrouve seul. Appeler hors du thread principal.
 */
final class ClockSync {
    private ClockSync() {}

    /** Écart (ms) = heure réelle − horloge du téléphone, ou null si le réseau ou le serveur ne répond pas. */
    static Long measure(String base) {
        if (base == null || !base.startsWith(Reminders.SITE)) return null;
        long[] rtt = new long[3], off = new long[3];
        int n = 0;
        for (int i = 0; i < 3; i++) {
            HttpURLConnection c = null;
            try {
                long t0 = System.currentTimeMillis();
                // paramètre unique : le serveur répond lui-même (pas de copie en cache dont la date serait ancienne)
                String url = base + (base.endsWith("/") ? "" : "/") + "index.html?__clock=" + t0;
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setRequestMethod("HEAD");
                c.setConnectTimeout(3000);
                c.setReadTimeout(3000);
                c.setUseCaches(false);
                c.setRequestProperty("Cache-Control", "no-cache");
                int code = c.getResponseCode();
                long t1 = System.currentTimeMillis();
                long server = c.getHeaderFieldDate("Date", 0);
                if (code >= 200 && code < 400 && server > 0) {
                    rtt[n] = t1 - t0;
                    off[n] = ClockMath.sample(t0, t1, server);
                    n++;
                }
            } catch (Exception e) {
                break;                                   // hors ligne ou serveur injoignable : inutile d'insister (le récepteur doit rester bref)
            } finally {
                if (c != null) c.disconnect();
            }
        }
        if (n == 0) return null;
        long m = ClockMath.pick(rtt, off, n);
        return ClockMath.plausible(m) ? Long.valueOf(m) : null;
    }
}
