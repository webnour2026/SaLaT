package io.github.webnour2026.salat;

/**
 * Arithmétique pure (sans Android) de l'écart entre l'horloge du téléphone et l'heure réelle.
 *
 * L'application web mesure cet écart (en-tête « Date » du serveur) et l'envoie au module : réel = horloge du téléphone + écart.
 * Un téléphone déréglé d'une heure sonnerait sinon une heure trop tôt ou trop tard, car AlarmManager suit l'horloge du téléphone.
 */
final class ClockMath {
    private ClockMath() {}

    static final long NO_REF = Long.MIN_VALUE;

    /**
     * Écart courant (ms) : l'écart mesuré à la synchronisation, corrigé si l'utilisateur a changé l'horloge depuis.
     * `ref` = (horloge − temps écoulé depuis le démarrage) mesuré à la synchronisation : constant tant que l'horloge n'est pas réglée.
     * Si elle a avancé de +1 h, la différence vaut +1 h et l'écart diminue d'autant. Après un redémarrage la référence n'est plus
     * comparable (sameBoot = faux) : on garde le dernier écart connu jusqu'à la prochaine synchronisation.
     */
    static long adjust(long offset, long ref, long wallNow, long elapsedNow, boolean sameBoot) {
        if (ref == NO_REF || !sameBoot) return offset;
        return offset - ((wallNow - elapsedNow) - ref);
    }

    /** En dessous, l'écart est ignoré : la date du serveur n'est précise qu'à la seconde. */
    static final long THRESHOLD = 2000;

    /** Un échantillon : date annoncée par le serveur (arrondie à la seconde : +500 ms = milieu de la seconde) moins le milieu de l'aller-retour. */
    static long sample(long t0, long t1, long serverMs) { return serverMs + 500 - (t0 + t1) / 2; }

    /** Écart retenu parmi `n` échantillons : celui dont l'aller-retour est le plus court (le plus fiable), ignoré s'il est négligeable. */
    static long pick(long[] rtt, long[] off, int n) {
        int best = 0;
        for (int i = 1; i < n; i++) if (rtt[i] < rtt[best]) best = i;
        long m = off[best];
        return Math.abs(m) >= THRESHOLD ? m : 0;
    }

    /** Un écart de plus de 24 h n'est pas un fuseau mal annoncé : c'est une mesure douteuse (réponse mise en cache, etc.), on ne s'y fie pas. */
    static boolean plausible(long off) { return Math.abs(off) <= 24L * 3600000L; }

    /** L'écart a-t-il assez changé pour reprogrammer les alarmes ? */
    static boolean changed(long before, long after) { return Math.abs(after - before) > 5000; }

    /** Heure réelle d'après l'horloge du téléphone. */
    static long real(long wallNow, long offset) { return wallNow + offset; }

    /** Instant (horloge du téléphone) auquel programmer une alarme prévue à l'heure réelle `realMs`. */
    static long device(long realMs, long offset) { return realMs - offset; }
}
