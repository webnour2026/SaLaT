package io.github.webnour2026.salat;

/**
 * Calcul astronomique des horaires : portage fidèle de js/prayer-calc.js et js/localites.js (dérivé de PrayTimes.org).
 * Sert de secours quand les horaires transmis par l'application sont épuisés (application non ouverte depuis plus d'un mois).
 * Maroc (méthode 21) : même modèle que le site (localité officielle la plus proche à 25 km ou moins, ou localité choisie à la
 * main ; horizons du lever et du coucher selon l'altitude ; décalages en secondes). Aux hautes latitudes : règle « angle ».
 * Les heures sont arrondies à la minute, comme les tableaux officiels.
 */
final class PrayerCalc {
    private PrayerCalc() {}

    // ---- modèle commun du Maroc (voir MA_MODEL dans js/prayer-calc.js) ----
    private static final double MA_FAJR = 18.95, MA_ISHA = 17.05;
    private static final double SR_H0 = 0.76, SR_K = 0.032, SS_H0 = 1.10, SS_K = 0.028;
    private static final double OFF_FAJR = -45, OFF_SUNRISE = -94, OFF_DHUHR = 300, OFF_ASR = 3, OFF_MAGHRIB = 65, OFF_ISHA = -15;   // secondes

    // ---- localités officielles (js/localites-data.js) : code, latitude, longitude, altitude ----
    private static final int SNAP_KM = 25;
    private static final int[] L_CODE = {
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
        30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56,
        57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83,
        84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108,
        109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130,
        131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152,
        153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 301, 302, 303, 304, 305,
        306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 320, 321, 322
    };
    private static final double[] L_LAT = {
        34.0167, 33.8333, 33.9167, 33.5167, 33.4167, 33.8, 34.25, 34.2167, 34.3167, 34.2667, 34.3167, 34.9167,
        34.8833, 35.7667, 35.5667, 35.1833, 35.4667, 35.1667, 35.6167, 35.6833, 35.0, 35.8333, 35.25, 35.8833, 35.85,
        35.2, 35.4333, 35.0, 34.8, 34.7, 34.6833, 34.9167, 32.1167, 32.5333, 34.2167, 34.3167, 32.2, 34.4167,
        35.1833, 35.3, 34.0, 35.0667, 35.2667, 35.2833, 32.5333, 33.05, 34.5833, 34.8167, 35.1833, 35.15, 34.8,
        34.9167, 34.95, 34.9333, 34.9667, 32.3, 32.05, 33.5667, 33.7, 33.6167, 33.0, 33.2833, 32.5, 33.0667, 33.2667,
        33.25, 33.2833, 32.6667, 32.6167, 32.9333, 33.2333, 31.8333, 32.3333, 31.95, 32.5, 31.7333, 32.5667, 32.6,
        32.8833, 32.8667, 34.0667, 33.8333, 34.0833, 33.3667, 33.05, 33.8167, 33.8333, 33.7333, 34.2167, 34.5333,
        34.65, 34.7667, 34.7333, 34.05, 34.3, 34.3667, 34.8833, 34.1833, 33.9, 33.5333, 33.6833, 34.05, 33.4333,
        31.6333, 32.05, 31.5167, 31.55, 32.2333, 32.4833, 31.0, 32.3, 32.7167, 32.25, 31.55, 31.5, 31.8667, 30.3833,
        30.4833, 29.7, 30.0833, 30.5333, 29.7167, 29.75, 29.4, 29.0333, 30.2167, 30.4, 31.9333, 31.2667, 31.4167,
        33.6667, 31.7, 32.15, 31.5, 32.2667, 32.6833, 30.3167, 30.9167, 31.5, 31.0667, 31.2333, 30.7, 31.3667,
        31.1167, 31.9333, 31.7, 30.7667, 29.3833, 28.9833, 28.5667, 28.0167, 28.4333, 29.1833, 27.4, 28.0167, 27.15,
        26.7667, 26.1333, 27.9333, 26.1667, 26.3667, 25.1333, 26.1667, 28.05, 23.7, 20.8333, 22.55, 21.6167, 23.9,
        34.1, 34.0833, 34.05, 34.1, 31.1833, 31.3, 31.35, 31.2333, 32.0167, 32.0167, 31.2667, 33.8, 31.3333, 31.5667,
        31.2833, 31.2333, 30.95, 31.5333, 29.8833, 30.0833, 32.5167, 31.6333
    };
    private static final double[] L_LNG = {
        -6.85, -6.0833, -6.3333, -6.6, -6.0, -7.1667, -6.6, -5.7167, -6.3167, -5.95, -6.3167, -5.9333, -6.2833,
        -5.8167, -5.3667, -6.15, -6.05, -5.2667, -5.2833, -5.3333, -5.9167, -5.5667, -3.9333, -5.35, -5.3667,
        -4.6667, -5.1, -4.8833, -5.5833, -3.6, -1.9333, -2.35, -1.2333, -1.9667, -3.3667, -2.1667, -2.5167, -2.8833,
        -2.9333, -2.9667, -3.0167, -2.9333, -2.9167, -2.9833, -3.4333, -2.0, -2.5, -1.9833, -2.25, -2.4167, -2.4,
        -2.2, -2.1, -2.7167, -3.3833, -3.4667, -3.05, -7.6667, -7.4, -7.1333, -7.6333, -7.2333, -7.2, -7.25, -7.5833,
        -8.5167, -8.35, -8.4333, -8.7167, -5.6833, -6.2, -6.1167, -6.3667, -6.5833, -6.7, -7.0167, -6.05, -6.2833,
        -6.9167, -6.5833, -5.0167, -4.85, -5.1833, -4.7333, -4.0167, -4.4167, -4.55, -5.0167, -4.0167, -4.65,
        -3.8833, -3.8, -4.1, -4.4333, -4.6833, -5.2167, -4.6333, -4.2833, -5.5833, -5.1167, -5.3833, -5.5333,
        -5.2333, -8.0333, -7.4167, -9.7833, -8.7667, -7.9667, -7.9167, -9.6833, -9.25, -9.0333, -8.5333, -7.95, -8.1,
        -8.1667, -9.5667, -8.8, -9.7333, -8.4667, -7.9333, -8.9833, -7.9833, -8.25, -8.9, -9.3667, -9.2167, -4.45,
        -4.2667, -4.2333, -3.6333, -4.95, -5.6167, -5.0333, -4.4667, -4.75, -5.85, -6.9333, -5.5333, -6.55, -6.15,
        -6.45, -6.0, -5.1833, -5.1833, -5.8167, -5.5667, -10.1833, -10.0667, -9.45, -9.3, -11.1167, -9.7333, -9.05,
        -10.8, -13.2333, -11.6833, -14.5333, -12.9333, -10.5667, -12.8333, -12.3667, -11.4, -12.05, -15.9833, -17.1,
        -14.3, -16.4667, -14.5333, -4.5833, -4.6, -4.4167, -4.55, -8.85, -9.45, -7.5167, -7.7833, -5.4833, -5.4833,
        -7.8167, -6.7833, -7.7667, -7.65, -7.9667, -9.0667, -7.85, -7.6333, -7.3, -6.8667, -1.0167, -6.5333
    };
    private static final int[] L_ALT = {
        120, 460, 460, 500, 1260, 100, 200, 450, 200, 100, 100, 200, 100, 300, 520, 100, 120, 1150, 100, 100, 150,
        150, 200, 500, 250, 250, 100, 1230, 700, 400, 730, 200, 900, 900, 400, 1070, 900, 1000, 200, 100, 1100, 300,
        200, 200, 1450, 1470, 620, 520, 100, 100, 890, 800, 300, 600, 600, 1360, 860, 200, 100, 300, 410, 420, 500,
        650, 250, 100, 150, 190, 200, 1000, 900, 2500, 1200, 1700, 500, 1700, 1300, 540, 830, 880, 450, 1000, 400,
        2500, 900, 1500, 1050, 1520, 900, 800, 1350, 1450, 900, 520, 310, 250, 1750, 400, 600, 1500, 1160, 860, 1430,
        600, 550, 120, 500, 550, 750, 450, 150, 100, 460, 600, 600, 600, 300, 300, 300, 2000, 1450, 1550, 720, 1500,
        1040, 150, 300, 1000, 1000, 1000, 750, 1000, 2200, 1000, 1350, 1610, 800, 1200, 1500, 1250, 1500, 1550, 1600,
        880, 2800, 2100, 500, 350, 650, 300, 400, 300, 580, 450, 500, 100, 300, 100, 100, 1000, 300, 300, 300, 300,
        150, 100, 300, 300, 400, 590, 300, 520, 150, 900, 1000, 400, 2600, 2200, 1200, 1200, 200, 1100, 700, 1200,
        1200, 2500, 2000, 1400, 1500, 1250, 1000
    };

