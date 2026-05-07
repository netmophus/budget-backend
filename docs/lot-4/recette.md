# Lot 4 — Recette transverse R1 → R7

> Statut : **livré** (2026-05-07) — branche `lot-4/4.4-recette`
>
> Ce document décrit 7 scénarios de bout-en-bout exécutables en
> environnement de pré-prod ou démo pour valider la chaîne complète
> du Lot 4 : multi-périmètres → délégations → notifications.
>
> Chaque sous-lot a déjà ses tests automatisés (1332 verts au total).
> La recette transverse vérifie que les briques s'enchaînent
> correctement avec une charge réelle (UI + API + cron + email).

## 0. Pré-requis communs

### 0.1 Environnement

- Backend MIZNAS démarré (`npm run start:dev` dans
  `budjet-backend`).
- Frontend MIZNAS démarré (`npm run dev` dans
  `budjet-frontend`).
- Postgres accessible avec les **52 migrations appliquées**
  (`npm run migration:run`).
- SMTP de capture **Mailhog** disponible sur `localhost:1025`
  (UI sur `http://localhost:8025`) — ou `EMAIL_DRY_RUN=true`
  selon le scénario.
- Seed personas exécuté (cf. migration Lot 4.1-fix3) :

  | Email | Rôle | Mot de passe seed |
  |-------|------|-------------------|
  | `admin@miznas.local` | ADMIN | défini par `SEED_ADMIN_PASSWORD` |
  | `lecteur@miznas.local` | LECTEUR | `ChangeMe!2026` |
  | `adj.retail@miznas.local` (Amadou) | SAISISSEUR | `ChangeMe!2026` |
  | `dir.retail@miznas.local` (Aïcha) | VALIDATEUR | `ChangeMe!2026` |
  | `dir.corporate@miznas.local` (Ibrahim) | VALIDATEUR | `ChangeMe!2026` |
  | `controleur.gestion@miznas.local` | VALIDATEUR | `ChangeMe!2026` |
  | `dga.exploitation@miznas.local` (Fatima) | PUBLICATEUR | `ChangeMe!2026` |
  | `auditeur@miznas.local` | AUDITEUR | `ChangeMe!2026` |

### 0.2 Outils

Une fenêtre `psql` connectée à la base (`DB_NAME`) en parallèle pour
les vérifications SQL. Toutes les requêtes du document sont
réutilisables verbatim.

### 0.3 Conventions du document

Chaque scénario est structuré :
- **Objectif** : capacité validée
- **Pré-requis** : état de base spécifique
- **Étapes** : action → résultat attendu (numéroté)
- **Vérifications SQL** : requêtes à exécuter pour valider
- **Cas négatifs** : ce qui doit ÉCHOUER

---

## R1 — Multi-périmètres simple (cible STRUCTURE)

**Objectif** : valider qu'un admin peut affecter une structure à un
persona, que le persona voit ses CR via le périmètre rattaché, et
que le retrait soft-delete fonctionne.

### Pré-requis

- Persona cible : Amadou (`adj.retail@miznas.local`).
- Au moins une structure courante en base, ex : `STRUCTURE_RETAIL`
  avec ≥ 2 CR rattachés.
- Aucune affectation `STRUCTURE` active sur Amadou.

### Étapes

1. **Connexion admin** sur `/login` puis aller sur
   `/admin/affectations`.
2. **Filtre email** : taper `adj.retail` → la ligne d'Amadou
   s'affiche, badge gris « 0 périmètre » (ou `n` si Lot 4.1-fix3
   personas par défaut).
3. **Cliquer « Ajouter une affectation »** sur sa ligne →
   `AffectationsDialog` s'ouvre.
4. **Choisir** : `cible_type=STRUCTURE`, sélectionner
   `STRUCTURE_RETAIL`, `dateDebut=today`, `motif="Recette R1"`.
5. **Cliquer « Ajouter »** → toast succès « Affectation créée. »
   La liste des affectations actuelles affiche maintenant la ligne.
6. **Déconnexion admin**, **connexion Amadou**.
7. **Aller sur `/budget/saisie`** → le sélecteur CR doit
   exposer **les CR rattachés à `STRUCTURE_RETAIL`**.
