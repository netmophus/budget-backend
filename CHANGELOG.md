# Changelog — MIZNAS Budget Backend

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/).
Le module respecte SemVer informel par lot (Lot N = jalons figés
en interne pour BSIC ; pas de release publique).

---

## [Lot 5] — 2026-05 — Module Exécution (réalisé, tableau de bord, reforecast)

Le Lot 5 ouvre le **module Exécution** de MIZNAS : capture du
réalisé budgétaire mensuel, restitution agrégée des écarts budget
vs réalisé, et reforecast trimestriel avec workflow de validation
+ écrasement OBSOLETE.

Doc consolidée : [`docs/lot-5/README.md`](docs/lot-5/README.md).

### Réalisé (Lot 5.1 + 5.1-fix1)

- Nouvelle table `fait_realise` (grain mensuel sur 5 dimensions :
  CR / compte / ligne_metier / temps / devise), workflow simple
  2 statuts unidirectionnel `IMPORTE → VALIDE` (décision Q4).
- 5 permissions RBAC `REALISE.LIRE` / `REALISE.SAISIR` /
  `REALISE.IMPORTER` / `REALISE.VALIDER` / `REALISE.SUPPRIMER`
  attribuées aux rôles métier existants.
- 4 codes audit `IMPORTER_REALISE` / `SAISIR_REALISE` /
  `VALIDER_REALISE` / `SUPPRIMER_REALISE`.
- Page `/realise/saisie` : grille mensuelle + dialogues création
  / modification / validation en lot / import Excel/CSV avec
  rapport détaillé (lignes OK / KO + raisons).
- Filtrage périmètre uniquement à l'écriture (saisie + import) ;
  lecture transverse (cohérent décision ADMIN.D du Lot
  Administration).
- Fix 5.1-fix1 : résolution `YYYY-MM`→`fk_temps` via endpoint
  dédié `/referentiels/temps/par-date/:date` (l'ancienne stratégie
  de filtrage par query params était bloquée par le
  ValidationPipe `whitelist=true`).

### Tableau de bord budget vs réalisé (Lot 5.2 + 5.2-fix1/2 + 5-fix-ui)

- Service d'agrégation `AnalyseEcartsService` : 1 seule passe SQL
  avec `LEFT JOIN` sur `fait_realise statut='VALIDE'` pour avoir
  les lignes `MANQUANT` (budget existe, pas de réalisé) sans
  double requête.
- 4 niveaux d'alerte paramétrables : `NORMAL` / `ATTENTION` (≥
  seuil_attention %) / `CRITIQUE` (≥ seuil_critique %) /
  `MANQUANT` (réalisé null).
- Sens UEMOA selon classe compte : classe 6 = `CHARGE` (favorable
  si réalisé < budget), classe 7 = `PRODUIT` (favorable si
  réalisé > budget), autres = `BILAN` toujours `NEUTRE`.
- Export Excel 3 onglets (Synthèse / Détail des écarts / Filtres)
  avec couleurs conditionnelles sur la colonne « Niveau ».
- Page `/tableau-de-bord/budget-vs-realise` : 4 KPI cards +
  filtres + tableau triable + filtre rapide
  (TOUS / CRITIQUE / ATTENTION / MANQUANT) + recherche par CR /
  compte.
- Permission **double** `BUDGET.LIRE ∧ REALISE.LIRE` (mode `all`).
- Fix 5.2-fix1 : sérialisation axios `crIds` en format « repeat »
  (`crIds=14&crIds=15`) au lieu de `brackets` rejeté par le DTO.
- Fix 5.2-fix2 : DTO accepte scalaire ou array via `@Transform`
  (le cas un seul CR sélectionné produisait une string scalaire).
- Fix 5-fix-ui : bug racine du libellé « Mois NaN 2027 » (pilote
  pg renvoie `Date` JS, slice produisait `"Wed Mar"`) corrigé via
  lecture directe `t.mois` / `t.annee` au lieu de slicer ; helper
  frontend partagé `formaterMois()` pour toutes les pages
  (corrige aussi « Mars 2027 2027 » dans la grille réalisé) ; KPI
  cards passent à « — » en cas d'erreur API.

