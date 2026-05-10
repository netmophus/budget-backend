# Changelog — MIZNAS Budget Backend

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/).
Le module respecte SemVer informel par lot (Lot N = jalons figés
en interne pour BSIC ; pas de release publique).

---

## [Non publié]

### Lot 6.5 — Notifications résiduelles (mai 2026)

#### Ajouté

**Palier 6.5.A — Forgot password self-service**
- Migration `1779200000200-CreerPasswordResetTokens` : table
  `password_reset_token` (id bigint, fk_user, token varchar(64) =
  hash SHA-256, date_expiration, utilise, 4 colonnes audit) +
  index unique sur token + index sur fk_user et date_expiration.
- Entity `PasswordResetToken` + ajout au `TypeOrmModule.forFeature`
  d'AuthModule.
- Endpoint `POST /auth/forgot-password` (public, anti-énumération) :
  réponse identique pour email connu/inconnu, INSERT token + email
  publié dans la queue uniquement si email connu actif.
- Endpoint `POST /auth/reset-password` (public, validation token +
  policy mdp) : pas de tokens JWT auto-émis, le user doit se
  reconnecter normalement après. Codes erreurs distincts
  `INVALID_TOKEN` (400, token absent ou déjà utilisé) vs
  `EXPIRED_TOKEN` (410, token expiré).
- `LoginRateLimiterService` étendu : méthode
  `enregistrerEtVerifierForgot(ip)` avec compteur dédié
  (3 tentatives / 15 min / IP). Désactivable via la même env var
  `LOGIN_RATE_LIMIT_DISABLED`.
- `ForgotPasswordRateLimitGuard` (nouveau) appliqué uniquement sur
  `POST /auth/forgot-password`. Audit `LOGIN_RATE_LIMITED` avec
  `entiteCible='forgot-password'`.
- Template `reset-password-self-service.hbs` (lien `{{lien_reset}}`,
  expiration `{{expiration_minutes}}`).
- `PasswordResetCleanupCronService` : cron `0 3 * * *` quotidien +
  rattrapage `OnApplicationBootstrap`. Supprime les tokens dont
  `date_expiration < now() - 30 jours` ; audit
  `NETTOYAGE_RESET_TOKENS` avec count.

**Palier 6.5.B — Rappel J-3 délégation**
- Migration `1779200000210-AjouterNotificationJ3Delegations` :
  ajoute la colonne `derniere_notification_j3` (timestamp NULL) sur
  `delegations` (idempotente via information_schema).
- Entity `Delegation` étendue avec `derniereNotificationJ3`.
- `DelegationsRappelService.notifierJ3()` : SELECT delegations
  matchées (date_fin = today + 3 jours AND actif AND
  derniere_notification_j3 IS NULL), publie 2 emails par délégation
  (délégant + délégataire) en respectant les opt-out user (toggle
  global + filtre liste blanche → email_log SUPPRIME), UPDATE
  derniere_notification_j3, audit `DELEGATION_RAPPEL_J3` (1 entrée
  par délégation).
- `DelegationsRappelCronService` : cron `0 6 * * *` quotidien +
  rattrapage `OnApplicationBootstrap`.
- 2 templates `delegation-rappel-delegant.hbs` et
  `delegation-rappel-delegataire.hbs` avec liens `/admin/delegations`
  et `/mes-delegations`.

**Migration 1779200000220-AjouterCodesAuditLot65** : 5 nouveaux codes
audit FR métier (DEMANDE_RESET_MDP_USER, DEMANDE_RESET_MDP_INCONNU,
RESET_MDP_USER_VALIDE, NETTOYAGE_RESET_TOKENS, DELEGATION_RAPPEL_J3) +
alignement TypeAction TypeScript.

#### Décisions / Sécurité

- **Token reset stocké en hash SHA-256** (jamais en clair en base).
  Le clair n'existe que dans le mail envoyé via la queue BullMQ
  (transit éphémère via Redis, pattern `EmailJobData.secrets` du
  Lot 6.4.C).
- **Réponse forgot-password identique pour email connu/inconnu**
  (anti-énumération de comptes). Audit séparé
  `DEMANDE_RESET_MDP_USER` vs `DEMANDE_RESET_MDP_INCONNU` côté
  serveur pour la détection de scan.