8. **Reprendre admin**, retourner sur `/admin/affectations`,
   ouvrir le dialogue d'Amadou, cliquer sur l'icône poubelle de
   la ligne d'affectation `STRUCTURE_RETAIL`.
9. **Confirmer** → toast « Affectation retirée. » La ligne
   apparaît barrée (`actif=false`).
10. **Reconnexion Amadou** → `/budget/saisie` n'expose plus les CR
    de `STRUCTURE_RETAIL`.

### Vérifications SQL

Après étape 5 :
```sql
SELECT id, fk_user, cible_type, cible_id, origine, actif, motif
  FROM user_perimetres
 WHERE fk_user = (SELECT id FROM "user" WHERE email='adj.retail@miznas.local')
   AND cible_type='STRUCTURE'
 ORDER BY id DESC LIMIT 1;
-- attendu : 1 ligne avec origine='AFFECTATION', actif=true,
--          motif='Recette R1', cible_id=<id de STRUCTURE_RETAIL>
```

Après étape 9 :
```sql
SELECT actif FROM user_perimetres WHERE id=<id de la ligne précédente>;
-- attendu : actif=false (soft-delete)
```

Audit trail :
```sql
SELECT type_action, utilisateur, id_cible, statut FROM audit_log
 WHERE entite_cible='user_perimetres'
 ORDER BY id DESC LIMIT 4;
-- attendu : RETIRER_AFFECTATION puis CREER_AFFECTATION (ordre DESC)
```

### Cas négatifs

- Tentative de création doublonnée (même `cible_type`/`cible_id`/
  `origine` actif) : `ConflictException` → toast d'erreur
  « Affectation déjà existante… ».

---

## R2 — Multi-périmètres CR_SET avec date_fin

**Objectif** : valider qu'un set de CR (`CR_SET` ≥ 2) avec
`date_fin` peut être créé, est actif jusqu'à cette date, et
disparaît automatiquement après.

### Pré-requis

- Persona : Aïcha (`dir.retail@miznas.local`).
- 3 CR courants en base, par exemple `CR_AGENCE_NIA`, `CR_AGENCE_OUA`,
  `CR_AGENCE_LOM`.

### Étapes

1. **Admin** → `/admin/affectations` → ouvrir dialogue d'Aïcha.
2. **Choisir** `cible_type=CR_SET` → sélectionner les 3 CR ci-dessus.
3. **dateDebut=today**, **dateFin=today + 30j**, motif
   « Recette R2 multi-CR temporaire ».
4. **Cliquer « Ajouter »** → toast succès.
5. **Déconnexion → connexion Aïcha**.
6. **Aller sur `/budget/saisie`** → sélecteur CR expose
   **exactement les 3 CR** du set (ni plus, ni moins).

### Vérifications SQL

```sql
SELECT id, cible_type, cible_cr_ids, date_debut, date_fin, actif
  FROM user_perimetres
 WHERE fk_user = (SELECT id FROM "user" WHERE email='dir.retail@miznas.local')
   AND cible_type='CR_SET'
 ORDER BY id DESC LIMIT 1;
-- attendu : actif=true, cible_cr_ids = bigint[3], date_fin = aujourd'hui+30
```

7. **Forcer l'expiration** :

```sql
UPDATE user_perimetres
   SET date_fin = CURRENT_DATE - INTERVAL '1 day'
 WHERE id = <id de la ligne précédente>;
```

> Note : `actif` reste `true`. Le filtrage par fenêtre temporelle
> est appliqué côté `PerimetreService.getCrAutorisesPourUser`.

8. **Reconnexion Aïcha** (ou rafraîchir le token) →
   `/budget/saisie` n'expose plus les 3 CR (le set est expiré).

### Cas négatifs

- `cible_type='CR_SET'` avec **1 seul CR** : rejet 400
  `BadRequestException` (`ck_user_perimetres_cible_coherence` côté
  SQL doublé applicatif).
- `cible_type='CR_SET'` avec `cible_id` rempli : rejet 400.
- 2 `CR_SET` strictement identiques actifs pour le même user :
  rejet 409 (`uq_user_perimetres_cr_set_actif`, Lot 4.1-fix2.C).

---

## R3 — Délégation nominal complet (Aïcha → Ibrahim)

**Objectif** : valider la chaîne complète délégation : création UI
+ email DELEGATION_CREEE → action métier via délégation +
`via_delegation_id` audité → révocation + email
DELEGATION_REVOQUEE + miroirs désactivés.

