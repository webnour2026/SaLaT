package io.github.webnour2026.salat;

/**
 * Mode Mosquée — arithmétique pure (sans Android), testée par scripts/test-java-mosque.mjs.
 *
 * Cycle d'une prière T :
 *   T            Adhan (joué normalement)
 *   start        fin de l'Adhan → sonneries coupées (l'Adhan passe par le canal « notification » : le couper avant la fin le ferait taire)
 *   iqama        T + 15 min (Maghrib : 10 min ; Maghrib de Ramadan : dès la fin de l'Adhan)
 *   end          T + durée choisie, jamais avant la fin de la prière (iqama + 6 min) → état audio d'avant restauré
 */
final class MosqueMath {
    private MosqueMath() {}

    static final long MIN = 60000L;
    static final long MAX_ADHAN = 6 * MIN;          // un Adhan plus long (fichier anormal) ne retarde pas la coupure au-delà de 6 min
    static final long PRAYER_SPAN = 6 * MIN;        // écran « Iqama » (1 min) + écran « Prière » (5 min)
    static final int DUR_DEFAULT = 25, DUR_MIN = 10, DUR_MAX = 90;

    // valeurs d'AudioManager (recopiées pour rester testables hors Android)
    static final int SILENT = 0, VIBRATE = 1, NORMAL = 2, NONE = -1;

    static int clampDur(int d) {
        if (d <= 0) return DUR_DEFAULT;
        return Math.max(DUR_MIN, Math.min(DUR_MAX, d));
    }

    /** Minutes entre l'Adhan et l'Iqama. */
    static int iqamaMin(String key, boolean ramadan) {
        if ("Maghrib".equals(key)) return ramadan ? 0 : 10;
        return 15;
    }

    /** { start, iqama, end } en ms. */
    static long[] window(long t, long adhanMs, int durMin, int iqamaMin) {
        long a = Math.max(0, Math.min(adhanMs, MAX_ADHAN));
        long start = t + a;
        long iqama = Math.max(t + iqamaMin * MIN, start);
        long end = Math.max(t + clampDur(durMin) * MIN, iqama + PRAYER_SPAN);
        return new long[]{start, iqama, end};
    }

    /**
     * Le cycle s'applique-t-il à la prière T ?
     *  perm : toujours ; once : seulement la prière visée (à la minute près), et une seule fois.
     */
    static boolean runs(String mode, long onceT, long doneT, long t) {
        if ("perm".equals(mode)) return true;
        if ("once".equals(mode)) return onceT > 0 && Math.abs(onceT - t) < MIN && doneT != onceT;
        return false;
    }

    /** Mode à garder actif pour programmer les alarmes (once : tant que la prière visée n'est pas passée). */
    static boolean wanted(String mode, long onceT, long now) {
        return "perm".equals(mode) || ("once".equals(mode) && onceT > now - MIN);
    }

    /**
     * Mode sonnerie à imposer, ou NONE s'il n'y a rien à faire.
     * Téléphone déjà silencieux → rien. Avec l'accès « Ne pas déranger » → silencieux ; sinon → vibreur (seul mode permis sans cet accès).
     */
    static int target(int prev, boolean dndAccess) {
        if (prev == SILENT) return NONE;
        int t = dndAccess ? SILENT : VIBRATE;
        return t == prev ? NONE : t;
    }

    /** On ne restaure que si l'utilisateur n'a pas changé lui-même le mode pendant la période. */
    static boolean restore(int current, int set) {
        return set != NONE && current == set;
    }
}
