# Roadmap MVP — Module Budgétaire Bancaire UEMOA (MIZNAS)

> Plan d'exécution détaillé des 6 lots du MVP, basé sur les
> spécifications fonctionnelles V1.0 (avril 2026) et le plan d'exécution
> projet. Chaque lot précise son périmètre, ses livrables, ses critères
> d'achèvement (DoD) et ses dépendances.

État actuel : **Lot 2 en cours**. Sous-étapes 2.1 (socle SCD2 +
import CSV) et 2.2 (`dim_temps` + `dim_devise` + frontend
consultation) livrées sur `main`. Prochaine étape : **2.3** —
premières dimensions SCD2 réelles (`dim_structure`,
`dim_centre_responsabilite`).

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
| Lot 2 | 4 semaines    | Module A — Référentiels (PCB UMOA, structure, axes)       | En cours (2.2 livré : socle SCD2, dim_temps, dim_devise + frontend lecture) |
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

---

## Lot 3 — Module B : Élaboration budgétaire

**Durée estimée** : 5 semaines
**Dépendances** : Lots 1 et 2 terminés
**Objectif** : industrialiser le cycle d'élaboration budgétaire de
bout en bout — saisie collaborative, workflow de validation, gestion
des versions et scénarios — pour produire un budget initial validé.

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