    /** {fajr°, isha°, ishaMin (0 = angle), décalage Dhuhr (min), décalage Maghrib (min)} */
    private static double[] params(int method) {
        switch (method) {
            case 21: return new double[]{19, 17, 0};          // Maroc : voir le modèle ci-dessus
            case 3:  return new double[]{18, 17, 0};          // Ligue islamique mondiale
            case 5:  return new double[]{19.5, 17.5, 0};      // Égypte
            case 4:  return new double[]{18.5, 0, 90};        // Umm Al-Qura
            case 1:  return new double[]{18, 18, 0};          // Karachi
            case 2:  return new double[]{15, 15, 0};          // ISNA
            case 13: return new double[]{18, 17, 0};          // Diyanet
            case 12: return new double[]{12, 12, 0};          // UOIF
            case 19: return new double[]{18, 17, 0};          // Algérie
            case 18: return new double[]{18, 18, 0};          // Tunisie
            case 8:  return new double[]{19.5, 0, 90};        // Golfe
            case 16: return new double[]{18.2, 18.2, 0};      // Dubaï
            case 15: return new double[]{18, 18, 0};          // Moonsighting (approx.)
            default: return new double[]{18, 17, 0};          // MWL
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

    private static double distanceKm(double lat1, double lng1, double lat2, double lng2) {
        double a = Math.pow(Math.sin(rad(lat2 - lat1) / 2), 2) + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.pow(Math.sin(rad(lng2 - lng1) / 2), 2);
        return 2 * 6371 * Math.asin(Math.sqrt(a));
    }

    /**
     * Point de référence du Maroc : {lat, lng, altitude}. code >= 0 : localité choisie à la main ; snap : localité officielle la plus
     * proche à 25 km ou moins ; sinon position exacte (altitude de la localité proche, ou 0).
     */
    private static double[] moroccoReference(double lat, double lng, boolean snap, int code) {
        if (code >= 0) for (int i = 0; i < L_CODE.length; i++) if (L_CODE[i] == code) return new double[]{L_LAT[i], L_LNG[i], L_ALT[i]};
        int best = -1; double bk = Double.MAX_VALUE;
        for (int i = 0; i < L_CODE.length; i++) { double km = distanceKm(lat, lng, L_LAT[i], L_LNG[i]); if (km < bk) { bk = km; best = i; } }
        if (best < 0) return new double[]{lat, lng, 0};
        boolean near = bk <= SNAP_KM;
        if (snap && near) return new double[]{L_LAT[best], L_LNG[best], L_ALT[best]};
        return new double[]{lat, lng, near ? L_ALT[best] : 0};
    }

    /** Horaires Fajr, Dhuhr, Asr, Maghrib, Isha (ms UTC, à la minute) pour la date civile y-m-d. 0 si le calcul est impossible. */
    static long[] compute(double lat, double lng, int y, int m, int d, int method, int school) {
        return compute(lat, lng, y, m, d, method, school, true, -1);
    }

    static long[] compute(double lat, double lng, int y, int m, int d, int method, int school, boolean snap, int code) {
        final boolean ma = method == 21;
        final double[] p = params(method);
        double alt = 0;
        if (ma) { double[] r = moroccoReference(lat, lng, snap, code); lat = r[0]; lng = r[1]; alt = r[2]; }
        final double hRise = ma ? SR_H0 + SR_K * Math.sqrt(alt) : 0.833, hSet = ma ? SS_H0 + SS_K * Math.sqrt(alt) : 0.833;
        final double fajrAngle = ma ? MA_FAJR : p[0], ishaAngle = ma ? MA_ISHA : p[1];
        final double jd = julian(y, m, d) - lng / (15 * 24);

        double fajr = angleTime(jd, lat, fajrAngle, 5 / 24.0, true);
        double sunrise = angleTime(jd, lat, hRise, 6 / 24.0, true);
        double dhuhr = midDay(jd, 12 / 24.0);
        double[] s13 = sun(jd + 13 / 24.0);
        double asrAngle = -deg(Math.atan(1 / ((school == 1 ? 2 : 1) + dtan(Math.abs(lat - s13[0])))));
        double asr = angleTime(jd, lat, asrAngle, 13 / 24.0, false);
        double sunset = angleTime(jd, lat, hSet, 18 / 24.0, false);
        double maghrib = sunset;
        double isha = p[2] > 0 ? maghrib + p[2] / 60 : angleTime(jd, lat, ishaAngle, 18 / 24.0, false);

        // Hautes latitudes : règle « angle » (portion de la nuit = angle / 60) quand le Soleil n'atteint pas l'angle
        if (!Double.isNaN(sunrise) && !Double.isNaN(sunset)) {
            double night = fix(sunrise - sunset, 24);
            if (!(fix(sunrise - fajr, 24) <= (fajrAngle / 60) * night)) fajr = sunrise - (fajrAngle / 60) * night;
            if (p[2] == 0 && !(fix(isha - sunset, 24) <= (ishaAngle / 60) * night)) isha = sunset + (ishaAngle / 60) * night;
        }
        if (ma) {
            fajr += OFF_FAJR / 3600.0; dhuhr += OFF_DHUHR / 3600.0; asr += OFF_ASR / 3600.0;
            maghrib += OFF_MAGHRIB / 3600.0; isha += OFF_ISHA / 3600.0;
        }
        long base = utcMidnight(y, m, d);
        double[] h = {fajr, dhuhr, asr, maghrib, isha};
        long[] out = new long[5];
        for (int i = 0; i < 5; i++) {
            out[i] = (Double.isNaN(h[i]) || Double.isInfinite(h[i])) ? 0 : Math.round((base + (h[i] - lng / 15) * 3600000) / 60000.0) * 60000L;
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
