# Crevare 🔥

Application web mobile (PWA, hors-ligne) pour organiser l'entraînement entre **la maison** (poids du corps, élastiques, barre de traction), **Fitness Park**, **la piscine** et **l'extérieur**, avec un **suivi d'habitudes**.

Objectifs pris en charge, enchaînés en trois blocs :

| Bloc | Échéance par défaut | Priorités |
|---|---|---|
| 1 — SSA | ~3 mois | Natation 3×/sem : technique, apnée, canard, remorquage, simulation du test (100 m < 3:45) |
| 2 — Hyrox | ~9 mois | Course + stations (SkiErg, rameur, sled, wall balls, fentes, farmer carry), VMA, force jambes |
| 3 — Pompier | ~2 ans | Indicateurs ICP : Luc Léger, tractions/pompes, gainage, souplesse + natation |

Les dates se règlent dans **Réglages**.

## Fonctionnalités

- **Aujourd'hui** : compte à rebours des 3 objectifs, séance du jour, habitudes à cocher.
- **Semaine** : planning jour par jour, changement de séance en un geste (salle fermée, fatigue…).
- **Séance** : séries à valider, charges/reps/temps notés, rappel de la dernière performance, minuteur de repos (son + vibration).
- **Périodisation automatique** : 1 semaine sur 4 allégée + journée tests le samedi ; semaine d'affûtage avant chaque objectif.
- **Habitudes** : liste personnalisable, séries (🔥), grille des 4 dernières semaines.
- **Progrès** : régularité, carte d'activité, tests de référence (test SSA, apnée, tractions, pompes, gainage, Luc Léger, 1 km, rameur…) avec courbes et objectifs ; certains sont remplis automatiquement depuis les séances.
- **Données** : stockées sur le téléphone (localStorage), export/import JSON.

## Installation sur le téléphone

1. Héberger le dossier (aucune compilation) — par exemple GitHub Pages : *Settings → Pages → Deploy from a branch*, choisir la branche et `/ (root)`.
2. Ouvrir l'URL sur le téléphone puis **« Ajouter à l'écran d'accueil »** (Safari : bouton Partager ; Chrome : menu ⋮).

En local : `python3 -m http.server` puis ouvrir `http://localhost:8000`.

## Structure

```
index.html            coquille de l'app
css/style.css         styles (thème sombre/clair auto)
js/data.js            séances, planning par bloc, habitudes, tests  ← à modifier pour adapter le programme
js/app.js             logique, vues, stockage
sw.js                 cache hors-ligne
manifest.webmanifest  installation PWA
```

> Les séances sont des repères généraux, pas un avis médical. Fais valider ton aptitude par un médecin, et ne pratique jamais l'apnée seul.