### Reforecast trimestriel (Lot 5.3.A backend + 5.3.B frontend)

- Extension de `dim_version` avec 9 colonnes pour gérer les
  versions de type `'reforecast'` :
  - métadonnées de génération : `fk_version_source`,
    `fk_scenario_source`, `trimestre_consolide`,
    `annee_consolide`, `methode_extrapolation`
  - cycle de vie d'écrasement : `statut_publication`
    (ACTIVE/OBSOLETE), `date_obsolescence`,
    `fk_version_remplacante`
- 1 nouvelle permission `BUDGET.REFORECAST_LANCER` attribuée à
  ADMIN + VALIDATEUR ; le workflow réutilise les permissions
  existantes (`BUDGET.SAISIR/SOUMETTRE/VALIDER/PUBLIER`) — Q3
  produit.
- 6 codes audit `LANCER_REFORECAST` /
  `SOUMETTRE/VALIDER/REJETER/PUBLIER_REFORECAST` /
  `MARQUER_REFORECAST_OBSOLETE` ; le `VersionWorkflowService`
  émet `*_REFORECAST` à la place de `*_BUDGET` quand
  `type_version='reforecast'` (helper `codeAudit()` polymorphe,
  0 duplication).
- Service `ReforecastService.lancer()` transactionnel :
  validations (version source `gele`, scénario actif, trimestre
  ∈ [1,4], ≥ 1 fait_realise VALIDE), création nouvelle version
  REFORECAST en BROUILLON ACTIVE, génération automatique des
  lignes `fait_budget` extrapolées selon 3 méthodes
  (`MOYENNE_TRIMESTRE`, `BUDGET_INITIAL`, `MANUELLE`), marquage
  OBSOLETE des reforecasts ACTIVE pré-existants pour la même
  clé (Q1 produit — décision d'écrasement).
- 8 endpoints REST sous `/reforecast` (lancer / lister / détail /
  grille / comparaison / soumettre / valider / rejeter / publier).
- Page `/reforecast` (liste avec filtres + bouton « Lancer ») et
  `/reforecast/:id` (détail avec onglets Grille + Comparaison vs
  source + boutons workflow polymorphes + banner OBSOLETE).
- Composant `Tabs` maison (sans Radix pour respecter la
  contrainte « aucune nouvelle dépendance npm »).

### Recette + doc (Lot 5.4)

- 7 scénarios bout-en-bout R1 → R7 documentés dans
  [`docs/lot-5/recette.md`](docs/lot-5/recette.md) avec
  pré-requis + étapes UI + vérifications SQL + cas négatifs.
- 5 diagrammes mermaid dans
  [`docs/lot-5/sequences.md`](docs/lot-5/sequences.md) couvrant
  saisie/validation réalisé, import Excel, tableau de bord,
  reforecast workflow et arbre de décision « origine cellule ».
- Grille de suivi recette en bas du fichier `recette.md` (à
  remplir par les contrôleurs au fur et à mesure).

### Migrations

| # | Fichier | Lot |
|---|---------|-----|
| **053** | `1779200000150-CreerFaitRealiseEtPermissions.ts` | 5.1 |
| **055** | `1779200000160-AjoutReforecastTrimestriel.ts` | 5.3 |

Toutes idempotentes.

### Tests

- Tests automatisés ajoutés Lot 5 : ~286 (~103 backend + ~183
  frontend cumulés).
- Tests totaux MIZNAS : **1082 backend + 536 frontend = 1618**
  verts, 0 régression cumulée depuis Lot 1.

---

## [Lot 4] — 2026-05 — Multi-périmètres, délégations, notifications

Le Lot 4 ferme le module budgétaire en lui donnant ses trois
capacités transverses transverses : périmètres flexibles,
délégations de droits temporaires et notifications email.

Doc consolidée : [`docs/lot-4/README.md`](docs/lot-4/README.md).

### Multi-périmètres (Lot 4.1 + 4.1-fix1/2/3)

- Nouvelle table `user_perimetres` portant les affectations
  flexibles (`STRUCTURE` / `CR` / `CR_SET ≥ 2`), origine
  (`PRINCIPAL` / `AFFECTATION` / `DELEGATION`), période
  optionnelle, soft-delete `actif`.
- Backfill depuis `bridge_user_role` à la migration : zéro perte
  de périmètre existant.
- Page `/admin/affectations` listant tous les users actifs
  (badge nombre de périmètres) + dialogue de création
  multi-cibles.
- Audit transactionnel `CREER_AFFECTATION` /
  `RETIRER_AFFECTATION` (Lot 4.1-fix2.B).
- Index unique partial anti-doublons CR_SET (Lot 4.1-fix2.C).
- 4 rôles métier créés et bascule des 6 personas BSIC :
  SAISISSEUR, VALIDATEUR, PUBLICATEUR, AUDITEUR (Lot 4.1-fix3).

### Délégations (Lot 4.2 + 4.2-fix1/3)

- Nouvelle table `delegations` avec contraintes CHECK strictes
  (diff_users, dates, périmètres non vide, permissions valides
  parmi SAISIE/SOUMISSION/VALIDATION/PUBLICATION).
- 2 nouvelles permissions `DELEGATION.LIRE` (lecture de ses
  propres délégations, attribuée à tous les rôles métier) et
  `DELEGATION.GERER` (ADMIN uniquement, supervision globale +
  révocation tierce).
- **Anti-chaînage strict (D2 NON-NÉGOCIABLE BCEAO)** :
  une permission reçue par délégation ne peut PAS être
  re-déléguée. Vérification appliquée 2 fois (UI + API).
- Cron quotidien d'expiration `@Cron('0 2 * * *')` +
  `OnApplicationBootstrap` pour rattrapage au démarrage.
- Page `/mes-delegations` (2 onglets Reçues/Émises) +
  `/admin/delegations` (DELEGATION.GERER) avec filtre par statut.
- Bandeau global discret sur `/budget/saisie` et
  `/budget/a-valider` quand l'utilisateur a des délégations
  actives reçues.
- `via_delegation_id` câblé sur 6 actions métier
  (`SOUMETTRE_BUDGET`, `VALIDER_BUDGET`, `REJETER_BUDGET`,
  `PUBLIER_BUDGET`, `IMPORT_BUDGET`, `IMPORT_BUDGET_BULK`) avec
  priorité NATIF si l'utilisateur possède aussi la permission
  nativement (Lot 4.2-fix.A).
- Limite `listUsers` ramenée à 100 dans `CreerDelegationDialog`
  pour respecter `@Max(100)` backend (Lot 4.2-fix3).

### Notifications email (Lot 4.3)

- Nouvelle table `email_log` avec snapshot destinataire, payload
  jsonb, statut (EN_ATTENTE / ENVOYE / ECHEC / SUPPRIME),
  tentatives, dernier message d'erreur ; trace systématique de
  chaque envoi (réel, dry-run, supprimé par préférence).
- 8 événements câblés (E1 → E5, E7, E8, E9) ; E6 (rappel
  délégation J-3) explicitement reporté Lot 6.
- 8 templates Handlebars + 1 layout institutionnel français
  (pas d'images externes ni pixel tracking, mention BCEAO sur
  publication et délégation).
- Mode `EMAIL_DRY_RUN=true` (défaut dev) : aucun appel SMTP, ligne
  `email_log` SUPPRIME avec motif `EMAIL_DRY_RUN=true`.
- Retry simple synchrone : 3 tentatives × backoff 1s/3s/10s.
- Préférences utilisateur en 2 colonnes ajoutées sur `"user"`
  (`notifications_email_actives` BOOLEAN DEFAULT true,
  `notifications_email_types` TEXT[] DEFAULT NULL = tous types).
- Page admin `/admin/email-log` (USER.GERER) avec filtres et
  bouton « Rejouer » sur les ECHEC.
- Page user `/me/preferences` avec toggle global + multi-select
  des 8 types ; logique « tous cochés ⇒ NULL côté API ».
- Couplage faible via `@nestjs/event-emitter` : les services
  métier émettent et oublient ; un échec d'envoi ne remonte
  JAMAIS vers l'action métier déjà committée.

### Recette transverse + documentation (Lot 4.4)

- 7 scénarios E2E documentés
  ([`docs/lot-4/recette.md`](docs/lot-4/recette.md)) couvrant
  multi-périmètres simples + CR_SET temporel, délégation cycle
  complet, expiration cron, anti-chaînage strict, workflow
  budget × emails, dry-run + opt-out user.
- 4 diagrammes mermaid de séquence des flux principaux
  ([`docs/lot-4/sequences.md`](docs/lot-4/sequences.md)).
- Doc consolidée Lot 4 avec migrations 047-052, RBAC ajoutés,
  codes audit, métriques globales
  ([`docs/lot-4/README.md`](docs/lot-4/README.md)).
- Grille de suivi d'exécution recette (à remplir au fil des
  campagnes).

