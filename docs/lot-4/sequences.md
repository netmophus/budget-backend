# Lot 4 — Diagrammes de séquence

> Vue dynamique des 4 flux principaux du Lot 4. Complément à
> [`README.md`](./README.md) (vue statique) et à [`recette.md`](./recette.md)
> (validation E2E).

## S1 — Création d'une affectation multi-périmètres (Lot 4.1)

Admin attribue un périmètre `STRUCTURE` / `CR` / `CR_SET` à un
utilisateur. Tout est transactionnel : si l'audit échoue,
l'affectation est rollback. L'événement `affectation.created`
est émis post-commit pour notifier l'utilisateur.

```mermaid
sequenceDiagram
    autonumber
    actor Admin
    participant UI as AffectationsDialog
    participant API as POST /admin/users/:id/perimetres
    participant Svc as UserPerimetreService.creer
    participant DB as Postgres
    participant Audit as AuditService
    participant Bus as EventEmitter2
    participant Notif as NotificationsListeners

    Admin->>UI: Choisit cible_type + cible + dateDebut + motif
    UI->>API: POST { cibleType, cibleId, dateDebut, motif }
    API->>Svc: creer(userId, dto, auteurEmail)

    Svc->>Svc: validerCible() (cohérence cible_type ↔ champs)
    Svc->>DB: SELECT existence cible (dim_structure / dim_cr)
    Svc-->>API: 400 BadRequest si cible inexistante

    Note over Svc,DB: BEGIN TRANSACTION
    Svc->>DB: INSERT user_perimetres<br/>(origine='AFFECTATION', actif=true)
    Svc->>Audit: log CREER_AFFECTATION (via tx)
    Audit->>DB: INSERT audit_log
    Note over Svc,DB: COMMIT (ou ROLLBACK<br/>en cas d'échec audit)

    Svc->>Bus: emit('affectation.created', { affectationId, fkUser, cibleType, ... })

    Svc-->>API: AffectationPerimetre saved
    API-->>UI: 201 Created
    UI->>Admin: Toast « Affectation créée. »

    Bus->>Notif: onAffectationCreated(payload)
    Notif->>Notif: resoudreDestinataires() = [user affecté]
    Notif->>DB: INSERT email_log (statut SUPPRIME si dry-run<br/>ou ENVOYE après nodemailer)
```

**Points clés** :
- Validation avant écriture : `validerCible` refuse les
  combinaisons inconsistantes (`CR_SET` sans `cible_cr_ids` ≥ 2,
  `STRUCTURE` avec `cible_cr_ids`, etc.).
- Index unique partial `uq_user_perimetres_actif` (Lot 4.1-fix2.C)
  protège contre les doublons (`cible_type`, `cible_id`,
  `origine`) → 409 Conflict côté API.
- Index unique partial `uq_user_perimetres_cr_set_actif` empêche
  2 `CR_SET` strictement identiques actifs pour le même user.
- L'événement `affectation.created` produit l'email E9
  (`AFFECTATION_CREEE`) vers le user affecté.

---

## S2 — Création d'une délégation (Lot 4.2)

Délégant accorde une délégation à un délégataire. Les **miroirs
`user_perimetres`** sont créés en transaction atomique avec
l'audit `CREER_DELEGATION`. **Anti-chaînage strict (D2 BCEAO)**
vérifié avant écriture.

