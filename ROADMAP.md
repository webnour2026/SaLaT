# SaLaTi – idées pour les prochains AAB

Liste des améliorations retenues, à regrouper dans un même AAB avec d'autres options ou exclusivités SaLaTi.
⚠ = module Android (nouvel AAB, niveau `native` à augmenter).

## Retenu (prochain AAB) — ✅ faits dans l'AAB 2.34.0 (module 22)

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

## Objectif : la référence des horaires de prière et de l'annonce du croissant (plan du 17/10/2026)

1. **Production sur Google Play** : 12 testeurs actifs pendant 14 jours, puis demande d'accès à la production. Tout le reste en dépend.
2. **Pages « مواقيت الصلاة في <ville> »** (191 pages statiques générées depuis data/officiel, FR/AR) : ce que les gens
   cherchent chaque jour sur Google ; chaque page renvoie vers l'appli. Web seulement.
   ✅ 17/10/2026 : en ligne sur https://miqatsalati.webnour.workers.dev/ (Cloudflare, dossier `pages/`, régénéré chaque
   jour ; Netlify abandonné, crédits épuisés). Reste : nouvelle propriété Search Console + sitemap ; suivre l'indexation.
3. **Annonce du croissant instantanée pour tous** : petit serveur gratuit (Cloudflare Worker, relève chaque minute les soirs
   d'annonce) + notifications push (Firebase pour l'appli Android, Web Push pour iPhone/PC). Comptes Cloudflare + Firebase
   à créer ; politique de confidentialité à mettre à jour (jeton de notification, sans donnée personnelle).
   ✅ 17/10/2026 : code prêt (2.32.0, worker/, travail « Notifications (serveur) ») ; reste à poser les secrets GitHub,
   déployer, ajouter l'adresse du serveur à la CSP, puis tester avec les testeurs web/iPhone avant le 10/11.
4. **iPhone** : aide « Ajouter à l'écran d'accueil » (Safari) ; avec le point 3, notifications du croissant sur iPhone.
   ✅ 17/10/2026 (2.32.3) : bandeau + étapes ; bouton « السماح بالإشعارات ». Reste : essai sur un vrai iPhone.
5. ⚠ **Avis Play dans l'appli** (In-App Review API), demandé une fois, après une semaine d'usage et un Adhan bien reçu.
   ✅ 17/10/2026 : module 22, AAB 2.34.0 (code 34) envoyé sur Play (test fermé), NATIVE_LATEST = 22.
6. **Sécurité** : double authentification sur GitHub et sur le compte Play ; copie hors ligne de la clé de signature ;
   vérifier « Signature d'application par Google Play » ; politique CSP déjà testée, aucun traqueur.
   ✅ 17/10/2026 : historique du dépôt contrôlé (aucun secret ni clé), clés Firebase/Cloudflare seulement dans les secrets
   GitHub. Reste (utilisateur) : 2FA GitHub / Google / Cloudflare / Netlify, restreindre la clé Web Firebase au site,
   alertes Dependabot + secret scanning, copie hors ligne du keystore.
7. **Exclusivité : écran de mosquée** (TV / tablette) : horaires du jour, compte à rebours de l'Iqama, Joumou'a, annonce du mois.
   ✅ 17/10/2026 (2.33.0) : …/SaLaT/#ecran ; à faire essayer par une mosquée (délais d'Iqama réels, lisibilité à distance).
8. **AppGallery** (Huawei sans Google).
   ✅ 17/10/2026 : option « fallback = webview » du travail Android. Reste : compte développeur Huawei (vérification d'identité).

## Plus tard

- Publication sur **AppGallery** (Huawei sans Google Play).
- Le jour de la production : `PLAY_PUBLIC = true` dans `js/app.js` (badge officiel, « حمّل », lien Play, bandeau Android
  avec bouton « تثبيت ») et tinyurl.com/salati-app → fiche Play.