### Migrations

| # | Fichier | Sous-lot |
|---|---------|----------|
| 047 | `1779200000080-AjoutUserPerimetres.ts` | 4.1 |
| 048 | `1779200000090-AjouterPersonasBSIC.ts` | 4.1-fix |
| 049 | `1779200000100-Lot41Fix2DataPatches.ts` | 4.1-fix2 |
| 050 | `1779200000110-CreerRolesMetierEtBasculePersonasBSIC.ts` | 4.1-fix3 |
| 051 | `1779200000120-CreerTableDelegations.ts` | 4.2 |
| 052 | `1779200000130-CreerEmailLogEtPreferencesNotifications.ts` | 4.3 |

Toutes idempotentes (CREATE IF NOT EXISTS, ON CONFLICT DO NOTHING,
ADD CONSTRAINT conditionnel via information_schema).

### Tests

- **918 backend** + **414 frontend = 1332 tests verts** au total.
- ~165 nouveaux tests Lot 4 (multi-périmètres, délégations,
  notifications, intégration listener, templates).
- 0 régression cumulée depuis Lot 1.

### Dette technique tracée pour Lot 6

- E6 rappel délégation J-3 (cron dédié + anti-doublon par jour).
- Migration retry email vers BullMQ + Redis (élimine le retry
  synchrone qui peut bloquer la requête HTTP jusqu'à 14 s).
- Outbox pattern post-commit (résilience si crash entre
  COMMIT et `events.emit()`).
- Internationalisation des templates email (français uniquement
  aujourd'hui).
- Preview HTML admin d'un email envoyé.
- Cookie de désinscription en 1 clic (alternative à
  `/me/preferences`).
- Autocomplete avec recherche serveur dans
  `CreerDelegationDialog` (limit fixe de 100 ne scalera pas
  pour des banques avec >100 users).
- UI gestion des rôles (admin n'a pas de page web — passe par
  les seeds ou UPDATE SQL directs).

---

## [Lot 3] — 2026-04 — Module budget complet (saisie, validation, indicateurs, import)

(Cf. historique git pour le détail. Les highlights : workflow
4 statuts ouvert/soumis/valide/gele, indicateurs PNB/MNI/Coef,
import Excel/CSV avec rollback >10 % erreurs.)

## [Lot 2] — 2026-02 → 2026-03 — Référentiels SCD2

Dimensions principales (compte, structure, CR, ligne_metier,
produit, segment, devise, temps, version, scenario) en pattern
SCD2 + 13 référentiels secondaires paramétrables.

## [Lot 1] — 2026-01 — Authentification + RBAC + audit

JWT + refresh, RBAC à 3 niveaux (rôles globaux + rôles avec
périmètre structure / CR), `audit_log` 10 ans BCEAO, 8 codes
audit initiaux (LOGIN/LOGOUT/CREATE/UPDATE/DELETE/...).
