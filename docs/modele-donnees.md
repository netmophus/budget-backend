# Modèle de données — MIZNAS

> Modèle dimensionnel cible du Module Budgétaire Bancaire UEMOA.
> Aligné sur la section « Architecture technique recommandée » des
> spécifications V1.0 (avril 2026) et sur le PCB UMOA.

Ce document décrit le **QUOI** : tables, colonnes, relations, règles
d'historisation. Le **COMMENT** (DDL SQL exact, migrations TypeORM)
relève des migrations versionnées (cf. `docs/conventions.md`).

---

## Sommaire

1. [Principes](#1-principes)
2. [Vue d'ensemble (schéma)](#2-vue-densemble-schéma)
3. [Dimensions](#3-dimensions)
4. [Tables de faits](#4-tables-de-faits)
5. [Tables de référentiel et de support](#5-tables-de-référentiel-et-de-support)
6. [Stratégie SCD type 2](#6-stratégie-scd-type-2)
7. [Index et performance](#7-index-et-performance)
8. [Conventions](#8-conventions)
9. [Volumétrie cible](#9-volumétrie-cible)
10. [Évolutions prévues](#10-évolutions-prévues)

---

## 1. Principes

- **Modèle dimensionnel en étoile** (*star schema*). Chaque table de
  faits est entourée de ses dimensions, sans imbrication (pas de
  *snowflake* généralisé). Les hiérarchies internes aux dimensions
  (structure, produit) sont gérées par auto-référence et non par
  éclatement en sous-tables.
- **Séparation stricte dimensions / faits** :
  - les dimensions portent le **contexte métier** (qui, quoi, où, quand) ;
  - les faits portent les **mesures numériques** (combien) et les
    clés étrangères vers les dimensions.
- **Historisation SCD type 2** sur les axes structurants : on conserve
  les versions successives d'une entité plutôt que d'écraser. Un fait
  pointe toujours vers la version de dimension valide à sa date métier.
- **Préfixes de tables** :
  - `dim_` — dimensions du modèle en étoile (avec ou sans SCD2)
  - `fait_` — tables de faits
  - `ref_` — référentiels purs sans historisation (paramètres,
    nomenclatures techniques)
  - `bridge_` — tables de liens *many-to-many* (allocations,
    rattachements multiples)
- **Surrogate keys** : toutes les dimensions exposent un `id` technique
  (`bigint generated always as identity`) qui sert de clé étrangère
  dans les faits. Le code métier (*business key*) reste stable
  inter-versions ; le `id` change à chaque nouvelle version SCD2.
- **Référentiel pivot** : tous les montants sont stockés dans la
  devise de l'opération **et** convertis en FCFA via `ref_taux_change`,
  pour permettre les agrégations consolidées sans recalcul à la
  volée.

---

## 2. Vue d'ensemble (schéma)

Le modèle s'organise autour de deux faits centraux pour le MVP —
`fait_budget` et `fait_realise` — et de deux faits complémentaires —
`fait_capex` et `fait_bilan`. Tous partagent le même socle dimensionnel.

```
                            ┌──────────────┐
                            │  dim_temps   │
                            └──────┬───────┘
                                   │
        ┌──────────────┐    ┌──────┴───────┐    ┌──────────────┐
        │ dim_structure├────┤              ├────┤  dim_compte  │
        └──────────────┘    │              │    └──────────────┘
        ┌──────────────┐    │              │    ┌──────────────┐
        │   dim_centre ├────┤ fait_budget  ├────┤  dim_produit │
        │_responsabili-│    │              │    │              │
        │     te       │    │ fait_realise │    └──────────────┘
        └──────────────┘    │              │    ┌──────────────┐
        ┌──────────────┐    │ fait_capex   ├────┤  dim_segment │
        │dim_ligne_    ├────┤              │    └──────────────┘
        │   metier     │    │ fait_bilan   │    ┌──────────────┐
        └──────────────┘    │              ├────┤  dim_devise  │
        ┌──────────────┐    │              │    └──────────────┘
        │  dim_version ├────┤              │
        └──────────────┘    └──────┬───────┘
                                   │
                            ┌──────┴───────┐
                            │ dim_scenario │
                            └──────────────┘
```

Représentation équivalente en mermaid (lisible sur GitHub/GitLab) :

```mermaid
erDiagram
    fait_budget }o--|| dim_temps : fk_temps
    fait_budget }o--|| dim_compte : fk_compte
    fait_budget }o--|| dim_structure : fk_structure
    fait_budget }o--|| dim_centre_responsabilite : fk_centre
    fait_budget }o--|| dim_ligne_metier : fk_ligne_metier
    fait_budget }o--|| dim_produit : fk_produit
    fait_budget }o--|| dim_segment : fk_segment
    fait_budget }o--|| dim_devise : fk_devise
    fait_budget }o--|| dim_version : fk_version
    fait_budget }o--|| dim_scenario : fk_scenario
    fait_realise }o--|| dim_temps : fk_temps
    fait_realise }o--|| dim_compte : fk_compte
    fait_realise }o--|| dim_structure : fk_structure
    fait_realise }o--|| dim_centre_responsabilite : fk_centre
    fait_capex  }o--|| dim_temps : fk_temps
    fait_bilan  }o--|| dim_temps : fk_temps
    ref_taux_change }o--|| dim_devise : fk_devise
    ref_taux_change }o--|| dim_temps : fk_temps
```

Lecture : le grain de `fait_budget` est **(temps × compte × structure ×
centre × ligne_métier × produit × segment × devise × version ×
scénario)**. Une ligne par combinaison unique, par mois.

---

## 3. Dimensions

### 3.1 dim_temps

Calendrier complet, granularité jour. Pré-rempli sur 10 ans glissants.

| Colonne                | Type      | Contraintes              | Description                                      |
|------------------------|-----------|--------------------------|--------------------------------------------------|
| id                     | bigint PK | identity                 | Surrogate key                                    |
| date                   | date      | NOT NULL, UNIQUE         | Date métier                                      |
| annee                  | int       | NOT NULL                 | Année calendaire (ex. 2026)                      |
| trimestre              | int       | NOT NULL, CHECK 1–4      | Trimestre civil                                  |
| mois                   | int       | NOT NULL, CHECK 1–12     | Mois civil                                       |
| jour                   | int       | NOT NULL, CHECK 1–31     | Jour du mois                                     |
| semaine_iso            | int       | NULL                     | N° de semaine ISO 8601                           |
| jour_ouvre             | boolean   | NOT NULL                 | Jour ouvré bancaire selon le calendrier BCEAO (régional UEMOA). Pour les fériés nationaux spécifiques à un pays, utiliser un calendrier dérivé via `ref_calendrier_pays` (V2). |
| est_fin_de_mois        | boolean   | NOT NULL                 | Dernier jour calendaire du mois (pour alignement avec les arrêtés comptables BCEAO) |
| est_fin_de_trimestre   | boolean   | NOT NULL                 | Dernier jour calendaire du trimestre             |
| est_fin_d_annee        | boolean   | NOT NULL                 | Dernier jour calendaire de l'année               |
| exercice_fiscal        | int       | NOT NULL                 | Exercice fiscal de rattachement                  |
| libelle_mois           | varchar   | NOT NULL                 | Libellé court du mois (ex. « Janv. 2026 »)       |

> Pas de SCD2 : le calendrier est figé une fois généré.

> Le besoin du dernier jour ouvré du mois (utile pour l'horodatage des
> opérations effectives) reste accessible en requête :
> `SELECT MAX(date) FROM dim_temps WHERE jour_ouvre = true GROUP BY annee, mois`.
> Si ce besoin se matérialise au Lot 5 ou plus tard, ajouter une colonne
> `est_dernier_ouvre_mois` sera une extension non-cassante.

---

### 3.2 dim_structure (SCD2)

Hiérarchie organisationnelle multi-niveaux : entité juridique → branche
→ direction → département → agence.

| Colonne                | Type      | Contraintes              | Description                                      |
|------------------------|-----------|--------------------------|--------------------------------------------------|
| id                     | bigint PK | identity                 | Surrogate key (change à chaque version SCD2)     |
| code_structure         | varchar   | NOT NULL                 | Business key — stable inter-versions             |
| libelle                | varchar   | NOT NULL                 | Libellé long de la structure                     |
| libelle_court          | varchar   | NULL                     | Libellé court pour restitutions                  |
| type_structure         | varchar   | NOT NULL                 | Enum : entite_juridique / branche / direction / departement / agence |
| niveau_hierarchique    | int       | NOT NULL                 | Profondeur dans l'arbre (racine = 1)             |
| fk_structure_parent    | bigint    | NULL, FK dim_structure   | Auto-référence vers la version courante du parent |
| code_pays              | char(3)   | NULL                     | Code ISO du pays UEMOA (CIV, SEN, BEN, …)        |
| date_debut_validite    | date      | NOT NULL                 | Début de validité de la version (SCD2)           |
| date_fin_validite      | date      | NULL                     | Fin de validité (NULL = version courante)        |
| version_courante       | boolean   | NOT NULL                 | True pour la version active à date              |
| est_actif              | boolean   | NOT NULL                 | False si la structure est fermée                 |

> Unicité : `(code_structure, date_debut_validite)`.
> Au plus une ligne par `code_structure` avec `version_courante = true`.

---

### 3.3 dim_centre_responsabilite (SCD2)

Centre de responsabilité (CR) rattaché à une structure. Maille de
saisie budgétaire principale.

| Colonne                | Type      | Contraintes              | Description                                      |
|------------------------|-----------|--------------------------|--------------------------------------------------|
| id                     | bigint PK | identity                 | Surrogate key                                    |
| code_cr                | varchar   | NOT NULL                 | Business key                                     |
| libelle                | varchar   | NOT NULL                 |                                                  |
| fk_structure           | bigint    | NOT NULL, FK dim_structure | Structure de rattachement (version courante)   |
| type_cr                | varchar   | NOT NULL                 | Enum : centre_de_cout / centre_de_profit / centre_mixte |
| nom_responsable        | varchar   | NULL                     | Nom du responsable budgétaire                    |
| date_debut_validite    | date      | NOT NULL                 | SCD2                                             |
| date_fin_validite      | date      | NULL                     | SCD2                                             |
| version_courante       | boolean   | NOT NULL                 |                                                  |
| est_actif              | boolean   | NOT NULL                 |                                                  |

---

### 3.4 dim_compte (SCD2)

Plan Comptable Bancaire UMOA — classes 1 à 9, hiérarchique. Sert
d'axe d'agrégation comptable et de pivot vers le poste budgétaire.

| Colonne                | Type      | Contraintes              | Description                                      |
|------------------------|-----------|--------------------------|--------------------------------------------------|
| id                     | bigint PK | identity                 | Surrogate key                                    |
| code_compte            | varchar   | NOT NULL                 | Code PCB UMOA (business key)                     |
| libelle                | varchar   | NOT NULL                 | Libellé officiel PCB                             |
| classe                 | int       | NOT NULL, CHECK 1–9      | Classe comptable PCB (1=capitaux, 2=immo, …)     |
| sous_classe            | varchar   | NULL                     | Sous-classe (ex. « 10 — Capital »)               |
| fk_compte_parent       | bigint    | NULL, FK dim_compte      | Compte de regroupement parent                    |
| niveau                 | int       | NOT NULL                 | Profondeur dans l'arborescence PCB               |
| sens                   | char(1)   | NULL, CHECK ('D','C','M') | D=Débit, C=Crédit, M=Mixte (compte de liaison ou à double sens). NULL autorisé pour les comptes collectifs sans sens normal défini. |
| code_poste_budgetaire  | varchar   | NULL                     | Mapping vers le poste budgétaire analytique      |
| est_compte_collectif   | boolean   | NOT NULL                 | Vrai si compte d'agrégation, faux si compte de mouvement |
| est_porteur_interets   | boolean   | NOT NULL                 | Indicateur pour calcul MNI / TIE                 |
| date_debut_validite    | date      | NOT NULL                 | SCD2                                             |
| date_fin_validite      | date      | NULL                     | SCD2                                             |
| version_courante       | boolean   | NOT NULL                 |                                                  |
| est_actif              | boolean   | NOT NULL                 |                                                  |

---

### 3.5 dim_ligne_metier (SCD2)

Ligne d'activité bancaire (retail, corporate, treasury, marchés…).

| Colonne                | Type      | Contraintes              | Description                                      |
|------------------------|-----------|--------------------------|--------------------------------------------------|
| id                     | bigint PK | identity                 | Surrogate key                                    |
| code_ligne_metier      | varchar   | NOT NULL                 | Business key                                     |
| libelle                | varchar   | NOT NULL                 |                                                  |
| fk_ligne_metier_parent | bigint    | NULL, FK dim_ligne_metier | Hiérarchie auto-référencée                      |
| niveau                 | int       | NOT NULL                 |                                                  |
| date_debut_validite    | date      | NOT NULL                 | SCD2                                             |
| date_fin_validite      | date      | NULL                     | SCD2                                             |
| version_courante       | boolean   | NOT NULL                 |                                                  |
| est_actif              | boolean   | NOT NULL                 |                                                  |

---

### 3.6 dim_produit (SCD2)

Produits bancaires : crédits (par typologie), dépôts, services,
opérations de marché.

| Colonne                | Type      | Contraintes              | Description                                      |
|------------------------|-----------|--------------------------|--------------------------------------------------|
| id                     | bigint PK | identity                 | Surrogate key                                    |
| code_produit           | varchar   | NOT NULL                 | Business key                                     |
| libelle                | varchar   | NOT NULL                 |                                                  |
| type_produit           | varchar   | NOT NULL                 | Enum : credit / depot / service / marche / autre |
| fk_produit_parent      | bigint    | NULL, FK dim_produit     | Hiérarchie produit                               |
| niveau                 | int       | NOT NULL                 |                                                  |
| est_porteur_interets   | boolean   | NOT NULL                 | Pour calcul MNI / TIE                            |
| date_debut_validite    | date      | NOT NULL                 | SCD2                                             |
| date_fin_validite      | date      | NULL                     | SCD2                                             |
| version_courante       | boolean   | NOT NULL                 |                                                  |
| est_actif              | boolean   | NOT NULL                 |                                                  |

---

### 3.7 dim_segment (SCD2)

Segmentation clientèle.

| Colonne                | Type      | Contraintes              | Description                                      |
|------------------------|-----------|--------------------------|--------------------------------------------------|
| id                     | bigint PK | identity                 | Surrogate key                                    |
| code_segment           | varchar   | NOT NULL                 | Business key                                     |
| libelle                | varchar   | NOT NULL                 |                                                  |
| categorie              | varchar   | NOT NULL                 | Enum : particulier / professionnel / pme / grande_entreprise / institutionnel / secteur_public |
| date_debut_validite    | date      | NOT NULL                 | SCD2                                             |
| date_fin_validite      | date      | NULL                     | SCD2                                             |
| version_courante       | boolean   | NOT NULL                 |                                                  |
| est_actif              | boolean   | NOT NULL                 |                                                  |

---

### 3.8 dim_devise

Référentiel des devises (BCEAO). Pas de SCD2 sur le libellé : les
**taux de change** sont historisés à part dans `ref_taux_change` (cf.
§5).

| Colonne                | Type      | Contraintes              | Description                                      |
|------------------------|-----------|--------------------------|--------------------------------------------------|
| id                     | bigint PK | identity                 | Surrogate key                                    |
| code_iso               | char(3)   | NOT NULL, UNIQUE         | Code ISO 4217 (ex. XOF, EUR, USD)                |
| libelle                | varchar   | NOT NULL                 | Libellé long (ex. « Franc CFA BCEAO »)           |
| symbole                | varchar   | NULL                     | Symbole monétaire (ex. €, $)                     |
| nb_decimales           | int       | NOT NULL, default 2      | Nombre de décimales pour l'affichage             |
| est_devise_pivot       | boolean   | NOT NULL                 | Vrai pour XOF (FCFA), faux sinon                 |
| est_active             | boolean   | NOT NULL                 |                                                  |

> Invariant : exactement une ligne avec `est_devise_pivot = true`
> (XOF / FCFA). Garanti par index unique partiel :
> `CREATE UNIQUE INDEX uq_devise_pivot ON dim_devise (est_devise_pivot) WHERE est_devise_pivot = true;`

---

### 3.9 dim_version

Versions de budget : initial, reforecasts, atterrissage. Pas de SCD2 :
une version est immuable une fois gelée (cf. Lot 3 de la roadmap).

| Colonne                | Type      | Contraintes              | Description                                      |
|------------------------|-----------|--------------------------|--------------------------------------------------|
| id                     | bigint PK | identity                 | Surrogate key                                    |
| code_version           | varchar   | NOT NULL, UNIQUE         | Ex. « BUDGET_2026_V1 », « RF1_2026 »             |
| libelle                | varchar   | NOT NULL                 |                                                  |
| type_version           | varchar   | NOT NULL                 | Enum : budget_initial / reforecast_1 / reforecast_2 / atterrissage |
| exercice_fiscal        | int       | NOT NULL                 | Exercice cible                                   |
| statut                 | varchar   | NOT NULL                 | Enum : ouvert / soumis / valide / gele           |
| date_gel               | timestamp | NULL                     | Renseigné au passage à `gele`                    |
| utilisateur_gel        | varchar   | NULL                     | Auteur du gel                                    |
| commentaire            | text      | NULL                     |                                                  |

> Une version `gele` est immuable : aucune ligne `fait_budget` portant
> ce `fk_version` ne peut être modifiée ni supprimée.

---

### 3.10 dim_scenario

Scénarios appliqués à une version : central, alternatif (a minima
au MVP).

| Colonne                | Type      | Contraintes              | Description                                      |
|------------------------|-----------|--------------------------|--------------------------------------------------|
| id                     | bigint PK | identity                 | Surrogate key                                    |
| code_scenario          | varchar   | NOT NULL, UNIQUE         | Ex. « CENTRAL », « ALTERNATIF_HAUT »             |
| libelle                | varchar   | NOT NULL                 |                                                  |
| type_scenario          | varchar   | NOT NULL                 | Enum : central / optimiste / pessimiste / alternatif |
| statut                 | varchar   | NOT NULL                 | Enum : actif / archive                           |
| commentaire            | text      | NULL                     |                                                  |

---

## 4. Tables de faits

### 4.1 fait_budget

Montant budgété par axe et par période. Une ligne par combinaison
unique des axes et par mois.

| Colonne                  | Type            | Contraintes                          | Description                                  |
|--------------------------|-----------------|--------------------------------------|----------------------------------------------|
| id                       | bigint PK       | identity                             | Surrogate key                                |
| fk_temps                 | bigint          | NOT NULL, FK dim_temps               | Maille mensuelle (1er du mois)               |
| fk_compte                | bigint          | NOT NULL, FK dim_compte              | Compte PCB UMOA                              |
| fk_structure             | bigint          | NOT NULL, FK dim_structure           |                                              |
| fk_centre                | bigint          | NOT NULL, FK dim_centre_responsabilite |                                            |
| fk_ligne_metier          | bigint          | NULL, FK dim_ligne_metier            |                                              |
| fk_produit               | bigint          | NULL, FK dim_produit                 |                                              |
| fk_segment               | bigint          | NULL, FK dim_segment                 |                                              |
| fk_devise                | bigint          | NOT NULL, FK dim_devise              |                                              |
| fk_version               | bigint          | NOT NULL, FK dim_version             |                                              |
| fk_scenario              | bigint          | NOT NULL, FK dim_scenario            |                                              |
| montant_devise           | numeric(20,4)   | NOT NULL                             | Montant en devise d'origine                  |
| montant_fcfa             | numeric(20,4)   | NOT NULL                             | Montant converti au taux applicable          |
| taux_change_applique     | numeric(18,8)   | NOT NULL                             | Taux utilisé pour la conversion              |
| date_creation            | timestamp       | NOT NULL                             |                                              |
| utilisateur_creation     | varchar         | NOT NULL                             |                                              |
| date_modification        | timestamp       | NULL                                 |                                              |
| utilisateur_modification | varchar         | NULL                                 |                                              |

> Unicité fonctionnelle : `(fk_temps, fk_compte, fk_structure, fk_centre,
> fk_ligne_metier, fk_produit, fk_segment, fk_devise, fk_version,
> fk_scenario)`. Les axes optionnels (`fk_ligne_metier`, `fk_produit`,
> `fk_segment`) pointent obligatoirement vers une **ligne sentinelle**
> (code = `NA`, libellé = `Non renseigné`, `id = 0` par convention)
> chargée au seed. Cette stratégie permet de maintenir la contrainte
> `UNIQUE` composite (PostgreSQL traite chaque NULL comme distinct
> dans les index `UNIQUE`).

### 4.2 fait_realise

Réalisé comptable importé du SI. Même socle dimensionnel que
`fait_budget`, sans `fk_version` ni `fk_scenario` (le réalisé est
unique).

| Colonne                | Type            | Contraintes                            | Description                                  |
|------------------------|-----------------|----------------------------------------|----------------------------------------------|
| id                     | bigint PK       | identity                               | Surrogate key                                |
| fk_temps               | bigint          | NOT NULL, FK dim_temps                 | Date d'écriture comptable                    |
| fk_compte              | bigint          | NOT NULL, FK dim_compte                |                                              |
| fk_structure           | bigint          | NOT NULL, FK dim_structure             |                                              |
| fk_centre              | bigint          | NULL, FK dim_centre_responsabilite     |                                              |
| fk_ligne_metier        | bigint          | NULL, FK dim_ligne_metier              |                                              |
| fk_produit             | bigint          | NULL, FK dim_produit                   |                                              |
| fk_segment             | bigint          | NULL, FK dim_segment                   |                                              |
| fk_devise              | bigint          | NOT NULL, FK dim_devise                |                                              |
| montant_devise         | numeric(20,4)   | NOT NULL                               |                                              |
| montant_fcfa           | numeric(20,4)   | NOT NULL                               |                                              |
| taux_change_applique   | numeric(18,8)   | NOT NULL                               |                                              |
| sens                   | char(1)         | NOT NULL, CHECK ('D','C')              | Sens de l'écriture importée. Peut différer de `dim_compte.sens` (sens normal du compte) pour les extournes, régularisations et passages d'écritures inverses. |
| reference_import       | varchar         | NOT NULL                               | Identifiant du batch d'import                |
| date_import            | timestamp       | NOT NULL                               |                                              |
| date_ecriture          | date            | NOT NULL                               | Date comptable de l'écriture                 |
| utilisateur_import     | varchar         | NOT NULL                               |                                              |

### 4.3 fait_capex

Engagements et amortissements d'investissement.

| Colonne                | Type            | Contraintes                            | Description                                  |
|------------------------|-----------------|----------------------------------------|----------------------------------------------|
| id                     | bigint PK       | identity                               |                                              |
| fk_temps               | bigint          | NOT NULL, FK dim_temps                 | Date du flux                                 |
| fk_structure           | bigint          | NOT NULL, FK dim_structure             |                                              |
| fk_centre              | bigint          | NOT NULL, FK dim_centre_responsabilite |                                              |
| fk_compte              | bigint          | NOT NULL, FK dim_compte                | Compte d'immobilisation                      |
| fk_devise              | bigint          | NOT NULL, FK dim_devise                |                                              |
| fk_version             | bigint          | NOT NULL, FK dim_version               |                                              |
| code_projet            | varchar         | NOT NULL                               | Identifiant projet d'investissement          |
| libelle_projet         | varchar         | NOT NULL                               |                                              |
| type_flux              | varchar         | NOT NULL                               | Enum : engagement / mise_en_service / dotation_amortissement |
| montant_devise         | numeric(20,4)   | NOT NULL                               |                                              |
| montant_fcfa           | numeric(20,4)   | NOT NULL                               |                                              |
| duree_amortissement_mois | int           | NULL                                   | Renseigné pour les mises en service          |
| date_mise_en_service_prevue | date       | NULL                                   |                                              |
| date_creation          | timestamp       | NOT NULL                               |                                              |
| utilisateur_creation   | varchar         | NOT NULL                               |                                              |

### 4.4 fait_bilan

Encours actif / passif par bande de maturité — support du module ALM.

| Colonne                | Type            | Contraintes                            | Description                                  |
|------------------------|-----------------|----------------------------------------|----------------------------------------------|
| id                     | bigint PK       | identity                               |                                              |
| fk_temps               | bigint          | NOT NULL, FK dim_temps                 | Date d'arrêté                                |
| fk_compte              | bigint          | NOT NULL, FK dim_compte                | Actif ou passif selon classe PCB             |
| fk_structure           | bigint          | NOT NULL, FK dim_structure             |                                              |
| fk_produit             | bigint          | NULL, FK dim_produit                   |                                              |
| fk_segment             | bigint          | NULL, FK dim_segment                   |                                              |
| fk_devise              | bigint          | NOT NULL, FK dim_devise                |                                              |
| fk_version             | bigint          | NOT NULL, FK dim_version               |                                              |
| fk_scenario            | bigint          | NOT NULL, FK dim_scenario              |                                              |
| nature_bilan           | char(1)         | NOT NULL, CHECK ('A','P')              | Actif / Passif                               |
| bande_maturite         | varchar         | NOT NULL                               | Enum : <1m / 1-3m / 3-6m / 6-12m / 1-2a / 2-5a / >5a |
| type_encours           | varchar         | NOT NULL                               | Enum : stock / flux_production / flux_remboursement |
| encours_devise         | numeric(20,4)   | NOT NULL                               |                                              |
| encours_fcfa           | numeric(20,4)   | NOT NULL                               |                                              |
| taux_moyen_pondere     | numeric(8,5)    | NULL                                   | Taux moyen pondéré de l'encours              |
| date_creation          | timestamp       | NOT NULL                               |                                              |
| utilisateur_creation   | varchar         | NOT NULL                               |                                              |

---

## 5. Tables de référentiel et de support

### 5.1 ref_taux_change

Historique des taux de change BCEAO. Lien dimension × temps × taux.

| Colonne                | Type            | Contraintes                            | Description                                  |
|------------------------|-----------------|----------------------------------------|----------------------------------------------|
| id                     | bigint PK       | identity                               |                                              |
| fk_devise              | bigint          | NOT NULL, FK dim_devise                | Devise cotée                                 |
| fk_temps               | bigint          | NOT NULL, FK dim_temps                 | Date de cotation                             |
| taux_vers_pivot        | numeric(18,8)   | NOT NULL                               | 1 unité de devise = X FCFA                   |
| source                 | varchar         | NOT NULL                               | Ex. « BCEAO », « manuel »                    |
| type_taux              | varchar         | NOT NULL                               | Enum : `cloture` / `moyen_mensuel` / `fixe_budgetaire`. `cloture` = taux fin de mois BCEAO ; `moyen_mensuel` = moyenne mensuelle BCEAO ; `fixe_budgetaire` = taux figé pour une campagne budgétaire. |

> Unicité : `(fk_devise, fk_temps, type_taux)`.

### 5.2 ref_calendrier_budgetaire

Campagnes budgétaires, jalons, dates de gel.

| Colonne                | Type            | Contraintes                            | Description                                  |
|------------------------|-----------------|----------------------------------------|----------------------------------------------|
| id                     | bigint PK       | identity                               |                                              |
| code_campagne          | varchar         | NOT NULL, UNIQUE                       | Ex. « BUDGET_2027 »                          |
| libelle                | varchar         | NOT NULL                               |                                              |
| exercice_fiscal        | int             | NOT NULL                               |                                              |
| date_ouverture         | date            | NOT NULL                               | Ouverture de la saisie                       |
| date_fin_saisie        | date            | NOT NULL                               | Date butoir de saisie                        |
| date_gel               | date            | NULL                                   | Date prévisionnelle de gel                   |
| statut                 | varchar         | NOT NULL                               | Enum : planifiee / ouverte / cloturee / gelee |

### 5.3 ref_role, ref_permission, bridge_user_role

Issus du Lot 1 (socle transverse).

| Table              | Rôle                                                                 |
|--------------------|----------------------------------------------------------------------|
| `ref_role`         | Liste des rôles applicatifs (ex. `controleur_gestion`, `admin_ref`)   |
| `ref_permission`   | Liste des permissions atomiques (ex. `BUDGET.SAISIR`, `VERSION.GELER`) |
| `bridge_role_permission` | Lien rôle × permission (n,n)                                   |
| `bridge_user_role` | Lien utilisateur × rôle (n,n), avec périmètre optionnel (structure / CR) |

### 5.4 audit_log

Piste d'audit transverse. Une ligne par action sensible (création,
modification, validation, gel, suppression logique).

| Colonne                | Type            | Contraintes                            | Description                                  |
|------------------------|-----------------|----------------------------------------|----------------------------------------------|
| id                     | bigint PK       | identity                               |                                              |
| date_action            | timestamp       | NOT NULL                               |                                              |
| utilisateur            | varchar         | NOT NULL                               |                                              |
| ip_source              | varchar         | NULL                                   |                                              |
| type_action            | varchar         | NOT NULL                               | Enum : create / update / delete / validate / freeze / login / logout |
| entite_cible           | varchar         | NOT NULL                               | Nom de la table ciblée                       |
| id_cible               | varchar         | NULL                                   | Identifiant de la ligne ciblée, stocké en `varchar` pour rester agnostique du type de PK (bigint, uuid, composite). Convention : représentation textuelle de la PK. |
| payload_avant          | jsonb           | NULL                                   | État avant (pour update / delete)            |
| payload_apres          | jsonb           | NULL                                   | État après (pour create / update)            |
| commentaire            | text            | NULL                                   |                                              |

---

## 6. Stratégie SCD type 2

**Axes concernés** : `dim_structure`, `dim_centre_responsabilite`,
`dim_compte`, `dim_ligne_metier`, `dim_produit`, `dim_segment`.

**Axes hors SCD2** : `dim_temps` (figée), `dim_devise` (variations
portées par `ref_taux_change`), `dim_version` et `dim_scenario`
(naturellement immuables une fois gelées).

### 6.1 Colonnes techniques systématiques

| Colonne               | Rôle                                                                 |
|-----------------------|----------------------------------------------------------------------|
| `id`                  | Surrogate key — change à chaque nouvelle version SCD2                |
| `code_<entité>`       | Business key — stable inter-versions                                 |
| `date_debut_validite` | Date de début de validité de la version (incluse)                    |
| `date_fin_validite`   | Date de fin (excluse). NULL = version en cours                       |
| `version_courante`    | True pour la ligne active à date — au plus une par business key      |
| `est_actif`           | False si l'entité est fermée (orthogonal au SCD2)                    |

### 6.2 Règles invariantes

- Pour un `code_<entité>` donné, les intervalles
  `[date_debut_validite, date_fin_validite)` sont **disjoints** et
  **contigus** (pas de trou, pas de chevauchement).
- Au plus **une seule ligne** avec `version_courante = true` par
  business key. Cette ligne a `date_fin_validite IS NULL`.
- Modifier un attribut SCD2-tracé (libellé, parent, type, …) crée une
  **nouvelle ligne** avec un nouveau `id` ; l'ancienne reste en base
  avec `date_fin_validite` renseignée.
- Modifier un attribut **non** SCD2-tracé (purement opérationnel) met
  à jour la ligne en place sans créer de version.

### 6.3 Règle de jointure faits ↔ dimensions

> Un fait pointe **toujours** vers la version de dimension valide à
> la date métier du fait.

Concrètement, lors de l'insertion d'une ligne `fait_*` :

1. récupérer la `date` portée par `fk_temps` ;
2. pour chaque axe SCD2, joindre `dim_<axe>` sur
   `code_<entité>` et la condition
   `date_debut_validite <= date < COALESCE(date_fin_validite, +∞)` ;
3. utiliser le `id` ainsi obtenu comme `fk_<axe>`.

Conséquence : un même CR sous deux libellés successifs apparaît avec
deux `fk_centre` différents dans `fait_budget`, ce qui permet de
restituer chaque période sous son libellé d'époque tout en
permettant les agrégations par business key.

### 6.4 Distinction business key vs surrogate key

| Aspect                   | `code_<entité>` (business)         | `id` (surrogate)                   |
|--------------------------|------------------------------------|------------------------------------|
| Stabilité dans le temps  | Stable                             | Change à chaque version SCD2       |
| Source                   | Métier (ex. code agence officiel)  | Technique (sequence)               |
| Utilisation dans les FK des faits | Non                       | Oui                                |
| Utilisation pour rapprocher des versions | Oui                | Non                                |
| Affichage utilisateur    | Oui                                | Non                                |

---

## 7. Index et performance

### 7.1 Index obligatoires

- **Clés primaires** : `id` de chaque table (implicite).
- **Foreign keys des faits** : index B-tree sur **chaque** `fk_*` des
  tables `fait_*`. Sans cela, les jointures sur 1 M+ lignes deviennent
  prohibitives.
- **Business keys des dimensions SCD2** : index sur
  `(code_<entité>, version_courante)` pour l'accès à la version
  active, et index sur `(code_<entité>, date_debut_validite)` pour
  les jointures historisées.

### 7.2 Index composites recommandés

| Table          | Index composite                                     | Cas d'usage                                  |
|----------------|-----------------------------------------------------|----------------------------------------------|
| `fait_budget`  | `(fk_version, fk_temps)`                            | Restitution mensuelle d'une version          |
| `fait_budget`  | `(fk_version, fk_centre, fk_temps)`                 | Tableau de bord par CR                       |
| `fait_budget`  | `(fk_temps, fk_compte)`                             | Agrégation par poste comptable               |
| `fait_realise` | `(fk_temps, fk_compte)`                             | Idem côté réalisé                            |
| `fait_realise` | `(reference_import)`                                | Reprise / annulation d'un import             |
| `fait_bilan`   | `(fk_version, fk_temps, bande_maturite)`            | Gap de liquidité                             |
| `audit_log`    | `(date_action DESC)`                                | Restitution chronologique                    |
| `audit_log`    | `(entite_cible, id_cible)`                          | Historique d'une entité                      |

### 7.3 Vues matérialisées prévues

| Vue matérialisée                | Granularité cible                                  | Rafraîchissement                |
|---------------------------------|----------------------------------------------------|---------------------------------|
| `mv_budget_mensuel`             | (mois × compte × CR × version)                     | Concurrent, après gel de version |
| `mv_realise_mensuel`            | (mois × compte × CR)                               | Concurrent, fin de chaque clôture |
| `mv_budget_par_ligne_metier`    | (mois × ligne_metier × version)                    | Concurrent, après gel de version |
| `mv_ecarts_mensuels`            | (mois × CR × compte × version)                     | Concurrent, après clôture mensuelle |

### 7.4 Partitionnement

- À activer si une table de faits dépasse **10 M de lignes par
  partition** ou si les temps de requête se dégradent.
- Stratégie envisagée pour `fait_budget` : partitionnement **par
  `exercice_fiscal`** (1 partition par an), avec sous-partitionnement
  par `type_version` si nécessaire. Le partitionnement direct par
  `fk_version` est écarté : trop de partitions sur la durée
  (> 100 versions sur 5 ans tous scénarios confondus, mal géré par
  PostgreSQL).
- Stratégie envisagée pour `fait_realise` : partitionnement **par
  année** (`date_ecriture`).
- Décision finale arbitrée au Lot 5 (Reporting) sur la base des temps
  de requête mesurés.

---

## 8. Conventions

| Aspect                | Règle                                                                  |
|-----------------------|------------------------------------------------------------------------|
| Casse tables/colonnes | `snake_case`, jamais de majuscules, jamais d'accent                    |
| Pluriel               | Non — `dim_compte`, pas `dim_comptes`                                  |
| Préfixes de tables    | `dim_`, `fait_`, `ref_`, `bridge_`                                     |
| Clé primaire          | Toujours `id bigint generated always as identity`                      |
| Clés étrangères       | `fk_<dimension>` — ex. `fk_compte`, `fk_temps`                         |
| Auto-références       | `fk_<entité>_parent` — ex. `fk_compte_parent`                          |
| Booléens              | Préfixe `est_` ou `a_` — ex. `est_actif`, `a_ete_valide`               |
| Dates métier          | Suffixe `_le` ou nom explicite — ex. `gele_le`, `date_ouverture`       |
| Dates SCD2            | `date_debut_validite`, `date_fin_validite` (toujours ce nommage)       |
| Horodatages techniques | `date_creation`, `date_modification` (timestamps)                     |
| Auteurs techniques    | `utilisateur_creation`, `utilisateur_modification` (varchar)           |
| Montants monétaires   | `numeric(20, 4)` — 16 chiffres avant la virgule, 4 après               |
| Taux et coefficients  | `numeric(8, 5)` (ex. taux d'intérêt) ou `numeric(18, 8)` (taux de change) |
| Énumérations          | `varchar` + `CHECK` ou table `ref_*` (les types ENUM PostgreSQL sont rigides : `ALTER TYPE` coûteux, pas de réordonnancement, pas de soft-delete des valeurs obsolètes) |
| Caractères pays / sens | `char(1)` ou `char(3)` selon ISO                                      |

---

## 9. Volumétrie cible

Reprise des hypothèses MVP de [`roadmap-mvp.md`](roadmap-mvp.md) :
1 entité juridique, 50–200 CR, profondeur 3 ans × 12 mois.

| Table             | Hypothèse de calcul                                                                                         | Volume estimé / version |
|-------------------|-------------------------------------------------------------------------------------------------------------|-------------------------|
| `dim_temps`       | 10 ans × 365 j                                                                                              | ~3 700 lignes           |
| `dim_compte`      | PCB UMOA                                                                                                    | quelques centaines      |
| `dim_structure`   | 1 entité + 50–200 sous-structures × ~2 versions SCD2 sur la durée                                           | < 1 000 lignes          |
| `dim_centre_responsabilite` | 200 CR × ~2 versions SCD2                                                                         | < 500 lignes            |
| `dim_produit`     | ~100 produits × ~2 versions                                                                                 | < 300 lignes            |
| `fait_budget`     | 200 CR × 50 comptes pertinents × 5 produits × 3 segments × 36 mois × 1 scénario, taux de remplissage effectif ~30 % | ≤ **5 M lignes / version** |
| `fait_realise`    | 200 CR × 100 comptes × 12 mois × 3 ans                                                                      | ~700 k lignes           |
| `fait_capex`      | ~100 projets × 60 mois                                                                                      | ~6 k lignes             |
| `fait_bilan`      | 100 produits × 7 bandes maturité × 36 mois × 2 scénarios                                                    | ~50 k lignes            |
| `ref_taux_change` | ~10 devises × 365 j × 10 ans                                                                                | ~36 k lignes            |
| `audit_log`       | Croissance ~10 k lignes / mois                                                                              | ~120 k lignes / an      |

> Au-delà de **5 versions de budget gelées** ou **3 ans de réalisé**,
> rebascule attendue vers le partitionnement (cf. §7.4).

---

## 10. Évolutions prévues

| Version cible | Module | Tables ajoutées                              | Description                                                                 |
|---------------|--------|----------------------------------------------|-----------------------------------------------------------------------------|
| V2            | G — Capital planning | `fait_capital`, `fait_rwa`         | Capital économique projeté, RWA par catégorie d'exposition, ratios CET1     |
| V2            | J — Scénarios / Stress | `fait_scenario_choc`, `ref_choc_macro` | Application de chocs macro paramétrés sur encours, taux et défauts       |
| V3            | K — Allocation analytique | `bridge_allocation_clef`, `ref_clef_allocation` | Refacturation interne et clés d'allocation des coûts indirects   |

Les surfaces dimensionnelles (axes structurants) sont déjà
dimensionnées pour ces extensions : aucune réingénierie majeure
attendue, uniquement de nouveaux faits.
