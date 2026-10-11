"""Génère les mises en page du widget Android (android/res/layout/widget_*.xml) et son motif (drawable/widget_pattern.xml).
Usage : python3 scripts/gen-widget-layouts.py   — à relancer après toute modification de ce fichier.

Variantes : _ar (prière à droite, compte à rebours à gauche) et _ltr (l'inverse) ; Widget.java choisit selon la langue des noms.
Tailles : large (en-tête ville | date hégirienne + prière + compte à rebours + 5 horaires ; l'en-tête est masqué si le widget est bas),
compact (une rangée, assez large), tiny (une rangée, étroit : empilé) ; preview = aperçu figé dans la liste des widgets.
L'en-tête et la rangée des horaires sont en gauche → droite fixe : Widget.java y place lui-même ville/date et horaires selon la langue."""
import pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent / 'android' / 'res'
CREAM, SUB, GOLD, DIM = '#F4F1E6', '#BFD8CF', '#EFCB72', '#80BFD8CF'
# Les widgets ne peuvent pas utiliser les polices de l'appli (res/font ignoré par le lanceur) : polices système pour le texte,
# et le nom de la prière DESSINÉ en Reem Kufi par Widget.java (image w_prayer_img ; le texte w_prayer reste en secours).
LIGHT, MED = 'sans-serif-light', 'sans-serif-medium'
KUFI = MED
NS = 'xmlns:android="http://schemas.android.com/apk/res/android"'

def tv(id_, size, color, font=None, text=None, gravity=None, extra=''):
    a = [f'android:id="@+id/{id_}"', 'android:layout_width="wrap_content"', 'android:layout_height="wrap_content"',
         'android:includeFontPadding="false"', 'android:singleLine="true"', f'android:textColor="{color}"', f'android:textSize="{size}sp"']
    if font: a.append(f'android:fontFamily="{font}"')
    if text is not None: a.append(f'android:text="{text}"')
    if gravity: a.append(f'android:gravity="{gravity}"')
    if extra: a.append(extra)
    return '<TextView ' + ' '.join(a) + ' />'

def name_img(extra=''):
    return (f'<ImageView android:id="@+id/w_prayer_img" android:layout_width="wrap_content" android:layout_height="wrap_content" '
            f'android:adjustViewBounds="true" android:scaleType="fitCenter" android:visibility="gone" android:importantForAccessibility="no" {extra}/>')

def count(size, preview, color=CREAM):
    if preview: return tv('w_count', size, color, LIGHT, '−1:24:10')
    return (f'<Chronometer android:id="@+id/w_count" android:layout_width="wrap_content" android:layout_height="wrap_content" '
            f'android:includeFontPadding="false" android:singleLine="true" android:fontFamily="{LIGHT}" android:textColor="{color}" android:textSize="{size}sp" />')

def frame(body, pad='14dp'):
    return f'''<?xml version="1.0" encoding="utf-8"?>
<!-- GÉNÉRÉ par scripts/gen-widget-layouts.py — ne pas modifier à la main -->
<FrameLayout {NS} android:id="@+id/w_root" android:layout_width="match_parent" android:layout_height="match_parent" android:background="@drawable/widget_bg">
    <ImageView android:layout_width="match_parent" android:layout_height="match_parent" android:layout_margin="1dp" android:scaleType="centerCrop" android:src="@drawable/widget_pattern" android:importantForAccessibility="no" />
    {body}
</FrameLayout>
'''

S = dict(name=['الفجر', 'الظهر', 'العصر', 'المغرب', 'العشاء'], time=['05:06', '12:24', '15:36', '18:10', '19:21'])

def row(preview):
    out = []
    for i in range(5):
        k = 4 - i                      # aperçu en arabe : Fajr à droite
        on, past = preview and k == 1, preview and k < 1
        nc, tc = (GOLD, GOLD) if on else (DIM, DIM) if past else (SUB, CREAM)
        bg = 'android:background="@drawable/widget_pill" ' if on else ''
        out.append(f'''<LinearLayout android:id="@+id/w_s{i}" android:layout_width="0dp" android:layout_height="wrap_content" android:layout_weight="1" android:layout_marginStart="2dp" android:layout_marginEnd="2dp" {bg}android:gravity="center" android:orientation="vertical" android:paddingTop="5dp" android:paddingBottom="5dp">
                {tv(f"w_n{i}", 11, nc, None, S["name"][k] if preview else None)}
                {tv(f"w_t{i}", 14, tc, MED, S["time"][k] if preview else None, extra='android:layout_marginTop="2dp"')}
            </LinearLayout>''')
    return '\n            '.join(out)

