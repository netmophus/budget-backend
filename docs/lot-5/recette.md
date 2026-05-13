# Lot 5 — Recette transverse R1 → R7

> **📌 Archive historique — voir [`docs/RECETTE-MVP.md`](../RECETTE-MVP.md)
> pour la recette MVP consolidée v1.0.0.**
>
> Ce document est conservé comme **référence historique du Lot 5**
> (Module Exécution : réalisé, tableau de bord, reforecast). La
> consolidation MVP reprend les R1-R7 ci-dessous (avec mise à jour du
> placeholder `CR_AG_BANDABARI` → `CR_AG_ABJ_PLATEAU` et du libellé
> bouton « Éditer ce reforecast » Lot 6.7.3) et ajoute R8-R15 pour les
> capacités Lots 6.3-6.7. Pour exécuter la recette MVP complète,
> utiliser exclusivement `docs/RECETTE-MVP.md`.

> Statut : **livrée pour exécution** (mai 2026) — branche
> `lot-5/5.3-reforecast` (consolidée à la fin du Lot 5).
>
> 7 scénarios bout-en-bout exécutables en pré-prod ou démo pour
> valider la chaîne complète du module **Exécution** :
> saisie/import du réalisé → consolidation tableau de bord →
> reforecast trimestriel avec workflow + écrasement.
>
> Chaque sous-lot dispose déjà de tests automatisés (1618 verts au
> total). La recette transverse vérifie l'enchaînement réel UI +
> API + audit.

## 0. Pré-requis communs

### 0.1 Environnement

- Backend MIZNAS démarré (`npm run start:dev` dans `budjet-backend`).
- Frontend MIZNAS démarré (`npm run dev` dans `budjet-frontend`).
- Postgres accessible avec les **55 migrations appliquées** dont les
  3 nouvelles du Lot 5 :
  - 053 (`1779200000150-CreerFaitRealiseEtPermissions`) — table
    `fait_realise` + permissions REALISE.* + 4 codes audit (Lot 5.1).
  - 054 — *cf. Lot 5.2 : aucune migration dédiée, pure mécanique
    SQL sur `fait_budget` ∪ `fait_realise`*.
  - 055 (`1779200000160-AjoutReforecastTrimestriel`) — extensions
    `dim_version` (9 colonnes), permission
    `BUDGET.REFORECAST_LANCER`, 6 codes audit `*_REFORECAST` (Lot
    5.3).

### 0.2 Données de référence (pré-existantes)

- Au moins **1 version source publiée** (ex. `BUDGET_INITIAL_2027`,
  `statut=gele`).
- Au moins **1 scénario actif** (ex. `OPTIMISTE_2027`).
- Au moins **un CR avec budget saisi sur l'année consolidée** (ex.
  `CR_AG_BANDABARI` avec lignes `fait_budget` sur les 12 mois 2027).
- Calendrier `dim_temps` : 1ers du mois 2027 présents.

### 0.3 Personas seed (Lot 4.1-fix3)

| Email | Rôle | Mot de passe |
|-------|------|--------------|
| `admin@miznas.local` | ADMIN | `SEED_ADMIN_PASSWORD` |
| `adj.retail@miznas.local` (Fatima) | SAISISSEUR | `MiznasTest!2026` |
| `dir.retail@miznas.local` (Amadou) | VALIDATEUR | `MiznasTest!2026` |
| `dir.corporate@miznas.local` (Ibrahim) | VALIDATEUR | `MiznasTest!2026` |
| `controleur.gestion@miznas.local` (Aïcha) | VALIDATEUR | `MiznasTest!2026` |
| `auditeur@miznas.local` (Moussa) | AUDITEUR | `MiznasTest!2026` |
| `dga.exploitation@miznas.local` (Salif) | PUBLICATEUR | `MiznasTest!2026` |

> Corrigé Lot 6.8 vs version d'origine 2026-05 : prénoms + mot de
> passe seed alignés sur la migration source
> `1779200000090-AjouterPersonasBSIC.ts`. Voir
> [`docs/RECETTE-MVP.md`](../RECETTE-MVP.md).

### 0.4 Conventions

Chaque scénario est structuré :
- **Objectif** : capacité validée
- **Pré-requis** : état de base spécifique
- **Étapes** : action → résultat attendu (numéroté)
- **Vérifications SQL** : requêtes à exécuter pour valider
- **Cas négatifs** : ce qui doit échouer