- **Rate limit forgot par IP uniquement** (pas par email) — limiter
  par email permettrait à un attaquant de découvrir les emails
  valides en observant le statut 429.
- **Pas d'auto-login après reset** — le user doit se reconnecter
  normalement (mécanique standard, attendue par la majorité des
  apps web).
- **Cron J-3 respecte les opt-out user** (notif transverse non
  critique). Forgot password ignore les opt-out (transactionnel
  critique — un user qui a opt-out doit pouvoir reset son mdp).
- **Idempotence J-3** garantie par `derniere_notification_j3 IS
  NULL` + UPDATE après publication. Le bootstrap rattrapage ne
  re-notifie pas si la nuit précédente est passée.

#### Tests

- Unit : 21 nouveaux (11 PasswordResetService + 4 LoginRateLimiter
  forgot + 6 DelegationsRappelService).
- e2e : 12 nouveaux (8 forgot-password + 4 delegations-rappel-j3).
- Total backend : **1151 unit verts (+20 nets)** + e2e à confirmer
  en CI.

#### Documentation

- `docs/lot-6/6.5-notifications-residuelles.md` — flux complet,
  invariants sécurité, dette, codes audit.

---

### Lot 6.4 — Sécurisation des mots de passe (mai 2026)

#### Ajouté

**Palier 6.4.A — Politique mdp + expiration + force change**
- `src/auth/password-policy.ts` : politique partagée (≥ 12 + 1 maj
  + 1 min + 1 chiffre + 1 spécial), décorateur `@MotDePasseValide()`
  pour DTO, helper `genererMotDePasseTemporaire(longueur=32)`
  policy-conforme (Fisher-Yates + `crypto.randomBytes`).
- Migration `1779200000180-CreerExpirationMotsDePasse` : colonnes
  `date_expiration_mdp` + `doit_changer_mdp` (idempotent via
  information_schema).
- Migration `1779200000190-AjouterCodesAuditPasswordSecurity` :
  codes audit `PASSWORD_CHANGED` + `LOGIN_RATE_LIMITED` ajoutés
  à la contrainte CHECK de `audit_log.type_action`.
- Endpoint `PATCH /me/password` (DTO `ChangerMdpDto`, audit
  `PASSWORD_CHANGED`, ré-émet de nouveaux tokens sans flags) +
  decorator `@AllowExpiredPassword()` pour bypass guard.
- `PasswordExpiredGuard` (`APP_GUARD` global) : 403 sur toute route
  authentifiée si JWT a `mdpExpire` ou `dcm` posé, avec code
  applicatif `MDP_EXPIRE` ou `MDP_TEMPORAIRE`. Whitelist via
  `@Public()` ou `@AllowExpiredPassword()`.
- Login response étendue : `mdpExpire`, `doitChangerMdp` ; JWT
  payload encode aussi ces flags (`mdpExpire`, `dcm`).
- Variable env `MDP_DUREE_VALIDITE_JOURS` (défaut 90j).

**Palier 6.4.B — Rate limiting login**
- `LoginRateLimiterService` : 2 fenêtres in-memory (5/60s par IP +
  5/15min par email), désactivable via `LOGIN_RATE_LIMIT_DISABLED=true`.
- `LoginRateLimitGuard` sur `POST /auth/login` : audit
  `LOGIN_RATE_LIMITED` + header `Retry-After` + 429 avec code
  applicatif `LOGIN_RATE_LIMITED`.

**Palier 6.4.C — Reset password admin async + force change UI**
- `EmailQueueModule` (extraction du Producer + `BullModule.registerQueue`)
  pour isoler le `EmailWorker` et permettre aux modules consommateurs
  d'importer la queue sans tirer le `BullExplorer` transitivement
  (fix DI pour les e2e backend pg-mem).
- `EmailJobData.secrets?: Record<string, string>` : transit éphémère
  via Redis pour les valeurs sensibles (mdp temporaire reset),
  fusionnés en Handlebars au dernier moment, **jamais persistés** en
  `email_log.payload`.
- Template `reset-password-admin.hbs` (mdp en clair, expiration,
  avertissement compromission) + sujet/template enregistrés dans
  `notifications.service.ts`.
