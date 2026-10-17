# SaLaTi – idées pour les prochains AAB

Liste des améliorations retenues, à regrouper dans un même AAB avec d'autres options ou exclusivités SaLaTi.
⚠ = module Android (nouvel AAB, niveau `native` à augmenter).

## Retenu (prochain AAB)

- ⚠ **Tuile « Mode Mosquée » dans les réglages rapides** (volet tiré du haut de l'écran) : activer / désactiver le silence
  d'un geste, sans ouvrir l'appli — utile en entrant à la mosquée hors des heures de prière (Joumou'a, Tarawih, cours).
  Android : `TileService` + déclaration dans `patch_manifest.py`.
- ⚠ **Rappel de l'Iqama dans la notification de l'Adhan** : bouton « Rappel à l'Iqama » qui fait vibrer à l'heure de
  l'Iqama de cette prière (délais déjà connus du Mode Mosquée, `MosqueMath.iqamaMin`).

## À vérifier

- 10 novembre 2026 (29 Joumada al-Oula 1448) : avis d'observation du croissant puis annonce reçus appli fermée,
  chez 2–3 testeurs dont un Oppo / Xiaomi (module 21 : rappels en réveil sur ces marques).
- Assoul (2 800 m) : Maghrib identique ~70 % seulement, même sur les tableaux 2026 — formule du coucher en très haute altitude.
- Lever du soleil en hiver (Oujda, Aknoul, Bir Gandouz) : 1 min plus tôt chez le ministère — à confirmer avec le tableau
  de Rajab 1448 lu sur le site en décembre (191 localités).

## Plus tard

- Publication sur **AppGallery** (Huawei sans Google Play).
- Le jour de la production : `PLAY_PUBLIC = true` dans `js/app.js` (badge officiel, « حمّل », lien Play, bandeau Android
  avec bouton « تثبيت ») et tinyurl.com/salati-app → fiche Play.