```mermaid
sequenceDiagram
    autonumber
    actor Delegant
    participant UI as CreerDelegationDialog
    participant API as POST /delegations
    participant Svc as DelegationsService.creer
    participant Perm as PermissionsService
    participant DB as Postgres
    participant Audit as AuditService
    participant Bus as EventEmitter2
    participant Notif as NotificationsListeners

    Delegant->>UI: Choisit délégataire + périmètres natifs<br/>+ permissions + dates + motif
    UI->>UI: Filtre les périmètres origine='DELEGATION'<br/>(anti-chaînage UI)
    UI->>API: POST CreerDelegationDto

    API->>Svc: creer(dto, currentUser)
    Svc->>Svc: Règle 1 : delegant ≠ delegataire
    Svc->>DB: SELECT délégataire actif
    Svc->>Svc: Règle 2 : date_fin ≥ date_debut
    Svc->>Perm: getEffectivePermissions(delegant)
    Svc->>Svc: Règle 5 : possède code RBAC sous-jacent

    Svc->>DB: SELECT user_perimetres source
    loop pour chaque périmètre source
        Svc->>Svc: Règle 4 : appartient au délégant + actif
        Svc->>Svc: 🔴 Règle 3 ANTI-CHAÎNAGE : <br/>rejet si origine='DELEGATION'
    end
    Svc-->>API: 400 BadRequest si rejet

    Svc->>DB: SELECT chevauchements actifs
    Svc->>Svc: warnings[] (informatif, pas blocage)

    Note over Svc,DB: BEGIN TRANSACTION
    Svc->>DB: INSERT delegations<br/>(actif=true, dates, permissions)
    loop pour chaque périmètre source
        Svc->>DB: INSERT user_perimetres MIROIR<br/>(fk_user=délégataire,<br/>origine='DELEGATION', delegation_id)
    end
    Svc->>Audit: log CREER_DELEGATION (via tx)
    Audit->>DB: INSERT audit_log
    Note over Svc,DB: COMMIT

    Svc->>Bus: emit('delegation.created', { delegationId, fkDelegant, fkDelegataire, ... })

    Svc-->>API: { delegation, warnings }
    API-->>UI: 201 + warnings
    UI->>Delegant: Toast succès (+ warnings si chevauchement)

    Bus->>Notif: onDelegationCreated(payload)
    Notif->>DB: INSERT email_log E5 DELEGATION_CREEE<br/>vers délégataire
```

**Points clés** :
- L'anti-chaînage est appliqué **2 fois** : côté UI (filtrage des
  périmètres `origine='DELEGATION'`) ET côté API (rejet dur avec
  message BCEAO explicite si tentative bypass).
- Les miroirs `user_perimetres` sont créés *dans la même
  transaction* que la `delegations` row + l'audit. Tout-ou-rien.
- Chevauchements (couple delegant/delegataire/permission/dates
  qui se recouvrent) → warnings remontés, pas blocage.
- L'événement post-commit déclenche l'email E5
  (`DELEGATION_CREEE`) vers le délégataire avec rappel
  anti-chaînage dans le template.

---

## S3 — Soumission d'une version → notification aux validateurs (Lot 3.5 + 4.3)

Workflow `ouvert → soumis`. Au commit, un événement est émis et
tous les VALIDATEUR concernés par le périmètre reçoivent un email
E1 (`BUDGET_SOUMIS`).

```mermaid
sequenceDiagram
    autonumber
    actor Saisisseur
    participant API as POST /versions/:id/soumettre
    participant Wf as VersionWorkflowService.soumettre
    participant Perm as PermissionsService
    participant DB as Postgres
    participant Audit as AuditService
    participant Bus as EventEmitter2
    participant Notif as NotificationsListeners
    participant NS as NotificationsService

    Saisisseur->>API: POST { commentaire }
    API->>Wf: soumettre(versionId, dto, user)
    Wf->>Perm: getDelegationContextPour(user.id, 'BUDGET.SOUMETTRE')
    Perm-->>Wf: viaDelegationId | null

    Note over Wf,DB: BEGIN TRANSACTION
    Wf->>DB: SELECT dim_version
    Wf-->>API: 404 si introuvable / 409 si statut ≠ ouvert
    Wf->>DB: SELECT COUNT fait_budget WHERE fk_version
    Wf-->>API: 422 si version vide

    Wf->>DB: UPDATE dim_version<br/>(statut='soumis', date_soumission=NOW)
    Wf->>Audit: log SOUMETTRE_BUDGET<br/>(payloadApres avec via_delegation_id si délégation)
    Audit->>DB: INSERT audit_log
    Note over Wf,DB: COMMIT

    Wf->>Bus: emit('budget.submitted', { versionId, codeVersion, auteurId, ... })

    Wf-->>API: VersionResponse statut='soumis'
    API-->>Saisisseur: 200 OK

    Bus->>Notif: onBudgetSubmitted(payload)
    Notif->>NS: resoudreDestinataires('BUDGET_SOUMIS', ...)
    NS->>Perm: hasPermission(userId, 'BUDGET.VALIDER')<br/>boucle sur tous users actifs
    NS->>NS: exclut l'auteur
    NS-->>Notif: User[] = VALIDATEUR concernés

    loop pour chaque destinataire
        Notif->>NS: envoyer('BUDGET_SOUMIS', user, payload)
        NS->>NS: filtrage préférences user<br/>(toggle global + liste blanche)
        alt préférence OFF ou dry-run
            NS->>DB: INSERT email_log statut='SUPPRIME'<br/>+ payload._motifSuppression
        else mode normal
            NS->>NS: rendre template HTML (Handlebars)
            NS->>NS: nodemailer.sendMail (3 tentatives × 1s/3s/10s)
            alt succès SMTP
                NS->>DB: INSERT email_log statut='ENVOYE'
            else 3 échecs
                NS->>DB: INSERT email_log statut='ECHEC'<br/>+ dernier_message_erreur
            end
        end
    end
```