- Endpoint `POST /admin/users/:id/forcer-changement-mdp`
  (USER.GERER) : pose `doit_changer_mdp = true` sans toucher au
  hash. Audit `RESET_PASSWORD_USER` avec
  `payloadApres.operation = 'forcer-changement-mdp'`. N'envoie pas
  d'email. Cas d'usage support (suspicion de compromission).
- Documentation `.env.example` : `LOGIN_RATE_LIMIT_DISABLED=false`
  avec rappel "NE JAMAIS activer en pré-prod ou en production".
- Documentation `docs/lot-6/6.4-securite-mots-de-passe.md` — flux
  complet, invariants sécurité, dette, env vars.

#### Modifié

- `UsersAdminService.resetPassword` refactoré async via queue :
  génère un mdp temporaire 32 chars (policy-conforme), pose
  `doit_changer_mdp=true` + `date_expiration_mdp = now() + 7j`,
  INSERT email_log `EN_ATTENTE` SANS le mdp dans le payload, puis
  publie le job avec `secrets={ mdpTemporaire }` HORS transaction.
  **Breaking change** : `ResetPasswordResponseDto = { success, message }`
  (suppression de `motDePasseTemporaire` dans la réponse).
- `AllExceptionsFilter` : préserve le `code` applicatif du payload
  des `HttpException` (`MDP_TEMPORAIRE`, `MDP_EXPIRE`,
  `LOGIN_RATE_LIMITED`). Backwards-compatible pour les exceptions
  sans `code`.

#### Décisions / Sécurité

- **Mot de passe en clair jamais retourné par l'API** (post-reset
  admin), **jamais persisté en `email_log.payload` ni
  `audit_log.payload`**, transit unique via Redis (job data BullMQ).
- **Codes audit EN/UPPERCASE** : conservation de la convention
  existante du module auth (cohérence avec `LOGIN`, `LOGIN_FAILED`)
  malgré la convention FR du reste de l'application.
- **Rate limit storage in-memory** : OK V1 mono-instance, dette
  tracée pour migration Redis en V2 (Lot 7+).
- **`@nestjs/throttler` non utilisé** : implémentation custom pour
  contrôle fin (2 fenêtres sur clés différentes IP/email) + audit
  intégré au pipeline.

#### Tests

- 22 unit (palier A) + 8 unit (palier B) + spec users-admin et
  worker adaptés palier C.
- 3 specs e2e SuperTest : `password.e2e-spec.ts`,
  `rate-limit.e2e-spec.ts`, `reset-password-admin.e2e-spec.ts`.

---

### Lot 6.3 — Queue BullMQ + Redis pour emails async (mai 2026)

#### Ajouté
- Dépendances : `bullmq`, `@nestjs/bullmq`, `ioredis`.
- `docker-compose.dev.yml` : Redis 7-alpine pour le dev local sur
  `:6379` avec volume persistant.
- `BullModule.forRootAsync` dans `AppModule` (vars
  `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`).
- `BullModule.registerQueue('emails')` dans `NotificationsModule`.
- `EmailQueueProducer.publier(emailLogId)` — publie un job avec
  attempts=3, backoff exponentiel 2s/4s/8s, removeOnComplete=100,
  removeOnFail=1000.
- `EmailQueueProducer.pingRedis()` — utilisé par le healthcheck.
- `EmailQueueProducer.getQueueStats()` — utilisé par l'endpoint
  admin de monitoring queue.
- `EmailWorker` (`@Processor('emails')`) — consume la queue,
  délègue à `NotificationsService.traiterJob()`, bascule en ECHEC
  via `marquerEchecDefinitif` quand la dernière tentative BullMQ
  échoue.
- Statut `EN_COURS` ajouté à `email_log.statut` (migration
  `1779200000170-AjoutStatutEnCoursEmailLog`).
- `GET /api/v1/admin/email-log/queue/stats` (`USER.GERER`) —
  compteurs BullMQ (waiting/active/completed/failed/delayed).
- Refactor `GET /api/v1/health` : retourne `status: 'degraded'`
  + payload `redis.status: 'down'` si Redis injoignable. L'app
  reste répondante (HTTP 200) — décision produit "MIZNAS reste
  utilisable même sans emails".