Une fenêtre `psql` connectée à la base en parallèle pour les
vérifications SQL.

---

## R1 — Saisie + validation réalisé cross-user

**Objectif** : valider la saisie manuelle puis la validation par un
autre utilisateur (séparation des rôles `REALISE.SAISIR` /
`REALISE.VALIDER`). Lot 5.1.

### Pré-requis

- Au moins 1 ligne `fait_budget` sur le compte `701100`
  (Commissions de tenue de compte) en mars 2027 sur `CR_AG_BANDABARI`
  pour la version `BUDGET_INITIAL_2027`.
- Amadou (`dir.retail`, VALIDATEUR) a `REALISE.VALIDER`. Fatima
  (`adj.retail`, SAISISSEUR) a `REALISE.SAISIR`.

### Étapes

1. **Connexion Fatima** (`adj.retail`, SAISISSEUR).
2. Aller sur `/realise/saisie`.
3. Sélectionner CR=`CR_AG_BANDABARI`, mois début=2027-01,
   mois fin=2027-03, devise=`XOF`.
4. La grille s'affiche avec 3 mois × N comptes. Tous les statuts
   sont `IMPORTE` ou vides.
5. Cliquer « Nouvelle ligne » sur le compte 701100, mois mars 2027,
   ligne métier `EXPLOITATION`.
6. Saisir montant `4 800 000`, mode `MNT`, commentaire
   « Recette R1 — saisie initiale ».
7. Cliquer « Enregistrer ». Toast succès. La grille affiche la
   nouvelle ligne en statut `IMPORTE` (badge ambre).
8. **Déconnexion** Fatima. **Connexion** Amadou (`dir.retail`).
9. Aller sur `/realise/saisie`, mêmes filtres.
10. La grille montre la ligne saisie par Fatima (statut `IMPORTE`).
11. Cocher la ligne, cliquer « Valider la sélection ».
12. Dialogue de validation : récap « 1 ligne(s) seront validées »
    + ligne « 701100 — Commissions de tenue de compte : 1 ligne(s) ».
13. Cliquer « Valider 1 ligne(s) ». Toast « 1 ligne(s) validée(s). »
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
          WHERE code_cr='CR_AG_BANDABARI')
   AND fr.fk_compte = (SELECT id FROM dim_compte WHERE code_compte='701100')
   AND fr.fk_temps = (
         SELECT id FROM dim_temps
          WHERE date='2027-03-01' AND jour=1);
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

- **Tenter `DELETE`** côté Amadou sur la ligne `VALIDE` → 422
  (statut=VALIDE non supprimable, REALISE.SUPPRIMER ne suffit pas).
- **Fatima tente de valider sa propre ligne** → bouton « Valider la
  sélection » non visible (pas de `REALISE.VALIDER` pour SAISISSEUR).

---

## R2 — Import Excel réalisé

**Objectif** : valider l'import en lot par fichier Excel/CSV avec
rapport détaillé (lignes OK / KO + raisons). Lot 5.1.B.

### Pré-requis

- Fichier `realise-2027-q1.xlsx` (ou CSV) avec 6 colonnes :
  `code_cr`, `code_compte`, `code_ligne_metier`, `mois` (YYYY-MM),
  `montant`, `code_devise`. ≥ 50 lignes valides + 3 lignes
  intentionnellement invalides (compte inexistant, mois mal formé,
  montant négatif).

### Étapes

1. **Connexion Fatima** (`adj.retail`, SAISISSEUR).
2. Aller sur `/realise/saisie`.
3. Cliquer « Importer ». Dialogue d'import s'ouvre.
4. Glisser-déposer le fichier `realise-2027-q1.xlsx`.
5. Cliquer « Lancer l'import ». Loading.
6. Le rapport s'affiche : « 50 ligne(s) créée(s), 3 ligne(s)
   rejetée(s) ». Détail des 3 erreurs avec ligne du fichier + motif.
7. Fermer le dialogue. La grille est rechargée avec les nouvelles
   lignes en `IMPORTE`.

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
- **Amadou** (VALIDATEUR sans REALISE.IMPORTER) → bouton « Importer »
  non visible.

---

## R3 — Tableau de bord budget vs réalisé + export Excel

**Objectif** : valider l'agrégation des écarts budget vs réalisé,
les niveaux d'alerte (NORMAL / ATTENTION / CRITIQUE / MANQUANT) et
l'export Excel multi-onglets. Lot 5.2.

### Pré-requis

