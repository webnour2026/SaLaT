# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Les dates précises ne sont consignées qu'à partir de la 2.12.16 ;
les versions antérieures portent seulement le mois. ⚠ = nécessite de reconstruire l'AAB (module Android).

## [2.12.21] – 2026-10-07
### Modifié
- Écran Cartes : la rangée « قريبًا » ne passe plus en tête dès le mercredi à cause de la Joumou'a (hebdomadaire). Pour la Joumou'a elle passe devant le jeudi et le vendredi ; pour les autres occasions (Achoura, début de mois, Ramadan, Aïds…), jusqu'à 2 jours avant.

## [2.12.20] – 2026-10-06
### Modifié
- Politique de confidentialité réécrite (français, arabe, anglais), alignée sur le code : AlAdhan et Nominatim (ce qui leur est envoyé, quand), téléchargements depuis GitHub (site, calendrier des Habous, horaires officiels, adhans, API GitHub, relecture de l'heure par le module Android), Google Fonts, permissions Android, partage des cartes, enfants. Mise à jour : 6 octobre 2026.
- Lien « Politique de confidentialité » dans Réglages → À propos ; page ajoutée au pré-cache hors ligne.
- Captures d'écran du manifeste (PWA) refaites avec le nouveau design : horaires, Qibla, calendrier, cartes, réglages, version large.

## [2.12.19] – 2026-10-06
### Ajouté
- Cartes d'occasion (rangée « قريبًا ») : introduction en tête des hadiths et doua, comme pour les hadiths et les doua : « قال رسول الله ﷺ » (Joumou'a ×2, Arafa, Achoura) et « مما علّمه رسول الله ﷺ من الدعاء » (Nuit du Destin). Les versets restent sans introduction.
- `test-cards-data.mjs` : plus aucun hadith ou doua d'une carte d'occasion ne peut être publié sans introduction.

