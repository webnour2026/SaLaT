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

## [2.34.11] – 2026-10-22
### Retiré
- Accueil : bouton « اتجاه القبلة » sous les horaires (il n'apparaissait que quand la page défile) ; la Qibla reste dans son onglet.

## [2.34.10] – 2026-10-22
### Corrigé
- Carte « الأيام البيض » (accueil, cartes à partager) : les trois jours sont toujours affichés ; quatre jours avant, le 15 manquait.

## [2.34.9] – 2026-10-18
### Corrigé
- Calendrier : la ligne sur l'annonce officielle n'est plus coupée (retour à la ligne).
- Bloc « الحدث القادم » : les jours blancs n'y figurent plus (déjà surlignés dans la grille) ; seules les autres occasions.

## [2.34.8] – 2026-10-18
### Ajouté
- Calendrier, bandeau « مراقبة الهلال » : petite ligne sous la prévision, l'annonce officielle (vu / non vu) tombe le soir même
  de l'observation et s'affiche dans SaLaTi dès sa parution (Maroc).

## [2.34.7] – 2026-10-18
### Modifié
- Guide de découverte : nouvelle page « 📺 شاشة المسجد » ; Mode Mosquée complété (tuile rapide, bouton « تذكير بالإقامة ») ;
  croissant « même appli fermée » ; 1re page « مطابقة للجداول الرسمية » (pas d'affiliation suggérée avec le ministère).

## [2.34.6] – 2026-10-18
### Modifié
- Premier lancement : l'appli s'ouvre en arabe par défaut, même si le téléphone est en français (cas courant au Maroc) ;
  en anglais seulement si le téléphone est en anglais. Le bouton ع / FR / EN reste disponible ; les utilisateurs déjà
  installés gardent leur langue.

## [2.34.5] – 2026-10-18
### Modifié
- Appli Android : le lien « مواقيت الصلاة في كل مدن المغرب » (À propos) est masqué. La page des villes est un autre site :
  elle s'ouvrait dans un onglet avec barre d'adresse et bouton « جرّب تطبيق صلاتي », sans intérêt dans l'appli. Le lien reste
  dans la version web.

## [2.34.4] – 2026-10-17
### Ajouté
- Mention « صلاتي تطبيق مستقل لا علاقة له بوزارة الأوقاف… » (ar, fr, en) en bas de « À propos », dans le pied des pages
  des villes et dans la fiche Play ; ligne de l'écran de mosquée reformulée (« selon les tableaux du ministère »).

## [2.34.3] – 2026-10-17
### Corrigé
- Version web : l'Adhan pouvait retentir avec du retard (ex. 10 min) en revenant dans l'onglet, le navigateur ayant mis
  le son en attente pendant que l'onglet était en arrière-plan ou l'écran éteint. Dans ce cas, seule la notification
  est envoyée à l'heure, sans Adhan différé. (L'appli Android n'est pas concernée : son module joue l'Adhan à l'heure.)

## [2.34.2] – 2026-10-17
### Modifié
- Pages des villes déplacées de Netlify (crédits gratuits épuisés : chaque modification du dépôt redéployait le site)
  vers Cloudflare : Worker sans code « miqatsalati » qui sert les fichiers statiques (gratuit, requêtes illimitées),
  https://miqatsalati.webnour.workers.dev/. Dossier `netlify/` renommé `pages/`, `netlify.toml` supprimé ; publication
  par le travail « Pages des villes » (après chaque « Officiel » ou changement de pages/). Lien de l'appli mis à jour.

## [2.34.1] – 2026-10-17
### Modifié
- Délais d'Iqama unifiés : Mode Mosquée, écran de mosquée et bouton « تذكير بالإقامة » utilisent les mêmes délais, ceux
  réglés dans l'écran de mosquée (⚙). Par défaut Fajr 20 min (consigne du ministère), Maghrib 10 min, autres 15 min ;
  Maghrib de Ramadan toujours dès la fin de l'Adhan. Note du Mode Mosquée mise à jour. ⚠ Côté module Android
  (MosqueMode), effectif au prochain AAB (il garde 15 min pour le Fajr d'ici là).

## [2.34.0] – 2026-10-17 ⚠ nouvel AAB (native=22)
### Ajouté
- ⚠ Avis Google Play dans l'appli (In-App Review API) : la fenêtre « Noter SaLaTi » de Google Play, proposée une seule
  fois, sans question préalable, quand l'appli est installée depuis 7 jours et que l'Adhan a sonné au moins 10 fois,
  dont un dans les 6 dernières heures (`ReviewActivity`, compteur `firedN`). Bibliothèque `com.google.android.play:review`.
  AAB envoyé sur Google Play (test fermé) le 17/10/2026 : `NATIVE_LATEST = 22` (bandeau « mise à jour » pour les testeurs en 21).
- ⚠ Bouton « تذكير بالإقامة » dans la notification de l'Adhan : notification avec vibration à l'heure de l'Iqama de cette
  prière (délais de l'écran de mosquée, Joumou'a à part le vendredi ; sinon 15 min, Maghrib 10 min) (`IqamaReceiver`).
- ⚠ Tuile « وضع المسجد » des réglages rapides : active / désactive le Mode Mosquée (toutes les prières) d'un geste, sans
  ouvrir l'appli (`MosqueTile`). L'appli adopte ce choix à l'ouverture (`?mqn=&mqat=` ajoutés par LauncherActivity) ;
  une synchronisation plus ancienne que la tuile ne l'écrase pas (`mq.at`).

## [2.33.0] – 2026-10-17
### Ajouté
- **Écran de mosquée** (TV, tablette, PC) : bouton « 📺 شاشة المسجد » dans le Mode Mosquée, ou adresse directe
  `…/SaLaT/#ecran`. Grande horloge, ville, dates grégorienne et hégirienne ; Adhan et Iqama de chaque prière (délais
  réglables par la mosquée, Joumou'a à part le vendredi) ; compte à rebours du prochain Adhan puis de l'Iqama (bandeau doré,
  clignote la dernière minute) ; écran sombre « الصلاة قائمة » pendant la prière (durée réglable, 0 = non) ; bandeau
  tournant : annonce de la mosquée (texte libre), prochaines occasions et début de mois (« selon l'observation du
  croissant » tant que le ministère n'a pas annoncé), jours blancs, rappel du vendredi. Écran maintenu allumé, plein écran,
  boutons masqués après 4 s. Paysage : 6 colonnes ; portrait : 2 colonnes. Règles testées (scripts/test-screen.mjs).

## [2.32.3] – 2026-10-17
### Ajouté
- iPhone / iPad (Safari, hors appli installée) : bandeau « ثبّت صلاتي على الآيفون » et bouton « كيف؟ » qui montre les
  4 étapes (Partager → Sur l'écran d'accueil → ouvrir depuis l'icône → activer l'annonce du croissant), avec l'icône
  Partager d'iOS. Fermé, il revient après 30 jours.
- Annonce du croissant : bouton « السماح بالإشعارات » quand l'autorisation n'a pas encore été demandée (sur iPhone, la
  demande doit venir d'un geste) ; sur iPhone hors écran d'accueil, la note explique qu'il faut d'abord l'installer.

## [2.32.2] – 2026-10-17
### Modifié
- Annonce du croissant : sous l'option, l'état de l'inscription quand elle n'a pas abouti (notifications non autorisées,
  navigateur non compatible, erreur) pour aider l'utilisateur et le diagnostic.

## [2.32.1] – 2026-10-17
### Modifié
- Serveur des notifications en service (salati-push.webnour.workers.dev, projet Firebase salati-389f0) : ajouté à la CSP ;
  l'appli n'accepte que cette adresse de serveur.

## [2.32.0] – 2026-10-17
### Ajouté
- Annonce du croissant instantanée, appli fermée, pour la version web (navigateur Android, iPhone avec l'appli sur l'écran
  d'accueil, ordinateur) : notification push dès que le ministère annonce le début du mois (vu / non vu, date du 1er,
  vœux de Ramadan et de l'Aïd, date de l'Aïd al-Adha). Réglages → Rappels : « إعلان الهلال فورًا » (activé par défaut au
  Maroc) et bouton « تجربة الإشعار ». L'appli Android garde son module natif (pas de doublon).
- Serveur `worker/` (Cloudflare Worker, gratuit) : inscrit les appareils (jeton Firebase anonyme) aux sujets
  `hilal-ar/fr/en`, relit `data/habous.json` toutes les 2 min les soirs d'annonce et envoie une seule fois par mois ;
  le travail « Habous » le prévient aussitôt l'annonce publiée. Déployé par le travail « Notifications (serveur) ».
- Bibliothèque Firebase Messaging copiée dans `vendor/` (aucun script tiers chargé) ; CSP ouverte aux seuls hôtes
  d'inscription Firebase. Politique de confidentialité mise à jour.

## [2.31.2] – 2026-10-17
### Modifié
- Pages « مواقيت الصلاة في <ville> » déplacées sur Netlify (miqatsalati.netlify.app) : c'est cette adresse que Google indexe et
  affiche. Générées dans `netlify/` (pages, sitemap.xml, robots.txt, icônes) par le travail « Officiel » ; `netlify.toml`
  publie ce dossier tel quel. L'appli reste sur GitHub Pages ; les liens des pages pointent vers elle. Anciennes copies
  `mawaqit/` et `sitemap.xml` retirées de GitHub Pages (pas de contenu en double).

## [2.31.1] – 2026-10-17
### Ajouté
- Pages web « مواقيت الصلاة في <ville> » (mawaqit/, 191 localités + page d’accueil avec recherche) : horaires officiels du jour (prochaine prière, compte à rebours) et tableau du mois dans le HTML, villes proches, lien vers l’appli ; `sitemap.xml`. Régénérées par le travail « Officiel » (scripts/build-mawaqit.mjs). Lien depuis Réglages → À propos.
### Corrigé
- Service worker : seule l’adresse de l’appli (et index.html) ouvre l’appli ; les autres pages du site (pages des villes) s’affichent telles quelles.

## [2.31.0] – 2026-10-17 ⚠ nouvel AAB (version code 33, native=21)
### Corrigé
- L’Adhan s’arrêtait au bout d’une vingtaine de secondes sur Samsung (et d’autres) : il était joué comme un son de notification, que ces téléphones écourtent. Il est maintenant joué en entier par son propre lecteur (service « lecture multimédia », flux des alarmes), au volume réglé dans l’appli ; la musique en cours se met en pause pendant l’Adhan ; pas d’Adhan pendant un appel. Notification « C’est l’heure de… » inchangée, bouton « Arrêter ». Si le lecteur ne peut pas démarrer, retour au son de notification.
### Ajouté
- Option « L’Adhan même en mode vibreur ou silencieux » (désactivée par défaut : en vibreur, notification et vibration seulement, comme avant).
- Xiaomi, Oppo, Realme, OnePlus, Vivo, Huawei, Honor : les rappels à heure fixe des 12 h à venir (soir du 29 pour l’observation du croissant, vendredi, Aïd…) sont programmés comme un réveil ; rappels reprogrammés après chaque prière.
- Raccourcis de l’icône (appui long) : المواقيت, القبلة, التقويم.

## [2.30.0] – 2026-10-17 ⚠ nouvel AAB (version code 32, native=20)
### Ajouté
- Téléphones Xiaomi/Redmi/Poco, Oppo, Realme, OnePlus, Vivo/iQOO, Huawei et Honor (économiseur de batterie qui arrête les applis fermées) : l’Adhan et la fin du Mode Mosquée sont programmés comme un réveil (`setAlarmClock`), que ces systèmes n’annulent pas. Les autres téléphones (Samsung, Pixel…) gardent l’alarme habituelle.
- Écran « Pour ne jamais manquer l’Adhan » (module Android) : le réglage à faire selon la marque, avec un bouton qui ouvre l’écran « démarrage automatique » de la marque et un bouton « Batterie ». Ouvert : depuis Réglages → Adhan téléphone fermé ; une fois après l’activation sur les marques concernées ; et, sur tous les téléphones, quand un Adhan n’a pas sonné alors que le téléphone était allumé (au plus tous les 3 jours).

## [2.29.5] – 2026-10-17
### Ajouté
- Version web ouverte sur Android (navigateur ou installée depuis le site) : bandeau « L’appli Android complète arrive bientôt sur Google Play : l’Adhan même appli fermée, le Mode Mosquée et le widget. » Fermable (30 jours). Quand `PLAY_PUBLIC` passera à true : texte « Avec l’appli Android… » et bouton « Installer » vers Google Play. Jamais affiché dans l’appli Play ni sur iPhone.

## [2.29.4] – 2026-10-15
### Corrigé
- Aperçu du premier lancement : la diapositive « L’Adhan, même appli fermée » n’apparaît plus que dans l’appli Android (la version web, sur iPhone notamment, ne peut pas sonner appli fermée).

## [2.29.3] – 2026-10-15
### Modifié
- Lien des messages partagés pendant le test fermé : https://tinyurl.com/SaLaTi-web (version web) ; https://tinyurl.com/salati-app (Google Play) quand `PLAY_PUBLIC` passera à true.

## [2.29.2] – 2026-10-15
### Modifié
- Calendrier : la date grégorienne de chaque case est en couleur laiton (distincte du jour hégirien), sur une seule ligne.
- Images partagées (cartes, jour, mois) : le pied indique « … توقع وإعلان رؤية الهلال » puis « مجاني وبدون إعلانات » sur deux lignes ; même ajout dans le texte des messages (FR : prévision et annonce du croissant ; EN : crescent forecast and announcement).
- Tant que la fiche Google Play est en test fermé (`PLAY_PUBLIC = false` dans js/app.js) : étiquette « قريباً على Google Play / Bientôt sur Google Play » au lieu du badge officiel, et « جرّب صلاتي مجاناً » au lieu de « حمّل صلاتي مجاناً ». Passer `PLAY_PUBLIC` à true le jour de la publication.

## [2.29.1] – 2026-10-14
### Ajouté
- Aperçu des fonctionnalités au premier lancement (avant la demande de position) : horaires du ministère, Adhan appli fermée, Mode Mosquée (appli Android), croissant, Qibla et calendrier. Une diapositive à la fois, « Suivant » / « Passer », balayage du doigt ; en arabe, français et anglais. Revoir à tout moment : Réglages → À propos → « Découvrir l’application ». La demande d’autorisation des notifications suit l’aperçu.

## [2.29.0] – 2026-10-14 ⚠ module Android (native=19)
### Modifié
- Maghrib (Maroc) : l'effet de l'altitude sur le coucher était trop fort (k 0,028 → 0,0265, décalage 65 → 75 s). Ajusté sur Joumada I 1448 lu sur le site du ministère (191 localités) et sur 20 tableaux de délégations d'autres saisons (Muharram 1448, Rajab et Ramadan 1447 : Assoul, Zaouia Ahensal, Rissani, Oujda, Aknoul, Guelmim, Agadir, Biougra, Bab Berred, Smara, Tinghir, Boumalne Dadès, Oued Amlil, Laâyoune, Sidi Slimane, Sidi Ifni, Fam El Hisn). Maghrib identique à la minute : 93,4 → 95,1 % (Rabia II), 93,6 → 94,8 % (Joumada I) et 86,7 → 93,8 % (autres saisons) ; plus aucun écart au-delà d'une minute.
- Horaires officiels : le site du ministère (www.habous.gov.ma/prieres/) devient la source principale pour les 191 localités ; bilan de conformité (`data/conformite.json`) et calibrage proposé (`data/calibration.json`) à chaque passage.

## [2.28.6] – 2026-10-13
### Modifié
- Horaires officiels : les fichiers indiquent leur origine (`src` : `fm6oa` = Fondation Mohammed VI, 163 localités ; `habous` = site du ministère, 28 localités). Pour les tableaux de la Fondation, quand l'Asr diffère du calcul d'une minute exactement, l'Asr du calcul est gardé : le tableau du ministère de Rabat (Rabia II 1448) et celui de la Fondation sont identiques sauf l'Asr, 1 min plus tôt chez la Fondation 5 jours sur 30, et le calcul suit le ministère 30 jours sur 30. Les autres horaires restent ceux du tableau officiel ; rien ne change pour les tableaux du ministère.

## [2.28.5] – 2026-10-13
### Modifié
- Description du site et du manifeste : « horaires de prière conformes au ministère des Habous, prévision et annonce du croissant, Adhan, Qibla et calendrier hégirien » (au lieu de « précis par GPS »). Nom sur l'écran d'accueil inchangé : SaLaTi.

## [2.28.4] – 2026-10-13
### Modifié
- Calendrier : les jours blancs ne sont plus répétés dans la liste sous la grille (déjà visibles dans les cases colorées et la légende) ; la liste ne garde que les occasions (début du mois, fêtes, nuits) et repart du haut après la mise en page, sans ligne coupée.

## [2.28.3] – 2026-10-13
### Modifié
- Calendrier, écran ajusté : chaque occasion de la liste tient sur une ligne (titre · dates, avec points de suspension) au lieu de deux lignes coupées à moitié sous la carte « Prochaine occasion » ; la liste repart du haut à chaque mois et garde au moins une ligne visible ; carte « Prochaine occasion » plus compacte.

## [2.28.2] – 2026-10-13
### Modifié
- Calendrier : la prévision du croissant quitte la liste des occasions (où, sur écran ajusté, elle était coupée au défilement) pour une ligne à part, toujours visible sous la légende : « 🔭 Observation du croissant · 10 nov. · bonne (29 jours probables) ». La visibilité est en couleur et n'est jamais tronquée.
- L'occasion du jour n'est plus répétée dans la liste : elle est déjà dans la carte « Prochaine occasion ».

## [2.28.1] – 2026-10-13 ⚠ nouvel AAB (version code 30, native=18)
### Modifié
- Horaires officiels : si le site du ministère (version test) publie le nouveau mois avant fm6oa.org, il sert de relais pour les 191 localités (jours manquants seulement, sans écraser ceux de fm6oa.org). habous.gov.ma reste essayé en premier, dès que son robots.txt l'autorisera.
- Module Android au niveau 18 : le widget et les notifications calculent l'Asr comme l'appli (Soleil apparent), voir 2.28.0.

## [2.28.0] – 2026-10-13
### Modifié
- **Asr (Maroc) recalé sur les tableaux du ministère, toutes saisons** : les ombres sont mesurées sur le Soleil apparent (réfraction de Saemundsson à midi et à l'heure de l'Asr) et la déclinaison est prise 3 h après l'Asr (itéré). Vérifié sur 820 Asr relevés sur 23 tableaux officiels du ministère et des délégations (Chawwal 1446 → Joumada I 1448, de Tanger à Guelmim) : **88,5 % → 95,6 %** d'Asr identiques à la minute (hiver 63-78 % → 93-98 %) ; tableaux de la Fondation (Rabia II 2026, 191 localités) 83,9 % → 89,8 %. Les autres prières ne changent pas.

## [2.27.2] – 2026-10-13 ⚠ module Android (sans urgence : prochain AAB)
### Modifié
- Asr (Maroc) : marge de +3 s supprimée, l'Asr redevient exactement celui de PrayTimes.js (fichier présent sur fm6oa.org/prieres/, déposé le 21/04/2026). Asr identique : tableaux de la Fondation Rabia II 2026 (191 localités) 79,1 % → 83,9 % ; Joumada I 1448 (7 villes + 3 délégations) 12 → 9 écarts ; année officielle 2021 inchangée (88 %).

## [2.27.1] – 2026-10-13
### Modifié
- Prévision du croissant : durée de présence minimale ramenée de 48 à 35 min. Les tableaux officiels des délégations (Joumada I 1448 : Chefchaouen, El Jebha, Bab Berred) annoncent « الرؤية واضحة جنوبا » le 10/11/2026, pour 39 min de présence à Dakhla (hauteur 7,5°, arc de lumière 17°) ; SaLaTi indiquait « عسيرة ».
- Vérifié sur ces trois tableaux : 513/522 horaires identiques au calcul, 1 min d'écart au plus.

## [2.27.0] – 2026-10-13 ⚠ nouvel AAB (version code 29, native=17)
### Ajouté
- **Prévision astronomique de la visibilité du croissant**, pour tous les mois : le soir du 29, la notification de l'Asr (« 🌙 الليلة ترقّب هلال شهر … ») indique « 🔭 الحساب الفلكي: رؤية الهلال الليلة متعذرة / عسيرة / ممكنة / واضحة » et le nombre de jours probable, avec « والعبرة بالإعلان الرسمي ». Aussi dans le calendrier (« 🔭 مراقبة الهلال — … »).
- Calcul (js/moon.js) : positions du Soleil et de la Lune (Meeus), critères du manuel de « التوقيت » du ministère (3e année, leçon 22) : naissance avant le coucher, mekth ≥ 48 min, hauteur ≥ 7°, élongation 10° / 12° / 14°. Au Maroc, meilleur de 6 lieux (Tanger → Dakhla) ; ailleurs, le lieu de l'utilisateur.
- Vérifié : conjonction du 1er avril 2022 à 06:25 GMT comme le manuel ; sur les mois annoncés depuis janvier 2026, toutes les prévisions franches (impossible / possible / bonne) conformes au ministère.
- L'annonce de l'observation (Asr du 29) concerne désormais tous les mois ; la question du matin du 1er (hors Maroc) reste pour les 5 mois surveillés.

## [2.26.0] – 2026-10-13 ⚠ nouvel AAB (version code 28, native=16)
### Ajouté
- Hors Maroc (calendrier calculé) : le matin du 1er de Mouharram, Chaabane, Ramadan, Chawwal et Dhou al-Hijja, notification « 🌙 Ramadan a-t-il commencé aujourd'hui dans votre pays ? » avec 3 boutons (Oui, aujourd'hui · Non, demain · C'était hier). Un toucher ouvre SaLaTi et règle la correction de la date hégirienne. Pas de question si l'utilisateur a déjà corrigé depuis la veille.
### Corrigé
- Version du module Android à 2 chiffres (≥ 10) ignorée : le bandeau « mise à jour » et la mention « Android N » restaient sur une ancienne version, et le jour du 1er dans le « non vu » n'était jamais activé.

## [2.25.1] – 2026-10-12
### Modifié
- Horaires du mois (tableau, image partagée, texte) : comme les tableaux du ministère, tant que la fin du mois n'est pas proclamée, le 30e jour porte la mention « حسب نتيجة المراقبة » (selon l'observation du croissant). Il disparaît si le mois compte 29 jours, la mention disparaît s'il en compte 30.

## [données] – 2026-10-12
### Ajouté
- Horaires officiels pour les 28 localités absentes du widget fm6oa.org (Sahara, petits centres) : tableau mensuel du site du ministère des Habous, contrôlé ligne par ligne contre le calcul. Les 191 localités ont désormais leurs horaires officiels.

## [2.25.0] – 2026-10-12 ⚠ nouvel AAB (version code 27, native=15)
### Ajouté
- « Croissant non vu » pour **tous** les mois (plus seulement les 5 mois surveillés) : le soir du 29, après le communiqué, « لم يثبت هلال شهر جمادى الأولى — يستوفي شهر ربيع الآخر ثلاثين يومًا: غدًا متمّمه، وفاتح شهر جمادى الأولى يوم الثلاثاء إن شاء الله », même appli fermée.
- Le jour de la semaine du 1er du mois est écrit dans la notification (module ≥ 15 ; sinon « بعد غد »).
### Corrigé
- Textes traduits : une variable répétée (« {p} … {p} ») n'était remplacée qu'une fois.

## [2.24.0] – 2026-10-11 ⚠ nouvel AAB (version code 26, native=14)
### Ajouté
- Chaabane rejoint les mois surveillés (Mouharram, Chaabane, Ramadan, Chawwal, Dhou al-Hijja) : le 29 Rajab, « 🌙 الليلة ترقّب هلال شهر شعبان » à l'Asr, puis « لم يثبت هلال شهر شعبان — غدًا متمّم شهر رجب، وفاتح شهر شعبان بعد غد » si le croissant n'est pas vu, même appli fermée ; hors Maroc, rappel de vérifier l'annonce du pays.

## [2.23.1] – 2026-10-11 ⚠ nouvel AAB (version code 25, native=13)
### Modifié
- Soir d'annonce, à partir du coucher du soleil (Rabat) + 10 min : la tâche « Habous » relit chaque minute les sources rapides (flux MAP, SNRT, Hespress ar/fr, Google Actualités), toutes les sources à chaque 5e essai ; avant le coucher, toutes les 5 min. Chaque exécution surveille jusqu'à 4 h 30 (GitHub décale les tâches programmées) ; trois départs par jour.
- Sources : flux Hespress (ar, fr) et page « actualités » de Medi1 News (ar, sans flux RSS) ajoutés.
- Module Android : calendrier relu chaque minute (au lieu de 10) pendant la fenêtre « à surveiller » ; appli ouverte, idem.

## [2.23.0] – 2026-10-11 ⚠ nouvel AAB (version code 24, native=12)
### Ajouté
- Mode GPS : la position est revérifiée aussi à chaque retour dans l'appli (au plus toutes les 15 min), plus seulement au démarrage. À plus de ~2 km : nouvelle ville, nouveaux horaires, module Android resynchronisé, et le message « 📍 Nouvelle position : Marrakech — horaires mis à jour ». Si le GPS ne répond pas, l'ancienne position est gardée sans fenêtre d'erreur.
- Module Android : quand le téléphone change de fuseau horaire (voyage) et que les horaires enregistrés sont ceux d'un autre fuseau, notification « 🌍 Nouveau fuseau horaire — ouvrez SaLaTi pour mettre à jour les horaires de votre nouvelle ville », même appli fermée. Retirée d'elle-même au retour dans le fuseau d'origine. Le module ne lit jamais la position en arrière-plan.

## [2.22.1] – 2026-10-11
### Modifié
- Message de partage : retour à « حمّل صلاتي مجاناً » (sans « على أندرويد ») — le badge Google Play de la carte suffit.

## [2.22.0] – 2026-10-11
### Modifié
- Pied des cartes partagées (versets, douas, vœux), de la carte des horaires du jour et du tableau du mois : badge officiel « Disponible sur Google Play » dans la langue de l'appli (icons/badges, fichiers de Google téléchargés par le workflow « Badges Google Play ») à la place de la ligne « Google Play : SaLaTi ».
### Corrigé
- Pied des cartes en français et en anglais écrit de droite à gauche (point en tête de phrase, « صلاتي – SaLaTi » inversé).

## [2.21.5] – 2026-10-11
### Modifié
- Message de partage des cartes : « حمّل صلاتي مجاناً على أندرويد » / « Téléchargez SaLaTi gratuitement sur Android » / « Get SaLaTi for free on Android » (le lien mène à Google Play).

## [2.21.4] – 2026-10-11
### Modifié
- Politique de confidentialité : l'hébergeur est nommé (GitHub Pages, GitHub/Microsoft) sans l'adresse technique du site.

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
