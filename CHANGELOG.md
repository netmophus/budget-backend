# Changelog — MIZNAS Budget Backend

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/).
Le module respecte SemVer informel par lot (Lot N = jalons figés
en interne pour BSIC ; pas de release publique).

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
