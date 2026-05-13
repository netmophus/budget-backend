# Recette MVP MIZNAS — v1.0.0

> **Statut** : documentaire — à exécuter par la banque pilote (BSIC) en pré-prod
> avant la mise en production. Le tag `v1.0.0-mvp` posé sur les 2 mains
> (backend + frontend) certifie le **code livré + ~1736 tests automatisés
> verts**, pas l'exécution de cette recette.
>
> 15 scénarios bout-en-bout (UI + API + audit + emails + cron) couvrant les
> capacités fonctionnelles **Lots 5 (Module Exécution) + 6.3-6.7 (Industrialisation
> sécurité, notifications résiduelles, UX résiduel)**. Les capacités du Lot 4
> (multi-périmètres, délégations, notifications) ont leur propre recette
> archivée : voir [`docs/lot-4/recette.md`](lot-4/recette.md).
>
> Document produit en clôture du **Lot 6.8** (recette finale + doc release MVP).
> Toute évolution future fait l'objet d'une nouvelle révision (`vX.Y.Z`).

---

## Table des matières

- [0. Pré-requis communs](#0-pré-requis-communs)
- [Tableau de suivi global](#tableau-de-suivi-global)
- [R1 — Saisie + validation réalisé cross-user](#r1--saisie--validation-réalisé-cross-user)
- [R2 — Import Excel réalisé](#r2--import-excel-réalisé)
- [R3 — Tableau de bord budget vs réalisé + export Excel](#r3--tableau-de-bord-budget-vs-réalisé--export-excel)
- [R4 — Reforecast nominal méthode MOYENNE_TRIMESTRE](#r4--reforecast-nominal-méthode-moyenne_trimestre)
- [R5 — Reforecast workflow soumission / rejet / resoumission / validation / publication](#r5--reforecast-workflow-soumission--rejet--resoumission--validation--publication)
- [R6 — Écrasement OBSOLETE](#r6--écrasement-obsolete)
- [R7 — RBAC + filtrage périmètre cross-module](#r7--rbac--filtrage-périmètre-cross-module)
- [R8 — Healthcheck Redis dégradé + monitoring queue emails](#r8--healthcheck-redis-dégradé--monitoring-queue-emails)
- [R9 — Politique mdp + expiration + ForceChangePasswordPage (3 cas)](#r9--politique-mdp--expiration--forcechangepasswordpage-3-cas)
- [R10 — Rate limiting login + audit `LOGIN_RATE_LIMITED`](#r10--rate-limiting-login--audit-login_rate_limited)
- [R11 — Reset password admin async via queue + force-changement-mdp](#r11--reset-password-admin-async-via-queue--force-changement-mdp)
- [R12 — Forgot password self-service (cycle complet anti-énumération)](#r12--forgot-password-self-service-cycle-complet-anti-énumération)
- [R13 — Rappel J-3 délégation via cron quotidien](#r13--rappel-j-3-délégation-via-cron-quotidien)
- [R14 — Tooltips délégation Z1 (permissions) + Z2 (rôles métier)](#r14--tooltips-délégation-z1-permissions--z2-rôles-métier)
- [R15 — Découvrabilité édition reforecast inline](#r15--découvrabilité-édition-reforecast-inline)
- [Synthèse — capacités validées par la recette](#synthèse--capacités-validées-par-la-recette)
- [Suivi d'exécution détaillé](#suivi-dexécution-détaillé)

---

## 0. Pré-requis communs

### 0.1 Environnement

- **Backend** MIZNAS démarré (`npm run start:dev` dans `budjet-backend`).
- **Frontend** MIZNAS démarré (`npm run dev` dans `budjet-frontend`), accessible
  sur `http://localhost:5173`.
- **Postgres 18+** accessible avec **55+ migrations** appliquées
  (`npm run migration:run` — voir `src/migrations/`).
- **Redis 7+** accessible sur `localhost:6379` (BullMQ queue `emails` Lot 6.3) :
  ```bash
  docker compose -f docker-compose.dev.yml up -d
  # container : miznas-redis-dev
  ```
- **SMTP de capture Mailhog** disponible sur `localhost:1025` (UI sur
  `http://localhost:8025`) — alternative : `EMAIL_DRY_RUN=true` selon le scénario.
- **Personas BSIC seedés** (cf. migrations 048 et 050) :

  | Email | Prénom | Rôle métier | Mot de passe seed |
  |-------|--------|-------------|-------------------|
  | `admin@miznas.local` | Admin MIZNAS | ADMIN | défini par `SEED_ADMIN_PASSWORD` (fallback dev : `ChangeMe!2026`) |
  | `lecteur@miznas.local` | Lecteur Test | LECTEUR | défini par `SEED_LECTEUR_PASSWORD` (fallback dev : `Lecteur!2026`) |
  | `adj.retail@miznas.local` | Fatima | SAISISSEUR | `MiznasTest!2026` |
  | `dir.retail@miznas.local` | Amadou | VALIDATEUR | `MiznasTest!2026` |
  | `dir.corporate@miznas.local` | Ibrahim | VALIDATEUR | `MiznasTest!2026` |
  | `controleur.gestion@miznas.local` | Aïcha | VALIDATEUR | `MiznasTest!2026` |
  | `auditeur@miznas.local` | Moussa | AUDITEUR | `MiznasTest!2026` |
  | `dga.exploitation@miznas.local` | Salif | PUBLICATEUR | `MiznasTest!2026` |

  > ⚠️ **Sécurité 1er déploiement** : les 6 personas BSIC ont **tous le
  > même mot de passe seed `MiznasTest!2026`** (hash bcrypt fixe dans
  > la migration `1779200000090-AjouterPersonasBSIC.ts`). Ces comptes
  > sont des **profils de smoke test** — ils doivent être **désactivés
  > ou avoir leurs mots de passe rotés** avant tout usage non-test en
  > pré-prod / production.

### 0.2 Données de référence (à vérifier dans l'instance BSIC)

Les scénarios R1-R6 utilisent les **placeholders** suivants, à adapter au
seed réellement chargé dans l'instance de recette :

| Placeholder | Sens | Exemple seed BSIC |
|-------------|------|-------------------|
| `STRUCTURE_RETAIL` | Structure organisationnelle retail | Code à vérifier via `SELECT code_structure FROM dim_structure WHERE est_actif AND version_courante=true` |
| `CR_AG_<...>` | Code CR cible des saisies | `CR_AG_ABJ_PLATEAU` (Côte d'Ivoire) — ajuster selon `SELECT code_cr FROM dim_centre_responsabilite WHERE est_actif AND version_courante=true` |
| `701100` | Code compte PCB UMOA produit (classe 7) | Compte « Commissions de tenue de compte » dans le PCB Révisé importé via Lot 2.4 |
| `BUDGET_INITIAL_2027` | Code version source budget initial gelé | À adapter à l'exercice fiscal courant |
| `OPTIMISTE_2027` | Code scénario actif | À adapter à votre cadrage |

Si un placeholder n'existe pas dans votre instance, créez-le avant
l'exécution OU adaptez les étapes/SQL en conséquence. Les codes audit, codes
HTTP, statuts et libellés UI sont en revanche **conformes au code livré
v1.0.0-mvp**.

### 0.3 Outils complémentaires

- Une fenêtre `psql` (ou DBeaver / pgAdmin) connectée à la base
  (`DB_NAME`) en parallèle pour les vérifications SQL — toutes les
  requêtes du document sont réutilisables verbatim.
- L'UI Mailhog (`http://localhost:8025`) ouverte en parallèle pour les
  scénarios qui vérifient des envois d'email (R6 [Lot 4 archivé],
  R11, R12, R13).
- Un éditeur de tableur (Excel ≥ 2016 ou LibreOffice Calc) pour vérifier
  les exports XLSX et préparer le fichier d'import R2.
- Un terminal avec `docker` pour stop/start le container Redis (R8).
- (Optionnel) Un décodeur JWT type [jwt.io](https://jwt.io) pour
  inspecter les flags `mdpExpire`, `dcm`, `mdpExpireProchainement` dans
  le payload (R9).

### 0.4 Variables d'environnement clés

| Variable | Valeur recette typique | Référence |
|----------|------------------------|-----------|
| `LOGIN_RATE_LIMIT_DISABLED` | `false` (production) — autoriser quelques essais avant R10 | Lot 6.4.B |
| `EMAIL_DRY_RUN` | `false` (Mailhog reçoit) sauf scénario R7.A archive | Lot 4.3 |
| `MDP_DUREE_VALIDITE_JOURS` | `90` (défaut) | Lot 6.4.A |
| `APP_BASE_URL` | `http://localhost:5173` | Lot 4.3 + Lot 6.5.A |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6379` | Lot 6.3 |
| `SEED_ADMIN_PASSWORD` | mdp policy-conforme (≥ 12 + complexité Lot 6.4.A) | Lot 1 |

### 0.5 Conventions du document

Chaque scénario est structuré :

- **Objectif** : capacité validée
- **Pré-requis** : état de base spécifique au scénario
- **Étapes** : action → résultat attendu (numérotées)
- **Vérifications SQL** : requêtes à exécuter pour valider
- **Cas négatifs** : ce qui doit **ÉCHOUER**
- **Critères de validation finale** : checklist ✅ pour conclure le scénario

### 0.6 Notes de version — mises à jour des R1-R7 vs `docs/lot-5/recette.md`

Les scénarios R1-R7 sont issus de `docs/lot-5/recette.md` (recette Lot 5,
livrée 2026-05). Pour la consolidation MVP v1.0.0, les ajustements
suivants ont été appliqués sans modifier les capacités testées :

- **Placeholder `CR_AG_BANDABARI`** (non seedé en BSIC) → remplacé par
  `CR_AG_ABJ_PLATEAU` (1er CR seedé Côte d'Ivoire) avec mention en 0.2.
- **R5 mention bouton « Éditer dans la saisie budgétaire »** → libellé
  actualisé en **« Éditer ce reforecast »** (renommage Lot 6.7.3).
- **R7 vérifications SQL `bridge_user_role.est_actif`** → conservé tel
  quel (schéma inchangé depuis Lot 4.1-fix3).
- Le tableau de suivi en fin de doc est **vierge** pour permettre une
  exécution propre par la banque pilote.

---

## Tableau de suivi global

Légende : ⬜ à faire / ✅ passé / ❌ échec / ⚠️ partiel (anomalie non bloquante,
voir notes)

| # | Scénario | Date | Exécutant | Statut | Notes |
|---|----------|------|-----------|--------|-------|
| **R1** | Saisie + validation réalisé cross-user | | | ⬜ | |
| **R2** | Import Excel réalisé | | | ⬜ | |
| **R3** | Tableau de bord budget vs réalisé + export Excel | | | ⬜ | |
| **R4** | Reforecast nominal MOYENNE_TRIMESTRE | | | ⬜ | |
| **R5** | Reforecast workflow soumission/rejet/resoumission/validation/publication | | | ⬜ | |
| **R6** | Écrasement OBSOLETE | | | ⬜ | |
| **R7** | RBAC + filtrage périmètre cross-module | | | ⬜ | |
| **R8** | Healthcheck Redis dégradé + monitoring queue emails | | | ⬜ | |
| **R9** | Politique mdp + expiration + ForceChangePasswordPage (3 cas) | | | ⬜ | |
| **R10** | Rate limiting login + audit `LOGIN_RATE_LIMITED` | | | ⬜ | |
| **R11** | Reset password admin async via queue + force-changement-mdp | | | ⬜ | |
| **R12** | Forgot password self-service (cycle complet anti-énumération) | | | ⬜ | |
| **R13** | Rappel J-3 délégation via cron quotidien | | | ⬜ | |
| **R14** | Tooltips délégation Z1 (permissions) + Z2 (rôles métier) | | | ⬜ | |
| **R15** | Découvrabilité édition reforecast inline | | | ⬜ | |

> Cf. [Suivi d'exécution détaillé](#suivi-dexécution-détaillé) en fin de doc
> pour le tableau étendu (réexécutions multiples, anomalies, actions
> correctives).

---

## R1 — Saisie + validation réalisé cross-user

**Objectif** : valider la saisie manuelle puis la validation par un autre
utilisateur (séparation des rôles `REALISE.SAISIR` / `REALISE.VALIDER`).
Lot 5.1.

### Pré-requis

- Au moins 1 ligne `fait_budget` sur le compte `701100` (Commissions de tenue
  de compte) en mars 2027 sur `CR_AG_ABJ_PLATEAU` pour la version
  `BUDGET_INITIAL_2027`.
- Amadou (`dir.retail@miznas.local`, VALIDATEUR) a `REALISE.VALIDER` (rôle
  VALIDATEUR — cf. Lot 5.1 seed `bridge_role_permission`). Fatima
  (`adj.retail@miznas.local`, SAISISSEUR) a `REALISE.SAISIR`.

### Étapes

1. **Connexion Fatima** (`adj.retail`, SAISISSEUR).
2. Aller sur `/realise/saisie`.
3. Sélectionner `CR=CR_AG_ABJ_PLATEAU`, mois début = 2027-01, mois fin =
   2027-03, devise = `XOF`.
4. La grille s'affiche avec 3 mois × N comptes. Tous les statuts sont
   `IMPORTE` ou vides.
5. Cliquer **« Nouvelle ligne »** sur le compte `701100`, mois mars 2027,
   ligne métier `EXPLOITATION`.
6. Saisir montant `4 800 000`, mode `MNT`, commentaire « Recette R1 — saisie
   initiale ».
7. Cliquer **« Enregistrer »**. Toast succès. La grille affiche la nouvelle
   ligne en statut `IMPORTE` (badge ambre).
8. **Déconnexion** Fatima. **Connexion** Amadou (`dir.retail`).
9. Aller sur `/realise/saisie`, mêmes filtres.
10. La grille montre la ligne saisie par Fatima (statut `IMPORTE`).
11. Cocher la ligne, cliquer **« Valider la sélection »**.
12. Dialogue de validation : récap « 1 ligne(s) seront validées » + ligne
    « 701100 — Commissions de tenue de compte : 1 ligne(s) ».
13. Cliquer **« Valider 1 ligne(s) »**. Toast « 1 ligne(s) validée(s). »
14. La ligne passe en statut `VALIDE` (badge vert) ; `valide_le` et
    `fk_valide_par` sont posés.

### Vérifications SQL

```sql
-- La ligne validée
SELECT fr.id, fr.statut, fr.montant, fr.valide_le,
       u.email AS valide_par
  FROM fait_realise fr
  LEFT JOIN "user" u ON u.id = fr.fk_valide_par
 WHERE fr.fk_centre_responsabilite = (
         SELECT id FROM dim_centre_responsabilite
          WHERE code_cr='CR_AG_ABJ_PLATEAU' AND version_courante=true)
   AND fr.fk_compte = (
         SELECT id FROM dim_compte WHERE code_compte='701100' AND version_courante=true)
   AND fr.fk_temps = (
         SELECT id FROM dim_temps WHERE date='2027-03-01' AND jour=1);
-- Attendu : statut=VALIDE, valide_par='dir.retail@miznas.local'

-- 2 lignes audit (saisie par Fatima + validation par Amadou)
SELECT type_action, utilisateur, date_action
  FROM audit_log
 WHERE entite_cible='fait_realise'
   AND id_cible::bigint = <id_de_la_ligne>
 ORDER BY date_action;
-- Attendu : SAISIR_REALISE par adj.retail puis VALIDER_REALISE par dir.retail
```

### Cas négatifs

- **Tentative `DELETE`** côté Amadou sur la ligne `VALIDE` → 422
  (statut=VALIDE non supprimable, `REALISE.SUPPRIMER` ne suffit pas une
  fois la ligne validée).
- **Fatima tente de valider sa propre ligne** → bouton « Valider la
  sélection » non visible (pas de `REALISE.VALIDER` pour SAISISSEUR).

### Critères de validation finale ✅

- [ ] La ligne saisie par Fatima apparaît en statut `IMPORTE` puis `VALIDE`
- [ ] Audit `SAISIR_REALISE` + `VALIDER_REALISE` distincts (2 utilisateurs)
- [ ] `fk_valide_par` pointe sur l'id d'Amadou (`dir.retail`)
- [ ] Les cas négatifs renvoient bien 422 / bouton caché

---

## R2 — Import Excel réalisé

**Objectif** : valider l'import en lot par fichier Excel/CSV avec rapport
détaillé (lignes OK / KO + raisons). Lot 5.1.B.

### Pré-requis

- Fichier `realise-2027-q1.xlsx` (ou CSV) avec 6 colonnes : `code_cr`,
  `code_compte`, `code_ligne_metier`, `mois` (YYYY-MM), `montant`,
  `code_devise`. ≥ 50 lignes valides + 3 lignes intentionnellement
  invalides (compte inexistant, mois mal formé, montant négatif).

### Étapes

1. **Connexion Fatima** (`adj.retail`, SAISISSEUR).
2. Aller sur `/realise/saisie`.
3. Cliquer **« Importer »**. Dialogue d'import s'ouvre.
4. Glisser-déposer le fichier `realise-2027-q1.xlsx`.
5. Cliquer **« Lancer l'import »**. Loading.
6. Le rapport s'affiche : « 50 ligne(s) créée(s), 3 ligne(s) rejetée(s) ».
   Détail des 3 erreurs avec ligne du fichier + motif.
7. Fermer le dialogue. La grille est rechargée avec les nouvelles lignes en
   `IMPORTE`.

### Vérifications SQL

```sql
-- 50 nouvelles lignes IMPORTE par Fatima
SELECT statut, source, COUNT(*)
  FROM fait_realise
 WHERE source='IMPORT'
   AND date_creation > NOW() - interval '5 minutes'
 GROUP BY statut, source;
-- Attendu : 50 lignes statut=IMPORTE source=IMPORT

-- 1 ligne audit IMPORTER_REALISE pour le fichier
SELECT type_action, payload_apres
  FROM audit_log
 WHERE type_action='IMPORTER_REALISE'
   AND utilisateur='adj.retail@miznas.local'
 ORDER BY date_action DESC LIMIT 1;
-- Attendu : payload contient nbCrees=50, nbRejets=3
```

### Cas négatifs

- **Fichier hors-périmètre** (CR auquel Fatima n'a pas accès) → ligne
  rejetée avec motif « périmètre interdit ».
- **Amadou** (VALIDATEUR sans `REALISE.IMPORTER` natif) → bouton
  « Importer » non visible (sauf si délégation reçue).

### Critères de validation finale ✅

- [ ] Le rapport affiche bien `50 OK / 3 KO`
- [ ] Les 3 motifs d'erreur sont compréhensibles (compte inexistant, mois
      mal formé, montant négatif)
- [ ] Audit `IMPORTER_REALISE` créé avec payload exhaustif
- [ ] Les 50 lignes sont visibles en mode `IMPORTE` dans la grille

---

## R3 — Tableau de bord budget vs réalisé + export Excel

**Objectif** : valider l'agrégation des écarts budget vs réalisé, les
niveaux d'alerte (NORMAL / ATTENTION / CRITIQUE / MANQUANT) et l'export
Excel multi-onglets. Lot 5.2.

### Pré-requis

- R1 et R2 exécutés : ≥ 50 lignes `fait_realise` `VALIDE` sur Q1 2027.

### Étapes

1. **Connexion contrôleur de gestion** (`controleur.gestion`, VALIDATEUR — a
   `BUDGET.LIRE` + `REALISE.LIRE`).
2. Aller sur `/tableau-de-bord/budget-vs-realise`.
3. Sélecteurs : version `BUDGET_INITIAL_2027`, scénario `OPTIMISTE_2027`,
   mois début 2027-01, fin 2027-03, seuil ATTENTION 5 %, seuil CRITIQUE
   10 %.
4. Cliquer **« Analyser »**. Loading.
5. KPI cards affichent : total écarts, dont CRITIQUE, dont ATTENTION,
   écart total absolu.
6. Le tableau d'écarts liste les lignes triées par écart absolu
   décroissant.
7. Vérifier : la ligne `701100 mars 2027` apparaît avec `montantBudget`
   (du `fait_budget`), `montantRealise=4 800 000`, `ecart`, `niveauAlerte`
   selon seuils, `sensEcart` selon classe compte (701 = PRODUIT donc
   favorable si réalisé > budget).
8. Filtre rapide : choisir **« Critiques uniquement »** → seules les lignes
   avec niveau CRITIQUE restent.
9. Recherche : taper `701100` → 1 ligne.
10. Cliquer **« Exporter Excel »**. Le fichier
    `ecarts-budget-realise-{versionId}-{date}.xlsx` est téléchargé.
11. Ouvrir le fichier : 3 onglets (Synthèse / Détail / Filtres), couleurs
    conditionnelles sur la colonne « Niveau ».

### Vérifications SQL

```sql
-- Cohérence total réalisé tableau de bord vs base
SELECT SUM(fr.montant)
  FROM fait_realise fr
  INNER JOIN dim_temps t ON t.id = fr.fk_temps
 WHERE fr.statut='VALIDE'
   AND t.annee=2027 AND t.mois BETWEEN 1 AND 3;
-- Doit correspondre à la somme des montants réalisés affichés
-- dans le tableau de bord (à filtrage périmètre près).
```

### Cas négatifs

- **Auditeur** (`REALISE.LIRE` seul, pas `BUDGET.LIRE`) → 403 sur
  `GET /api/v1/tableau-de-bord/budget-vs-realise` (RBAC double permission
  via `@RequirePermissions({ all: ['BUDGET.LIRE','REALISE.LIRE'] })`).
- **Filtrer sur scénario inexistant** → tableau vide + message « Aucune
  ligne disponible. Vérifiez les filtres et que le réalisé a bien été
  validé pour cette période. »

### Critères de validation finale ✅

- [ ] Les 4 KPI cards affichent des chiffres cohérents
- [ ] La ligne `701100 mars 2027` apparaît avec `montantRealise=4 800 000`
- [ ] Le filtre rapide et la recherche fonctionnent
- [ ] L'export Excel contient bien 3 onglets avec couleurs conditionnelles
- [ ] Le cas négatif RBAC double permission renvoie 403

---

## R4 — Reforecast nominal méthode MOYENNE_TRIMESTRE

**Objectif** : valider le lancement nominal d'un reforecast avec
extrapolation par moyenne du trimestre consolidé. Lot 5.3.

### Pré-requis

- R1, R2, R3 OK. ≥ 1 `fait_realise` `VALIDE` par mois sur le trimestre Q1
  2027 pour les CR / comptes actifs.

### Étapes

1. **Connexion contrôleur de gestion** (a `BUDGET.REFORECAST_LANCER`).
2. Aller sur `/reforecast`. La liste est vide ou ne contient pas encore
   de reforecast pour la clé `(BI_2027, OPT_2027, T1, 2027)`.
3. Cliquer **« Lancer un reforecast »**. Dialogue s'ouvre.
4. Sélecteurs :
   - Version source : `BUDGET_INITIAL_2027`.
   - Scénario source : `OPTIMISTE_2027`.
   - Trimestre : `T1` (radio).
   - Année : `2027` (auto-rempli depuis `exerciceFiscal` de la version).
   - Méthode : **« Moyenne du trimestre consolidé »**.
   - Libellé : « Reforecast T1 2027 » (auto-rempli).
5. Pas d'avertissement OBSOLETE (premier reforecast pour cette clé).
6. Cliquer **« Lancer le reforecast »**. Loading « Génération en cours… ».
   Toast succès. Redirection vers `/reforecast/:id`.
7. La page détail s'affiche : header avec badges `T1 2027` + `Moyenne du
   trimestre consolidé` + workflow `Brouillon` + publication `ACTIVE`.
8. Onglet **Grille** (par défaut) : matrice CR × compte × ligne_metier ×
   12 mois. Cellules T1 2027 affichent badge `RÉALISÉ` (vert). Cellules
   avril → décembre 2027 affichent badge `EXTRAPOLATION` (bleu).
9. Onglet **« Comparaison vs source »** : KPI total écart absolu + ajustées
   + inchangées. Le tableau liste les écarts par ligne. Origine `RÉALISÉ`
   pour T1, `EXTRAPOLATION` pour T2-T4.

### Vérifications SQL

```sql
-- La nouvelle version reforecast existe
SELECT id, code_version, type_version, statut, statut_publication,
       trimestre_consolide, annee_consolide, methode_extrapolation
  FROM dim_version
 WHERE type_version='reforecast'
 ORDER BY date_creation DESC LIMIT 1;
-- Attendu : statut=ouvert, statut_publication=ACTIVE,
--          trim=1, annee=2027, methode=MOYENNE_TRIMESTRE

-- Lignes générées
SELECT COUNT(*) AS nb_lignes
  FROM fait_budget
 WHERE fk_version = (
         SELECT MAX(id) FROM dim_version
          WHERE type_version='reforecast');
-- Attendu : N × 12 (12 mois × N combinaisons grain dim)

-- Audit LANCER_REFORECAST émis
SELECT type_action, payload_apres->>'methodeExtrapolation' AS methode,
       payload_apres->>'nbLignes' AS nb
  FROM audit_log
 WHERE type_action='LANCER_REFORECAST'
 ORDER BY date_action DESC LIMIT 1;
-- Attendu : MOYENNE_TRIMESTRE, nb cohérent

-- Vérifier qu'une cellule T2 = moyenne T1 pour un compte donné
WITH cible AS (
  SELECT v.id AS version_id
    FROM dim_version v
   WHERE v.type_version='reforecast'
   ORDER BY v.date_creation DESC LIMIT 1
)
SELECT
  -- Moyenne T1 du compte 701100 sur CR_AG_ABJ_PLATEAU
  (SELECT SUM(fr.montant)/3.0
     FROM fait_realise fr
     INNER JOIN dim_temps t ON t.id=fr.fk_temps
    WHERE fr.statut='VALIDE'
      AND fr.fk_centre_responsabilite=(SELECT id FROM dim_centre_responsabilite WHERE code_cr='CR_AG_ABJ_PLATEAU' AND version_courante=true)
      AND fr.fk_compte=(SELECT id FROM dim_compte WHERE code_compte='701100' AND version_courante=true)
      AND t.annee=2027 AND t.mois BETWEEN 1 AND 3) AS moyenne_t1,
  -- Valeur extrapolée du même compte en avril 2027
  (SELECT fb.montant_fcfa
     FROM fait_budget fb
     INNER JOIN dim_temps t ON t.id=fb.fk_temps
    WHERE fb.fk_version = (SELECT version_id FROM cible)
      AND fb.fk_centre=(SELECT id FROM dim_centre_responsabilite WHERE code_cr='CR_AG_ABJ_PLATEAU' AND version_courante=true)
      AND fb.fk_compte=(SELECT id FROM dim_compte WHERE code_compte='701100' AND version_courante=true)
      AND t.annee=2027 AND t.mois=4
    LIMIT 1) AS valeur_extrapolee_avril;
-- Les deux montants doivent être égaux (à arrondi près).
```

### Cas négatifs

- **Aucun réalisé `VALIDE` pour le trimestre demandé** → 422 « Aucun
  réalisé validé sur le trimestre T1 2027, impossible de lancer le
  reforecast. »
- **Trimestre 5** → 400 (validation DTO).
- **Amadou** (`dir.retail`, VALIDATEUR sans `BUDGET.REFORECAST_LANCER`) →
  403 sur `POST /api/v1/reforecast/lancer`.

### Critères de validation finale ✅

- [ ] Le reforecast créé est en statut `Brouillon` + publication `ACTIVE`
- [ ] Les cellules T1 affichent badge `RÉALISÉ`, T2-T4 badge `EXTRAPOLATION`
- [ ] La moyenne T1 = valeur extrapolée en avril (à l'arrondi près)
- [ ] Audit `LANCER_REFORECAST` avec payload détaillé
- [ ] Les 3 cas négatifs (pas de réalisé, trimestre invalide, RBAC) sont rejetés

---

## R5 — Reforecast workflow soumission / rejet / resoumission / validation / publication

**Objectif** : valider le workflow complet 4 transitions sur un reforecast
(codes audit `*_REFORECAST` polymorphes). Lot 5.3.

### Pré-requis

- R4 OK : 1 reforecast en `Brouillon` + `ACTIVE` sur la clé `(BI_2027,
  OPT_2027, T1, 2027)`.

### Étapes

1. **Connexion contrôleur de gestion** (Brouillon → Soumis).
2. Aller sur `/reforecast/:id` du R4. Statut `Brouillon`.
3. Cliquer **« Soumettre »**. Toast « Soumission effectuée. ». Statut passe
   à `Soumis`.
4. **Déconnexion**, **connexion Amadou** (`dir.retail`, VALIDATEUR).
5. Aller sur `/reforecast/:id`. Boutons **« Valider »** et **« Rejeter »**
   visibles.
6. Cliquer **« Rejeter »**. Dialogue motif. Saisir « Méthode incorrecte —
   refaire en BUDGET_INITIAL ».
7. Cliquer **« Rejeter »**. Toast. Statut repasse à `Brouillon`. Le motif
   est conservé en audit.
8. **Reconnexion contrôleur**. Aller sur `/reforecast`.
9. Cliquer **« Lancer un reforecast »** avec les **mêmes paramètres** mais
   méthode = `BUDGET_INITIAL`.
10. Avertissement OBSOLETE affiché : « Un reforecast existe déjà… statut :
    ouvert. ». Cocher la case de confirmation.
11. Cliquer **« Lancer le reforecast »**. Le précédent reforecast est marqué
    `OBSOLETE`. Le nouveau est créé en `Brouillon` `ACTIVE`.
12. Sur le nouveau reforecast, cliquer **« Soumettre »** (statut `Soumis`).
13. **Connexion Amadou**, valider le nouveau reforecast (statut `Validé`).
14. **Déconnexion**, **connexion Salif** (`dga.exploitation`,
    PUBLICATEUR).
15. Aller sur `/reforecast/:id` du nouveau reforecast. Bouton **« Publier »**.
16. Cliquer **« Publier »**. Toast. Statut `Publié`. Banner vert « Reforecast
    publié et actif. Cette version est IMMUABLE. ».

### Vérifications SQL

```sql
-- Transitions sur le nouveau reforecast (audit *_REFORECAST)
SELECT type_action, utilisateur, date_action,
       payload_apres->>'commentaireRejet' AS motif_rejet
  FROM audit_log
 WHERE entite_cible='dim_version'
   AND id_cible::bigint = (
         SELECT MAX(id) FROM dim_version
          WHERE type_version='reforecast'
            AND statut_publication='ACTIVE')
 ORDER BY date_action;
-- Attendu (ancien reforecast — encore consultable en historique) :
--   LANCER_REFORECAST par contrôleur
--   SOUMETTRE_REFORECAST par contrôleur
--   REJETER_REFORECAST par dir.retail (motif rempli)
-- Attendu (nouveau reforecast) :
--   LANCER_REFORECAST + MARQUER_REFORECAST_OBSOLETE (sur l'ancien)
--   SOUMETTRE_REFORECAST par contrôleur
--   VALIDER_REFORECAST par dir.retail
--   PUBLIER_REFORECAST par dga.exploitation
```

### Cas négatifs

- **Soumettre une version déjà soumise** → 409 « Seule une version en
  Brouillon peut être soumise. »
- **Publier un reforecast OBSOLETE** → 409 « Ce reforecast est
  OBSOLETE… aucune transition n'est possible. »

### Critères de validation finale ✅

- [ ] Le rejet repasse bien en `Brouillon` (et pas `OBSOLETE`)
- [ ] Le motif de rejet est persisté en `audit_log.payload_apres`
- [ ] Les 4 transitions sont auditées avec les codes `*_REFORECAST`
- [ ] La publication rend la version immuable (banner vert)

---

## R6 — Écrasement OBSOLETE

**Objectif** : valider la décision Q1 produit (un nouveau `lancer()`
écrase l'ancien ACTIVE pour la même clé en le marquant OBSOLETE avec audit
complet). Lot 5.3.

### Pré-requis

- R5 terminé : 1 reforecast `Publié` `ACTIVE` + 1 reforecast `OBSOLETE`
  (l'ancien rejeté).

### Étapes

1. **Connexion contrôleur de gestion**.
2. Aller sur `/reforecast`. Filtre publication = `OBSOLETE` → tableau
   affiche l'ancien reforecast avec badge gris barré et tooltip « Remplacé
   par : `<code>` ».
3. Cliquer **« Voir détail »** sur l'OBSOLETE. Banner ambre s'affiche : « Ce
   reforecast est marqué OBSOLETE depuis le `<date>`. Il a été remplacé par
   `<libellé>` (`<code>`). Plus de modifications possibles. ». Lien
   remplaçant cliquable.
4. Aucun bouton workflow n'est visible (`statut_publication=OBSOLETE`).
5. Cliquer le lien remplaçant → redirection vers le reforecast `ACTIVE`
   publié.
6. Lancer un **3e reforecast** sur la même clé pour démontrer l'écrasement
   en cascade. Avertissement, confirmation, lancement.
7. L'ancien reforecast `Publié` `ACTIVE` est désormais marqué `OBSOLETE`
   (publication seulement, statut workflow conservé).
   `fk_version_remplacante` pointe vers le 3e.

### Vérifications SQL

```sql
-- Chaîne d'obsolescence
SELECT id, code_version, statut, statut_publication,
       fk_version_remplacante, date_obsolescence
  FROM dim_version
 WHERE type_version='reforecast'
   AND fk_scenario_source = (
         SELECT id FROM dim_scenario WHERE code_scenario='OPTIMISTE_2027')
   AND trimestre_consolide=1 AND annee_consolide=2027
 ORDER BY id;
-- Attendu : 3 lignes, les 2 premières OBSOLETE pointant vers la
--          suivante via fk_version_remplacante, la dernière ACTIVE.

-- Audit MARQUER_REFORECAST_OBSOLETE (1 par écrasement)
SELECT type_action, id_cible, payload_apres->>'fkVersionRemplacante'
  FROM audit_log
 WHERE type_action='MARQUER_REFORECAST_OBSOLETE'
 ORDER BY date_action;
-- Attendu : 2 entrées (1ère et 2e versions OBSOLETE).
```

### Cas négatifs

- **Tenter de soumettre l'OBSOLETE** via API directe → 409 « Aucune
  transition n'est possible. »

### Critères de validation finale ✅

- [ ] Le filtre OBSOLETE affiche les reforecasts gris barrés
- [ ] La banner ambre est visible sur le détail
- [ ] Le lien remplaçant fonctionne et redirige correctement
- [ ] La chaîne `fk_version_remplacante` est cohérente (chaîne de 3)
- [ ] L'écrasement émet un audit `MARQUER_REFORECAST_OBSOLETE` par
      version dépréciée

---

## R7 — RBAC + filtrage périmètre cross-module

**Objectif** : valider les permissions et le filtrage périmètre sur
l'ensemble des modules Exécution. Lots 5.1, 5.2, 5.3.

### Pré-requis

- Tous les personas seedés et actifs.
- Fatima (`adj.retail`, SAISISSEUR) affectée à `STRUCTURE_RETAIL`
  uniquement (cf. R1 du Lot 4 archivé).
- Moussa (`auditeur`, AUDITEUR) sans aucun périmètre actif.

### Étapes

1. **Connexion Moussa** (`auditeur`).
2. Sidebar : voit « Saisie réalisé » (`REALISE.LIRE` ✓), « Tableau de bord »
   (`REALISE.LIRE` ✓), « Reforecasts » (`BUDGET.LIRE` ✓).
3. `/realise/saisie` : grille accessible mais aucun bouton « Nouvelle
   ligne » / « Importer » / « Valider » (pas de SAISIR ni VALIDER).
4. `/tableau-de-bord/budget-vs-realise` : analyse + export accessibles
   (seules permissions `BUDGET.LIRE` + `REALISE.LIRE` requises).
5. `/reforecast` : accès en lecture, **pas de bouton « Lancer »** (pas de
   `BUDGET.REFORECAST_LANCER`).
6. `/reforecast/:id` d'un Brouillon : aucun bouton workflow.
7. **Déconnexion**, **connexion Fatima** (`adj.retail`, SAISISSEUR).
8. `/realise/saisie` : grille filtrée sur les CR de `STRUCTURE_RETAIL`
   uniquement (pas les autres structures).
9. Boutons « Nouvelle ligne » + « Importer » visibles. Pas de « Valider »
   (pas `REALISE.VALIDER`).
10. `/reforecast` : accessible en lecture, pas de bouton « Lancer ».
11. `/reforecast/:id` Brouillon : bouton **« Soumettre »** visible (Fatima
    a `BUDGET.SOUMETTRE`). Pas de « Valider » ni « Publier ».

### Vérifications SQL

```sql
-- Périmètre Fatima (filtrage écriture réalisé)
SELECT cible_type, cible_id, origine, actif
  FROM user_perimetres
 WHERE fk_user = (SELECT id FROM "user" WHERE email='adj.retail@miznas.local')
   AND actif=true;
-- Attendu : ligne STRUCTURE/<id structure_retail>/AFFECTATION/true

-- Permissions auditeur (lecture seule cross-module)
SELECT p.code_permission
  FROM bridge_role_permission rp
  INNER JOIN bridge_user_role ur ON ur.fk_role=rp.fk_role
  INNER JOIN ref_permission p ON p.id=rp.fk_permission
 WHERE ur.fk_user=(SELECT id FROM "user" WHERE email='auditeur@miznas.local')
   AND ur.est_actif=true
 ORDER BY p.code_permission;
-- Attendu : AUDIT.LIRE, BUDGET.LIRE, CONFIGURATION.LIRE,
--          DELEGATION.LIRE, REALISE.LIRE, REFERENTIEL.LIRE,
--          ROLE.LIRE, USER.LIRE — pas de SAISIR/VALIDER/PUBLIER
--          ni REFORECAST_LANCER.
```

### Cas négatifs

- **Fatima tente de saisir sur un CR hors `STRUCTURE_RETAIL`** via l'API
  directement → 403 « périmètre interdit ».
- **Moussa (`auditeur`) tente `POST /api/v1/reforecast/lancer`** → 403.

### Critères de validation finale ✅

- [ ] Moussa (`auditeur`) voit la sidebar mais n'a aucun bouton d'écriture
- [ ] Fatima ne voit que les CR de sa structure
- [ ] Les permissions auditeur en SQL sont **exactement** les 8 LIRE attendues
- [ ] Les 2 cas négatifs renvoient 403

---

## R8 — Healthcheck Redis dégradé + monitoring queue emails

**Objectif** : valider l'observabilité runtime de la queue BullMQ
(healthcheck `degraded` quand Redis injoignable, endpoint admin queue
stats opérationnel). Lot 6.3.

### Pré-requis

- Redis 7+ démarré sur `localhost:6379` (container `miznas-redis-dev`).
- Backend démarré, queue BullMQ fonctionnelle (Lot 6.3).
- Admin connectable (`admin@miznas.local`).
- ⚠️ **À exécuter sur dev local ou pré-prod avec arrêt programmé Redis**.
  Ne pas exécuter sur production sans rolling restart.

### Étapes

#### Partie A — État nominal (Redis up)

1. Depuis un terminal :
   ```bash
   curl -s http://localhost:3001/api/v1/health | jq
   ```
   Attendu :
   ```json
   {
     "status": "ok",
     "redis": { "status": "up" },
     "db": { "status": "up" }
   }
   ```
2. Connexion admin sur `http://localhost:5173/login`.
3. Aller sur `/admin/email-log` → cliquer onglet ou bouton **« Queue
   stats »** (Lot 6.3) — alternativement, requête directe :
   ```bash
   curl -s -H "Authorization: Bearer <TOKEN_ADMIN>" \
        http://localhost:3001/api/v1/admin/email-log/queue/stats | jq
   ```
   Attendu : payload avec compteurs `{ waiting, active, completed, failed,
   delayed }`. Valeurs cohérentes avec l'historique d'envois récents.

#### Partie B — Redis down → healthcheck dégradé

4. Arrêter le container Redis :
   ```bash
   docker stop miznas-redis-dev
   ```
5. Relancer le healthcheck :
   ```bash
   curl -s -w "\nHTTP %{http_code}\n" http://localhost:3001/api/v1/health | jq
   ```
   Attendu :
   - **HTTP 200** (et non 503 — l'app reste répondante, décision produit
     « MIZNAS reste utilisable même sans emails »).
   - `status: "degraded"`, `redis.status: "down"`.
6. Tenter une action qui déclenche un email (ex : Fatima soumet une
   version via R6 archivée Lot 4, ou créer une délégation R3 archivée).
   L'action métier passe ; la ligne `email_log` reste en statut
   `EN_ATTENTE`.

#### Partie C — Redis up again → consumption rattrapée

7. Redémarrer le container :
   ```bash
   docker start miznas-redis-dev
   ```
8. Attendre ~10s. Relancer le healthcheck → `status: ok`,
   `redis.status: up`.
9. Le worker BullMQ rattrape les emails `EN_ATTENTE` automatiquement.
   Vérifier que `email_log` passe à `ENVOYE`.

### Vérifications SQL

```sql
-- Emails créés pendant Redis down
SELECT id, evenement, destinataire_email, statut, date_creation
  FROM email_log
 WHERE date_creation > NOW() - interval '10 minutes'
 ORDER BY id DESC;
-- Attendu :
--   Pendant Redis down → statut='EN_ATTENTE'
--   Après Redis up → statut='ENVOYE' (worker consomme la backlog)
```

### Cas négatifs

- **Auditeur** (sans `USER.GERER`) appelle
  `GET /api/v1/admin/email-log/queue/stats` → 403.
- **Sans JWT** → 401 sur l'endpoint admin.

### Critères de validation finale ✅

- [ ] Healthcheck nominal renvoie `status: ok` + `redis.status: up`
- [ ] Healthcheck Redis arrêté renvoie HTTP 200 + `status: degraded` +
      `redis.status: down`
- [ ] Endpoint queue stats renvoie un payload complet à l'admin
- [ ] L'app reste utilisable sans Redis (actions métier passent, emails
      empilés)
- [ ] Une fois Redis redémarré, les emails `EN_ATTENTE` passent à
      `ENVOYE` automatiquement
- [ ] Cas négatif RBAC sur queue stats renvoie bien 403

---

## R9 — Politique mdp + expiration + ForceChangePasswordPage (3 cas)

**Objectif** : valider la politique mdp (≥ 12 + 1maj + 1min + 1chiffre +
1spécial), l'expiration à 90 jours, et la `ForceChangePasswordPage` qui
couvre **3 cas distincts** :

- **Cas (a) `doitChangerMdp=true`** : mdp temporaire (reset admin ou
  forcer-changement) — bouton « Plus tard » **CACHÉ** (sécurité).
- **Cas (b) `mdpExpire=true`** : mdp expiré depuis > 0 jours — bouton
  « Plus tard » **CACHÉ** (`PasswordExpiredGuard` bloque les autres routes).
- **Cas (c) `mdpExpireProchainement=true`** (J-7) : alerte préventive,
  bouton « Plus tard » **VISIBLE** (le user peut différer).

Lots 6.4.A + 6.4.C.2 + 6.7.1.

### Pré-requis

- Admin connectable.
- Un user de test (ex : Moussa `auditeur@miznas.local`, mdp seed
  `MiznasTest!2026`).
- Mailhog allumé (l'email reset admin partira par la queue).
- `MDP_DUREE_VALIDITE_JOURS=90` (défaut).
- `LOGIN_RATE_LIMIT_DISABLED=false` (mais prévoir une marge entre les
  tentatives login pour ne pas déclencher R10).

### Étapes

#### Cas (a) — Force change via admin

1. **Connexion admin** sur `/admin/users`.
2. Sur la ligne de l'auditeur, cliquer **« Forcer changement »** (action
   Lot 6.4.C.3 : pose `doit_changer_mdp=true` sans toucher au hash, **pas
   d'email envoyé**).
3. **Vérification SQL** :
   ```sql
   SELECT email, doit_changer_mdp, date_expiration_mdp FROM "user"
    WHERE email='auditeur@miznas.local';
   -- Attendu : doit_changer_mdp=true, date_expiration_mdp inchangée
   ```
4. **Déconnexion admin**.
5. **Connexion Moussa** avec son mdp habituel (`MiznasTest!2026`).
6. Redirection automatique vers `/change-mdp` (via `ProtectedRoute`
   étendu Lot 6.4.C.2).
7. La page affiche : titre « Vous devez changer votre mot de passe »,
   raison « Votre administrateur vous a demandé de changer votre mot de
   passe. ».
8. **Bouton « Plus tard » : CACHÉ** ✅ (sécurité).
9. Footer texte : « Changement obligatoire ».
10. Saisir ancien=`MiznasTest!2026`, nouveau=`NouveauMdp!2026A`,
    confirmation=identique. Submit.
11. Toast succès. Tokens renouvelés sans flag. Redirect vers `/dashboard`.

#### Cas (b) — Mdp expiré

12. **Forcer l'expiration en SQL** sur l'auditeur :
    ```sql
    UPDATE "user" SET date_expiration_mdp = NOW() - INTERVAL '1 day'
     WHERE email='auditeur@miznas.local';
    ```
13. **Déconnexion auditeur**, **reconnexion** auditeur avec son nouveau
    mdp `NouveauMdp!2026A`.
14. Login retourne `mdpExpire: true` dans la réponse `LoginResponse`
    (vérifier via DevTools onglet Network).
15. Redirection vers `/change-mdp`. Raison : « Votre mot de passe est
    expiré. Vous devez le renouveler pour accéder à l'application. ».
16. **Bouton « Plus tard » : CACHÉ** ✅ (sécurité — `PasswordExpiredGuard`
    bloque tout autre accès).
17. Tenter d'accéder à `/dashboard` directement via URL : 403 / redirect
    `/change-mdp`.
18. Changer mdp vers `EncoreNouveau!2026B`. Submit. `date_expiration_mdp`
    repasse à `NOW() + 90 jours`.

#### Cas (c) — J-7 (alerte préventive)

19. **Forcer J-7 en SQL** sur l'auditeur :
    ```sql
    UPDATE "user" SET date_expiration_mdp = NOW() + INTERVAL '5 days'
     WHERE email='auditeur@miznas.local';
    ```
20. **Déconnexion**, **reconnexion** auditeur.
21. Login retourne `mdpExpireProchainement: true` (mutuellement exclusif
    avec `mdpExpire`, calculé Lot 6.7.1 backend).
22. **Accès `/dashboard` OK** (pas bloqué par le Guard).
23. `AuthLayout` affiche le **`<BandeauMdpExpire>` orange** au-dessus
    du contenu, avec lien « Changer maintenant ».
24. Cliquer le lien → `/change-mdp`. Raison : « Votre mot de passe
    expire dans X jour(s). Nous vous recommandons de le renouveler dès
    maintenant. ».
25. **Bouton « Plus tard » : VISIBLE** ✅ (le user peut différer).
26. Cliquer « Plus tard » → redirect `/dashboard` sans changer le mdp.
    Bandeau orange reste visible (état `mdpExpireProchainement` persisté
    Zustand).
27. Re-cliquer le lien, cette fois changer effectivement. Le bandeau
    disparaît (`mdpExpireProchainement: false` retourné par
    `changerMdp()`).

### Vérifications SQL

```sql
-- Audit PASSWORD_CHANGED après chaque changement (cas a, b, c)
SELECT type_action, utilisateur, date_action,
       payload_apres->>'changeReason' AS raison
  FROM audit_log
 WHERE type_action='PASSWORD_CHANGED'
   AND utilisateur='auditeur@miznas.local'
 ORDER BY date_action DESC LIMIT 5;
-- Attendu : 3 entrées au moins, payload distinguant les motifs

-- Vérifier que le hash a bien changé (non régression sur la valeur)
SELECT email, LEFT(mot_de_passe, 7) AS hash_prefix, date_expiration_mdp,
       doit_changer_mdp
  FROM "user"
 WHERE email='auditeur@miznas.local';
-- Attendu : doit_changer_mdp=false, date_expiration_mdp = NOW + 90j
```

### Cas négatifs

- **Mdp policy non conforme** (`abc`, `password`, `Aa1!`, 11 chars
  exactement, sans spécial, etc.) → 422 avec détail des règles
  manquantes côté DTO `ChangerMdpDto`.
- **Ancien mdp incorrect** → 401 « Mot de passe actuel incorrect. ».
- **Confirmation ≠ nouveau** → erreur de validation côté frontend
  (zod) avant submit.
- **Bouton « Plus tard » en cas (a) ou (b)** : doit rester
  **CACHÉ** — si visible, c'est une régression critique sécurité.
- **Auditeur (sans `mdpExpire/dcm/mdpExpireProchainement`) arrivant
  sur `/change-mdp`** : redirect automatique vers `/dashboard` (garde
  anti-arrivée intempestive Lot 6.4.C.2).

### Critères de validation finale ✅

- [ ] Cas (a) `doitChangerMdp` : redirect + bouton « Plus tard » caché
- [ ] Cas (b) `mdpExpire` : redirect + bouton « Plus tard » caché +
      403 sur autres routes
- [ ] Cas (c) `mdpExpireProchainement` : bandeau orange + bouton
      « Plus tard » VISIBLE
- [ ] Texte `raison` distinct dans les 3 cas
- [ ] Policy non conforme rejetée avec détails clairs
- [ ] Audit `PASSWORD_CHANGED` créé après chaque changement réussi
- [ ] `date_expiration_mdp` repassée à NOW + 90j après chaque succès

---

## R10 — Rate limiting login + audit `LOGIN_RATE_LIMITED`

**Objectif** : valider les 2 fenêtres rate limit login (5 tentatives / 60s
par IP + 5 tentatives / 15min par email), le code applicatif
`LOGIN_RATE_LIMITED` en HTTP 429, le header `Retry-After`, et l'audit
correspondant. Lot 6.4.B.

### Pré-requis

- `LOGIN_RATE_LIMIT_DISABLED=false` dans `.env` (défaut).
- Backend redémarré si la var a été modifiée (le service in-memory ne
  recharge pas à chaud).
- Un email existant en base (ex : `lecteur@miznas.local`).

### Étapes

#### Partie A — Fenêtre IP (5/60s)

1. Depuis un terminal (ou Postman / curl) :
   ```bash
   for i in 1 2 3 4 5 6; do
     curl -s -o /dev/null -w "Tentative $i : HTTP %{http_code}\n" \
       -X POST http://localhost:3001/api/v1/auth/login \
       -H "Content-Type: application/json" \
       -d '{"email":"lecteur@miznas.local","password":"mauvais"}'
   done
   ```
2. Attendu :
   - Tentatives 1-5 : HTTP `401` (Unauthorized — mdp incorrect)
   - **Tentative 6 : HTTP `429`** avec headers :
     - `Retry-After: <secondes>` (ex : 45)
     - Payload : `{ "code": "LOGIN_RATE_LIMITED", "message": "..." }`
3. Attendre le délai indiqué dans `Retry-After` (~60s max).
4. Refaire un POST `/login` avec **bon mdp** : HTTP 200, login OK.

#### Partie B — Fenêtre email (5/15min)

5. Réinitialiser les compteurs (redémarrage backend ou attendre 15min).
6. Depuis plusieurs IPs distinctes (changer `X-Forwarded-For` ou utiliser
   un proxy), tenter 6 logins avec le même email `lecteur@miznas.local`
   en mauvais mdp.
7. À la 6e tentative depuis n'importe quelle IP : HTTP 429 + code
   `LOGIN_RATE_LIMITED`.

#### Partie C — Désactivation env

8. Modifier `.env` : `LOGIN_RATE_LIMIT_DISABLED=true`. Redémarrer le
   backend.
9. Refaire les 10 tentatives consécutives : toutes renvoient 401 (jamais
   429). ⚠️ **Ne JAMAIS activer cette var en pré-prod ou production**.

### Vérifications SQL

```sql
-- Audit LOGIN_RATE_LIMITED émis lors du blocage
SELECT type_action, utilisateur, ip_source, date_action,
       payload_apres
  FROM audit_log
 WHERE type_action='LOGIN_RATE_LIMITED'
   AND date_action > NOW() - INTERVAL '5 minutes'
 ORDER BY date_action DESC LIMIT 5;
-- Attendu : entrées avec
--   utilisateur='lecteur@miznas.local' (ou IP si fenêtre IP),
--   payload contenant fenetreSec, limit, tentativesObservees
```

### Cas négatifs

- **6 tentatives avec bon mdp** : aucune n'est rate limitée (le compteur
  s'incrémente UNIQUEMENT sur 401 — succès ne déclenche pas).
- **Tentative au format DTO invalide** (`{}`) → 400 (validation pipe),
  pas d'incrémentation rate limiter.

### Critères de validation finale ✅

- [ ] Les tentatives 1-5 renvoient 401, la 6e renvoie 429
- [ ] Header `Retry-After` présent en 429
- [ ] Payload 429 contient `code: "LOGIN_RATE_LIMITED"`
- [ ] Audit `LOGIN_RATE_LIMITED` créé avec payload détaillé
- [ ] Fenêtre IP et fenêtre email opérationnelles indépendamment
- [ ] Désactivation via env confirmée (et danger pour prod documenté)

---

## R11 — Reset password admin async via queue + force-changement-mdp

**Objectif** : valider que le reset password admin (a) génère un mdp
temporaire policy-conforme côté serveur, (b) **ne le retourne JAMAIS dans
la réponse API** (`ResetPasswordResponseDto = { success, message }`),
(c) **ne le persiste JAMAIS dans `email_log.payload` ni
`audit_log.payload`**, (d) pose `doit_changer_mdp=true` +
`date_expiration_mdp = now() + 7j`. Et valider que `forcer-changement-mdp`
pose le flag sans toucher au hash (cas suspicion compromission, sans
email envoyé). Lots 6.4.C.1 + 6.4.C.3.

### Pré-requis

- Admin connectable.
- Un user de test (ex : `lecteur@miznas.local`).
- Mailhog allumé sur `localhost:1025` (UI `localhost:8025`).
- Redis up (queue BullMQ fonctionnelle).
- `EMAIL_DRY_RUN=false`.

### Étapes

#### Partie A — Reset password admin async

1. **Connexion admin** sur `/admin/users`.
2. Sur la ligne du lecteur, cliquer **« Réinitialiser mot de passe »**
   (action Lot 6.4.C.1 + breaking change Lot Administration : plus
   d'affichage du mdp en clair).
3. Confirmer le dialogue. Toast succès.
4. **Vérifier le retour API** (DevTools onglet Network sur
   `POST /api/v1/admin/users/:id/reset-password`) :
   - Status 200
   - Payload : `{ "success": true, "message": "Email envoyé..." }`
   - **AUCUN champ `motDePasseTemporaire` ni équivalent** ✅
5. Une `Card` de confirmation s'affiche dans l'UI : « Email envoyé à
   `lecteur@miznas.local`. Le nouveau mot de passe expire dans 7 jours. ».
   **AUCUN affichage du mdp en clair** ✅.
6. Aller sur Mailhog : email reçu avec template `reset-password-admin`,
   sujet incluant l'expiration, corps mentionnant : mdp temporaire en
   clair (✅ unique endroit), expiration 7j, lien `/change-mdp`,
   avertissement compromission.

#### Partie B — Connexion du user reset

7. **Déconnexion admin**, **connexion** lecteur avec le mdp temporaire
   reçu par email.
8. Redirect automatique sur `/change-mdp` (cf. R9 cas a — `doitChangerMdp`).
9. Changer mdp vers `MotDePasse!2026Cible`. Submit. Toast succès. Redirect
   `/dashboard`.

#### Partie C — Forcer-changement-mdp (sans reset)

10. **Reconnexion admin** sur `/admin/users`.
11. Sur la ligne du lecteur, cliquer **« Forcer changement »** (action
    Lot 6.4.C.3).
12. Confirmer le dialogue. Toast succès. **AUCUN email** ne part (vérifier
    Mailhog : aucune nouvelle entrée).
13. **Déconnexion admin**, **connexion** lecteur avec son mdp courant
    `MotDePasse!2026Cible` (le hash n'a pas été touché).
14. Redirect automatique sur `/change-mdp`.

### Vérifications SQL — sécurité critique

```sql
-- 1. Audit RESET_PASSWORD_USER NE doit PAS contenir le mdp en clair
SELECT type_action, utilisateur, payload_apres
  FROM audit_log
 WHERE type_action='RESET_PASSWORD_USER'
   AND date_action > NOW() - INTERVAL '10 minutes'
 ORDER BY date_action DESC LIMIT 5;
-- Attendu :
--   payload_apres = { "operation": "reset" | "forcer-changement-mdp",
--                     "cibleEmail": "lecteur@miznas.local",
--                     "expirationMdp": "...",
--                     ... }
-- ✅ Aucun champ mdp / motDePasseTemporaire / password en clair

-- 2. email_log.payload NE doit PAS contenir le mdp en clair non plus
SELECT id, evenement, template, payload, statut
  FROM email_log
 WHERE template='reset-password-admin'
   AND date_creation > NOW() - INTERVAL '10 minutes'
 ORDER BY id DESC LIMIT 5;
-- Attendu :
--   payload ne contient PAS la clé "mdpTemporaire"
--   (transit éphémère via Redis job data, jamais persisté)

-- 3. Flags posés correctement sur le user
SELECT email, doit_changer_mdp, date_expiration_mdp
  FROM "user"
 WHERE email='lecteur@miznas.local';
-- Attendu après reset admin : doit_changer_mdp=true, expiration = NOW + 7j
-- Attendu après forcer-changement : doit_changer_mdp=true, expiration inchangée
```

### Cas négatifs

- **Lecteur (sans `USER.GERER`)** tente
  `POST /api/v1/admin/users/<id>/reset-password` → 403.
- **Auditeur** sur même endpoint → 403.
- **Reset sur un user déjà désactivé** → vérifier le comportement
  attendu (rejet 422 ou autorisé ?). Documenter le résultat.

### Critères de validation finale ✅

- [ ] **Le mdp en clair n'apparaît JAMAIS dans la réponse API** (Partie A
      étape 4)
- [ ] **Le mdp en clair n'apparaît JAMAIS dans `email_log.payload`**
      (Vérif SQL n°2)
- [ ] **Le mdp en clair n'apparaît JAMAIS dans `audit_log.payload_apres`**
      (Vérif SQL n°1)
- [ ] L'email arrive bien dans Mailhog avec le mdp en clair (seul endroit
      où il transite)
- [ ] `doit_changer_mdp=true` posé dans les 2 cas
- [ ] `date_expiration_mdp = NOW + 7j` UNIQUEMENT en cas reset (pas en
      forcer-changement)
- [ ] Cas négatifs RBAC renvoient 403

---

## R12 — Forgot password self-service (cycle complet anti-énumération)

**Objectif** : valider `/forgot-password` → email → `/reset-password?token=XYZ`
→ reconnexion. Anti-énumération (réponse identique pour email connu vs
inconnu, audit différencié `DEMANDE_RESET_MDP_USER` vs
`DEMANDE_RESET_MDP_INCONNU`), rate limit forgot 3/15min/IP, codes erreurs
distincts `INVALID_TOKEN` (400) vs `EXPIRED_TOKEN` (410), cleanup cron
3h00 supprime tokens > 30j. Lot 6.5.A.

### Pré-requis

- Mailhog allumé.
- `EMAIL_DRY_RUN=false`.
- `APP_BASE_URL=http://localhost:5173`.
- Backend redémarré si var modifiée.
- Un user existant (ex : `lecteur@miznas.local`).

### Étapes

#### Partie A — Cycle nominal

1. Sur `/login`, cliquer le lien **« Mot de passe oublié ? »**
   (`testid="login-lien-forgot-password"`).
2. Aller sur `/forgot-password`. Saisir `lecteur@miznas.local`. Submit.
3. Bandeau de confirmation : « Si cet email correspond à un compte
   actif, un message vous a été envoyé. Vérifiez votre boîte aux
   lettres. » (texte exact à confirmer dans l'UI livrée).
4. **Mailhog** : 1 nouveau message destiné à `lecteur@miznas.local`,
   template `reset-password-self-service`, sujet incluant
   « Réinitialisation de votre mot de passe ». Le corps contient un
   lien `http://localhost:5173/reset-password?token=<TOKEN_CLAIR>`.
5. Cliquer le lien (ou copier-coller dans le navigateur).
6. La page `/reset-password` s'affiche : 2 champs (nouveau mot de passe +
   confirmation).
7. Saisir `NouveauMdp!2027` + confirmation identique. Submit.
8. Toast succès « Votre mot de passe a été modifié. Reconnectez-vous. ».
   Redirect `/login`.
9. Login avec `lecteur@miznas.local` + `NouveauMdp!2027` → succès.

#### Partie B — Anti-énumération (email inconnu)

10. Retour sur `/forgot-password`. Saisir un email **inconnu** (ex :
    `inexistant@example.org`). Submit.
11. **Vérifier que le bandeau de confirmation est IDENTIQUE** au cas
    email connu (même message, mêmes délais, même UI) — c'est le pivot
    anti-énumération. **AUCUN email n'arrive** dans Mailhog.

#### Partie C — Rate limit forgot

12. Depuis la même IP, lancer **4 POST `/forgot-password`** en moins de
    15 min :
    ```bash
    for i in 1 2 3 4; do
      curl -s -o /dev/null -w "Tentative $i : HTTP %{http_code}\n" \
        -X POST http://localhost:3001/api/v1/auth/forgot-password \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"random${i}@example.org\"}"
    done
    ```
13. Attendu :
    - Tentatives 1-3 : HTTP 200
    - **Tentative 4 : HTTP 429** + code `LOGIN_RATE_LIMITED`

#### Partie D — Codes erreurs INVALID_TOKEN vs EXPIRED_TOKEN

14. Tenter `/reset-password?token=invalide-base64-xyz` ou un token déjà
    consommé → submit → toast **« Lien invalide ou déjà utilisé. »**.
    Code HTTP 400 + payload `{ code: "INVALID_TOKEN" }`.
15. Forcer en SQL un token expiré :
    ```sql
    UPDATE password_reset_token
       SET date_expiration = NOW() - INTERVAL '1 minute'
     WHERE utilise=false AND fk_user = (
             SELECT id FROM "user" WHERE email='lecteur@miznas.local')
     ORDER BY id DESC LIMIT 1;
    ```
    Récupérer le token en clair (impossible — uniquement le hash en
    base) ; tester via API avec un token de votre cycle nominal en
    forçant l'expiration en SQL juste après envoi.
16. Soumettre ce token expiré → toast **« Le lien a expiré. Demandez un
    nouveau. »**. Code HTTP 410 + payload `{ code: "EXPIRED_TOKEN" }`.

#### Partie E — Cleanup cron (3h00 quotidien)

17. Forcer la suppression de tokens anciens :
    ```sql
    UPDATE password_reset_token
       SET date_expiration = NOW() - INTERVAL '31 days'
     WHERE id = <id_d_un_token_consommé>;
    ```
18. Redémarrer le backend (le `OnApplicationBootstrap` rejoue le cleanup).
19. **Vérification SQL** : le token > 30j a disparu (purgé) + audit
    `NETTOYAGE_RESET_TOKENS` créé avec count.

### Vérifications SQL

```sql
-- 1. Token stocké en hash SHA-256, jamais en clair
SELECT id, fk_user, token, LENGTH(token) AS taille, utilise,
       date_expiration
  FROM password_reset_token
 WHERE fk_user = (SELECT id FROM "user" WHERE email='lecteur@miznas.local')
 ORDER BY id DESC LIMIT 1;
-- Attendu : token = chaîne hex 64 chars (SHA-256), JAMAIS le clair

-- 2. Audit différencié connu vs inconnu (anti-énumération côté serveur)
SELECT type_action, utilisateur, payload_apres->>'email'
  FROM audit_log
 WHERE type_action IN ('DEMANDE_RESET_MDP_USER','DEMANDE_RESET_MDP_INCONNU')
   AND date_action > NOW() - INTERVAL '10 minutes'
 ORDER BY date_action DESC LIMIT 10;
-- Attendu :
--   DEMANDE_RESET_MDP_USER pour lecteur@miznas.local
--   DEMANDE_RESET_MDP_INCONNU pour inexistant@example.org

-- 3. Reset effectif crée un audit RESET_MDP_USER_VALIDE
SELECT type_action, utilisateur
  FROM audit_log
 WHERE type_action='RESET_MDP_USER_VALIDE'
   AND date_action > NOW() - INTERVAL '10 minutes'
 ORDER BY date_action DESC LIMIT 5;
-- Attendu : 1 entrée pour lecteur@miznas.local

-- 4. Cleanup cron émet NETTOYAGE_RESET_TOKENS avec count
SELECT type_action, payload_apres->>'count' AS supprimes,
       date_action
  FROM audit_log
 WHERE type_action='NETTOYAGE_RESET_TOKENS'
 ORDER BY date_action DESC LIMIT 3;
-- Attendu : entrées matérialisant le passage du cron
```

### Cas négatifs

- **Pre-check du token au chargement** : volontairement non implémenté
  (cohérence backend) — l'erreur ne remonte qu'au submit du nouveau mdp.
- **Auto-login après reset** : volontairement non implémenté — le user
  doit se reconnecter manuellement (toast d'invitation).
- **POST `/forgot-password` sans body** → 400 (validation pipe).
- **POST `/reset-password` avec mdp policy non conforme** → 422.

### Critères de validation finale ✅

- [ ] Cycle nominal OK : envoi email → submit → reconnexion
- [ ] Anti-énumération : bandeau IDENTIQUE pour email connu vs inconnu
- [ ] Audit `DEMANDE_RESET_MDP_USER` vs `DEMANDE_RESET_MDP_INCONNU`
      différenciés en base
- [ ] **Token stocké en hash SHA-256, JAMAIS en clair** (Vérif SQL n°1)
- [ ] Rate limit forgot 3/15min/IP fonctionne (4e = 429)
- [ ] `INVALID_TOKEN` (400) vs `EXPIRED_TOKEN` (410) distincts
- [ ] Cleanup cron 3h00 supprime tokens > 30j + audit
      `NETTOYAGE_RESET_TOKENS`
- [ ] Audit `RESET_MDP_USER_VALIDE` créé lors du reset réussi

---

## R13 — Rappel J-3 délégation via cron quotidien

**Objectif** : valider que le cron `0 6 * * *` envoie 2 emails (délégant
+ délégataire) pour les délégations dont `date_fin = CURRENT_DATE + 3
jours AND actif=true AND derniere_notification_j3 IS NULL`, idempotence
garantie par l'UPDATE post-publication, respect opt-out user. Lot 6.5.B.

### Pré-requis

- 2 personas distincts (ex : Aïcha `controleur.gestion` délégant +
  Ibrahim `dir.corporate` délégataire — tous 2 VALIDATEUR).
- Mailhog allumé. `EMAIL_DRY_RUN=false`.
- `notifications_email_actives=true` sur les 2 users (défaut).
- Au moins une délégation active créée (cf. R3 Lot 4 archivé) avec
  `date_fin = CURRENT_DATE + 3 jours` et `derniere_notification_j3 IS
  NULL`.

### Étapes

1. Créer une délégation A → B (cf. R3 Lot 4 archivé) avec `dateFin =
   today + 3j` :
   - Connexion Aïcha (`controleur.gestion`) → `/mes-delegations` →
     « Nouvelle délégation » → délégataire = Ibrahim (`dir.corporate`),
     période courte avec `dateFin = today + 3j`.
2. **Vérification SQL** :
   ```sql
   SELECT id, fk_delegant, fk_delegataire, date_fin, actif,
          derniere_notification_j3
     FROM delegations
    WHERE date_fin = CURRENT_DATE + INTERVAL '3 days'
      AND actif=true
    ORDER BY id DESC LIMIT 1;
   -- Attendu : 1 ligne, derniere_notification_j3 IS NULL
   ```
3. **Déclencher le cron manuellement** :
   - Option (a) : redémarrer le backend — le `OnApplicationBootstrap`
     rejoue le rattrapage J-3.
   - Option (b) : attendre 06:00 UTC (cron `@Cron('0 6 * * *', { name:
     'delegations-rappel-j3' })`).
4. **Vérifier Mailhog** : 2 nouveaux emails :
   - À `controleur.gestion@miznas.local` (Aïcha — délégante) avec
     template `delegation-rappel-delegant`, lien `/admin/delegations`.
   - À `dir.corporate@miznas.local` (Ibrahim — délégataire) avec template
     `delegation-rappel-delegataire`, lien `/mes-delegations`.

#### Idempotence

5. Redémarrer une 2e fois le backend (ou attendre une 2e exécution cron).
6. **Mailhog ne reçoit AUCUN nouvel email** — la délégation a déjà
   `derniere_notification_j3` rempli (Lot 6.5.B).

#### Respect opt-out

7. Ibrahim désactive ses notifications via `/me/preferences` (cf. R7.B
   Lot 4 archivé) :
   ```sql
   UPDATE "user" SET notifications_email_actives=false
    WHERE email='dir.corporate@miznas.local';
   ```
8. Créer une **2e délégation** A → B' (ou modifier la précédente pour
   reposer `derniere_notification_j3 = NULL` et `date_fin = today + 3j`).
9. Redéclencher le cron.
10. **Mailhog** : 1 seul email part (au délégant uniquement). Ligne
    `email_log` pour Ibrahim en `SUPPRIME` avec motif opt-out.

### Vérifications SQL

```sql
-- 1. Délégation marquée comme notifiée
SELECT id, derniere_notification_j3
  FROM delegations
 WHERE date_fin = CURRENT_DATE + INTERVAL '3 days'
   AND actif=true
 ORDER BY id DESC LIMIT 1;
-- Attendu : derniere_notification_j3 = timestamp (cron a tourné)

-- 2. Audit DELEGATION_RAPPEL_J3 émis (1 par délégation notifiée)
SELECT type_action, id_cible, payload_apres, date_action
  FROM audit_log
 WHERE type_action='DELEGATION_RAPPEL_J3'
   AND date_action > NOW() - INTERVAL '10 minutes'
 ORDER BY date_action DESC LIMIT 5;
-- Attendu : 1 entrée par délégation traitée

-- 3. email_log : 2 entrées par délégation (délégant + délégataire),
--    ou 1 ENVOYE + 1 SUPPRIME si opt-out
SELECT evenement, destinataire_email, statut,
       payload->>'_motifSuppression' AS motif_suppression
  FROM email_log
 WHERE evenement='DELEGATION_RAPPEL_J3'
   AND date_creation > NOW() - INTERVAL '10 minutes'
 ORDER BY id DESC LIMIT 10;
-- Attendu :
--   Cas nominal : 2 ENVOYE (délégant + délégataire)
--   Cas opt-out : 1 ENVOYE + 1 SUPPRIME motif='PREF_TOGGLE_GLOBAL_OFF'
```

### Cas négatifs

- **Délégation `date_fin = today + 4 jours`** : non sélectionnée
  (filtre strict sur +3 jours).
- **Délégation déjà inactive** (`actif=false`) : non sélectionnée.
- **Délégation déjà notifiée** (`derniere_notification_j3 IS NOT NULL`) :
  non re-sélectionnée (idempotence).

### Critères de validation finale ✅

- [ ] 2 emails partent à J-3 (délégant + délégataire)
- [ ] `derniere_notification_j3` posé après envoi
- [ ] Re-exécution du cron ne renvoie pas d'email (idempotence)
- [ ] Opt-out du délégataire → 1 seul email envoyé (au délégant), ligne
      SUPPRIME pour le délégataire
- [ ] Audit `DELEGATION_RAPPEL_J3` créé par délégation traitée
- [ ] Les 3 cas négatifs ne déclenchent pas le cron

---

## R14 — Tooltips délégation Z1 (permissions) + Z2 (rôles métier)

**Objectif** : valider l'affichage des tooltips descriptifs au survol sur
**Z1 — 4 permissions déléguables** (`SAISIE` / `SOUMISSION` /
`VALIDATION` / **`PUBLICATION` avec mention "Action irréversible"**)
dans 3 pages, et sur **Z2 — 4 rôles métier** (`SAISISSEUR` /
`VALIDATEUR` / `PUBLICATEUR` / `AUDITEUR`) dans la gestion des rôles
user. Wrapping conditionnel : pas de tooltip si description null/vide.
Lot 6.7.2.

### Pré-requis

- Admin connectable.
- Aïcha (`controleur.gestion@miznas.local`, VALIDATEUR) connectable.
- Au moins 1 délégation existante (cf. R13 ou R3 archivé).
- `TooltipProvider` racine actif (`delayDuration={200}` côté `App.tsx`).

### Étapes

#### Z1 — Permissions déléguables (3 pages)

1. **Connexion admin**.
2. Aller sur `/admin/delegations`. La table liste les délégations existantes
   avec les badges permissions (`SAISIE`, `SOUMISSION`, `VALIDATION`,
   `PUBLICATION`).
3. **Hover** ~200ms sur un badge `SAISIE` → tooltip apparaît avec un texte
   FR décrivant la permission (cf. constante
   `PERMISSION_DELEGABLE_DESCRIPTIONS` dans
   `src/lib/api/delegations.ts`).
4. **Hover** sur un badge `SOUMISSION` → tooltip FR.
5. **Hover** sur un badge `VALIDATION` → tooltip FR.
6. **Hover** sur un badge `PUBLICATION` → tooltip FR **mentionnant
   « Action irréversible »** (cohérent avec la description BDD du rôle
   PUBLICATEUR migration `1779200000110`).
7. **Connexion Aïcha**, aller sur `/mes-delegations` (onglet Reçues ou
   Émises). Hover sur les mêmes badges → mêmes tooltips.
8. **Sur Aïcha**, cliquer **« Nouvelle délégation »** → `CreerDelegationDialog`
   s'ouvre. Hover sur les **options** de permissions (4 choix) → tooltips
   apparaissent (style underline pointillé + `cursor-help`).

#### Z2 — Rôles métier (gestion des rôles user)

9. **Connexion admin**, aller sur `/admin/users/:id` (un user existant),
   ouvrir l'onglet ou la section **« Gérer les rôles »**
   (`GererRolesSection`).
10. Le composant affiche les rôles métier disponibles avec descriptions
    consommées depuis `listRoles()` (qui expose `description: string |
    null` via `RoleResponse`).
11. **Hover** sur le rôle `SAISISSEUR` → tooltip avec description BDD
    (migration `1779200000110`).
12. **Hover** sur `VALIDATEUR` / `PUBLICATEUR` / `AUDITEUR` → tooltips
    correspondants.
13. **Cas wrapping conditionnel** : si un rôle legacy existe avec
    `description IS NULL` ou vide → **pas de tooltip** affiché
    (`<Tooltip>` non rendu, le badge reste simple). Vérifier avec :
    ```sql
    SELECT code_role, libelle, description FROM ref_role_metier
     ORDER BY code_role;
    -- S'il existe un code_role avec description NULL/vide, le hover
    -- sur ce badge dans l'UI ne doit PAS afficher de tooltip.
    ```

### Vérifications SQL

```sql
-- Z2 — descriptions des rôles métier seedées Lot 4.1-fix3
SELECT code_role, libelle, description
  FROM ref_role_metier
 WHERE code_role IN ('SAISISSEUR','VALIDATEUR','PUBLICATEUR','AUDITEUR')
 ORDER BY code_role;
-- Attendu : 4 lignes avec descriptions non-vides (mention "irréversible"
-- attendue dans la description de PUBLICATEUR)
```

### Cas négatifs

- **Hover < 200ms** : pas de tooltip (delayDuration=200 protège des
  flickers).
- **Rôle legacy sans description** : aucun tooltip (pas de tooltip
  trompeur).
- **Mobile / touch device** : le hover est remplacé par focus/tap
  (comportement Radix par défaut — non testé en MVP).

### Critères de validation finale ✅

- [ ] **Z1** : 4 tooltips visibles sur les 3 pages
      (`AdminDelegationsPage`, `MesDelegationsPage`,
      `CreerDelegationDialog`)
- [ ] **PUBLICATION** : tooltip mentionne explicitement « Action
      irréversible »
- [ ] **Z2** : 4 tooltips visibles sur `GererRolesSection`
- [ ] Tooltip s'affiche après ~200ms de hover (delayDuration)
- [ ] Wrapping conditionnel : badge sans description → **aucun tooltip**
- [ ] Cohérence FR entre les 3 pages Z1 (même constante
      `PERMISSION_DELEGABLE_DESCRIPTIONS` partagée)

---

## R15 — Découvrabilité édition reforecast inline

**Objectif** : valider la signalétique d'édition reforecast (Lot 6.7.3) :
- Bouton **« Éditer ce reforecast »** (renommé Lot 6.7.3, avant : « Éditer
  dans la saisie budgétaire ») dans `ReforecastGrille`.
- Tooltip explicatif au survol du bouton.
- Redirection vers `/budget/saisie?versionId={id}&scenarioId={id}`.
- **Bandeau bleu informatif** sur `SaisieBudgetairePage` lorsque la
  version a `typeVersion === 'reforecast'`, caché sinon.

Lot 6.7.3.

### Pré-requis

- Contrôleur de gestion connectable.
- Au moins 1 reforecast `ACTIVE` éditable (statut workflow `Brouillon`
  ou `Soumis` selon les règles d'édition) — réutiliser R4 / R5.
- Au moins 1 version `budget_initial` classique pour le cas négatif.

### Étapes

#### Partie A — Bouton et tooltip

1. **Connexion contrôleur de gestion**.
2. Aller sur `/reforecast`. Cliquer sur un reforecast `ACTIVE` (issu de R4
   ou R5).
3. Aller sur `/reforecast/:id`. Onglet **Grille** (par défaut).
4. Le composant `ReforecastGrille` affiche un bouton **« Éditer ce
   reforecast »** (libellé exact Lot 6.7.3).
5. **Hover** ~200ms sur le bouton → tooltip explicatif (cf. Lot 6.7.3) :
   « La saisie reforecast utilise la même grille que le budget. Vous
   serez redirigé vers la page de saisie filtrée sur ce reforecast. »
   (texte exact à confirmer dans l'UI livrée).

#### Partie B — Redirection vers saisie budgétaire

6. Cliquer **« Éditer ce reforecast »**.
7. Redirection automatique vers
   `/budget/saisie?versionId={reforecastId}&scenarioId={scenarioId}`.
8. La page `SaisieBudgetairePage` se charge avec les bons filtres
   pré-remplis.

#### Partie C — Bandeau bleu contexte reforecast

9. Sur la `SaisieBudgetairePage`, en haut de la grille, un **bandeau bleu
   informatif** est visible :
   - « Vous éditez un reforecast T{trim} {annee}. Les modifications sont
     sauvegardées en place. » (texte exact à confirmer).
   - Visible UNIQUEMENT si `versionComplete?.typeVersion === 'reforecast'`.
10. Modifier une cellule éditable de la grille (ex : montant T2 d'un compte
    extrapolé). Cliquer **« Enregistrer »**. Toast succès.
11. Retour sur `/reforecast/:id` (lien ou navigation arrière) →
    onglet Grille affiche la cellule mise à jour.

#### Partie D — Cas négatif bandeau caché

12. Naviguer vers `/budget/saisie?versionId={budget_initial_id}` (une
    version `budget_initial`, pas reforecast).
13. **Vérifier que le bandeau bleu N'EST PAS affiché** — la page ressemble
    à la version budget classique (sans bruit).

### Vérifications SQL

```sql
-- Confirmer le typeVersion='reforecast' pour le test partie C
SELECT id, code_version, type_version, trimestre_consolide,
       annee_consolide
  FROM dim_version
 WHERE id = <reforecastId_utilise>;
-- Attendu : type_version='reforecast', trim/année cohérents avec le
-- libellé du bandeau

-- Le fait_budget mis à jour est bien rattaché à la version reforecast
SELECT fb.id, fb.fk_version, fb.montant_fcfa, fb.date_modification,
       v.code_version, v.type_version
  FROM fait_budget fb
  INNER JOIN dim_version v ON v.id = fb.fk_version
 WHERE fb.fk_version = <reforecastId_utilise>
   AND fb.date_modification > NOW() - INTERVAL '5 minutes'
 ORDER BY fb.id DESC LIMIT 1;
-- Attendu : 1 ligne mise à jour récemment, type_version='reforecast'
```

### Cas négatifs

- **Reforecast `Publié` ou `OBSOLETE`** : le bouton « Éditer ce
  reforecast » peut être caché ou désactivé (selon les règles d'édition
  livrées Lot 5.3 — vérifier le comportement actuel et documenter).
- **Utilisateur sans `BUDGET.SAISIR`** sur le périmètre du reforecast :
  redirect vers `/budget/saisie` mais cellules en lecture seule.

### Critères de validation finale ✅

- [ ] Bouton libellé **exactement « Éditer ce reforecast »**
- [ ] Tooltip explicatif visible au hover ≥ 200ms
- [ ] Clic → redirect avec query params `versionId` + `scenarioId`
- [ ] Bandeau bleu visible UNIQUEMENT si `typeVersion === 'reforecast'`
- [ ] Bandeau bleu mentionne le trimestre + année consolidés
- [ ] Modification d'une cellule s'enregistre bien dans `fait_budget` de
      la version reforecast (cf. vérif SQL n°2)
- [ ] Sur une version `budget_initial`, le bandeau bleu reste **caché**

---

## Synthèse — capacités validées par la recette

| # | Capacité MVP validée | Lots de référence |
|---|----------------------|-------------------|
| **R1** | Saisie + validation cross-user du réalisé | Lot 5.1 |
| **R2** | Import Excel/CSV du réalisé en lot | Lot 5.1.B |
| **R3** | Tableau de bord budget vs réalisé + export Excel 3 onglets | Lot 5.2 |
| **R4** | Reforecast nominal méthode MOYENNE_TRIMESTRE | Lot 5.3 |
| **R5** | Workflow reforecast 4 transitions polymorphes | Lot 5.3 |
| **R6** | Écrasement OBSOLETE en cascade + chaîne `fk_version_remplacante` | Lot 5.3 |
| **R7** | RBAC + filtrage périmètre cross-module | Lots 5.1, 5.2, 5.3 |
| **R8** | Observabilité runtime queue BullMQ + healthcheck Redis dégradé | Lot 6.3 |
| **R9** | Politique mdp + expiration 90j + ForceChangePasswordPage 3 cas | Lots 6.4.A + 6.4.C.2 + 6.7.1 |
| **R10** | Rate limiting login 2 fenêtres + audit `LOGIN_RATE_LIMITED` | Lot 6.4.B |
| **R11** | Reset password admin async via queue + force-changement-mdp (sécurité critique : mdp jamais persisté) | Lots 6.4.C.1 + 6.4.C.3 |
| **R12** | Forgot password self-service + anti-énumération + cleanup cron | Lot 6.5.A |
| **R13** | Rappel J-3 délégation via cron + idempotence + opt-out | Lot 6.5.B |
| **R14** | Tooltips délégation Z1 (4 permissions) + Z2 (4 rôles métier) | Lot 6.7.2 |
| **R15** | Découvrabilité édition reforecast inline + bandeau contexte | Lot 6.7.3 |

À la livraison BSIC, marquer ce document daté avec le résultat de chaque
scénario (✓ / ✗ / commentaire) — voir tableau suivant.

---

## Suivi d'exécution détaillé

Tableau à compléter au fil des campagnes de recette. Une ligne par
exécution réelle (un scénario peut être ré-exécuté plusieurs fois —
dupliquer la ligne).

**Légende** :
- ⬜ à faire
- ✅ passé (toutes les vérifications SQL OK + UI conforme + critères ✅
  cochés)
- ❌ échec (au moins une vérification a échoué — décrire en notes +
  référencer une issue)
- ⚠️ partiel (le scénario passe mais avec un comportement inattendu qui
  n'invalide pas la capacité — décrire en notes)

| # | Scénario | Date | Exécutant | Statut | Notes / référence issue |
|---|----------|------|-----------|--------|-------------------------|
| **R1** | Saisie + validation réalisé cross-user | | | ⬜ | |
| **R2** | Import Excel réalisé | | | ⬜ | |
| **R3** | Tableau de bord budget vs réalisé | | | ⬜ | |
| **R4** | Reforecast nominal MOYENNE | | | ⬜ | |
| **R5** | Reforecast workflow 4 transitions | | | ⬜ | |
| **R6** | Écrasement OBSOLETE | | | ⬜ | |
| **R7** | RBAC + périmètre cross-module | | | ⬜ | |
| **R8** | Healthcheck Redis + monitoring queue | | | ⬜ | |
| **R9** | Cycle vie mdp (3 cas a/b/c) | | | ⬜ | |
| **R10** | Rate limiting login | | | ⬜ | |
| **R11** | Reset password admin async + force-changement-mdp | | | ⬜ | |
| **R12** | Forgot password self-service | | | ⬜ | |
| **R13** | Rappel J-3 délégation cron | | | ⬜ | |
| **R14** | Tooltips Z1 + Z2 | | | ⬜ | |
| **R15** | Découvrabilité reforecast inline | | | ⬜ | |

> En cas d'échec, créer une issue référençant ce document
> (`docs/RECETTE-MVP.md`) avec le numéro `Rn`, la date, et le bloc de
> vérification SQL ou la capture UI incriminée. Les scénarios marqués
> **critiques sécurité (R9 / R10 / R11 / R12)** doivent repasser en
> priorité avant toute mise en production.

---

## Références

- [Doc release v1.0.0-mvp](RELEASE-v1.0.0-mvp.md) — features livrées,
  procédure de déploiement, dette tracée
- [Recette Lot 4 (archivée)](lot-4/recette.md) — multi-périmètres,
  délégations, notifications (7 scénarios — référence historique)
- [Recette Lot 5 (archivée)](lot-5/recette.md) — module Exécution
  (référence historique des R1-R7 initiaux, mis à jour ici)
- [Doc Lot 6.7 UX résiduel](lot-6/6.7-ux-residuel.md) — détail
  cross-repo des 3 sous-lots R8/R14/R15
- [CHANGELOG backend](../CHANGELOG.md) — historique exhaustif des
  versions
- [Doc CI/CD](ci-cd.md) — branch protection rules et jobs CI
