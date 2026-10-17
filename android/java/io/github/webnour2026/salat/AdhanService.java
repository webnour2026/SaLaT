package io.github.webnour2026.salat;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;

/**
 * Joue l'Adhan avec son propre lecteur (flux « alarme ») au lieu du son de notification :
 * le fichier est joué en entier (Samsung et d'autres écourtent les sons de notification à ~20 s),
 * avec le volume des alarmes. En mode vibreur / silencieux, l'Adhan n'est joué que si l'utilisateur
 * l'a demandé (option « même en mode silencieux », cfg.al). Pendant un appel : pas d'Adhan.
 * Service de premier plan « lecture multimédia » : sa notification est celle de l'Adhan (bouton Arrêter).
 */
public class AdhanService extends Service {
    static final String EXTRA_SOUND = "sound", EXTRA_TITLE = "title", EXTRA_TEXT = "text", EXTRA_STOP = "stopLabel", EXTRA_VIB = "vib", EXTRA_ALWAYS = "always", EXTRA_VOL = "vol";
    static final String ACTION_STOP = "io.github.webnour2026.salat.ADHAN_STOP";
    private MediaPlayer player;
    private AudioManager audio;
    private AudioFocusRequest focus;

    /** Lance l'Adhan ; false si le service n'a pas pu démarrer (on retombe alors sur le son de notification). */
    static String iqKey; static long iqWhen;   // prière en cours : bouton « Rappel de l'Iqama »
    static boolean start(Context ctx, String sound, String title, String text, String stopLabel, boolean vib, boolean always, float vol) {
        if (Build.VERSION.SDK_INT < 26 || AlarmScheduler.rawId(ctx, sound) == 0) return false;
        Intent i = new Intent(ctx, AdhanService.class).putExtra(EXTRA_SOUND, sound).putExtra(EXTRA_TITLE, title)
                .putExtra(EXTRA_TEXT, text).putExtra(EXTRA_STOP, stopLabel).putExtra(EXTRA_VIB, vib).putExtra(EXTRA_ALWAYS, always).putExtra(EXTRA_VOL, vol);
        try { ctx.startForegroundService(i); return true; }
        catch (Exception e) { return false; }   // Android 12+ : démarrage en arrière-plan refusé (alarme non exacte)
    }

    static void stop(Context ctx) {
        try { ctx.stopService(new Intent(ctx, AdhanService.class)); } catch (Exception ignored) { }
    }

    /** Canal sans son (le son vient du lecteur), avec ou sans vibration. */
    static String channel(Context ctx, boolean vib, String label) {
        String id = "salati3_play" + (vib ? "_v" : "_nv");
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(id) == null) {
            NotificationChannel ch = new NotificationChannel(id, label, NotificationManager.IMPORTANCE_HIGH);
            ch.setSound(null, null);
            ch.enableVibration(vib);
            if (vib) ch.setVibrationPattern(new long[]{0, 400, 200, 400, 200, 800});
            nm.createNotificationChannel(ch);
        }
        return id;
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent in, int flags, int startId) {
        if (in == null || ACTION_STOP.equals(in.getAction())) { stopAll(); return START_NOT_STICKY; }
        String sound = in.getStringExtra(EXTRA_SOUND);
        boolean vib = in.getBooleanExtra(EXTRA_VIB, false), always = in.getBooleanExtra(EXTRA_ALWAYS, false);
        releasePlayer();

        Intent stopI = new Intent(this, StopReceiver.class).setAction("io.github.webnour2026.salat.STOP");
        android.app.PendingIntent stopPi = android.app.PendingIntent.getBroadcast(this, 3, stopI,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = AlarmScheduler.builder(this, channel(this, vib, AlarmScheduler.text(AlarmScheduler.config(this), "chAdhan", "Adhan")))
                .setContentTitle(in.getStringExtra(EXTRA_TITLE))
                .setContentText(in.getStringExtra(EXTRA_TEXT))
                .setCategory(Notification.CATEGORY_ALARM)
                .setDeleteIntent(stopPi)
                .addAction(new Notification.Action.Builder(null, in.getStringExtra(EXTRA_STOP), stopPi).build());
        if (iqKey != null && !"Sunrise".equals(iqKey)) b.addAction(IqamaReceiver.action(this, AlarmScheduler.config(this), iqKey, iqWhen));
        Notification n = b.build();
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(AlarmScheduler.NOTIF_ADHAN, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            else startForeground(AlarmScheduler.NOTIF_ADHAN, n);
        } catch (Exception e) { stopSelf(); return START_NOT_STICKY; }

        audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        boolean muted = audio.getRingerMode() != AudioManager.RINGER_MODE_NORMAL;
        boolean inCall = audio.getMode() == AudioManager.MODE_IN_CALL || audio.getMode() == AudioManager.MODE_IN_COMMUNICATION;
        if ((muted && !always) || inCall || sound == null) { done(); return START_NOT_STICKY; }   // notification (et vibration) seulement

        try {
            AudioAttributes aa = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
            focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(aa).build();
            audio.requestAudioFocus(focus);                   // la musique en cours se met en pause pendant l'Adhan
            player = new MediaPlayer();
            player.setAudioAttributes(aa);
            Uri u = AlarmScheduler.soundUri(this, sound);
            player.setDataSource(this, u);
            player.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
                @Override public void onCompletion(MediaPlayer mp) { done(); }
            });
            player.setOnErrorListener(new MediaPlayer.OnErrorListener() {
                @Override public boolean onError(MediaPlayer mp, int what, int extra) { done(); return true; }
            });
            float v = Math.max(0.05f, Math.min(1f, in.getFloatExtra(EXTRA_VOL, 0.8f)));   // volume de l'appli, appliqué au volume des alarmes
            player.setVolume(v, v);
            player.prepare();
            player.start();
        } catch (Exception e) { done(); }
        return START_NOT_STICKY;
    }

    /** Fin de l'Adhan : la notification reste affichée (« C'est l'heure de… »), le service s'arrête. */
    private void done() {
        releasePlayer();
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_DETACH); else stopForeground(false);
        stopSelf();
    }

    /** « Arrêter » : son coupé et notification retirée. */
    private void stopAll() {
        releasePlayer();
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        stopSelf();
    }

    private void releasePlayer() {
        try { if (player != null) { player.stop(); player.release(); } } catch (Exception ignored) { }
        player = null;
        try { if (audio != null && focus != null) audio.abandonAudioFocusRequest(focus); } catch (Exception ignored) { }
        focus = null;
    }

    @Override public void onDestroy() { releasePlayer(); super.onDestroy(); }
}
