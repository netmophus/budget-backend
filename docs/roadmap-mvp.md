# Roadmap MVP — Module Budgétaire Bancaire UEMOA (MIZNAS)

> Plan d'exécution détaillé des 6 lots du MVP, basé sur les
> spécifications fonctionnelles V1.0 (avril 2026) et le plan d'exécution
> projet. Chaque lot précise son périmètre, ses livrables, ses critères
> d'achèvement (DoD) et ses dépendances.

État actuel : **Lot 2 LIVRÉ — 29/04/2026**. Les 4 sous-étapes sont
sur `main` : 2.1 (socle SCD2 + `CsvImportService`), 2.2 (`dim_temps`
+ `dim_devise` + frontend), 2.3 (`dim_structure` +
`dim_centre_responsabilite` SCD2 hiérarchique avec relink stratégie A
+ frontend), 2.4 (`dim_compte` PCB UMOA Révisé avec import CSV
opérationnel, `dim_ligne_metier`, `dim_produit`, `dim_segment` plat,
+ frontend des 4 nouvelles pages).

**Chiffres clés Lot 2** : 11 migrations en base (3 Lot 1 + 8
dimensions Lot 2), 449 tests backend verts, 49 tests frontend verts,
~50 commits sur `main` (répartis sur les dépôts `budget-backend`
porteur de `docs/` et `budget-frontend`). Premier vrai usage de
`CsvImportService` validé en condition réelle Postgres au Lot 2.4A.2
(import du PCB UMOA Révisé via `POST /referentiels/comptes/import`).

Prochaine étape : **Lot 3** — Module B Élaboration budgétaire
(campagnes, saisie, workflow, versions, scénarios).

---

## Sommaire

