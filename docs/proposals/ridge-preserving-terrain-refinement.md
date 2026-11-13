# Ridge-Preserving Terrain Refinement

> Proposition rangée le 2026-11-07 pour une discussion ultérieure. Ce n'est pas un contrat du projet : rien ici n'est validé ni implémenté.

_Document fondateur de fonctionnalité_

Statut : proposition d’architecture à valider | Cible : moteur planétaire Babylon.js / projection cube / déplacement GPU

## Décision fondatrice

Le niveau de subdivision spatiale d’une tuile ne doit pas être limité par le dernier LOD disponible du DEM. Au-delà de cette limite, le moteur doit raffiner les tuiles pour les textures et les objets sans inventer de données altimétriques, sans rééchantillonnage cumulatif et sans arrondir artificiellement les crêtes.

## 1. Contexte et problème

Le moteur utilise une pyramide implicite de tuiles en projection cube. La topologie des maillages est réutilisée ; les sommets sont déplacés dans le vertex shader depuis une texture d’élévation GPU. Les couches de texture et les objets peuvent nécessiter un LOD supérieur au dernier LOD du DEM (exemple : DEM LOD 15, subdivision spatiale LOD 20+).

Le raffinement actuel fonctionne, mais l’interpolation cubique des hauteurs produit des crêtes arrondies, des arêtes adoucies et une perte de lisibilité morphologique. Les causes possibles sont distinctes : lissage du noyau d’interpolation, absence de sommets sur les lignes de crête, filtrage texture GPU, dérive UV / précision numérique, rééchantillonnage successif et normales incohérentes.

## 2. Invariants de conception

- Séparer spatialLOD (subdivision et visibilité) de elevationLOD (résolution native de la source).

- Échantillonner directement la tuile DEM ancêtre ; ne jamais interpoler une interpolation.

- Une position géographique identique doit donner une altitude identique quel que soit le spatialLOD.

- Ne pas confondre restitution morphologique et création d’une précision topographique absente de la source.

- Assurer la continuité des hauteurs et du rendu entre tuiles et faces du cube.

- Préserver le pipeline de déplacement GPU et la topologie fixe dans la première itération.

## 3. Architecture proposée

### 3.1 Découplage des niveaux

| Sous-système       | Après le dernier DEM LOD                                 |
| ------------------ | -------------------------------------------------------- |
| Quadtree / cube    | Subdivision spatiale continue                            |
| Textures et objets | LOD indépendant et streaming continu                     |
| DEM                | Source native figée à son dernier LOD disponible         |
| Maillage GPU       | Subdivisé sans rééchantillonnage cumulatif               |
| Morphologie        | Caractéristiques préservées dans la limite du DEM source |

### 3.2 Échantillonnage dans le repère de l’ancêtre

Pour chaque vertex : calculer sa direction planétocentrique ; retrouver l’ancêtre DEM qui couvre ce point ; transformer les coordonnées dans le repère UV de cet ancêtre ; évaluer directement la hauteur source ; appliquer l’élévation selon la convention de surface du corps céleste. L’échantillonnage doit rester cohérent sur les frontières et les coins des faces cube.

### 3.3 Interpolateurs interchangeables

Fournir un mode bilinéaire de référence, le bicubique existant, un bicubique contraint (limitation des dépassements), puis un mode edge-aware et enfin ridge-aware. Un bicubique contraint limite les oscillations mais ne garantit pas à lui seul la préservation des crêtes. Le mode ridge-aware devra utiliser une géométrie de crête explicitement estimée.

### 3.4 Ridge Feature Map (phase avancée)

Prétraitement multiscale du DEM : gradient, courbures / Hessien, candidats de crêtes, orientation, force et confiance. Les lignes de partage des eaux doivent être distinguées des arêtes topographiques aiguës. Utiliser des marges de calcul (halo) et une réconciliation des segments traversant les frontières de tuiles. Stockage possible sous forme de textures auxiliaires et/ou polylignes vectorielles ; encodage sans perte ou à erreur quantifiée pour les données sensibles.

### 3.5 Maillage et normales