### Pré-requis

- Aïcha (`dir.retail@miznas.local`) — VALIDATEUR avec une
  affectation native (`STRUCTURE` ou `CR_SET`) sur des CR de la
  branche retail.
- Ibrahim (`dir.corporate@miznas.local`) — VALIDATEUR mais sans
  affectation sur la branche retail.
- Au moins une version budgétaire en statut `soumis` sur un CR
  de la branche retail.
- Mailhog en écoute sur `localhost:1025` ; `EMAIL_DRY_RUN=false`.
- Aïcha a bien `notifications_email_actives=true` et
  `notifications_email_types=NULL` (défaut).

### Étapes

1. **Connexion Aïcha** → `/mes-delegations`.
2. **Cliquer « Nouvelle délégation »** → `CreerDelegationDialog`
   s'ouvre.
3. **Choisir** : délégataire = Ibrahim ; périmètre =
   un de ses périmètres natifs (origine `AFFECTATION` ou
   `PRINCIPAL`) ; permission = `VALIDATION` ; `dateDebut=today`,
   `dateFin=today + 7j`, motif « Recette R3 mission Niamey ».
4. **Cliquer « Créer la délégation »** → toast « Délégation
   créée. »
5. **Vérifier Mailhog** : 1 email à `dir.corporate@miznas.local`,
   sujet `[MIZNAS] Vous avez reçu une délégation`. Le corps
   mentionne :
   - Permissions : `VALIDATION`
   - Période : du *today* au *today+7*
   - Le motif
   - Mention « **Anti-chaînage strict (BCEAO)** ».
6. **Déconnexion Aïcha → connexion Ibrahim**.
7. **Vérifier le bandeau de délégations actives sur
   `/budget/a-valider`** : « Vous agissez actuellement avec **1**
   délégation(s) active(s) (1 permission(s) distincte(s)). »
8. **Aller sur la file `/budget/a-valider`** → il voit la version
   soumise précédemment (alors qu'il n'y avait pas accès avant).
9. **Cliquer « Valider »** → toast succès.
10. **Vérifier l'audit** : la ligne `audit_log VALIDER_BUDGET`
    pour cette version contient `via_delegation_id` rempli.

### Vérifications SQL

Après étape 4 :
```sql
SELECT id, fk_delegant, fk_delegataire, permissions, actif
  FROM delegations
 ORDER BY id DESC LIMIT 1;
-- attendu : permissions=['VALIDATION'], actif=true
```

```sql
SELECT origine, delegation_id, fk_user, actif FROM user_perimetres
 WHERE delegation_id = <id ci-dessus>;
-- attendu : 1 ligne miroir avec
--   fk_user = id d'Ibrahim, origine='DELEGATION', actif=true
```

Après étape 5 :
```sql
SELECT evenement, destinataire_email, statut FROM email_log
 ORDER BY id DESC LIMIT 1;
-- attendu : DELEGATION_CREEE / dir.corporate@miznas.local / ENVOYE
```

Après étape 10 :
```sql
SELECT type_action, payload_apres FROM audit_log
 WHERE entite_cible='dim_version' AND type_action='VALIDER_BUDGET'
 ORDER BY id DESC LIMIT 1;
-- attendu : payload_apres contient
--   "via_delegation_id": "<id de la délégation R3>"
```

11. **Reconnexion Aïcha** → `/mes-delegations` onglet « Émises »
    → cliquer « Révoquer » sur la délégation R3.
12. **Saisir motif** « Recette R3 fin du test » → confirmer.
13. **Vérifier Mailhog** : 1 email à Ibrahim, sujet
    `[MIZNAS] Délégation révoquée`, motif rendu dans le corps.
14. **Reconnexion Ibrahim** → `/budget/a-valider` n'affiche plus
    les versions du périmètre d'Aïcha (le miroir est désactivé).

### Vérifications SQL post-révocation

```sql
SELECT actif, revoquee_le, motif_revocation FROM delegations
 WHERE id = <id R3>;
-- attendu : actif=false, revoquee_le rempli, motif_revocation = 'Recette R3 fin du test'

SELECT actif FROM user_perimetres WHERE delegation_id = <id R3>;
-- attendu : actif=false (miroirs soft-delete)

SELECT evenement, destinataire_email FROM email_log
 ORDER BY id DESC LIMIT 1;
-- attendu : DELEGATION_REVOQUEE / dir.corporate@miznas.local
```

