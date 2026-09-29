# Carte étudiante 3D — Anáhuac Campus Norte

Carte Three.js interactive des environs de l’Universidad Anáhuac México — Campus Norte : relief, bâtiments OpenStreetMap, commerces, équipements publics et sélection de logements étudiants.

## Lancer localement

```bash
./run.sh
```

Puis ouvrir `http://localhost:3002`.

## Fonctions principales

- bâtiments extrudés et lieux issus d’OpenStreetMap ;
- relief Copernicus DEM mis en cache ;
- éclairage piloté par l’heure ;
- annonces de locations étudiantes avec vérification de leurs sources ;
- recherche ponctuelle d’adresses dans les 10 km autour du campus ;
- repères personnels conservés dans le navigateur.

## Déploiement Render

Le fichier `render.yaml` décrit le Web Service. Depuis Render, choisir **New > Blueprint**, connecter ce dépôt puis valider la création du service. Render installe les dépendances avec npm, compile le site et fournit automatiquement son port au serveur.

Le système de fichiers d’une instance gratuite est temporaire : le cache de géocodage et les vérifications faites après le déploiement peuvent être réinitialisés lors d’un redémarrage. Les repères personnels restent conservés dans le navigateur de chaque utilisateur.

## Données et attribution

Données cartographiques © contributeurs OpenStreetMap, sous licence ODbL. Le géocodage ponctuel utilise Nominatim conformément à sa politique d’utilisation. Le relief provient de Copernicus DEM GLO-90 via Open-Meteo.

Les logements affichés sont une sélection informative. Prix et disponibilités doivent être confirmés directement auprès des annonceurs.
