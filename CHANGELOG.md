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
