/**
 * Définition typée des événements émis par les services métier
 * (Lot 4.3). Chaque service métier dépendance-faible vers
 * NotificationsModule via @nestjs/event-emitter — il émet et
 * oublie. NotificationsModule écoute via @OnEvent.
 *
 * Conventions :
 *  - clé snake.dotted (ex: 'budget.submitted')
 *  - payload sérialisable JSON (pas d'instance d'entité — strings/ids)
 *  - tous les ids passés en string (bigint Postgres)
 */

export const EVENT_BUDGET_SUBMITTED = 'budget.submitted';
export const EVENT_BUDGET_VALIDATED = 'budget.validated';
export const EVENT_BUDGET_REJECTED = 'budget.rejected';
export const EVENT_BUDGET_PUBLISHED = 'budget.published';
export const EVENT_DELEGATION_CREATED = 'delegation.created';
export const EVENT_DELEGATION_EXPIRED = 'delegation.expired';
export const EVENT_DELEGATION_REVOKED = 'delegation.revoked';
export const EVENT_AFFECTATION_CREATED = 'affectation.created';
// Lot 6.6 — E14 ouverture campagne budgétaire. Notification proactive
// envoyée aux saisisseurs et validateurs au démarrage officiel de la
// phase de saisie (référence Document Budget 2026 BSIC NIGER, Annexe
// A6 Email N°1). Déclenchée par POST /admin/campagnes/:versionId/ouvrir.
export const EVENT_CAMPAGNE_OUVERTE = 'campagne.ouverte';

// Lot workflow par CR — 6 événements du cycle de validation par CR.
// Émis par CrWorkflowService ; les listeners email sont câblés dans un
// sous-lot dédié (templates + résolution destinataires).
export const EVENT_CR_SUBMITTED = 'cr.submitted'; // → validateur
export const EVENT_CR_VALIDATED = 'cr.validated'; // → saisisseur
export const EVENT_CR_REJECTED = 'cr.rejected'; // → saisisseur (motif)
export const EVENT_CR_REOPENED = 'cr.reopened'; // → saisisseur (motif)
export const EVENT_VERSION_PRE_VALIDATED = 'version.prevalidated'; // → coordinateur
export const EVENT_VERSION_SUBMITTED_COMITE = 'version.submitted_comite'; // → comité
// Mini-PR transitions Comité — demande de révision sur un CR validé.
export const EVENT_CR_REVISION_DEMANDEE = 'cr.revision_demandee'; // → saisisseur + validateur du CR ciblé

/** Payload des événements de transition par CR. */
export interface CrWorkflowEventPayload {
  versionId: string;
  codeVersion: string;
  crCode: string;
  crId: string;
  auteurEmail: string;
  auteurId: string;
  motif?: string | null;
  commentaire?: string | null;
}

export interface BudgetEventPayload {
  versionId: string;
  codeVersion: string;
  /** email de l'auteur de l'action courante */
  auteurEmail: string;
  /** id user de l'auteur de l'action courante */
  auteurId: string;
  /** commentaire ou motif de l'action (rejet/publication) */
  commentaire?: string | null;
}

export interface DelegationEventPayload {
  delegationId: string;
  fkDelegant: string;
  fkDelegataire: string;
  permissions: string[];
  dateDebut: string;
  dateFin: string;
  motif: string;
  motifRevocation?: string;
}

export interface AffectationEventPayload {
  affectationId: string;
  fkUser: string;
  cibleType: string;
  cibleId: string | null;
  cibleCrIds: string[] | null;
  dateDebut: string;
  motif: string | null;
}

/**
 * Payload de l'événement EVENT_CAMPAGNE_OUVERTE (Lot 6.6 — E14).
 *
 * Émis par CampagnesController quand un admin (BUDGET.PUBLIER) déclenche
 * l'ouverture officielle de la phase de saisie pour une version
 * budgétaire. Les listeners notifient tous les saisisseurs + validateurs
 * (union dédupliquée, auteur exclu).
 *
 * Dates : passées en ISO pour neutralité ; le formatage humain
 * (dd/MM/yyyy) est fait dans le listener juste avant l'envoi email.
 */
export interface CampagneOuverteEventPayload {
  versionId: string;
  codeVersion: string;
  auteurId: string;
  auteurEmail: string;
  dateOuverture: string; // ISO
  dateFermeture: string; // ISO
  commentaire?: string | null;
}
