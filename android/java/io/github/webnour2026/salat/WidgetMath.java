package io.github.webnour2026.salat;

/**
 * Widget d'écran d'accueil — règles pures (sans Android), testées par scripts/test-java-widget.mjs.
 */
final class WidgetMath {
    private WidgetMath() {}

    static final int COMPACT = 0, MEDIUM = 1, LARGE = 2;

    /**
     * Mise en page selon la taille donnée par le lanceur (dp) :
     *   COMPACT : une rangée (≈ 1 case de haut, ou trop étroit pour 5 horaires) → prière + compte à rebours ;
     *   MEDIUM  : + les 5 horaires du jour ;
     *   LARGE   : + ville et date hégirienne.
     */
    static int layout(int widthDp, int heightDp) {
        if (heightDp > 0 && heightDp < 100) return COMPACT;
        if (widthDp > 0 && widthDp < 200) return COMPACT;
        if (heightDp > 0 && heightDp < 150) return MEDIUM;
        return LARGE;
    }

    /** Texte arabe ? (alphabet arabe dans le nom de la prière) → les 5 horaires se lisent de droite à gauche. */
    static boolean rtl(String s) {
        if (s == null) return false;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c >= 0x0600 && c <= 0x06FF) return true;
        }
        return false;
    }

    /** Case (0 = gauche … 4 = droite) qui affiche la prière k (0 = Fajr … 4 = Isha). */
    static int slot(int k, boolean rtl) { return rtl ? 4 - k : k; }

    /**
     * Prochain rafraîchissement : fin du « depuis » d'une prière qui vient de passer (elapsedEnd > 0), sinon heure de la
     * prochaine prière ; toujours avant `now + MAX_WAIT` (filet de sécurité : jour suivant, changement d'heure manqué…).
     */
    static final long MAX_WAIT = 6 * 3600000L;

    static long nextRefresh(long now, long elapsedEnd, long nextTime) {
        long t = elapsedEnd > now ? elapsedEnd : nextTime;
        if (t <= now) t = now + 60000L;
        return Math.min(t, now + MAX_WAIT);
    }
}
