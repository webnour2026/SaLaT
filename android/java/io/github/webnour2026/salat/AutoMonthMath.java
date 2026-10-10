package io.github.webnour2026.salat;

/**
 * Rappels du croissant, calculés par le module lui-même (appli fermée pendant des mois) — arithmétique pure, testée par
 * scripts/test-java-automonth.mjs. Les jours sont des « jours d'époque » UTC (ms / 86 400 000).
 *
 * À partir du dernier début de mois connu `last` (1er du mois en cours) :
 *   last + 28  = 29e jour : soir d'observation
 *     · Asr                 « ce soir, observation » (Mouharram, Ramadan, Chawwal, Dhou al-Hijja)
 *     · Maghrib + 20 min    « demain, 1er du mois »  si le calendrier annonce last + 29
 *     · Maghrib + 20 min    « croissant non vu »     si le calendrier annonce last + 30
 *   last + 29  = 30e jour : Maghrib + 20 min « demain, 1er du mois » si le calendrier annonce last + 30
 *   last + 31, 09:00 UTC : rien appris (pas de réseau) → on relit le calendrier ; à défaut, on suppose 30 jours.
 */
final class AutoMonthMath {
    private AutoMonthMath() {}

    static final long DAY = 86400000L, MIN = 60000L;
    static final long WATCH = 4 * 3600000L, FIXED = 6 * 3600000L;

    static int nextMonth(int m) { return m == 12 ? 1 : m + 1; }
    static int nextYear(int m, int y) { return m == 12 ? y + 1 : y; }
    static boolean watched(int m) { return m == 1 || m == 9 || m == 10 || m == 12; }

    /** Instant de la relecture de secours. */
    static long refreshAt(long last) { return (last + 31) * DAY + 9 * 3600000L; }

    /**
     * Faut-il remplacer le dernier début connu par celui lu dans le calendrier ?
     * Toujours s'il est plus récent ; si le nôtre n'était qu'une estimation (30 jours supposés), aussi s'il la corrige d'un jour.
     */
    static boolean accept(long stored, boolean estimated, long seen) {
        if (seen <= 0) return false;
        if (stored <= 0 || seen > stored) return true;
        return estimated && seen != stored && seen >= stored - 1;
    }

    /** Date « AAAA-MM-JJ » d'un jour d'époque. */
    static String iso(long day) {
        long z = day + 719468, era = Math.floorDiv(z, 146097), doe = z - era * 146097;
        long yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        long y = yoe + era * 400, doy = doe - (365 * yoe + yoe / 4 - yoe / 100), mp = (5 * doy + 2) / 153;
        long d = doy - (153 * mp + 2) / 5 + 1, m = mp < 10 ? mp + 3 : mp - 9;
        if (m <= 2) y++;
        return String.format(java.util.Locale.US, "%04d-%02d-%02d", y, m, d);
    }

    /** Jour d'époque d'une date « AAAA-MM-JJ », ou -1. */
    static long dayOf(String s) {
        if (s == null || !s.matches("\\d{4}-\\d{2}-\\d{2}")) return -1;
        int y = Integer.parseInt(s.substring(0, 4)), m = Integer.parseInt(s.substring(5, 7)), d = Integer.parseInt(s.substring(8, 10));
        y -= m <= 2 ? 1 : 0;
        long era = Math.floorDiv(y, 400), yoe = y - era * 400;
        long doy = (153L * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1, doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146097 + doe - 719468;
    }
}
