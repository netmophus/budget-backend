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
