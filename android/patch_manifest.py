"""Ajoute au projet Android généré par Bubblewrap le module « Adhan en arrière-plan ».
Usage : python3 patch_manifest.py <dossier du module app>  (ex. app/app)"""
import sys, re, pathlib
mod = pathlib.Path(sys.argv[1])
# mises en page natives (notification permanente) : android/res/layout -> app/src/main/res/layout
import shutil
src = pathlib.Path(__file__).resolve().parent / 'res' / 'layout'
if src.is_dir():
    dst = mod / 'src/main/res/layout'
    dst.mkdir(parents=True, exist_ok=True)
    for f in src.glob('*.xml'):
        shutil.copy(f, dst / f.name)
        print('layout copié :', f.name)
m = mod / 'src/main/AndroidManifest.xml'
s = m.read_text(encoding='utf-8')
if 'SyncActivity' in s:
    print('déjà modifié'); sys.exit(0)
wanted = ['SCHEDULE_EXACT_ALARM', 'RECEIVE_BOOT_COMPLETED', 'VIBRATE', 'POST_NOTIFICATIONS', 'INTERNET']   # INTERNET : lire le calendrier des Habous le soir de l'annonce
perms = '\n' + ''.join(f'    <uses-permission android:name="android.permission.{p}"/>\n'
                       for p in wanted if f'android.permission.{p}"' not in s)
s = re.sub(r'(<manifest[^>]*>)', lambda x: x.group(1) + perms, s, count=1)
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
        <receiver android:name="io.github.webnour2026.salat.AlarmReceiver" android:exported="false"/>
        <receiver android:name="io.github.webnour2026.salat.StopReceiver" android:exported="false"/>
        <receiver android:name="io.github.webnour2026.salat.ReminderReceiver" android:exported="false"/>
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