### Cas négatifs

- Ibrahim tente de révoquer la délégation d'Aïcha à sa place :
  rejet 403 `ForbiddenException` (« Seul le délégant ou un
  administrateur peut révoquer cette délégation. »).
- Aïcha tente de re-révoquer une délégation déjà inactive :
  rejet 400 `BadRequestException`.

---

## R4 — Expiration automatique d'une délégation (cron)

**Objectif** : valider que le cron quotidien désactive bien les
délégations dont `date_fin` est dépassée et émet l'email
DELEGATION_EXPIREE.

### Pré-requis

- Reprendre une nouvelle délégation A → B avec `dateFin=today`
  (Aïcha délègue à Ibrahim, période de 0 jour mais valide).
- Mailhog allumé, `EMAIL_DRY_RUN=false`.

### Étapes

1. **Aïcha crée la délégation R4** par UI (`/mes-delegations` →
   nouvelle, `dateDebut=today`, `dateFin=today`, motif « R4
   expiration »).
2. **Email DELEGATION_CREEE reçu côté Mailhog** (cf. R3).
3. **Forcer l'expiration en SQL** (sans attendre le cron) :

```sql
UPDATE delegations SET date_fin = CURRENT_DATE - INTERVAL '1 day'
 WHERE id = <id R4>;
```

4. **Déclencher le cron manuellement** via REPL Node ou en
   redémarrant l'application (le `OnApplicationBootstrap` du
   `DelegationsCronService` rejoue le rattrapage).
   - Alternative : attendre `02:00 UTC` (cron `@Cron('0 2 * * *')`).

### Vérifications SQL

Après le déclenchement du cron :
```sql
SELECT actif, date_modification, utilisateur_modification
  FROM delegations WHERE id = <id R4>;
-- attendu : actif=false, utilisateur_modification='system (cron expiration)'

SELECT actif FROM user_perimetres WHERE delegation_id = <id R4>;
-- attendu : tous les miroirs actif=false
```

```sql
SELECT type_action, utilisateur FROM audit_log
 WHERE entite_cible='delegations' AND id_cible='<id R4>'
 ORDER BY id DESC LIMIT 1;
-- attendu : type_action='EXPIRER_DELEGATION', utilisateur='system'
```

```sql
SELECT evenement, destinataire_email FROM email_log
 WHERE evenement='DELEGATION_EXPIREE'
 ORDER BY id DESC LIMIT 2;
-- attendu : 2 emails, vers dir.retail@ ET dir.corporate@
```

### Cas négatifs

- Délégation déjà inactive : le cron ne la sélectionne pas
  (`WHERE actif = true AND date_fin < today`).
- `date_fin = today` exactement : la délégation reste active
  (le filtre est strict `<`, pas `<=`).

---

## R5 — ANTI-CHAÎNAGE STRICT (test critique BCEAO)

**Objectif** : valider la décision produit D2 NON-NÉGOCIABLE — une
permission reçue par délégation ne peut PAS être re-déléguée. La
chaîne s'arrête au délégataire.

### Pré-requis

- Personas A=Aïcha, B=Ibrahim, C=Fatima
  (`dga.exploitation@miznas.local`).
- Aïcha a une affectation native sur un périmètre P.
- Aucune délégation existante entre A, B et C sur P.

### Étapes

1. **A → B** : Aïcha crée une délégation `VALIDATION` à Ibrahim sur
   P (cf. R3 étapes 1-4).
2. **Connexion Ibrahim**, aller sur `/mes-delegations`, cliquer
   « Nouvelle délégation ».
3. **Tenter** : délégataire = Fatima ; permission = `VALIDATION` ;
   périmètre = celui qu'il a reçu d'Aïcha (P, miroir
   `origine='DELEGATION'`).
4. **Vérifier l'UI** :
   - Dans la liste « Périmètres à déléguer » du dialogue,
     **le périmètre miroir P n'apparaît PAS** (filtré côté UI :
     anti-chaînage en double sécurité).
   - Si Ibrahim avait d'autres périmètres natifs, ils
     apparaissent normalement (la délégation native non chaînée
     fonctionne toujours).