def large(rtl, preview=False):
    side, other = ('right', 'left') if rtl else ('left', 'right')
    prayer = f'''<LinearLayout android:layout_width="0dp" android:layout_height="wrap_content" android:layout_weight="1" android:gravity="{side}" android:orientation="vertical">
                {tv('w_label', 11, SUB, None, 'الصلاة القادمة' if preview else None)}
                {tv('w_prayer', 30, CREAM, KUFI, 'الظهر' if preview else None, extra='android:layout_marginTop="2dp" android:ellipsize="end"')}
                {'' if preview else name_img('android:layout_marginTop="2dp" ')}
                {tv('w_time', 15, GOLD, MED, '12:24' if preview else None, extra='android:layout_marginTop="2dp"')}
            </LinearLayout>'''
    cnt = f'''<LinearLayout android:layout_width="wrap_content" android:layout_height="wrap_content" android:gravity="{other}" android:orientation="vertical">
                {tv('w_clabel', 11, SUB, None, 'بعد' if preview else None)}
                {count(32, preview)}
            </LinearLayout>'''
    middle = f'{cnt}\n            {prayer}' if rtl else f'{prayer}\n            {cnt}'
    return frame(f'''<LinearLayout android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical" android:paddingStart="16dp" android:paddingEnd="16dp" android:paddingTop="12dp" android:paddingBottom="10dp">
        <LinearLayout android:id="@+id/w_head" android:layout_width="match_parent" android:layout_height="wrap_content" android:layoutDirection="ltr" android:orientation="horizontal">
            {tv('w_left', 12, GOLD, MED, '29 ربيع الآخر 1448' if preview else None, 'left', 'android:layout_width="0dp" android:layout_weight="1"').replace('android:layout_width="wrap_content" ', '', 1)}
            {tv('w_right', 12, SUB, MED, 'مراكش' if preview else None, 'right', 'android:layout_width="0dp" android:layout_weight="1"').replace('android:layout_width="wrap_content" ', '', 1)}
        </LinearLayout>
        <LinearLayout android:layout_width="match_parent" android:layout_height="0dp" android:layout_weight="1" android:layoutDirection="ltr" android:gravity="center_vertical" android:orientation="horizontal">
            {middle}
        </LinearLayout>
        <ImageView android:layout_width="match_parent" android:layout_height="1dp" android:layout_marginBottom="6dp" android:src="@drawable/widget_rule" android:scaleType="fitXY" android:importantForAccessibility="no" />
        <LinearLayout android:id="@+id/w_row" android:layout_width="match_parent" android:layout_height="wrap_content" android:layoutDirection="ltr" android:orientation="horizontal">
            {row(preview)}
        </LinearLayout>
    </LinearLayout>''')

def compact(rtl):
    prayer = f'''<LinearLayout android:layout_width="0dp" android:layout_height="wrap_content" android:layout_weight="1" android:gravity="{'right' if rtl else 'left'}" android:orientation="vertical">
            {tv('w_prayer', 22, CREAM, KUFI, extra='android:ellipsize="end"')}
            {name_img()}
            {tv('w_time', 13, GOLD, MED, extra='android:layout_marginTop="1dp"')}
        </LinearLayout>'''
    cnt = count(26, False)
    body = f'{cnt}\n        {prayer}' if rtl else f'{prayer}\n        {cnt}'
    return frame(f'''<LinearLayout android:layout_width="match_parent" android:layout_height="match_parent" android:layoutDirection="ltr" android:gravity="center_vertical" android:orientation="horizontal" android:paddingStart="16dp" android:paddingEnd="16dp">
        {body}
    </LinearLayout>''')

def tiny(rtl):
    name, time = tv('w_prayer', 17, CREAM, KUFI) + '\n            ' + name_img(), tv('w_time', 13, GOLD, MED, extra='android:layout_marginStart="6dp" android:layout_marginEnd="6dp"')
    line = f'{time}\n            {name}' if rtl else f'{name}\n            {time}'
    return frame(f'''<LinearLayout android:layout_width="match_parent" android:layout_height="match_parent" android:gravity="center" android:orientation="vertical" android:paddingStart="10dp" android:paddingEnd="10dp">
        <LinearLayout android:layout_width="wrap_content" android:layout_height="wrap_content" android:layoutDirection="ltr" android:gravity="center_vertical" android:orientation="horizontal">
            {line}
        </LinearLayout>
        {count(22, False)}
    </LinearLayout>''')

def pattern():
    # étoiles à huit branches (deux carrés croisés), comme le fond de l'écran d'accueil de l'appli
    paths, r, s = [], 15, 15 * 1.4142
    for y in range(0, 230, 54):
        for x in range(-27 if (y // 54) % 2 else 0, 400, 54):
            paths.append(f'M{x - r},{y - r}h{2 * r}v{2 * r}h{-2 * r}z M{x},{y - s}L{x + s},{y}L{x},{y + s}L{x - s},{y}z')
    return f'''<?xml version="1.0" encoding="utf-8"?>
<!-- GÉNÉRÉ par scripts/gen-widget-layouts.py — motif d'étoiles du fond du widget -->
<vector {NS} android:width="360dp" android:height="200dp" android:viewportWidth="360" android:viewportHeight="200">
    <path android:pathData="{' '.join(paths)}" android:strokeColor="{GOLD}" android:strokeAlpha="0.06" android:strokeWidth="1" android:fillColor="#00000000" />
</vector>
'''

L = ROOT / 'layout'
for f in ('widget_large.xml', 'widget_compact.xml'):
    (L / f).unlink(missing_ok=True)
for rtl, suf in ((True, 'ar'), (False, 'ltr')):
    (L / f'widget_large_{suf}.xml').write_text(large(rtl), encoding='utf-8')
    (L / f'widget_compact_{suf}.xml').write_text(compact(rtl), encoding='utf-8')
    (L / f'widget_tiny_{suf}.xml').write_text(tiny(rtl), encoding='utf-8')
(L / 'widget_preview.xml').write_text(large(True, True), encoding='utf-8')
(ROOT / 'drawable' / 'widget_pattern.xml').write_text(pattern(), encoding='utf-8')
print('ok')