- R1 et R2 exécutés : ≥ 50 lignes `fait_realise` `VALIDE` sur
  Q1 2027.

### Étapes

1. **Connexion contrôleur de gestion** (`controleur.gestion`,
   VALIDATEUR — a `BUDGET.LIRE` + `REALISE.LIRE`).
2. Aller sur `/tableau-de-bord/budget-vs-realise`.
3. Sélecteurs : version `BUDGET_INITIAL_2027`, scénario
   `OPTIMISTE_2027`, mois début 2027-01, fin 2027-03, seuil
   ATTENTION 5 %, seuil CRITIQUE 10 %.
4. Cliquer « Analyser ». Loading.
5. KPI cards affichent : total écarts, dont CRITIQUE, dont
   ATTENTION, écart total absolu.
6. Le tableau d'écarts liste les lignes triées par écart absolu
   décroissant.
7. Vérifier : la ligne `701100 mars 2027` apparaît avec
   `montantBudget` (du fait_budget), `montantRealise=4 800 000`,
   `ecart`, `niveauAlerte` selon seuils, `sensEcart` selon classe
   compte (701 = PRODUIT donc favorable si réalisé > budget).
8. Filtre rapide : choisir « Critiques uniquement » → seules les
   lignes avec niveau CRITIQUE restent.
9. Recherche : taper `701100` → 1 ligne.
10. Cliquer « Exporter Excel ». Le fichier
    `ecarts-budget-realise-{versionId}-{date}.xlsx` est téléchargé.
11. Ouvrir le fichier : 3 onglets (Synthèse / Détail / Filtres),
    couleurs conditionnelles sur la colonne « Niveau ».

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

- **Auditeur** (REALISE.LIRE seul, pas BUDGET.LIRE) → 403 sur
  `GET /tableau-de-bord/budget-vs-realise` (RBAC double permission).
- **Filtrer sur scénario inexistant** → tableau vide + message
  « Aucune ligne disponible. Vérifiez les filtres et que le
  réalisé a bien été validé pour cette période. »

---

## R4 — Reforecast nominal méthode MOYENNE_TRIMESTRE

**Objectif** : valider le lancement nominal d'un reforecast avec
extrapolation par moyenne du trimestre consolidé. Lot 5.3.

### Pré-requis

- R1, R2, R3 OK. ≥ 1 fait_realise VALIDE par mois sur le
  trimestre Q1 2027 pour les CR/comptes actifs.

### Étapes

1. **Connexion contrôleur de gestion** (a `BUDGET.REFORECAST_LANCER`).
2. Aller sur `/reforecast`. La liste est vide ou ne contient pas
   encore de reforecast pour la clé (BI_2027, OPT_2027, T1, 2027).
3. Cliquer « Lancer un reforecast ». Dialogue s'ouvre.
4. Sélecteurs :
   - Version source : `BUDGET_INITIAL_2027`.
   - Scénario source : `OPTIMISTE_2027`.
   - Trimestre : T1 (radio).
   - Année : 2027 (auto-rempli depuis exerciceFiscal de la version).
   - Méthode : `Moyenne du trimestre consolidé`.
   - Libellé : « Reforecast T1 2027 » (auto-rempli).
5. Pas d'avertissement OBSOLETE (premier reforecast pour cette clé).
6. Cliquer « Lancer le reforecast ». Loading « Génération en
   cours… ». Toast succès. Redirection vers `/reforecast/:id`.
7. La page détail s'affiche : header avec badges T1 2027 +
   `Moyenne du trimestre consolidé` + workflow `Brouillon` +
   publication `ACTIVE`.
8. Onglet Grille (par défaut) : matrice CR × compte × ligne_metier
   × 12 mois. Cellules T1 2027 affichent badge `RÉALISÉ` (vert).
   Cellules avril → décembre 2027 affichent badge `EXTRAPOLATION`
   (bleu).