- Setup global e2e (`test/e2e/setup-global.ts`) démarre Postgres
  + Redis via testcontainers en parallèle.
- `test/e2e/emails.e2e-spec.ts` — flux SENT (SMTP réussi) +
  FAILED (retries → ECHEC).
- `src/notifications/email.worker.spec.ts` — 6 tests unitaires
  Worker.
- Documentation `docs/lot-6/6.3-bullmq-redis.md` (architecture,
  config, debug).

#### Modifié
- `NotificationsService.envoyer()` ne fait plus SMTP synchronement.
  Il crée la trace `email_log` en `EN_ATTENTE` puis publie dans la
  queue. Retour immédiat. Les retries 1s/3s/10s synchrones internes
  sont supprimés (remplacés par les retries BullMQ).
- `NotificationsService.rejouer(emailLogId)` re-publie un job au
  lieu de re-tenter SMTP synchronement.
- `notifications.service.spec.ts` adapté : 3 tests SMTP synchrones
  remplacés par des tests de publication queue (mock
  `EmailQueueProducer`).

#### Supprimé
- Boucle de retries SMTP synchrones internes dans
  `NotificationsService.envoyer()`. Les WARN
  `[NotificationsService] Tentative x/3 échouée ... ECONNREFUSED /
  SMTP DOWN` qui polluaient les logs Vitest ont disparu.

#### Décisions
- **Statuts en français** (`EN_ATTENTE/EN_COURS/ENVOYE/ECHEC/
  SUPPRIME`) au lieu d'EN, conformément à la convention i18n FR
  du projet.
- **Worker in-process** (NestJS `@Processor` standard) — dette
  tracée, à isoler en process dédié au Lot 7+ pour scale
  indépendant.
- **Pas de code audit `EMAIL_ECHEC_DEFINITIF`.** La trace est dans
  `email_log`.
- **Healthcheck Redis = degraded, pas down hard.** L'app reste
  utilisable même sans emails.

#### Tests
- Backend unit/integration : **1100 verts** (1094 + 6 worker).
- Backend e2e : **31 verts** (29 du Lot 6.2.A + 2 emails).
- Aucune régression sur les tests existants.

---

## [v0.5.0-mvp] — 2026-05 — MVP fonctionnel + démarrage industrialisation

Tag de release marquant la transition entre la livraison du MVP
fonctionnel (Lots 1 → 5) et le démarrage du Lot 6
(industrialisation, dettes techniques, finitions).

État du MVP :
- 3 modules métier opérationnels (Élaboration, Multi-périmètres
  + délégations + notifications, Administration, Exécution).
- 55 migrations en base, 8 personas seedés.
- 1082 tests backend + 536 frontend = 1618 tests verts (1094
  backend après les sanity tests Lot 5.4 + ces 12 tests).
- 0 régression cumulée depuis Lot 1.

### Industrialisation (Lot 6.1)

- **CI GitHub Actions** sur les 2 repos
  (`.github/workflows/ci.yml`) : jobs `setup` + `lint` +
  `typecheck` + `build` + `test` (+ `audit-codes-coherence`
  côté backend uniquement). Bloque les PR sur `main` qui
  régressent.
- Script `scripts/check-audit-codes-coherence.js` qui
  vérifie l'alignement migrations ↔ type union TypeAction
  (parade au bug Lot Administration où un code audit était
  inséré en base sans être déclaré dans le type TS).
- Documentation [`docs/ci-cd.md`](docs/ci-cd.md) avec
  description des jobs, recommandations branch protection
  rules, dette typecheck héritée à apurer Lot 6.6.

### Dette typecheck rendue visible

La CI strict révèle **20 erreurs TS sur 7 fichiers backend**
(majoritairement dans `test/integration/fk-ref-secondaire`
hors-périmètre Jest et 6 mocks de tests obsolètes) et **~67
erreurs sur ~49 fichiers frontend** (principalement le
namespace `JSX` masqué post-React 19 + 2 mocks obsolètes).
Traitement consolidé prévu Lot 6.6.

GitHub : [comparer v0.5.0-mvp vs Lot 4](https://github.com/netmophus/budget-backend/compare/main...v0.5.0-mvp)

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