### Test API direct (cas où l'UI serait bypassée)

5. **Outils → console navigateur d'Ibrahim** (logged in) :

```javascript
const res = await fetch('/api/v1/delegations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json',
             'Authorization': `Bearer ${localStorage.getItem('budget-store')
               ? JSON.parse(localStorage.getItem('budget-store')).state.accessToken : ''}` },
  body: JSON.stringify({
    fkDelegataire: '<id Fatima>',
    perimetreUserPerimetreIds: ['<id du miroir reçu d Aïcha>'],
    permissions: ['VALIDATION'],
    motif: 'Tentative anti-chaînage R5',
    dateDebut: '2027-01-01',
    dateFin: '2027-01-31',
  }),
});
console.log(res.status, await res.json());
```

6. **Résultat attendu** : **HTTP 400** avec message :
   > « Vous ne pouvez pas déléguer une permission que vous tenez
   > vous-même d'une délégation. La chaîne de délégation est
   > interdite (auditabilité BCEAO). Demandez à un administrateur
   > de réassigner directement. »

### Vérifications SQL

```sql
SELECT COUNT(*) FROM delegations
 WHERE fk_delegant = (SELECT id FROM "user" WHERE email='dir.corporate@miznas.local')
   AND fk_delegataire = (SELECT id FROM "user" WHERE email='dga.exploitation@miznas.local');
-- attendu : 0 (aucune ligne créée)
```

```sql
SELECT type_action, statut FROM audit_log
 WHERE entite_cible='delegations'
 ORDER BY id DESC LIMIT 5;
-- attendu : aucune entrée CREER_DELEGATION récente avec ces personas
```

### Cas négatifs (déjà couverts par les tests automatisés)

- Le test `DelegationsService.spec.ts > ANTI-CHAÎNAGE STRICT`
  reproduit ce cas en pg-mem avec assertion explicite sur le
  message de rejet.
- Tester aussi : Ibrahim peut bien re-déléguer un de ses
  périmètres NATIFS (origine `AFFECTATION`) — l'anti-chaînage
  n'empêche que les chaînes de délégations.

---

## R6 — Workflow complet avec emails (5 transitions)

**Objectif** : valider que chaque transition du workflow Lot 3.5
émet l'email approprié vers les bons destinataires.

### Pré-requis

- Personas : Amadou (SAISISSEUR), Aïcha (VALIDATEUR), Fatima
  (PUBLICATEUR), avec leurs affectations natives sur le même
  périmètre `STRUCTURE_RETAIL`.
- Une version budgétaire en statut `ouvert` (Brouillon) avec
  ≥ 1 ligne `fait_budget` saisie sur ce périmètre.
- Mailhog allumé, `EMAIL_DRY_RUN=false`.

### Étapes

1. **Vider Mailhog** ou noter l'index actuel pour ne capturer que
   les nouveaux mails.
2. **Connexion Amadou**, aller sur `/budget/versions`, soumettre
   la version (statut → `soumis`, commentaire « Recette R6 »).
3. **Mailhog : vérifier 1 email `BUDGET_SOUMIS`** vers Aïcha
   (et tout autre VALIDATEUR concerné par le périmètre).
4. **Connexion Aïcha**, `/budget/a-valider`, **rejeter** la
   version avec motif « R6 — test rejet ».
5. **Mailhog : 1 email `BUDGET_REJETE`** vers Amadou avec le
   motif rendu dans le corps.
6. **Reconnexion Amadou**, re-soumettre la version (statut
   `ouvert` → `soumis`).
7. **Mailhog : 1 nouveau `BUDGET_SOUMIS`** vers Aïcha.
8. **Connexion Aïcha**, **valider** la version avec commentaire
   « R6 — OK ».
9. **Mailhog : 1 email `BUDGET_VALIDE`** vers Amadou (le
   soumetteur, audit lookup) ET vers Fatima (PUBLICATEUR
   concerné par le périmètre).
10. **Connexion Fatima**, `/budget/versions`, **publier** la
    version (commentaire « R6 — gel »).
11. **Mailhog : 1 email `BUDGET_PUBLIE`** vers Amadou + Aïcha +
    tout SAISISSEUR concerné par le périmètre, avec mention
    « action irréversible » et « conservation 10 ans ».

