/**
 * Listeners (Lot 4.3) — pont entre les événements applicatifs émis
 * par les services métier et le NotificationsService.
 *
 * Couplage faible : les services métier ne connaissent pas ce
 * fichier ; ils émettent un événement typé via EventEmitter2 puis
 * oublient. Si NotificationsModule est absent, l'émission ne
 * casse rien.
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import {
  type AffectationEventPayload,
  type BudgetEventPayload,
  type CampagneOuverteEventPayload,
  type DelegationEventPayload,
  EVENT_AFFECTATION_CREATED,
  EVENT_BUDGET_PUBLISHED,
  EVENT_BUDGET_REJECTED,
  EVENT_BUDGET_SUBMITTED,
  EVENT_BUDGET_VALIDATED,
  EVENT_CAMPAGNE_OUVERTE,
  EVENT_DELEGATION_CREATED,
  EVENT_DELEGATION_EXPIRED,
  EVENT_DELEGATION_REVOKED,
} from './notifications.events';
import { NotificationsService } from './notifications.service';
import type { TypeEvenement } from './entities/email-log.entity';

/**
 * Formate une date ISO en "dd/MM/yyyy" pour affichage humain dans
 * les templates email (Lot 6.6 — campagne ouverte). Renvoie la chaîne
 * brute si parsing échoue (sécurité : on n'embête pas l'utilisateur
 * avec "Invalid Date" dans un email).
 */
function formatDateFr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

@Injectable()
export class NotificationsListeners {
  private readonly logger = new Logger(NotificationsListeners.name);

  constructor(private readonly notifs: NotificationsService) {}

  // ─── Budget ─────────────────────────────────────────────────────

  @OnEvent(EVENT_BUDGET_SUBMITTED, { async: true })
  async onBudgetSubmitted(payload: BudgetEventPayload): Promise<void> {
    await this.notifierBudget('BUDGET_SOUMIS', payload);
  }

  @OnEvent(EVENT_BUDGET_VALIDATED, { async: true })
  async onBudgetValidated(payload: BudgetEventPayload): Promise<void> {
    await this.notifierBudget('BUDGET_VALIDE', payload);
  }

  @OnEvent(EVENT_BUDGET_REJECTED, { async: true })
  async onBudgetRejected(payload: BudgetEventPayload): Promise<void> {
    await this.notifierBudget('BUDGET_REJETE', payload);
  }

  @OnEvent(EVENT_BUDGET_PUBLISHED, { async: true })
  async onBudgetPublished(payload: BudgetEventPayload): Promise<void> {
    await this.notifierBudget('BUDGET_PUBLIE', payload);
  }

  private async notifierBudget(
    evenement: TypeEvenement,
    payload: BudgetEventPayload,
  ): Promise<void> {
    try {
      const destinataires = await this.notifs.resoudreDestinataires(evenement, {
        budgetVersionId: payload.versionId,
        auteurId: payload.auteurId,
        auteurEmail: payload.auteurEmail,
      });
      for (const d of destinataires) {
        await this.notifs.envoyer(evenement, d, {
          versionId: payload.versionId,
          codeVersion: payload.codeVersion,
          auteurEmail: payload.auteurEmail,
          commentaire: payload.commentaire ?? null,
          lien_action: `/budget/versions`,
        });
      }
    } catch (err) {
      // Couplage faible : un échec notification ne doit jamais
      // remonter vers l'action métier déjà committée.
      this.logger.error(
        `Erreur lors de la notification ${evenement} : ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ─── Délégations ────────────────────────────────────────────────

  @OnEvent(EVENT_DELEGATION_CREATED, { async: true })
  async onDelegationCreated(payload: DelegationEventPayload): Promise<void> {
    await this.notifierDelegation('DELEGATION_CREEE', payload, [
      payload.fkDelegataire,
    ]);
  }

  @OnEvent(EVENT_DELEGATION_EXPIRED, { async: true })
  async onDelegationExpired(payload: DelegationEventPayload): Promise<void> {
    await this.notifierDelegation('DELEGATION_EXPIREE', payload, [
      payload.fkDelegant,
      payload.fkDelegataire,
    ]);
  }

  @OnEvent(EVENT_DELEGATION_REVOKED, { async: true })
  async onDelegationRevoked(payload: DelegationEventPayload): Promise<void> {
    await this.notifierDelegation('DELEGATION_REVOQUEE', payload, [
      payload.fkDelegataire,
    ]);
  }

  private async notifierDelegation(
    evenement: TypeEvenement,
    payload: DelegationEventPayload,
    destinataireUserIds: string[],
  ): Promise<void> {
    try {
      const destinataires = await this.notifs.resoudreDestinataires(evenement, {
        delegationId: payload.delegationId,
        destinataireUserIds,
      });
      for (const d of destinataires) {
        await this.notifs.envoyer(evenement, d, {
          delegationId: payload.delegationId,
          permissions: payload.permissions,
          dateDebut: payload.dateDebut,
          dateFin: payload.dateFin,
          motif: payload.motif,
          motifRevocation: payload.motifRevocation ?? null,
          lien_action: '/mes-delegations',
        });
      }
    } catch (err) {
      this.logger.error(
        `Erreur notification ${evenement} : ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ─── Campagne budgétaire (Lot 6.6 — E14) ────────────────────────

  @OnEvent(EVENT_CAMPAGNE_OUVERTE, { async: true })
  async onCampagneOuverte(payload: CampagneOuverteEventPayload): Promise<void> {
    try {
      const destinataires = await this.notifs.resoudreDestinataires(
        'CAMPAGNE_OUVERTE',
        {
          budgetVersionId: payload.versionId,
          auteurId: payload.auteurId,
          auteurEmail: payload.auteurEmail,
        },
      );
      // Formatage humain des dates côté listener — l'événement reste
      // neutre en ISO. Le template Handlebars affiche directement les
      // chaînes "dd/MM/yyyy".
      const dateOuvertureFmt = formatDateFr(payload.dateOuverture);
      const dateFermetureFmt = formatDateFr(payload.dateFermeture);
      for (const d of destinataires) {
        await this.notifs.envoyer('CAMPAGNE_OUVERTE', d, {
          versionId: payload.versionId,
          codeVersion: payload.codeVersion,
          auteurEmail: payload.auteurEmail,
          dateOuverture: dateOuvertureFmt,
          dateFermeture: dateFermetureFmt,
          commentaire: payload.commentaire ?? null,
          lien_action: '/saisie-budgetaire',
        });
      }
    } catch (err) {
      this.logger.error(
        `Erreur notification CAMPAGNE_OUVERTE : ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ─── Affectations ───────────────────────────────────────────────

  @OnEvent(EVENT_AFFECTATION_CREATED, { async: true })
  async onAffectationCreated(payload: AffectationEventPayload): Promise<void> {
    try {
      const destinataires = await this.notifs.resoudreDestinataires(
        'AFFECTATION_CREEE',
        {
          affectationId: payload.affectationId,
          destinataireUserIds: [payload.fkUser],
        },
      );
      for (const d of destinataires) {
        await this.notifs.envoyer('AFFECTATION_CREEE', d, {
          affectationId: payload.affectationId,
          cibleType: payload.cibleType,
          cibleId: payload.cibleId,
          cibleCrIds: payload.cibleCrIds,
          dateDebut: payload.dateDebut,
          motif: payload.motif,
          lien_action: '/profile',
        });
      }
    } catch (err) {
      this.logger.error(
        `Erreur notification AFFECTATION_CREEE : ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