9. Onglet « Comparaison vs source » : KPI total écart absolu +
   ajustées + inchangées. Le tableau liste les écarts par ligne.
   Origine `RÉALISÉ` pour T1, `EXTRAPOLATION` pour T2-T4.

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
  -- Moyenne T1 du compte 701100 sur CR_AG_BANDABARI
  (SELECT SUM(fr.montant)/3.0
     FROM fait_realise fr
     INNER JOIN dim_temps t ON t.id=fr.fk_temps
    WHERE fr.statut='VALIDE'
      AND fr.fk_centre_responsabilite=(SELECT id FROM dim_centre_responsabilite WHERE code_cr='CR_AG_BANDABARI')
      AND fr.fk_compte=(SELECT id FROM dim_compte WHERE code_compte='701100')
      AND t.annee=2027 AND t.mois BETWEEN 1 AND 3) AS moyenne_t1,
  -- Valeur extrapolée du même compte en avril 2027
  (SELECT fb.montant_fcfa
     FROM fait_budget fb
     INNER JOIN dim_temps t ON t.id=fb.fk_temps
    WHERE fb.fk_version = (SELECT version_id FROM cible)
      AND fb.fk_centre=(SELECT id FROM dim_centre_responsabilite WHERE code_cr='CR_AG_BANDABARI')
      AND fb.fk_compte=(SELECT id FROM dim_compte WHERE code_compte='701100')
      AND t.annee=2027 AND t.mois=4
    LIMIT 1) AS valeur_extrapolee_avril;
-- Les deux montants doivent être égaux (à arrondi près).
```

### Cas négatifs

- **Aucun réalisé VALIDE pour le trimestre demandé** → 422
  « Aucun réalisé validé sur le trimestre T1 2027, impossible de
  lancer le reforecast. »
- **Trimestre 5** → 400 (validation DTO).
- **Amadou** (`dir.retail`, VALIDATEUR sans `BUDGET.REFORECAST_LANCER`)
  → 403 sur `POST /reforecast/lancer`.

---

## R5 — Reforecast soumission, rejet, resoumission, validation, publication

**Objectif** : valider le workflow complet 4 transitions sur un
reforecast (codes audit `*_REFORECAST` polymorphes). Lot 5.3.

### Pré-requis

- R4 OK : 1 reforecast en `Brouillon` + `ACTIVE` sur la clé
  (BI_2027, OPT_2027, T1, 2027).

### Étapes

1. **Connexion contrôleur de gestion** (Brouillon → Soumis).
2. Aller sur `/reforecast/:id` du R4. Statut `Brouillon`.
3. Cliquer « Soumettre ». Toast « Soumission effectué. ». Statut
   passe à `Soumis`.
4. **Déconnexion**, **connexion Amadou** (`dir.retail`, VALIDATEUR).
5. Aller sur `/reforecast/:id`. Boutons « Valider » et « Rejeter »
   visibles.
6. Cliquer « Rejeter ». Dialogue motif. Saisir
   « Méthode incorrecte — refaire en BUDGET_INITIAL ».
7. Cliquer « Rejeter ». Toast. Statut repasse à `Brouillon`. Le
   motif est conservé en audit.
8. **Reconnexion contrôleur**. Aller sur `/reforecast`.
9. Cliquer « Lancer un reforecast » avec les **mêmes paramètres**
   mais méthode = `BUDGET_INITIAL`.
10. Avertissement OBSOLETE affiché : « Un reforecast existe déjà…
    statut : ouvert. ». Cocher la case de confirmation.
11. Cliquer « Lancer le reforecast ». Le précédent reforecast est
    marqué `OBSOLETE`. Le nouveau est créé en `Brouillon` `ACTIVE`.
12. Sur le nouveau reforecast, cliquer « Soumettre » (statut
    `Soumis`).
13. **Connexion Amadou**, valider le nouveau reforecast (statut
    `Validé`).
14. **Déconnexion**, **connexion Salif** (`dga.exploitation`,
    PUBLICATEUR).
15. Aller sur `/reforecast/:id` du nouveau reforecast. Bouton
    « Publier ».
16. Cliquer « Publier ». Toast. Statut `Publié`. Banner vert
    « Reforecast publié et actif. Cette version est IMMUABLE. ».

### Vérifications SQL

```sql
-- 4 transitions sur le nouveau reforecast (audit *_REFORECAST)
SELECT type_action, utilisateur, date_action,
       payload_apres->>'commentaireRejet' AS motif_rejet
  FROM audit_log
 WHERE entite_cible='dim_version'
   AND id_cible::bigint = (
         SELECT MAX(id) FROM dim_version
          WHERE type_version='reforecast'
            AND statut_publication='ACTIVE')
 ORDER BY date_action;
-- Attendu (ancien reforecast) :
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

- **Soumettre une version déjà soumise** → 409 « Seule une version
  en Brouillon peut être soumise. »
- **Publier un reforecast OBSOLETE** → 409 « Ce reforecast est
  OBSOLETE… aucune transition n'est possible. »

---

## R6 — Écrasement OBSOLETE