**Points clés** :
- Le `getDelegationContextPour` est appelé AVANT la transaction
  pour ne pas allonger le verrou — le résultat est juste injecté
  dans le payload audit.
- L'événement est émis APRÈS le COMMIT — si la transaction
  échoue, aucun email n'est émis.
- Un échec d'envoi (catch dans le listener) ne remonte JAMAIS
  vers l'action métier déjà committée.
- Le filtrage préférences produit toujours une trace `email_log`
  (statut `SUPPRIME` + motif) — exigence audit BCEAO.

---

## S4 — Cron expiration délégation (Lot 4.2 + 4.3)

Tous les jours à 02:00 UTC, le scheduler désactive les délégations
dont `date_fin < CURRENT_DATE` et émet l'email E7
(`DELEGATION_EXPIREE`) au délégant et au délégataire.

```mermaid
sequenceDiagram
    autonumber
    participant Cron as @Cron('0 2 * * *')
    participant Cs as DelegationsCronService
    participant Svc as DelegationsService.expirerAutomatiquement
    participant DB as Postgres
    participant Audit as AuditService
    participant Bus as EventEmitter2
    participant Notif as NotificationsListeners
    participant NS as NotificationsService

    Cron->>Cs: tick quotidien 02:00 UTC
    Cs->>Svc: expirerAutomatiquement()

    Svc->>DB: SELECT delegations<br/>WHERE actif=true AND date_fin < today
    Note over Svc: + idem au démarrage<br/>(OnApplicationBootstrap rattrapage)

    loop pour chaque délégation à expirer
        Note over Svc,DB: BEGIN TRANSACTION
        Svc->>DB: UPDATE delegations<br/>(actif=false, utilisateur_modification='system (cron expiration)')
        Svc->>DB: UPDATE user_perimetres miroirs<br/>(actif=false)
        Svc->>Audit: log EXPIRER_DELEGATION (utilisateur='system')
        Audit->>DB: INSERT audit_log
        Note over Svc,DB: COMMIT

        Svc->>Bus: emit('delegation.expired', { delegationId, fkDelegant, fkDelegataire, ... })

        Bus->>Notif: onDelegationExpired(payload)
        Notif->>NS: resoudreDestinataires('DELEGATION_EXPIREE', { destinataireUserIds: [delegant, delegataire] })
        NS->>NS: 2 envois (cf. S3 boucle envoyer)
        NS->>DB: 2 lignes email_log E7
    end

    Svc->>Svc: Logger.log("Cron expiration : N délégations désactivées.")
    Svc-->>Cs: { nbExpirees }
```

**Points clés** :
- Une transaction par délégation (granularité du rollback) plutôt
  qu'une transaction globale — un échec sur une délégation
  n'arrête pas le traitement des autres.
- `OnApplicationBootstrap` permet un rattrapage si l'app était
  down au moment du cron normal.
- Le filtre est strict `<` (pas `<=`) : une délégation
  `date_fin = today` reste active pour la journée en cours.
- Aucun email n'est envoyé pour une délégation déjà
  `actif=false` (révoquée explicitement avant son terme — l'email
  `REVOQUER_DELEGATION` a déjà été émis à ce moment-là).
