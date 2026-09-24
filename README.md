# Prière — horaires, compte à rebours, Qibla, Adhan (PWA)

Application 100 % côté client (HTML/CSS/JS, sans build ni backend). Hébergeable telle quelle sur GitHub Pages ou Netlify, y compris dans un sous-dossier (tous les chemins sont relatifs).

## Structure
```
index.html          manifest.json        sw.js
css/style.css
js/app.js           orchestration, affichage, réglages, événements
js/api.js           fournisseur AlAdhan (remplaçable via setProvider)
js/prayer-times.js  cache mensuel, jour courant, prochaine prière
js/prayer-calc.js   calcul astronomique local (secours hors ligne)
js/countdown.js     compte à rebours = cible − maintenant (sans dérive)
js/clock.js         synchronisation de l'horloge (en-tête HTTP Date)
js/qibla.js         cap orthodromique + distance
js/compass.js       DeviceOrientation (iOS + Android), lissage, calibration
js/adhan.js         audio, vibration, notifications
js/location.js      GPS, recherche de ville (Nominatim), villes prédéfinies
js/i18n.js          français / العربية / English
icons/  audio/adhan/
```

## Précision
- Horaires calculés par l'API AlAdhan à partir de **latitude/longitude**, date, méthode et madhab (jamais à partir du nom de la ville). Paramètre `iso8601=true` : chaque heure arrive avec son fuseau, donc pas d'erreur d'heure d'été.
- Méthode par défaut : Maroc (21). Choix automatique selon le pays tant que l'utilisateur n'a pas fixé la méthode.
- Mois courant mis en cache (et le suivant à partir du 25). Hors ligne sans cache : calcul local, signalé à l'écran.
- Qibla depuis le nord géographique ; la déclinaison magnétique (réglages) corrige la boussole.

## Changer d'API
Écrire un objet `{ id, fetchMonth({lat,lng,year,month,method,school,signal}) }` qui renvoie
`[{ date:'YYYY-MM-DD', tz, times:{ Fajr: timestampMs, ... } }]`, puis `setProvider(monProvider)` dans `app.js`.

## Déploiement
Servir en HTTPS (obligatoire pour GPS, boussole, service worker). À chaque mise en ligne, incrémenter `VERSION` dans `sw.js`.

## Limites connues (navigateur)
- Adhan et notifications fiables seulement quand l'appli est ouverte. Fermée ou en veille, le système suspend la page ; aucune API web standard ne permet de programmer une alarme garantie. Pour cela : version Android native (ou TWA + module natif).
- iOS : l'audio exige un premier toucher ; les notifications web nécessitent iOS 16.4+ et l'appli installée sur l'écran d'accueil.
- Boussole : Firefox Android ne fournit pas le nord absolu ; l'angle en degrés reste affiché pour une boussole classique.

## PWABuilder / Google Play
- Manifest complet : `id`, icônes 96→512 + maskable + SVG, captures d'écran `narrow` et `wide`, raccourcis, `display_override`, `launch_handler`.
- `.nojekyll` à la racine (GitHub Pages).
- `twa/assetlinks.json` : modèle à compléter (voir `twa/LISEZ-MOI.md`).
- Captures dans `screenshots/` : à refaire si l'interface change (Play Console en exige au moins 2).