## [2.12.18] – 2026-10-06
### Ajouté
- Doua prophétiques (catégorie « دعاء ») : une introduction en tête de carte, comme pour les hadiths.
  « مما دعا به رسول الله ﷺ » (9 doua que le Prophète ﷺ disait), « مما علّمه رسول الله ﷺ من الدعاء » (4 doua qu'il a enseignées),
  « قال رسول الله ﷺ في سيد الاستغفار » (1). Les doua coraniques et les versets restent sans introduction (pas de basmala en tête).
- `test-cards-data.mjs` : contrôle des introductions.

## [2.12.17] – 2026-10-06
### Ajouté
- Petit bip (880 Hz, 0,15 s, généré par WebAudio : aucun fichier) quand la boussole entre dans l'alignement sur la Qibla, avec la vibration existante. Une seule fois par alignement (hystérésis ±2° / ±4°).
- Réglages → Avancé → Boussole : interrupteur « Petit bip quand la boussole pointe vers la Qibla » (activé par défaut ; un bip d'aperçu à l'activation).
- `scripts/test-qibla-beep.mjs`.

## [2.12.16] – 2026-10-06
### Sécurité
- Politique de sécurité (CSP) en balise `<meta>` dans `index.html` : aucun script inline, aucun `eval`, hôtes externes limités à ceux réellement utilisés.
- Le script de démarrage (« vider le cache ») passe dans `js/boot-guard.js`.
### Ajouté
- `scripts/test-csp.mjs` (cohérence CSP / code / pré-cache), `scripts/run-tests.mjs` et `npm test`.
- Workflow GitHub `Tests` : syntaxe de tous les fichiers + tous les jeux de tests à chaque envoi de code.
- `CHANGELOG.md` ; README : sections « Tests » et « Sécurité (CSP) et dépendances externes ».

## [2.12.15] – 2026-10
### Modifié
- Cartes « soleil » et « marche » : affichage homogène (Kaaba toujours droite, boutons pleine largeur non rognés, étiquette d'angle dans une zone libre, dessins recadrés).
### Ajouté
- Réglage du nord avec le sens de marche (« أواجه اتجاه مشيي »), 3ᵉ repère du réglage manuel.

## [2.12.14] – 2026-10
### Ajouté
- Réglage manuel du nord pour les téléphones à gyroscope sans magnétomètre : face au nord ou face au soleil (azimut calculé), puis la boussole suit la rotation.
### Corrigé
- Quand seuls des événements d'orientation relatifs arrivent, le statut est « relatif » et non « bloqué ».

## [2.12.13] – 2026-10
### Ajouté
- « Qibla en marchant (GPS) » : le cap vient du sens de déplacement (GPS), avec consigne gauche/droite et bonhomme animé ; arrêt automatique après 3 min et en quittant l'écran.

## [2.12.12] – 2026-10
### Corrigé
- Message de la boussole sans mention d'iPhone (le navigateur Android peut aussi exiger un geste).
- Cadran coupé en haut quand « Plus de détails » est ouvert à la main : mise en page recalculée, contenu centré sans débordement vers le haut.

## [2.12.11] – 2026-10
### Ajouté
- Petit bonhomme animé (vue de dessus) dans la vérification par le soleil.

## [2.12.10] – 2026-10
### Modifié
- Soleil presque dans le dos (coucher du soleil) : « donnez-lui le dos puis pivotez de N° » au lieu de « 169° à gauche du soleil ».

## [2.12.9] – 2026-10
### Ajouté
- Sans capteur, « Plus de détails » s'ouvre tout seul (angle pour boussole classique, soleil) ; bouton « essayer la vérification par le soleil » ; conseil de nuit.
### Modifié
- Aide aux capteurs : plus de nom de site cité.

## [2.12.8] – 2026-10
### Ajouté
- Bouton « Comment activer les capteurs ? » (étapes Chrome pour l'appli installée ou le navigateur).
### Corrigé
- Le message ne renvoie plus à une barre d'adresse inexistante dans l'appli installée.

## [2.21.3] – 2026-10-11
### Corrigé
- Réglages → À propos → « Politique de confidentialité » rechargeait l'appli au lieu d'ouvrir la page : le service worker renvoyait l'écran principal pour toute page. Seules la racine et index.html donnent désormais l'appli ; les autres pages du site s'ouvrent (aussi hors ligne, elles sont pré-chargées). Lien « ← SaLaTi » en haut de la politique pour revenir.

## [2.21.2] – 2026-10-11
### Modifié
- Politique de confidentialité (fr, ar, en), mise à jour du 11 octobre 2026 : autorisation « Ne pas déranger » du Mode Mosquée (accordée par l'utilisateur) et widget d'écran d'accueil (aucune donnée envoyée).

## [2.21.1] – 2026-10-11
### Corrigé
- Appli Android : choisir un rappel « avant la prière » pouvait encore demander l'autorisation de notification du SITE (webnour2026.github.io). Dans l'appli, seule l'autorisation Android de SaLaTi est demandée ; toutes les notifications viennent du module SaLaTi.

## [2.21.0] – 2026-10-11
### Ajouté
- Hors Maroc (calendrier calculé) : le 29 au soir de Chaabane, Ramadan, Dhou al-Qi'da et Dhou al-Hijja (calcul), notification « Ce soir : observation du croissant » invitant à vérifier l'annonce officielle de son pays et, si elle diffère, à ajuster la correction (Réglages → Date hégirienne). Pas de « non vu » hors Maroc (aucune annonce lue).
### Modifié
- Note du calendrier selon la source : au Maroc « calendrier officiel (ministère des Habous), mis à jour automatiquement » ; ailleurs « dates calculées (Umm al-Qura), peuvent différer d'un jour selon l'annonce de votre pays ». L'ancienne note conseillait à tort une correction manuelle au Maroc.

## [2.20.2] – 2026-10-11 ⚠ nouvel AAB (version code 23, native=11)
### Ajouté
- 10 méthodes de calcul (toutes celles d'AlAdhan) : Koweït, Qatar, Jordanie, Malaisie (JAKIM), Indonésie (Kemenag), Singapour (MUIS), Russie, Portugal (Lisbonne), chiite (Qom), Téhéran — dans l'appli et dans le calcul de secours du module Android.
- Méthode proposée d'office pour ~40 pays (avant : 15) : Koweït → Koweït (au lieu de Golfe), Qatar → Qatar, Jordanie, Malaisie, Indonésie, Singapour, Brunei, Russie, Portugal, Iran, Machrek et Libye (Égypte), Yémen (Umm Al-Qura), Inde/Bangladesh/Afghanistan (Karachi), Azerbaïdjan (Diyanet) ; ailleurs, Ligue islamique mondiale.
- Workflow « Vérifier les méthodes » (scripts/verifier-aladhan.mjs) : calcul local comparé à AlAdhan sur 27 villes × 4 dates à chaque modification du calcul.
### Corrigé
- Calcul de secours hors ligne : marges officielles de la Turquie (Diyanet : lever −7, Dhuhr +5, Asr +4, Maghrib +7 min), de Dubaï (Dhuhr et Maghrib +3) et de Lisbonne (Dhuhr +5) — jusqu'ici 3 à 7 min d'écart avec AlAdhan.

## [2.19.1] – 2026-10-11 ⚠ nouvel AAB (version code 22, native=10)
### Corrigé
- Widget : les polices de l'appli n'étaient pas appliquées (un lanceur ignore les polices d'une appli dans un widget). Le nom de la prière est désormais dessiné en Reem Kufi dans une image (texte système en secours) ; chiffres en polices du système (fine pour le compte à rebours, medium pour les horaires). Polices Plex retirées de l'APK.
- Motif d'étoiles du fond plus discret.

## [2.19.0] – 2026-10-11 ⚠ nouvel AAB (version code 21, native=9)
### Modifié
- Widget redessiné aux couleurs et polices de l'appli : nom de la prière en Reem Kufi, chiffres en IBM Plex Sans Arabic (renommée « SaLaTi Sans », sous-ensemble intégré, licence OFL : android/fonts/), fond vert avec le motif d'étoiles de l'écran d'accueil, filet doré, prière et compte à rebours sur deux colonnes (prière à droite en arabe).
- Compte à rebours signé : « −5:26:38 » avant l'heure, « +04:21 » en doré juste après (avec « حان وقت صلاة » / « منذ »), puis la prière suivante.
- Trois formats selon la taille : grand (ville, date hégirienne, 5 horaires), une rangée (côte à côte), étroit 2 cases (empilé).
### Corrigé
- En-tête du widget : ville et date hégirienne collées au centre (alignement « début/fin » inversé par l'arabe) ; désormais aux deux extrémités.
- Mises en page générées par scripts/gen-widget-layouts.py.

## [2.18.2] – 2026-10-11
### Ajouté
- Réglages → À propos : la version du module Android installé s'affiche à côté de celle des écrans (« Version 2.18.2 · Android 8 »), pour savoir d'un coup d'œil si la mise à jour Google Play est installée.

## [2.18.1] – 2026-10-11
### Corrigé
- Bandeau « mise à jour disponible » : fermé avec ×, il restait caché 3 jours même quand une NOUVELLE version du module sortait entre-temps. La fermeture ne vaut plus que pour la version en cours.

## [2.18.0] – 2026-10-11 ⚠ nouvel AAB (version code 20, native=8)
### Ajouté
- Widget d'écran d'accueil Android (4 × 2 par défaut, redimensionnable) : prochaine prière avec compte à rebours en direct, les 5 horaires du jour (prochaine prière en doré, prières passées estompées), ville et date hégirienne en grand format ; petit format (une rangée) : prière + compte à rebours. Juste après l'heure : « منذ » et temps écoulé, comme la notification permanente.
- Fonctionne appli fermée (horaires déjà envoyés au module, officiels compris), sans service ni mise à jour chaque seconde : compte à rebours tenu par Android, rafraîchi à chaque prière (alarme non réveillante), à chaque synchronisation et au redémarrage. Un appui ouvre l'appli.

## [2.17.1] – 2026-10 ⚠ nouvel AAB (version code 19, native=7)
### Ajouté
- Adhans intégrés à l'appli : « مغربي، أنس التازي » (par défaut) et « أذان — القارئ محمد سراج الإسلام ».

## [2.17.0] – 2026-10
### Modifié
- « مغربي، أنس التازي » devient l'Adhan par défaut (accord écrit d'Anas Tazi, 10/10/2026). Tant que son fichier n'est pas intégré, l'appli joue « Aaqib » à la place.
### Retiré
- « أذان مغربي » (adhan-moroccan) : remplacé par l'Adhan d'Anas Tazi, dont les droits sont connus.
### Ajouté
- Adhans prêts à être convertis dès le dépôt de leur fichier dans audio/adhan/sources : Anas Tazi, Qari MD Sirajul Islam.

## [2.16.0] – 2026-10 ⚠ nouvel AAB (version code 18, native=6)
### Modifié
- « أذان مغربي » (Adhan marocain) : nouveau nom, et Adhan par défaut (nouvelles installations, secours si un son manque).
- Adhan court : 40 s au lieu de 20 s (appli ouverte et appli fermée).
### Retiré
- « Atlas » (morocco) et « Adhan moroccan2 » : qualité insuffisante. Ceux qui les avaient choisis passent à l'Adhan marocain.

## [2.15.0] – 2026-10 ⚠ nouvel AAB (version code 17, native=5)
### Ajouté
- Deux Adhans de Doha (Qatar, domaine public, Internet Archive) : « أذان الدوحة » et « أذان الفجر (الصلاة خير من النوم) ».
- L'Adhan du Fajr n'est proposé que pour le Fajr et ne sonne jamais à une autre prière ; « Doha » choisi pour toutes les prières prend sa version du Fajr au Fajr.

## [2.14.3] – 2026-10
### Corrigé
- Cartes : l'aperçu des versets (liste et « عرض الكل ») utilise la police Warsh ; ses signes propres s'affichaient en carrés vides.

## [2.14.2] – 2026-10
### Corrigé
- Bandeau de mise à jour resté affiché après la mise à jour : l'appli rouvre la page existante, la nouvelle adresse de lancement est maintenant lue (launchQueue). Le module mis à jour reçoit aussi sa configuration au toucher suivant.

## [2.14.1] – 2026-10 ⚠ nouvel AAB (version code 16)
### Ajouté
- Bandeau « نسخة جديدة من SaLaTi متوفرة — تحديث » quand le module Android installé est plus ancien que le dernier publié ; le bouton ouvre la fiche Google Play. Fermable (rappel 3 jours plus tard).
- Version du module transmise par l'adresse de démarrage (`native=4`). **À chaque changement du module Android : augmenter `native=` dans le workflow Android ET `NATIVE_LATEST` dans js/app.js.**

## [2.14.0] – 2026-10 ⚠ nouvel AAB à publier (module Android)
### Modifié
- Rappels du croissant (observation, « vu », « non vu », début de mois, Aïds) **autonomes** : le module Android retient le dernier début de mois officiel, lit les annonces du ministère le soir du 29 et prépare lui-même le mois suivant — même si l'appli n'est plus jamais ouverte, comme l'Adhan.
- Sans réseau le soir de l'annonce : relecture le surlendemain, sinon mois de 30 jours supposé, corrigé à la lecture suivante.
- Mode Mosquée : l'Iqama du Maghrib de Ramadan reste juste au-delà des 31 jours envoyés par la page.

## [2.13.2] – 2026-10
### Ajouté
- Mouharram, Ramadan, Chawwal, Dhou al-Hijja : notification « الليلة ترقّب هلال شهر … » à l'Asr du 29 ; puis, si le croissant n'est pas vu, « لم يثبت هلال شهر … » le soir même (le mois en cours compte 30 jours). Fonctionne appli fermée avec le module actuel (pas de nouvel AAB).
- Veille du 1er Mouharram : « غدًا فاتح محرم — رأس السنة الهجرية ».

## [2.13.1] – 2026-10
### Modifié
- Bouton du Mode Mosquée : libellé « المسجد » sous l'icône, pour le distinguer des réglages.

## [2.13.0] – 2026-10 ⚠ nouvel AAB à publier (module Android)
### Ajouté
- **Mode Mosquée** (وضع المسجد) : bouton mosquée dans l'en-tête, deux choix « هذه الصلاة فقط » / « كل الصلوات », durée réglable (25 min par défaut, pas de 5 min, 10 à 90 min).
  Après l'Adhan, le module Android coupe les sonneries (silencieux avec l'accès « Ne pas déranger », sinon vibreur), puis remet exactement l'état d'avant (sonnerie, vibreur, Ne pas déranger) — sauf si l'utilisateur l'a changé entre-temps.
  Fonctionne appli fermée, survit au redémarrage, une seule alarme par étape (pas de doublon). Notification « وضع المسجد مفعّل » avec compte à rebours et bouton « إعادة الرنين الآن ».
- Écran **الإقامة** 15 min après l'Adhan (Maghrib : 10 min ; Maghrib de Ramadan : dès la fin de l'Adhan), puis écran **الصلاة** pendant 5 min ; la période de silence couvre toujours la prière.
- Badge d'état sur l'accueil et ligne « وضع المسجد — مفعّل » dans les réglages.
### Modifié
- Appli Android : plus aucune notification web (« webnour2026.github.io ») — tout passe par le module SaLaTi, activé automatiquement au premier toucher. Supprime les doubles notifications (Joumou'a, rappels).
- Rappel du vendredi à **09:30** (heure du lieu).
- Puce « critères des Habous » retirée de l'en-tête ; le bouton « mode silencieux » de l'en-tête est remplacé par le Mode Mosquée (le mode silencieux reste dans Réglages → Adhan).

## [2.12.7] – 2026-10
### Corrigé
- Barre de défilement qui clignotait sur les mois de 6 lignes du calendrier (cases réduites, ajustement re-vérifié à chaque mois).

## [2.12.6] – 2026-10
### Modifié
- Calendrier : seuls les événements à venir sont listés sous la grille.

## [2.12.5] – 2026-10
### Modifié
- Doua du croissant : texte du Tirmidhi 3451 (« باليمن »), identique sur la carte et dans les rappels (test d'identité).

## [2.12.4] – 2026-10
### Ajouté
- « فاتح الشهر » : occasion de chaque mois hégirien, carte dédiée avec la doua du croissant, prochain événement du calendrier.

## [2.12.3] – 2026-10
### Ajouté
- Cartes de versets : mention « برواية ورش عن نافع — العدّ المدني الأخير المعتمد في المصحف المغربي », note dans la liste, source dans « À propos ».

## [2.12.2] – 2026-10
### Modifié
- Bandeau d'écart d'horloge plus court et fermable (24 h).

## [2.12.1] – 2026-10
### Modifié
- Texte coranique des cartes plus grand et plus épais, marges élargies.

## [2.12.0] – 2026-10
### Modifié
- Versets en **riwaya de Warsh 'an Nāfiʿ**, décompte médinois récent (6214 versets, comme le Mushaf Mohammedi) ; texte du Complexe du Roi Fahd, police KFGQPC Warsh.
- 331 versets orientés vers tawhid, bonne nouvelle et Paradis, louange, patience, miséricorde, espoir ; 114 numéros de verset changent par rapport à Hafs.
- Test automatique : chaque texte coranique se retrouve dans les versets Warsh de sa référence.

## [2.11.8] – 2026-10 ⚠
### Corrigé
- Alarme de l'Adhan en retard d'une heure quand le réseau mobile impose un mauvais fuseau : le module Android mesure lui-même l'heure réelle (en-tête `Date` du site) au démarrage, avant chaque prière et après chaque alarme. Garde-fous : mesure bornée à 24 h, une seule tentative au démarrage.

## 2.10.0 – 2.11.7 – 2026-10
Refonte complète de l'interface : accueil, réglages en 6 pages, Qibla à cadran unique, cartes à partager (carrousels d'aperçus), calendrier, accessibilité (cibles ≥ 44 px, contrastes AA), fuseau légal du Maroc, catégories de cartes (versets / hadiths / doua).