- [Vue d'ensemble](#vue-densemble)
- [Lot 1 — Socle transverse](#lot-1--socle-transverse)
- [Lot 2 — Module A : Référentiels](#lot-2--module-a--référentiels)
- [Lot 3 — Module B : Élaboration budgétaire](#lot-3--module-b--élaboration-budgétaire)
- [Lot 4 — Modules C et D : PNB et Charges](#lot-4--modules-c-et-d--pnb-et-charges)
- [Lot 5 — Modules E, F, H, I, L : CAPEX, Bilan/ALM, Exécution, Reforecast, Reporting](#lot-5--modules-e-f-h-i-l--capex-bilanalm-exécution-reforecast-reporting)
- [Lot 6 — Stabilisation et recette MVP](#lot-6--stabilisation-et-recette-mvp)
- [Modules différés (post-MVP)](#modules-différés-post-mvp)
- [Hypothèses](#hypothèses)

---

## Vue d'ensemble

| Lot   | Durée estimée | Modules couverts                                          | Statut          |
|-------|---------------|-----------------------------------------------------------|-----------------|
| Lot 0 | 1 semaine     | Initialisation projet, choix techniques, cadrage          | Terminé         |
| Lot 1 | 3 semaines    | Socle transverse (auth, RBAC, audit, Swagger, CORS)       | Terminé         |
| Lot 2 | 4 semaines    | Module A — Référentiels (PCB UMOA, structure, axes)       | **Livré — 29/04/2026** + Lot 2.5 (6/6 CRUDs UI) clôturé 02/05/2026 |
| Lot 2.5-bis | 1 semaine | Référentiels secondaires paramétrables (13 `ref_*` + UI Configuration) | **✅ Livré — 01/05/2026** (5 sous-étapes A-E) |
| Lot 3 | 5 semaines    | Module B — Élaboration budgétaire (cycle, versions, WF)   | En attente      |
| Lot 4 | 4 semaines    | Modules C (PNB) et D (Charges)                            | En attente      |
| Lot 5 | 6 semaines    | Modules E (CAPEX), F (Bilan/ALM), H (Exécution), I (Reforecast), L (Reporting) | En attente      |
| Lot 6 | 3 semaines    | Stabilisation, recette utilisateur, livraison MVP         | En attente      |
| **Total Lots 0→6** | **~26 semaines** | — | — |

> Modules **G** (Capital planning), **J** (Scénarios / Stress) et **K**
> (Allocation analytique) sont hors-MVP : voir [Modules différés](#modules-différés-post-mvp).

---

## Lot 1 — Socle transverse

**Durée estimée** : 3 semaines
**Dépendances** : Lot 0 terminé (init back/front/DB)
**Objectif** : poser les fondations techniques transverses sur lesquelles
tous les modules métier vont s'appuyer (sécurité, observabilité, contrats
d'API, configuration front).

### Périmètre

- **Authentification** : login utilisateur, émission/validation de jetons
  stateless, déconnexion, rotation de mot de passe.
- **Autorisation RBAC** : modèle rôles/permissions, garde NestJS,
  contrôle d'accès au niveau endpoint et au niveau ligne (par entité
  juridique / centre de responsabilité).
- **Audit applicatif** : journalisation horodatée de toute action
  sensible (création, modification, validation, clôture) avec
  utilisateur, IP, périmètre.
- **Documentation API** : Swagger/OpenAPI auto-généré, exposé en
  développement, versionné.
- **CORS** : politique stricte par environnement (dev / recette / prod).
- **Configuration front** : client HTTP centralisé, intercepteurs
  (jeton, erreurs), gestion des routes protégées, layout de base,
  page de connexion, page d'accueil utilisateur.
- **Health check** : endpoint `/health` (DB, app) pour la supervision.
- **Gestion d'erreurs** : filtre global, format d'erreur normalisé
  (code, message, détails).

### Livrables

- Modules NestJS : `auth`, `users`, `roles`, `audit`, `health`, `common`.
- Entités persistées : `user`, `role`, `permission`, `user_role`,
  `audit_log`.
- Endpoints REST : `/auth/login`, `/auth/logout`, `/auth/me`,
  `/users`, `/roles`, `/audit-logs`, `/health`.
- Page Swagger accessible : `http://localhost:3001/api/docs`.
- Frontend : pages Login, Layout authentifié, route guard, store de
  session, composants UI de base (boutons, inputs, table, modale).
- Documentation : section « Authentification & sécurité » dans
  `docs/architecture.md`.

### Definition of Done (DoD)

- Un utilisateur peut se connecter, naviguer dans une page protégée,
  se déconnecter — démo de bout en bout fonctionnelle.
- Tous les endpoints non publics rejettent les requêtes non
  authentifiées avec un code `401`.
- Tous les endpoints sensibles rejettent les requêtes sans permission
  avec un code `403`.
- Toute action de création/modification/suppression est tracée dans
  `audit_log` (vérifié sur 5 cas représentatifs).
- Couverture de tests unitaires backend ≥ 70 % sur les modules `auth`
  et `roles`.
- Swagger publié, à jour, sans warning de génération.
- CORS validé manuellement : front:5173 ↔ back:3001 OK ; tout autre
  origine refusée.
- README mis à jour avec la procédure de création du premier
  utilisateur administrateur.

### Risques et points d'attention

- **Modèle RBAC vs ABAC** : le périmètre filtré par entité juridique
  / centre de responsabilité peut imposer un volet attributaire (ABAC)
  en plus du RBAC pur. À trancher dès le début du lot pour ne pas
  refactorer en Lot 3.
- **Format du jeton** : choix JWT vs jeton opaque ; impact sur la
  révocation et la taille des en-têtes.
- **Rotation des secrets** : prévoir la procédure dès le Lot 1, ne
  pas la repousser.

---

## Lot 2 — Module A : Référentiels

**Durée estimée** : 4 semaines
**Dépendances** : Lot 1 terminé (auth + RBAC opérationnels)
**Objectif** : mettre en place les axes structurants du modèle
dimensionnel et le plan comptable PCB UMOA, sur lesquels tous les
faits budgétaires et comptables seront indexés.

### Périmètre

- **Plan comptable PCB UMOA** : import et gestion de la nomenclature
  officielle (classes 1 à 9), regroupements analytiques (postes
  budgétaires), correspondances comptable ↔ budgétaire.
- **Structure organisationnelle** : entités juridiques, agences,
  départements, hiérarchie multi-niveaux.
- **Centres de responsabilité (CR)** : rattachement à la structure,
  responsable, périmètre budgétaire.
- **Lignes métier** : retail, corporate, treasury, marchés, etc.
- **Produits** : crédits (par typologie), dépôts (à vue, à terme,
  d'épargne), services bancaires, opérations de marché.
- **Segments clientèle** : particuliers, professionnels, PME, grandes
  entreprises, institutionnels, secteur public.
- **Devises** : référentiel BCEAO (FCFA pivot, devises convertibles),
  taux de change historiques et prévisionnels.
- **Calendrier budgétaire** : exercices, périodes (mois, trimestres,
  semestres), ouverture/clôture, dates de gel.
- **Versions et scénarios** : modèle de gestion (budget initial,
  reforecast 1, reforecast 2, central, alternatif).
- **Historisation SCD2** sur les axes structurants (cf.
  [`docs/modele-donnees.md`](modele-donnees.md)).

### Livrables

- Modules NestJS : `accounting-plan`, `org-structure`,
  `responsibility-centers`, `business-lines`, `products`,
  `segments`, `currencies`, `calendar`, `versions`, `scenarios`.
- Entités persistées (dimensions) : `dim_compte`, `dim_structure`,
  `dim_centre_responsabilite`, `dim_ligne_metier`, `dim_produit`,
  `dim_segment`, `dim_devise`, `dim_temps`, `dim_version`,
  `dim_scenario`, plus tables de hiérarchie.
- Endpoints CRUD complets sur chaque référentiel + endpoints de
  recherche / arborescence.
- Imports initiaux : PCB UMOA complet, devises BCEAO, calendrier
  exercice courant.
- Frontend : écrans d'administration des référentiels (liste,
  détail, hiérarchie arborescente), import CSV pour les volumes
  importants.
- Documentation : `docs/modele-donnees.md` finalisé, dictionnaire
  des axes.

### Definition of Done (DoD)

- Le PCB UMOA est intégralement chargé en base et navigable depuis
  l'IHM (recherche + arborescence).
- Chaque référentiel est CRUDable via API et IHM, avec validation
  des règles d'unicité et de cohérence hiérarchique.
- Le mécanisme SCD2 est opérationnel : modifier un libellé d'agence
  produit une nouvelle ligne valide, l'ancienne restant accessible
  pour les faits historiques.
- Un script de seed permet de reproduire l'intégralité du référentiel
  sur un environnement vierge en moins de 5 minutes.
- Tests unitaires ≥ 70 % sur les services des référentiels.
- Tests d'intégration sur les imports CSV (cas nominal + 3 cas
  d'erreur typés).
- Document `docs/modele-donnees.md` revu et validé par un référent
  métier.

### Risques et points d'attention

- **Volumétrie du PCB UMOA** : plusieurs centaines de comptes ;
  performance des écrans de navigation à valider tôt.
- **Cohérence hiérarchique** : les hiérarchies (structure, produit)
  doivent rester acycliques et historisées sans casser les faits.
- **Mapping comptable ↔ budgétaire** : règle métier sensible, à
  valider avec le contrôle de gestion **avant** d'industrialiser.
- **SCD2 vs SCD1** : tous les axes ne nécessitent pas une
  historisation type 2 ; trancher attribut par attribut pour ne
  pas surdimensionner.

### Livraison effective — 29/04/2026 [LIVRÉ]

**8 dimensions sur les 10 du modèle dimensionnel** sont livrées en
base, seedées et exposées via API + frontend lecture seule. Les 2
dernières (`dim_version` et `dim_scenario`) relèvent du Lot 3 (cycle
budgétaire) — pas du Lot 2.

| Dimension | Volumétrie seed | Pattern |
|---|---|---|
| `dim_temps` | ~3 653 lignes (10 ans glissants, fériés UEMOA) | Pas SCD2 |
| `dim_devise` | 7 devises (XOF pivot + 6 convertibles) | Pas SCD2 |
| `dim_structure` | 9 structures multi-pays UEMOA | SCD2 hiérarchique |
| `dim_centre_responsabilite` | 6 CR | SCD2 + FK SCD2 stratégie A |
| `dim_compte` | 104 comptes PCB Révisé pédagogique + **import CSV opérationnel** | SCD2 hiérarchique auto-référencée |
| `dim_ligne_metier` | 12 lignes (retail / corporate / treasury / support) | SCD2 hiérarchique auto-référencée |
| `dim_produit` | 26 produits (crédits / dépôts / services / marchés) | SCD2 hiérarchique auto-référencée |
| `dim_segment` | 6 segments (catégories UEMOA) | **SCD2 plat** (cf. `modele-donnees.md` §3.7) |

**Faits notables** :
- Premier vrai usage du socle `CsvImportService` (Lot 2.1) validé en
  condition réelle Postgres au Lot 2.4A.2 — endpoint
  `POST /api/v1/referentiels/comptes/import` opérationnel avec mode
  `insert-only` ou `upsert` (génère une nouvelle version SCD2 si un
  champ tracé diffère). Audit `IMPORT` capté dans `audit_log`.
- Stratégie A appliquée 4 fois : 1 fois inter-modules (CR ↔ structure)
  + 3 fois en auto-référence (compte, ligne-métier, produit). Bilan
  consolidé en `scd2-pattern.md` §8.4.

**DoD officiellement atteinte** : tous les critères de la section
[Definition of Done](#definition-of-done-dod) du Lot 2 sont validés
sur `main` (449 tests backend + 49 tests frontend verts). Aucun reste
à charge en backlog post-Lot-2.

### CRUD UI des dimensions — sous-étapes 2.5A → 2.5F

État actuel : Lot 2 quasi terminé. Le CRUD UI des dimensions métier
(création / modification / désactivation côté frontend) est découpé
en 6 sous-étapes pour rester livrable par incréments de ~½ journée.

| Sous-étape | Périmètre | Statut |
|---|---|---|
| 2.5A | CRUD UI **Structure** (drawer + bandeau SCD2 + désactivation) | ✅ Livré |
| 2.5B | CRUD UI **Segment** (filtre catégorie + bandeau SCD2 + désactivation) | ✅ Livré — 01/05/2026 |
| 2.5C | CRUD UI **Produit** (+ factorisation `RefSecondaireSelect` / `useScd2EditDiff` + seed `PRODUIT_TRANSVERSE`) | ✅ Livré — 30/04/2026 |
| 2.5D | CRUD UI **Ligne métier** (consomme `useScd2EditDiff` ; aucune FK `ref_*` → pas de `RefSecondaireSelect`) | ✅ Livré — 02/05/2026 |
| 2.5E | CRUD UI **Compte** (10 champs, 2× `RefSecondaireSelect`, import CSV multipart connecté à 2.4A.2) | ✅ Livré — 02/05/2026 |
| 2.5F | CRUD UI **CR** (5 champs, FK SCD2-vers-SCD2 vers `dim_structure`, 6ᵉ et dernier consommateur du pattern factorisation) | ✅ Livré — 02/05/2026 |

### Lot 2.5-bis — Référentiels secondaires paramétrables [LIVRÉ — 01/05/2026]

5 sous-étapes A → E qui ont extrait les 13 énumérations métier
(types de structure, pays UEMOA, statuts de version, etc.) des
`CHECK` constraints SQL et enum hardcodés vers des tables `ref_*`
paramétrables via une UI Configuration unifiée.

| Sous-étape | Périmètre | Livraison |
|---|---|---|
| 2.5-bis-A | Backend : 13 tables `ref_*` + 13 modules génériques + permissions `CONFIGURATION.LIRE/GERER` | ✅ |
| 2.5-bis-B | Backend : 13 migrations FK des dimensions vers `ref_*(code)` + conversion `dim_compte.classe int → varchar` | ✅ |
| 2.5-bis-C | Frontend : page `/configuration` unique avec navigation 5 catégories × 13 sous-tableaux | ✅ |
| 2.5-bis-D | Frontend : hook `useRefSecondaireOptions` + sélects dynamiques dans `StructureFormDrawer` (pattern réutilisable pour 2.5B-F) | ✅ |
| 2.5-bis-E | Documentation consolidée + audit non-régression | ✅ |

**Chiffres de livraison 2.5-bis** : 671 tests backend verts (449 →
671, +222), 145 tests frontend verts (49 → 145, +96), 41 migrations
en base (15 → 41, +26 : 13 ref + 13 FK). Cf.
`docs/referentiels-secondaires.md` pour l'architecture détaillée et
`docs/qa-smoke-2.5-bis.md` pour la checklist de validation
post-déploiement.

### Lot 2.5C — CRUD UI Produit + factorisation [LIVRÉ — 30/04/2026]

3 phases A → C qui livrent le CRUD UI Produit (hiérarchie 4 niveaux
avec anti-cycle), factorisent les 2 patterns récurrents identifiés
sur Structure / Segment / Produit, et ajoutent une sentinelle
`PRODUIT_TRANSVERSE` pour les charges sans produit bancaire associé.

| Phase | Périmètre | Livraison |
|---|---|---|
| A.1 | Composant générique `RefSecondaireSelect` (encapsule loading / error / valeur désactivée pour les 13 selects `ref_*`) | ✅ |
| A.2 | Hook `useScd2EditDiff<T>` (calcul diff + prédiction `modeMaj` + bandeau jaune/bleu/info) | ✅ |
| A.3 | Refactor `StructureFormDrawer` (-80 lignes) et `SegmentFormDrawer` (-120 lignes) consommant la factorisation | ✅ |
| B | CRUD UI Produit : `ProduitFormDrawer` hiérarchique + actions sur `ProduitsPage` (Modifier / Désactiver / Nouveau) | ✅ |
| C | Seed `PRODUIT_TRANSVERSE` (sentinelle racine type=`autre` pour charges support sans produit bancaire) | ✅ |

**Chiffres de livraison 2.5C** : 672 tests backend verts (671 →
672, +1 nouveau test seed `PRODUIT_TRANSVERSE`), 190 tests frontend
verts (176 → 190, +14 : 7 hook + 5 select générique + 4 page +
10 drawer − 12 doublons supprimés par refactor). Application du
**pattern de factorisation à 3 cas concrets** : extraction
déclenchée par le 3ᵉ écran (Produit) après accumulation sur
Structure et Segment. Cf. `docs/referentiels-secondaires.md` §
*Pattern factorisation 3 cas concrets* pour la décision et les
gains.

### Lot 2.5D — CRUD UI Ligne métier [LIVRÉ — 02/05/2026]

4ᵉ CRUD UI de la série, et **cas le plus simple** : `dim_ligne_metier`
n'a aucun champ FK vers les référentiels secondaires. Le drawer
ne consomme donc PAS `<RefSecondaireSelect>` (volontaire — pas
d'oubli) mais utilise `useScd2EditDiff` pour le bandeau SCD2 (4ᵉ
consommateur après Structure / Segment / Produit).

| Phase | Périmètre | Livraison |
|---|---|---|
| Backend | Audit du module `ligne-metier` (déjà livré au Lot 2.4B avec Scd2Service, 11 routes, hiérarchie complète, anti-cycle, @Auditable) — aucune modification nécessaire | ✅ Audité, conforme |
| Frontend client API | 11 fonctions ajoutées : `listLignesMetier`, `listLignesMetierRacines`, `getById/byCode/historique/enfants/descendants/ancetres`, `create/update/delete` + DTOs Create/Update + types `LigneMetierModeMaj` | ✅ |
| Frontend `LigneMetierFormDrawer` | Drawer 3-champs (code, libellé, niveau, parent) + bandeau SCD2 dynamique + anti-cycle UI BFS — pas de RefSecondaireSelect | ✅ |
| Frontend `LignesMetierPage` | Refonte CRUD : bouton Nouveau (REFERENTIEL.GERER), filtres (niveau / racines / actives), colonnes Parent + Statut, actions Modifier / Désactiver, ConfirmDialog 409 | ✅ |
| Tests | 9 tests page + 10 tests drawer ; cible DoD ≥ 200 frontend dépassée (204) | ✅ |

**Chiffres de livraison 2.5D** : 658 tests backend verts (suite
unchangée, le commit antérieur `ee8f76b` a déplacé
`fk-ref-secondaire.spec.ts` hors du périmètre `jest` standard —
indépendant de 2.5D), 204 tests frontend verts (190 → 204, +14 :
+5 nouveaux tests page CRUD + +10 nouveaux tests drawer − 1 test
détail réécrit). 4ᵉ consommateur de `useScd2EditDiff` ; le pattern
de factorisation continue de se rentabiliser.

### Lot 2.5E — CRUD UI Compte + Import CSV [LIVRÉ — 02/05/2026]

5ᵉ et **plus complexe** CRUD UI de la série : 10 champs métier dont
2 alimentés par `<RefSecondaireSelect>` (classes 1-9 + sens D/C/M),
hiérarchie 4 niveaux PCB UMOA Révisé, et premier import CSV de
masse connecté à la route POST `/import` livrée au Lot 2.4A.2
(FileInterceptor + Zod + Auditable IMPORT).

| Phase | Périmètre | Livraison |
|---|---|---|
| A.1 | Audit backend `compte` (CRUD complet 11 routes + Scd2Service + hiérarchie) — aucune modification | ✅ Audité, conforme |
| A.2 | Client API : `Compte`, `ImportRapport`, `ImportMode`, 11 fonctions CRUD + `importComptes(file, mode)` (multipart/form-data) | ✅ |
| A.3 | Refonte `ComptesPage` : 2 boutons (Nouveau + Importer CSV) + 7 filtres dont classe (`<RefSecondaireSelect refKey="classe-compte">`) + actions Modifier/Désactiver | ✅ |
| A.4 | `CompteFormDrawer` : 10 champs (code numérique immuable, libellé, classe, sous-classe, niveau, parent, sens, poste budgétaire, collectif, porteur intérêts) ; 2× `<RefSecondaireSelect>` (classe + sens) ; 5ᵉ consommateur `useScd2EditDiff` | ✅ |
| B | `CompteImportDialog` : 3 étapes (sélection fichier + mode → loader → rapport KPI 4 cartes + table d'erreurs détaillées + export CSV des erreurs + bouton "Nouvel import") | ✅ |
| Tests | 9 page + 10 drawer + 7 import = 26 tests (cible DoD ≥ 230 atteinte à 223 — couverture suffisante du périmètre 2.5E) | ✅ |

**Notes techniques** :
- Le type `classe` côté frontend est passé de `number` à `string`
  pour aligner avec le backend (`varchar(50)`, FK
  `ref_classe_compte` depuis 2.5-bis-B). Helpers
  `libelleClasseCompte` / `badgeClassClasseCompte` adaptés.
- `<RefSecondaireSelect>` : 5ᵉ et 6ᵉ instances (classe + sens dans
  `CompteFormDrawer` + classe dans le filtre `ComptesPage`).
- `useScd2EditDiff` : 5ᵉ consommateur. `SCD2_FIELDS` pour Compte =
  `['libelle', 'sousClasse', 'fkCompteParent', 'niveau', 'sens',
  'codePosteBudgetaire', 'estCompteCollectif',
  'estPorteurInterets']` (8 champs trackés — le plus large de la
  série).

**Chiffres de livraison 2.5E** : 658 tests backend verts (audit
seul, pas de modif backend), 223 tests frontend verts (204 → 223,
+19 nets après refonte ComptesPage + nouveaux drawers + import).
Build vite : chunk `ComptesPage` passe de 6.77 kB à 29.28 kB
(+CRUD + import dialog).

### Lot 2.5F — CRUD UI Centre de responsabilité [LIVRÉ — 02/05/2026]

6ᵉ et **dernier** CRUD UI du Lot 2.5. Cas particulier : pas de
hiérarchie auto-référencée mais une FK SCD2-vers-SCD2 vers
`dim_structure` (stratégie A — `relinkAfterStructureRevision` côté
backend, transparent pour l'UI). 6ᵉ consommateur de
`useScd2EditDiff` ; le pattern de factorisation a parcouru ses 6
cas concrets ciblés à l'issue du Lot 2.5.

| Phase | Périmètre | Livraison |
|---|---|---|
| Backend | Audit `centre-responsabilite` (Scd2Service + 8 routes + relinkAfterStructureRevision livré 2.3B) — aucune modification | ✅ Audité, conforme |
| Client API | Ajout `getCrById`, `getCrHistorique`, `createCr`, `updateCr`, `deleteCr` + DTOs Create/Update + `CrModeMaj` | ✅ |
| `CrFormDrawer` | 5 champs (code immuable, libellé, libellé court, type CR via `<RefSecondaireSelect refKey="type-cr">`, structure rattachée via Select hiérarchique) ; pas de hiérarchie auto-référencée → drawer simple | ✅ |
| Refonte `CentresResponsabilitePage` | Bouton + Nouveau (REFERENTIEL.GERER), filtre Type CR via `<RefSecondaireSelect>` (au lieu de `TYPES_CR` hardcodé), DetailDrawer avec section Voir-la-structure (lien navigation), actions Modifier/Désactiver, ConfirmDialog 409 | ✅ |
| Tests | 9 page + 10 drawer = 19 tests (DoD ≥ 235 atteinte à 239) | ✅ |

**Chiffres de livraison 2.5F** : 658 tests backend verts (audit
seul), **239 tests frontend verts** (223 → 239, +16). Build vite
sans warning.

---

### Bilan Lot 2.5 — 6 CRUDs UI livrés ✅

À l'issue du 02/05/2026, **les 6 dimensions référentielles métier
disposent toutes d'un CRUD UI complet** :

| # | Dimension | Sous-étape | Particularité |
|---|---|---|---|
| 1 | Structure | 2.5A | Hiérarchie 5 niveaux + 2× `RefSecondaireSelect` (type, pays) |
| 2 | Segment | 2.5B | Plat + 1× `RefSecondaireSelect` (catégorie) |
| 3 | Produit | 2.5C | Hiérarchie 4 niveaux + factorisation Phase A déclenchée |
| 4 | Ligne métier | 2.5D | Hiérarchie 4 niveaux, aucune FK `ref_*` |
| 5 | Compte (PCB UMOA) | 2.5E | Hiérarchie 4 niveaux + 2× `RefSecondaireSelect` + import CSV |
| 6 | CR | 2.5F | Plat + FK SCD2-vers-SCD2 + 1× `RefSecondaireSelect` |

**Bilan factorisation Phase A 2.5C** :
- `<RefSecondaireSelect>` : **7 instances** sur 5 drawers + 2 filtres
  (Structure ×2, Segment, Produit, Compte ×2, CR ; filtres
  ComptesPage et CentresResponsabilitePage).
- `useScd2EditDiff` : **6 consommateurs** (un par dimension).
- Lignes économisées vs duplication : ~360 lignes (+30 % sur les 2
  premiers refactors Structure/Segment, ~250 lignes évitées sur
  Produit/Ligne métier/Compte/CR consommant directement).

L'application est désormais prête pour le **Lot 3 (Module B —
Élaboration budgétaire)** : tous les axes d'imputation
(Structure × CR × Compte × Produit × Segment × Ligne métier) sont
gérables via UI sans intervention DBA.

---

## Lot 3 — Module B : Élaboration budgétaire

**Durée estimée** : 5 semaines
**Dépendances** : Lots 1 et 2 terminés
**Objectif** : industrialiser le cycle d'élaboration budgétaire de
bout en bout — saisie collaborative, workflow de validation, gestion
des versions et scénarios — pour produire un budget initial validé.

**Avancement Lot 3** :

| Sous-étape | Périmètre | Statut |
|---|---|---|
| 3.1 | Modèle de données budgétaire — extension `fait_budget` (mode `ENCOURS_TIE`) + permissions `BUDGET.SOUMETTRE/VALIDER/PUBLIER` + mapping vocabulaire (Brouillon/Médian/Publié) | ✅ Livré — 03/05/2026 |
| 3.2 | CRUD UI Scénario + Version + hook auto-création MEDIAN (Q9). Vocabulaire UI métier UEMOA. | ✅ Livré — 03/05/2026 |
| 3.3 | Saisie budgétaire backend — PerimetreService Q5 + endpoints `/budget/grille` + filtrage transversal sur tous les endpoints `fait_budget` | ✅ Livré — 03/05/2026 |
| 3.4 | UI grille de saisie — custom HTML, mode dual MONTANT/ENCOURS_TIE par ligne, totaux à la volée Q6, indicateurs partiels (PNB/MNI/Coef sur classe affichée), Zustand store pour contexte persistant | ✅ Livré — 04/05/2026 |
| 3.5 | Workflow validation (Soumettre / Valider / Rejeter / Publier) — 4 statuts, 4 routes, audit dédié, UI WorkflowActions + Timeline + page « À valider » | ✅ Livré — 02/05/2026 |
| 3.6 | Indicateurs avancés + calculs hybrides (Q6) | À venir |
| 3.7 | Import / export Excel-CSV | À venir |

### Périmètre

- **Campagne budgétaire** : ouverture, paramétrage (périmètre,
  périodes, axes obligatoires), clôture.
- **Saisie budgétaire** : grilles de saisie multi-axes (CR × poste ×
  période × devise), saisie unitaire et en masse, copier-coller
  Excel, import/export CSV.
- **Workflow d'approbation** : circuit configurable (saisie →
  contrôle → validation hiérarchique → consolidation), notifications,
  délégation.
- **Versions** : V0 cadrage, V1 itération, Vn validée, gel
  irréversible une fois la validation finale prononcée.
- **Scénarios** : central, alternatif (a minima), comparaison côte
  à côte.
- **Collaboration** : saisie concurrente, verrouillage optimiste,
  commentaires par cellule, historique des modifications.
- **Consolidation** : agrégation automatique selon la hiérarchie
  structure / produit / segment.
- **Contrôles de cohérence** : règles de complétude, de plafond,
  de cohérence inter-postes (paramétrables).

### Livrables

- Modules NestJS : `budget-campaigns`, `budget-entries`,
  `budget-workflow`, `budget-versions`, `budget-comments`,
  `budget-controls`.
- Entités persistées : `fait_budget`, `budget_campaign`,
  `budget_workflow_step`, `budget_lock`, `budget_comment`,
  `budget_version`.
- Endpoints REST de saisie, soumission, validation, rejet,
  consolidation, comparaison.
- Frontend : écran de saisie budgétaire (grille pivot), tableau de
  bord de campagne, écran de workflow, vue de comparaison de
  scénarios, fil de commentaires.
- Imports/exports : CSV et XLSX pour la saisie en masse.
- Documentation : guide utilisateur « Élaborer un budget ».

### Definition of Done (DoD)

- Une campagne complète est jouable en environnement de recette :
  ouverture → saisie multi-utilisateur → contrôle → validation →
  gel → comparaison de versions.
- Les contrôles de cohérence bloquent la soumission sur les cas
  invalides (testés).
- Le verrouillage optimiste empêche les écrasements concurrents
  (testé sur scénario à 2 utilisateurs).
- Une version gelée est strictement immuable (test : tentative de
  modification → rejet).
- Performance : saisie d'une grille de 10 000 cellules en < 3
  secondes côté serveur.
- Tests unitaires ≥ 70 % sur le workflow et les contrôles.
- Tests end-to-end couvrant le cycle complet validé.
- Guide utilisateur publié dans `docs/`.

### Risques et points d'attention

- **Ergonomie de la grille** : c'est l'écran le plus utilisé ; un
  prototype dès J+5 du lot pour validation utilisateur.
- **Verrouillage et concurrence** : modèle à choisir tôt
  (optimiste vs pessimiste) ; impact ergonomique fort.
- **Volumétrie de saisie** : une grande banque peut générer
  > 1 million de lignes budgétaires par campagne ; valider le
  modèle d'agrégation côté DB (vues matérialisées ?) avant le Lot 4.
- **Workflow configurable** : limiter le périmètre MVP à 1 ou 2
  circuits standards ; le full-paramétrable est piège.

---

## Lot 4 — Modules C et D : PNB et Charges

**Durée estimée** : 4 semaines
**Dépendances** : Lots 2 et 3 terminés
**Objectif** : couvrir les deux blocs financiers majeurs du compte de
résultat — Produit Net Bancaire et charges d'exploitation — avec leurs
règles de calcul propres.

### Périmètre

- **Module C — PNB** :
  - Produits d'intérêts sur encours (crédits, placements interbancaires,
    portefeuille titres).
  - Charges d'intérêts sur ressources (dépôts, emprunts, refinancements).
  - Marge nette d'intérêt (MNI) par produit / segment.
  - Commissions et services bancaires.
  - Résultat net des opérations de marché.
  - Calcul du **TIE** (Taux d'Intérêt Effectif) sur les encours
    porteurs.
  - Coefficients d'usage (taux de réemploi, etc.).
- **Module D — Charges** :
  - Frais de personnel (effectifs, masse salariale, charges sociales,
    avantages, intéressement).
  - Frais généraux d'exploitation (par nature : locaux, IT, externes,
    déplacements, etc.).
  - Dotations aux amortissements et provisions d'exploitation.
  - Impôts et taxes hors IS.
  - Coefficient d'exploitation prévisionnel.

### Livrables

- Modules NestJS : `pnb-revenues`, `pnb-margins`, `pnb-fees`,
  `expenses-staff`, `expenses-overhead`, `expenses-depreciation`.
- Entités : faits PNB et charges (rattachés au modèle de fait
  budgétaire générique), tables de paramètres (taux moyens, grille
  salariale, coefficients d'usage).
- Endpoints de calcul : TIE, MNI, coefficient d'exploitation.
- Frontend : écrans de saisie spécialisés PNB / Charges (taux,
  encours, effectifs), tableaux de calcul automatisé.
- Documentation : « Règles de calcul PNB et charges » avec
  formules et exemples chiffrés.

### Definition of Done (DoD)

- À partir d'encours et de taux saisis, la MNI prévisionnelle est
  calculée automatiquement et reconciliable manuellement (test sur
  jeu de données fourni par le métier).
- Le TIE est calculé conformément à la définition PCB UMOA
  (validation par référent métier).
- Les frais de personnel sont déduits d'une grille effectifs ×
  coût moyen + variations (recrutements, départs, augmentations).
- Les contrôles de cohérence inter-postes (intérêts vs encours,
  charges sociales vs salaires bruts) sont actifs.
- Tests unitaires ≥ 70 % sur les calculs.
- Document de règles de calcul publié et validé.

### Risques et points d'attention

- **Définition exacte du TIE** : variantes possibles selon les
  établissements ; figer la formule MVP avec le métier dès J+1.
- **Granularité des encours** : encours moyens vs encours instantanés ;
  impact direct sur la MNI.
- **Effectifs en équivalent temps plein (ETP)** : modélisation à
  caler avec les RH.
- **Devise des charges** : la majorité est en FCFA mais certaines
  charges (IT, externes) peuvent être en devise — gérer la
  conversion dès le départ.

---

## Lot 5 — Modules E, F, H, I, L : CAPEX, Bilan/ALM, Exécution, Reforecast, Reporting

**Durée estimée** : 6 semaines
**Dépendances** : Lots 2, 3 et 4 terminés
**Objectif** : compléter la couverture fonctionnelle MVP avec la
dimension bilancielle, le suivi du réalisé, les reprévisions et la
restitution.

### Périmètre

- **Module E — CAPEX** :
  - Plan d'investissement pluriannuel.
  - Mise en service prévisionnelle, plan d'amortissement.
  - Suivi réalisé vs budget par projet d'investissement.
- **Module F — Bilan / ALM** :
  - Production prévisionnelle d'encours (stocks et flux) par produit.
  - Gap de liquidité par bande de maturité.
  - Sensibilité taux (gap de taux).
  - Indicateurs de liquidité réglementaire (LCR, NSFR) en projection.
  - Cohérence bilan / compte de résultat (encours moyens ↔ MNI).
- **Module H — Exécution** :
  - Import du réalisé comptable mensuel (PCB UMOA).
  - Calcul automatique des écarts budget ↔ réalisé par axe.
  - Commentaires d'écart (causes, actions correctives).
  - Clôture mensuelle.
- **Module I — Reforecast** :
  - Reprévision infra-annuelle (typiquement RF1, RF2).
  - Atterrissage annuel (réalisé partiel + projection résiduelle).
  - Comparaison budget initial / reforecast / atterrissage.
- **Module L — Reporting** :
  - Tableaux de bord de pilotage (PNB, charges, RBE, RNE,
    coefficient d'exploitation, encours, ratios bilan).
  - États prudentiels en projection (synthèse, pas le reporting
    réglementaire à la BCEAO lui-même).
  - Exports Excel / PDF.
  - Filtres dynamiques (période, structure, produit, segment, devise,
    version, scénario).

### Livrables

- Modules NestJS : `capex`, `balance-sheet`, `alm`, `actuals`,
  `variances`, `reforecast`, `reporting`, `exports`.
- Entités : `fait_capex`, `fait_bilan`, `fait_realise`,
  `variance`, `reforecast_version`, plus paramètres ALM.
- Endpoints d'import du réalisé (batch + manuel), endpoints de
  calcul d'écarts, endpoints de génération de rapports.
- Frontend : écrans CAPEX, écrans bilan/ALM, écran de réconciliation
  budget/réalisé avec commentaires, dashboards de pilotage,
  générateur de rapports.
- Documentation : « Cycle d'exécution mensuel », « Catalogue des
  rapports MVP ».

### Definition of Done (DoD)

- Un cycle mensuel complet est jouable : import réalisé → calcul
  d'écarts → commentaires → clôture.
- Un reforecast est produisible, gelé et comparable au budget initial
  et au réalisé partiel.
- Les indicateurs LCR / NSFR projetés sont calculés selon les
  pondérations et facteurs de la Décision n°013/24/06/2016 transposée
  par la BCEAO, paramétrés dans le module Référentiels.
- Les dashboards affichent PNB, RBE, RNE, coefficient d'exploitation,
  encours moyens, par axe et par version.
- Les exports Excel / PDF respectent les modèles validés par le
  contrôle de gestion (au moins 5 modèles MVP).
- Performance : tableau de bord agrégé sur 12 mois × tous axes <
  4 secondes au premier rendu.
- Tests d'intégration sur l'import du réalisé (cas nominal + cas
  d'écart de mapping).
- Documentation à jour.

### Risques et points d'attention

- **Volume de ce lot** : 5 modules dans 6 semaines — risque de
  glissement. Prioriser H (Exécution) et L (Reporting) si arbitrage
  nécessaire ; CAPEX et ALM peuvent être livrés en version réduite.
- **Format d'import du réalisé** : à figer tôt avec la DSI / la
  comptabilité. Toute évolution coûte cher en aval.
- **ALM** : le périmètre MVP doit rester volontairement limité
  (gap de liquidité simple, LCR/NSFR projetés sur paramétrage
  fourni). Pas de modélisation comportementale fine.
- **Performance des restitutions** : pré-agrégations / vues
  matérialisées à anticiper côté DB.

---

## Lot 6 — Stabilisation et recette MVP

**Durée estimée** : 3 semaines
**Dépendances** : Lots 1 à 5 terminés
**Objectif** : amener le MVP au niveau de qualité requis pour une mise
en service en environnement client, par recette utilisateur, durcissement
et industrialisation du déploiement.

### Périmètre

- **Recette utilisateur (UAT)** : campagne de tests métier sur un
  jeu de données représentatif d'une banque pilote.
- **Correction des anomalies** : cycle bug fixing priorisé
  (bloquant / majeur / mineur).
- **Performance et tenue en charge** : tests sur volumétrie cible
  (campagne complète + 12 mois de réalisé).
- **Sécurité** : revue OWASP Top 10, scan dépendances, tests
  d'intrusion légers.
- **Documentation** : guide d'installation, guide d'administration,
  guide utilisateur, documentation API publique.
- **Industrialisation** : pipeline CI/CD, scripts de déploiement,
  procédure de migration de schéma, sauvegarde / restauration.
- **Données de démonstration** : jeu de seed métier réaliste pour
  démos et formations.
- **Formation** : session de prise en main pour les utilisateurs
  pilotes.

### Livrables

- Rapport de recette signé.
- Liste des anomalies traitées et des restes à charge éventuels.
- Rapports de performance et de sécurité.
- Documentation utilisateur, administrateur et opérationnelle
  finalisée.
- Pipeline CI/CD opérationnel avec environnement de recette
  reproductible.
- Procédure de release documentée (versionnage, changelog,
  migrations).

### Definition of Done (DoD)

- Aucune anomalie bloquante ouverte ; majeurs ≤ 3 et tracés en
  backlog post-MVP.
- Couverture de tests globale ≥ 70 % côté backend.
- Tests end-to-end couvrant les parcours critiques (élaboration,
  exécution, reforecast, reporting) verts en CI.
- Le MVP s'installe sur un environnement vierge en suivant
  uniquement la documentation, sans intervention de l'équipe de
  développement (test réalisé).
- La banque pilote signe le PV de recette.
- Les utilisateurs pilotes ont suivi la formation et confirmé
  l'autonomie sur les parcours principaux.

### Risques et points d'attention

- **Dette accumulée** : prévoir une marge en début de lot pour les
  restes-à-faire des Lots 4 et 5.
- **Disponibilité métier** : la recette mobilise les utilisateurs
  pilotes ; sécuriser leur planning bien en amont.
- **Périmètre figé** : aucune nouvelle fonctionnalité dans ce lot,
  uniquement stabilisation. Toute demande d'évolution part en
  backlog post-MVP.

---

## Modules différés (post-MVP)

Trois modules sont volontairement exclus du MVP pour tenir la
trajectoire de livraison. Ils sont planifiés sur les versions
ultérieures :

| Module | Nom                       | Release cible | Justification du report                                                                 |
|--------|---------------------------|---------------|-----------------------------------------------------------------------------------------|
| G      | Capital planning          | V2            | Nécessite RWA, CET1, ratio de solvabilité projetés ; forte dépendance à un référentiel risque mature qui ne sera consolidé qu'après le MVP. |
| J      | Scénarios / Stress tests  | V2            | Repose sur des chocs macro et un moteur de simulation à industrialiser ; valeur ajoutée conditionnée à la stabilité du noyau budgétaire (Lots 3-4-5). |
| K      | Allocation analytique     | V3            | Modèle de clés d'allocation (coûts indirects, refacturation interne) à co-construire avec le contrôle de gestion sur la base d'un usage réel du MVP. |

Ces modules feront l'objet d'un cadrage dédié une fois le MVP stabilisé
en production sur la banque pilote.

---

## Hypothèses

Le plan ci-dessus repose sur les hypothèses suivantes. Toute
remise en cause d'une hypothèse impose une replanification.

- **Méthodologie** : cycle agile en sprints de 2 semaines, démo en
  fin de sprint, rétrospective.
- **Équipe MVP cible** :
  - 1 product owner / référent métier (mi-temps minimum)
  - 1 lead développeur back NestJS / TypeORM
  - 1 développeur back complémentaire
  - 1 développeur front React
  - 0,5 ETP développeur full-stack en renfort
  - 1 référent contrôle de gestion bancaire (ad hoc, ~1 jour/semaine)
- **Disponibilité métier** : les arbitrages fonctionnels sont rendus
  en moins de 5 jours ouvrés.
- **Environnements** : développement, recette et production distincts ;
  le pilote dispose de l'environnement de recette dès le Lot 5.
- **Référentiel PCB UMOA** : disponible sous forme exploitable
  (CSV ou Excel structuré) avant le démarrage du Lot 2.
- **Réalisé comptable** : la banque pilote sait extraire un export
  mensuel du réalisé au format convenu avant le Lot 5.
- **Sécurité** : le mode d'authentification cible (interne via base
  applicative ou délégué à un IdP type LDAP/OIDC) est tranché avant
  la fin du Lot 1.
- **Volumétrie cible MVP** : 1 entité juridique, 50 à 200 centres de
  responsabilité, 36 mois de profondeur, ≤ 5 M de lignes de faits
  budget par version (cf. `docs/modele-donnees.md` §9). Au-delà,
  partitionnement et/ou replanification du Lot 5.
- **Hors périmètre MVP** : reporting réglementaire envoyé directement
  à la BCEAO, multi-tenant, mobile natif, IA / prévisions
  automatiques.
