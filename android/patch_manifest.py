"""Ajoute au projet Android généré par Bubblewrap le module « Adhan en arrière-plan ».
Usage : python3 patch_manifest.py <dossier du module app>  (ex. app/app)"""
import sys, re, pathlib
mod = pathlib.Path(sys.argv[1])
# mises en page natives (notification permanente) : android/res/layout -> app/src/main/res/layout
import shutil
# + description du widget : android/res/xml -> app/src/main/res/xml
# + polices du widget : android/res/font (*.ttf) -> app/src/main/res/font
for kind, pat in (('layout', '*.xml'), ('xml', '*.xml'), ('font', '*.ttf')):
    src = pathlib.Path(__file__).resolve().parent / 'res' / kind
    if src.is_dir():
        dst = mod / 'src/main/res' / kind
        dst.mkdir(parents=True, exist_ok=True)
        for f in src.glob(pat):
            shutil.copy(f, dst / f.name)
            print(kind, 'copié :', f.name)
m = mod / 'src/main/AndroidManifest.xml'
s = m.read_text(encoding='utf-8')
if 'SyncActivity' in s:
    print('déjà modifié'); sys.exit(0)
wanted = ['SCHEDULE_EXACT_ALARM', 'RECEIVE_BOOT_COMPLETED', 'VIBRATE', 'POST_NOTIFICATIONS', 'INTERNET',   # INTERNET : lire le calendrier des Habous le soir de l'annonce
          'ACCESS_NOTIFICATION_POLICY']   # Mode Mosquée : couper puis rétablir la sonnerie (accès « Ne pas déranger » accordé par l'utilisateur)
perms = '\n' + ''.join(f'    <uses-permission android:name="android.permission.{p}"/>\n'
                       for p in wanted if f'android.permission.{p}"' not in s)
s = re.sub(r'(<manifest[^>]*>)', lambda x: x.group(1) + perms, s, count=1)
# écrans « démarrage automatique » des marques (Android 11+ : visibilité des paquets)
queries = '    <queries>\n' + ''.join(f'        <package android:name="{q}"/>\n' for q in [
    'com.miui.securitycenter', 'com.miui.powerkeeper', 'com.coloros.safecenter', 'com.oppo.safe', 'com.oneplus.security',
    'com.vivo.permissionmanager', 'com.iqoo.secure', 'com.huawei.systemmanager', 'com.hihonor.systemmanager']) + '    </queries>\n'
if '<queries>' not in s: s = re.sub(r'(<manifest[^>]*>)', lambda x: x.group(1) + '\n' + queries, s, count=1)
comps = '''
        <!-- Adhan en arrière-plan (SaLaTi) -->
        <activity android:name="io.github.webnour2026.salat.SyncActivity"
            android:exported="true"
            android:excludeFromRecents="true"
            android:noHistory="true"
            android:theme="@android:style/Theme.Translucent.NoTitleBar">
            <intent-filter>
                <action android:name="android.intent.action.VIEW"/>
                <category android:name="android.intent.category.DEFAULT"/>
                <category android:name="android.intent.category.BROWSABLE"/>
                <data android:scheme="salati" android:host="sync"/>
            </intent-filter>
        </activity>
        <!-- « Pour ne jamais manquer l'Adhan » : réglage batterie / démarrage automatique selon la marque -->
        <activity android:name="io.github.webnour2026.salat.BatteryActivity"
            android:exported="true"
            android:excludeFromRecents="true"
            android:noHistory="true"
            android:theme="@android:style/Theme.Translucent.NoTitleBar">
            <intent-filter>
                <action android:name="android.intent.action.VIEW"/>
                <category android:name="android.intent.category.DEFAULT"/>
                <category android:name="android.intent.category.BROWSABLE"/>
                <data android:scheme="salati" android:host="battery"/>
            </intent-filter>
        </activity>
        <!-- Bouton « le mois a-t-il commencé aujourd'hui ? » (hors Maroc) -->
        <activity android:name="io.github.webnour2026.salat.AskActivity"
            android:exported="false"
            android:excludeFromRecents="true"
            android:noHistory="true"
            android:taskAffinity=""
            android:theme="@android:style/Theme.Translucent.NoTitleBar"/>
        <receiver android:name="io.github.webnour2026.salat.AlarmReceiver" android:exported="false"/>
        <receiver android:name="io.github.webnour2026.salat.StopReceiver" android:exported="false"/>
        <receiver android:name="io.github.webnour2026.salat.ReminderReceiver" android:exported="false"/>
        <receiver android:name="io.github.webnour2026.salat.MosqueReceiver" android:exported="false"/>
        <!-- Widget d'écran d'accueil : prochaine prière + compte à rebours -->
        <receiver android:name="io.github.webnour2026.salat.Widget"
            android:exported="false"
            android:label="SaLaTi">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE"/>
            </intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/salati_widget"/>
        </receiver>
        <receiver android:name="io.github.webnour2026.salat.BootReceiver" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED"/>
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED"/>
                <action android:name="android.intent.action.TIME_SET"/>
                <action android:name="android.intent.action.TIMEZONE_CHANGED"/>
                <action android:name="android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED"/>
            </intent-filter>
        </receiver>
'''
i = s.rfind('</application>')
s = s[:i] + comps + '    ' + s[i:]
m.write_text(s, encoding='utf-8')
print('AndroidManifest.xml modifié')