### Vérifications SQL

```sql
SELECT evenement, destinataire_email, statut
  FROM email_log
 WHERE evenement IN ('BUDGET_SOUMIS','BUDGET_REJETE','BUDGET_VALIDE','BUDGET_PUBLIE')
   AND date_creation > NOW() - INTERVAL '10 minutes'
 ORDER BY id ASC;
-- attendu : 5 lignes minimum dans cet ordre :
--   BUDGET_SOUMIS  → vers les VALIDATEUR concernés
--   BUDGET_REJETE  → vers Amadou (soumetteur)
--   BUDGET_SOUMIS  → vers les VALIDATEUR (re-soumission)
--   BUDGET_VALIDE  → vers Amadou + Fatima (PUBLICATEUR)
--   BUDGET_PUBLIE  → vers les parties prenantes du périmètre
```

```sql
SELECT type_action, COUNT(*) FROM audit_log
 WHERE entite_cible='dim_version' AND id_cible='<id version R6>'
   AND date_creation > NOW() - INTERVAL '10 minutes'
 GROUP BY type_action ORDER BY MIN(id) ASC;
-- attendu : SOUMETTRE_BUDGET=2, REJETER_BUDGET=1, VALIDER_BUDGET=1,
--          PUBLIER_BUDGET=1
```

### Cas négatifs

- Soumettre une version vide (0 ligne `fait_budget`) :
  rejet 422 `UnprocessableEntityException`. Aucun email n'est
  émis.
- Soumettre une version déjà `soumis` : rejet 409
  `ConflictException`.
- Tenter de valider en tant qu'Amadou (SAISISSEUR sans
  `BUDGET.VALIDER`) : rejet 403 `PermissionsGuard`.

---

## R7 — Mode dry-run + préférences utilisateur

**Objectif** : valider deux mécanismes de coupure des emails — le
mode global `EMAIL_DRY_RUN=true` et l'opt-out individuel via
`/me/preferences`. Dans les deux cas, **la trace dans `email_log`
reste systématique** (audit BCEAO).

### Partie A — Mode dry-run global

#### Pré-requis

- `.env` : `EMAIL_DRY_RUN=true` et redémarrage du backend.
- Mailhog allumé pour vérifier qu'il NE reçoit RIEN.
- Tous les personas avec `notifications_email_actives=true` (défaut).

#### Étapes

1. **Vider Mailhog**.
2. **Refaire l'étape R6.2** (Amadou soumet une version).
3. **Mailhog : vide** — aucun email n'est arrivé.

#### Vérification SQL

```sql
SELECT evenement, destinataire_email, statut, payload->>'_motifSuppression' AS motif
  FROM email_log
 WHERE date_creation > NOW() - INTERVAL '2 minutes'
 ORDER BY id DESC LIMIT 5;
-- attendu : statut='SUPPRIME' pour tous, motif='EMAIL_DRY_RUN=true'
```

### Partie B — Préférences utilisateur (opt-out individuel)

#### Pré-requis

- `.env` : `EMAIL_DRY_RUN=false` et redémarrage du backend.
- Mailhog allumé.

#### Étapes

4. **Connexion Aïcha** (qui doit recevoir `BUDGET_SOUMIS`).
5. **Aller sur `/me/preferences`** (via dropdown utilisateur
   « Mes préférences »).
6. **Décocher le toggle global** « Recevoir les notifications par
   email » → cliquer « Enregistrer mes préférences » → toast
   succès.
7. **Vérification SQL préférences enregistrées** :

```sql
SELECT email, notifications_email_actives, notifications_email_types
  FROM "user" WHERE email='dir.retail@miznas.local';
-- attendu : actives=false, types=NULL
```

8. **Reconnexion Amadou**, soumettre une nouvelle version sur le
   même périmètre.
9. **Mailhog** : aucun email pour Aïcha (les autres VALIDATEUR
   reçoivent bien leur copie).

#### Vérification SQL

```sql
SELECT destinataire_email, statut, payload->>'_motifSuppression'
  FROM email_log
 WHERE evenement='BUDGET_SOUMIS' AND date_creation > NOW() - INTERVAL '2 minutes'
 ORDER BY id DESC;
-- attendu : 1 ligne pour Aïcha en SUPPRIME / motif='PREF_TOGGLE_GLOBAL_OFF'
--           autres VALIDATEUR en ENVOYE
```

