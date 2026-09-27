package io.github.webnour2026.salat;

/**
 * Calcul astronomique des horaires (portage de js/prayer-calc.js, dérivé de PrayTimes.org).
 * Sert de secours quand les horaires officiels transmis par l'application sont épuisés.
 */
final class PrayerCalc {
    private PrayerCalc() {}

    /** {fajr°, isha° (ou -1), ishaMin (ou 0), offsetDhuhr, offsetMaghrib} */
    private static double[] params(int method) {
        switch (method) {
            case 21: return new double[]{19, 17, 0, 5, 5};      // Maroc
            case 5:  return new double[]{19.5, 17.5, 0, 0, 0};  // Égypte
            case 4:  return new double[]{18.5, -1, 90, 0, 0};   // Umm Al-Qura
            case 1:  return new double[]{18, 18, 0, 0, 0};      // Karachi
            case 2:  return new double[]{15, 15, 0, 0, 0};      // ISNA
            case 13: return new double[]{18, 17, 0, 0, 0};      // Diyanet
            case 12: return new double[]{12, 12, 0, 0, 0};      // UOIF
            case 19: return new double[]{18, 17, 0, 0, 0};      // Algérie
            case 18: return new double[]{18, 18, 0, 0, 0};      // Tunisie
            case 8:  return new double[]{19.5, -1, 90, 0, 0};   // Golfe
            case 16: return new double[]{18.2, 18.2, 0, 0, 0};  // Dubaï
            default: return new double[]{18, 17, 0, 0, 0};      // MWL
        }
    }

    private static double rad(double d) { return d * Math.PI / 180; }
    private static double deg(double r) { return r * 180 / Math.PI; }
    private static double fix(double a, double b) { a = a - b * Math.floor(a / b); return a < 0 ? a + b : a; }
    private static double dsin(double d) { return Math.sin(rad(d)); }
    private static double dcos(double d) { return Math.cos(rad(d)); }
    private static double dtan(double d) { return Math.tan(rad(d)); }

    private static double julian(int y, int m, int d) {
        if (m <= 2) { y -= 1; m += 12; }
        double A = Math.floor(y / 100.0), B = 2 - A + Math.floor(A / 4);
        return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
    }
    /** {déclinaison, équation du temps} */
    private static double[] sun(double jd) {
        double D = jd - 2451545.0;
        double g = fix(357.529 + 0.98560028 * D, 360);
        double q = fix(280.459 + 0.98564736 * D, 360);
        double L = fix(q + 1.915 * dsin(g) + 0.020 * dsin(2 * g), 360);
        double e = 23.439 - 0.00000036 * D;
        double RA = deg(Math.atan2(dcos(e) * dsin(L), dcos(L))) / 15;
        return new double[]{deg(Math.asin(dsin(e) * dsin(L))), q / 15 - fix(RA, 24)};
    }

    /** Horaires Fajr, Dhuhr, Asr, Maghrib, Isha (ms UTC) pour la date civile y-m-d. */
    static long[] compute(double lat, double lng, int y, int m, int d, int method, int school) {
        double[] p = params(method);
        final double jd = julian(y, m, d) - lng / (15 * 24);
        double fajr = angleTime(jd, lat, p[0], 5 / 24.0, true);
        double dhuhr = midDay(jd, 12 / 24.0) + p[3] / 60;
        double[] s13 = sun(jd + 13 / 24.0);
        double asrAngle = -deg(Math.atan(1 / ((school == 1 ? 2 : 1) + dtan(Math.abs(lat - s13[0])))));
        double asr = angleTime(jd, lat, asrAngle, 13 / 24.0, false);
        double sunset = angleTime(jd, lat, 0.833, 18 / 24.0, false);
        double maghrib = sunset + p[4] / 60;
        double isha = p[2] > 0 ? sunset + p[2] / 60 : angleTime(jd, lat, p[1], 18 / 24.0, false);
        long base = utcMidnight(y, m, d);
        double[] h = {fajr, dhuhr, asr, maghrib, isha};
        long[] out = new long[5];
        for (int i = 0; i < 5; i++) {
            out[i] = Double.isNaN(h[i]) ? 0 : Math.round(base + (h[i] - lng / 15) * 3600000);
        }
        return out;
    }
    private static double midDay(double jd, double t) { return fix(12 - sun(jd + t)[1], 24); }
    private static double angleTime(double jd, double lat, double angle, double t, boolean ccw) {
        double decl = sun(jd + t)[0];
        double T = deg(Math.acos((-dsin(angle) - dsin(decl) * dsin(lat)) / (dcos(decl) * dcos(lat)))) / 15;
        return midDay(jd, t) + (ccw ? -T : T);
    }
    private static long utcMidnight(int y, int m, int d) {
        java.util.Calendar c = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC"));
        c.clear(); c.set(y, m - 1, d, 0, 0, 0);
        return c.getTimeInMillis();
    }
}
