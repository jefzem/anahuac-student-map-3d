# Décisions prises

## Périmètre

- J’ai interprété « l’école Anauac de Mexico » comme **Universidad Anáhuac México — Campus Norte**, Av. Universidad Anáhuac 46, Huixquilucan. C’est le campus explicitement relié à Interlomas par les annonces et l’adresse officielle.
- Centre cartographique : `19.404145, -99.260732` (coordonnées publiées par l’université). La scène couvre un disque de 10 km; les logements sont limités à 5 km.
- Après précision de la demande, seules les offres explicitement destinées aux étudiants ou décrites comme idéales pour les étudiants de l’Anáhuac sont conservées. Les appartements familiaux ou généralistes ont été retirés.

## Données immobilières

- Les annonces sont une sélection vérifiée le **29 septembre 2026**. Une annonce n’est jamais une garantie de disponibilité : chaque fiche indique de confirmer auprès de la source.
- Les prix sont affichés en MXN par mois. Les charges connues sont indiquées séparément.
- Les positions des annonces sont volontairement approximatives (résidence, rue ou quartier), car les portails ne publient pas toujours l’adresse exacte et il ne faut pas inventer un numéro de porte.
- Les données structurées se trouvent dans `data/listings.json`, avec le lien source de chaque offre.
- Le bouton « Mettre à jour les annonces » vérifie chaque URL source depuis le serveur local. Une page accessible reste active, une annonce explicitement retirée ou répondant 404/410 est masquée, et une source bloquant la vérification reste visible avec le statut « à confirmer ». Les prix ne sont jamais modifiés à partir d’un texte ambigu.

## Carte et performance

- Le récupérateur principal télécharge bâtiments et lieux d’OpenStreetMap via l’API Overpass et les met en cache dans `data/`. Le 29 septembre 2026, Overpass renvoyait des erreurs 504 même sur 500 m : le cache livré a donc été obtenu via l’API cartographique officielle OSM, depuis la même base, sur les 4 km autour du campus où se trouvent toutes les annonces. Le disque et les anneaux de navigation restent gradués jusqu’à 10 km. `pnpm fetch:osm` remettra à jour l’étendue complète par Overpass dès son rétablissement.
- Les hauteurs OSM sont utilisées quand elles existent. Sinon, une hauteur déterministe est estimée à partir du nombre d’étages ou du type de bâtiment, afin d’éviter un paysage plat sans prétendre à une mesure exacte.
- Pour garder une caméra fluide dans le navigateur, les empreintes sont simplifiées légèrement lors du prétraitement, puis regroupées en maillages. L’étendue reste 10 km.
- Les marqueurs « vie pratique » privilégient magasins, cafés, restaurants, bars, pharmacies, hôpitaux et transports utiles à la vie étudiante.
- Le relief utilise le modèle numérique de terrain Copernicus DEM GLO-90 fourni par l’API d’altitude Open-Meteo, échantillonné sur les 10 km et mis en cache dans `data/elevation.json`. À la demande de l’utilisateur, l’exagération verticale passe à 0,82 pour rendre les vallées et crêtes nettement perceptibles.
- Les commerces sont colorés en or et les bâtiments ou services publics en bleu. Leur catégorie provient exclusivement des tags OpenStreetMap (`shop`, `amenity`, `office`, `building`).
- Un clic sur le campus, un commerce ou un équipement public ouvre une vignette concise avec catégorie, distance, commentaire contextuel et lien de référence.
- Le formulaire d’adresse utilise une recherche OpenStreetMap Nominatim uniquement après validation par l’utilisateur, sans autocomplétion. Les réponses sont mises en cache, limitées au Mexique et refusées au-delà des 10 km visibles. Les adresses ajoutées restent dans le navigateur et peuvent être retirées depuis leur vignette.

## Direction visuelle

- Une ambiance « atlas nocturne étudiant » : fond bleu pétrole, bâtiments minéraux, repères citron/corail/cyan.
- Le curseur solaire pilote la couleur du ciel, la lumière directionnelle, l’ambiance et les fenêtres nocturnes.
- Une caméra orbitale avec inertie permet rotation, zoom et déplacement. Les fiches et filtres restent utilisables au clavier et sur mobile.

## Lancement

- `./run.sh` sert directement la version compilée sur `http://localhost:3002` avec un serveur Node autonome. Il ne dépend ni de npm, ni de Vite, ni de `node_modules`, ce qui évite les incompatibilités de modules natifs entre Windows et WSL.
- Les données ne sont pas re-téléchargées au lancement : elles restent en cache. `pnpm fetch:osm` actualise l’étendue complète via Overpass; `pnpm fetch:osm:fallback` reconstruit le cache central depuis l’API OSM officielle si Overpass est en panne.