**Objectif** : valider la décision Q1 produit (un nouveau
`lancer()` écrase l'ancien ACTIVE pour la même clé en le marquant
OBSOLETE avec audit complet). Lot 5.3.

### Pré-requis

- R5 terminé : 1 reforecast `Publié` `ACTIVE` + 1 reforecast
  `OBSOLETE` (l'ancien rejeté).

### Étapes

1. **Connexion contrôleur de gestion**.
2. Aller sur `/reforecast`. Filtre publication = `OBSOLETE` →
   tableau affiche l'ancien reforecast avec badge gris barré et
   tooltip « Remplacé par : `<code>` ».
3. Cliquer « Voir détail » sur l'OBSOLETE. Banner ambre s'affiche :
   « Ce reforecast est marqué OBSOLETE depuis le `<date>`. Il a été
   remplacé par `<libellé>` (`<code>`). Plus de modifications
   possibles. ». Lien remplaçant cliquable.
4. Aucun bouton workflow n'est visible (statut_publication=OBSOLETE).
5. Cliquer le lien remplaçant → redirection vers le reforecast
   ACTIVE publié.
6. Lancer un **3e reforecast** sur la même clé pour démontrer
   l'écrasement en cascade. Avertissement, confirmation, lancement.
7. L'ancien reforecast `Publié` `ACTIVE` est désormais marqué
   `OBSOLETE` (publication seulement, statut workflow conservé).
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

- **Tenter de soumettre l'OBSOLETE** via API directe → 409
  « Aucune transition n'est possible. »

---

## R7 — RBAC + filtrage périmètre cross-module

**Objectif** : valider les permissions et le filtrage périmètre
sur l'ensemble des modules Exécution. Lot 5.1, 5.2, 5.3.

### Pré-requis

- Tous les personas seedés et actifs.
- Fatima (`adj.retail`, SAISISSEUR) affectée à `STRUCTURE_RETAIL`
  uniquement (cf. R1 du Lot 4).
- Auditeur sans aucun périmètre actif.

### Étapes

1. **Connexion auditeur**.
2. Sidebar : voit « Saisie réalisé » (`REALISE.LIRE` ✓), « Tableau
   de bord » (`REALISE.LIRE` ✓), « Reforecasts » (`BUDGET.LIRE` ✓).
3. `/realise/saisie` : grille accessible mais aucun bouton « Nouvelle
   ligne » / « Importer » / « Valider » (pas de SAISIR ni VALIDER).
4. `/tableau-de-bord/budget-vs-realise` : analyse + export accessibles
   (seules permissions BUDGET.LIRE + REALISE.LIRE requises).
5. `/reforecast` : accès en lecture, **pas de bouton « Lancer »**
   (pas de `BUDGET.REFORECAST_LANCER`).
6. `/reforecast/:id` d'un Brouillon : aucun bouton workflow.
7. **Déconnexion**, **connexion Fatima** (`adj.retail`, SAISISSEUR).
8. `/realise/saisie` : grille filtrée sur les CR de
   `STRUCTURE_RETAIL` uniquement (pas les autres structures).
9. Boutons « Nouvelle ligne » + « Importer » visibles. Pas de
   « Valider » (pas REALISE.VALIDER).
10. `/reforecast` : accessible en lecture, pas de bouton « Lancer ».
11. `/reforecast/:id` Brouillon : bouton « Soumettre » visible
    (Fatima a `BUDGET.SOUMETTRE`). Pas de « Valider » ni « Publier ».

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

- **Fatima tente de saisir sur un CR hors `STRUCTURE_RETAIL`** via
  l'API directement → 403 « périmètre interdit ».
- **Auditeur tente `POST /reforecast/lancer`** → 403.

---

## Suivi d'exécution de la recette

Légende : ⬜ à faire / ✅ passé / ❌ échec / ⚠️ partiel

| Scénario | Date d'exécution | Exécutant | Statut | Notes |
|----------|------------------|-----------|--------|-------|
| **R1** Saisie + validation cross-user | | | ⬜ | |
| **R2** Import Excel | | | ⬜ | |
| **R3** Tableau de bord + export Excel | | | ⬜ | |
| **R4** Reforecast nominal MOYENNE | | | ⬜ | |
| **R5** Reforecast rejet + resoumission | | | ⬜ | |
| **R6** Écrasement OBSOLETE | | | ⬜ | |
| **R7** RBAC + périmètre | | | ⬜ | |
