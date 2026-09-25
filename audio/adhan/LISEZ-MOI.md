# Fichiers Adhan

## Adhans libres téléchargés automatiquement
Workflow **« Télécharger les Adhans »** (onglet Actions → Run workflow) :

| Choix dans l'appli | Fichier | Source |
|---|---|---|
| Voix seule — Aaqib Azeez (par défaut) | aaqib.mp3 | Wikimedia Commons, CC BY-SA 4.0 |
| Médine — Mosquée du Prophète | madinah.mp3 | ejaz215, Wikimedia Commons, CC BY 3.0 |
| Maroc — Haut Atlas | morocco.mp3 | Iain McCurdy, Freesound, CC BY 4.0 |
| Adhan doux | adhan1.mp3 | Wikimedia Commons, CC0 |

Retirés : La Mecque (x2) et Mosquée Hassan II (trop de bruit de fond).

## Ajouter un Adhan libre
1. Déposez le fichier (MP3, WAV, M4A, OGG…) dans **audio/adhan/nouveaux/** sur GitHub.
2. Son nom devient le nom affiché : `Maroc-Fes.mp3` → « Maroc Fes ».
3. Le workflow « Convertir les Adhans en MP3 » le nettoie (début coupé sur la voix, volume égalisé),
   le range dans audio/adhan/ et met à jour `list.json` : il apparaît tout seul dans l'appli.

Uniquement des fichiers dont la licence permet l'usage dans une application
(CC0, CC BY, CC BY-SA, licence Pixabay…). Pas d'Adhans de YouTube ou d'autres applications.

## Adhans personnels
Chaque utilisateur peut importer ses propres fichiers : Réglages → Adhan → « Importer des Adhans ».
Ils restent sur son téléphone.