Une interpolation parfaite ne suffit pas si le maillage n’échantillonne aucun point de la crête. Première version : maillage fixe et diagnostic de densité. Version ultérieure : sommets contraints aux axes de crête ou topologie adaptative, seulement si les mesures démontrent le besoin. Les normales doivent dériver du même champ de hauteur que les positions, avec voisinage trans-tuile.

## 4. Pipeline GPU cible

1. Vertex → direction cube planétocentrique

1. Résolution de la tuile DEM ancêtre et transformation UV

1. Lecture du DEM natif et sélection de l’interpolateur

1. Correction ridge-aware optionnelle, explicitement bornée

1. Intersection rayon / ellipsoïde puis application de l’élévation

1. Position finale et normales cohérentes

## 5. Contrat de données indicatif

```json
{
  "spatialLOD": 20,
  "elevationLOD": 15,
  "elevationTileId": "<cube-face/level/x/y>",
  "interpolation": "ridge-aware",
  "resampleFromAncestor": true,
  "ridgeFeatures": {
    "enabled": true,
    "map": "ridge-map",
    "scalesMeters": [10, 25, 50, 100]
  }
}
```

Schéma conceptuel non normatif : adapter les identifiants, unités, formats de métadonnées et conventions de hauteur au catalogue des corps célestes.

## 6. Validation et mesures

Scènes synthétiques : crête en V inversé, arête oblique, sommet pointu et crête traversant une frontière cube. Scènes réelles : un DEM montagneux terrestre, puis des DEM lunaire et martien. Comparer spatialLOD 15, 17, 19 et 21 avec la même source d’altitude.

- Écart de hauteur à coordonnées géographiques fixes entre LOD : nul à la tolérance numérique définie.

- Déplacement latéral des axes de crête et écart de pente par rapport à la source de référence.

- Écart de normale, coutures aux frontières et stabilité pendant le morphing LOD.

- Coût GPU par vertex, bande passante des cartes auxiliaires et mémoire résidente.

- A/B bilinéaire vs bicubique, à densité de maillage identique et filtrage contrôlé.

## 7. Phases de réalisation

### P0 : Instrumentation

Visualiser les UV, footprints texels, normales, points de vertex, coordonnées ancêtres et écarts de hauteur.

### P1 : Correctif déterministe

Échantillonnage direct du DEM ancêtre ; comparaison bilinéaire/bicubique ; vérification des frontières.

### P2 : Morphologie

Cartes de crêtes multiscales et interpolateur ridge-aware optionnel ; benchmark qualité / GPU.

### P3 : Raffinement adaptatif

Étudier une topologie contrainte uniquement si les résultats de P2 restent limités par le placement des sommets.

### P4 : Généralisation

Validation multi-planétaire, métadonnées, tests de régression et documentation API.

## 8. Risques et décisions ouvertes

- Risque de sur-accentuation ou d’invention de relief : imposer un mode fidèle aux mesures et un mode visuel distinct.

- Interpolation anisotrope : contrôler les artefacts de direction, notamment aux bords du cube.

- Données source : un DEM à 5 m ne permet pas de retrouver fidèlement une arête sous-résolue.

- Décider si les cartes de crêtes sont pré-calculées côté service ou calculées à la demande.

- Définir les tolérances numériques, la précision des formats de hauteur et la stratégie de cache GPU.

## 9. Critère de réussite

À DEM constant, augmenter spatialLOD ne doit ni arrondir davantage les crêtes, ni déplacer les sommets caractéristiques, ni produire de discontinuité entre tuiles. Les améliorations ridge-aware doivent être mesurables, désactivables et ne pas être présentées comme une augmentation de résolution réelle.

### Premier test à exécuter

Sur une crête identifiée : figer le DEM ancêtre et le maillage, désactiver le filtrage implicite non maîtrisé, comparer bilinéaire et bicubique avec des normales identiquement calculées. Puis augmenter uniquement spatialLOD. Cette expérience permet d’isoler interpolation, densité de sommets et coordonnées UV avant de développer les cartes morphologiques.
