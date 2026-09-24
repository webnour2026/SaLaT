# assetlinks.json (TWA Android / Google Play)

Sans ce fichier, l'appli Android s'ouvre avec une barre d'adresse Chrome en haut.

1. Remplacez `package_name` par l'identifiant choisi dans PWABuilder.
2. Remplacez l'empreinte par la SHA-256 de la clé de signature.
   Si Google Play signe l'appli (Play App Signing), prenez celle de
   Play Console > Intégrité de l'appli > Certificat de la clé de signature.
   Vous pouvez mettre les deux empreintes : clé d'importation + clé Play.
3. Placez le fichier à la RACINE du domaine, dans `/.well-known/assetlinks.json`
   (tout en minuscules). Sur GitHub Pages avec une appli dans un sous-dossier
   (`webnour2026.github.io/SaLaTi/`), le fichier va dans le dépôt
   `webnour2026.github.io`, pas dans le dépôt de l'appli.
4. Le fichier `.nojekyll` doit exister à la racine de ce dépôt ; sinon GitHub Pages
   ignore le dossier `.well-known`.
5. Vérifiez : https://developers.google.com/digital-asset-links/tools/generator