10. **Variante liste blanche** : sur `/me/preferences`, réactiver
    le toggle global et **décocher uniquement BUDGET_SOUMIS** dans
    la grille des 8 types → enregistrer.
11. **Re-soumettre** une version → Aïcha reçoit toujours pas de
    BUDGET_SOUMIS, mais elle recevrait les autres types
    (BUDGET_VALIDE/BUDGET_PUBLIE/délégations…).

```sql
SELECT notifications_email_actives, notifications_email_types
  FROM "user" WHERE email='dir.retail@miznas.local';
-- attendu : actives=true, types=ARRAY[7 types sans BUDGET_SOUMIS]
```

```sql
SELECT statut, payload->>'_motifSuppression' FROM email_log
 WHERE evenement='BUDGET_SOUMIS'
   AND destinataire_email='dir.retail@miznas.local'
 ORDER BY id DESC LIMIT 1;
-- attendu : SUPPRIME / 'PREF_TYPE_NON_SOUSCRIT'
```

12. **Restaurer les préférences par défaut** : recocher
    `BUDGET_SOUMIS` → la grille devient « tous cochés » → la page
    enregistre `types=NULL` (logique frontend).

### Cas négatifs

- Désactiver le toggle global puis tenter de cocher des types :
  la grille est masquée par l'UI (pas de risque d'incohérence).
- Désactiver pour un seul type SANS toucher au toggle global :
  l'API accepte une liste blanche partielle ; les types non
  listés produisent SUPPRIME `PREF_TYPE_NON_SOUSCRIT`.

---

## Synthèse — capacités validées par la recette

| Scénario | Capacité Lot 4 validée |
|----------|------------------------|
| R1 | Affectation STRUCTURE + soft-delete + audit (Lot 4.1) |
| R2 | Affectation CR_SET + date_fin + filtrage temporel (Lot 4.1) |
| R3 | Délégation cycle complet création/usage/révocation + via_delegation_id (Lot 4.2 + 4.2-fix) |
| R4 | Expiration auto cron + email EXPIRER_DELEGATION (Lot 4.2 + 4.3) |
| R5 | **Anti-chaînage strict D2 BCEAO** — UI + API double sécurité (Lot 4.2) |
| R6 | Workflow 5 transitions × emails appropriés (Lot 3.5 + 4.3) |
| R7 | Dry-run global + opt-out user + traçabilité SUPPRIME (Lot 4.3) |

À la livraison, marquer ce document daté avec le résultat de
chaque scénario (✓ / ✗ / commentaire).

---

## Suivi d'exécution

Tableau à compléter au fil des campagnes de recette. Une ligne
par exécution réelle (un scénario peut être ré-exécuté plusieurs
fois — duppliquer la ligne).

**Légende** :
- ⬜ à faire
- ✅ passé (toutes les vérifications SQL OK + UI conforme)
- ❌ échec (au moins une vérification a échoué — décrire en notes)
- ⚠️ partiel (le scénario passe mais avec un comportement inattendu
  qui n'invalide pas la capacité — décrire en notes)

| Scénario | Date d'exécution | Exécutant | Statut | Notes |
|----------|------------------|-----------|--------|-------|
| **R1** Multi-périmètres simple STRUCTURE        |  |  | ⬜ |  |
| **R2** Multi-périmètres CR_SET avec date_fin    |  |  | ⬜ |  |
| **R3** Délégation nominal complet               |  |  | ⬜ |  |
| **R4** Expiration auto (cron)                   |  |  | ⬜ |  |
| **R5** ANTI-CHAÎNAGE STRICT (BCEAO)             |  |  | ⬜ |  |
| **R6** Workflow complet × 5 emails              |  |  | ⬜ |  |
| **R7.A** Mode dry-run global                    |  |  | ⬜ |  |
| **R7.B** Préférences user (toggle + liste blanche) |  |  | ⬜ |  |

> Si un scénario échoue, créer une issue référençant ce document
> (`docs/lot-4/recette.md`) avec le numéro Rn, la date, et le bloc
> de la vérification SQL incriminée. La correction doit faire
> repasser **R5 en priorité** (anti-chaînage strict — exigence
> BCEAO non négociable).
