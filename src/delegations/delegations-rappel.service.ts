/**
 * DelegationsRappelService (Lot 6.5.B) — orchestration du rappel
 * J-3 d'expiration des délégations.
 *
 * Méthode publique `notifierJ3()` :
 *  1. Sélectionne les délégations dont `date_fin = today + 3 jours`
 *     ET `actif = true` ET `derniere_notification_j3 IS NULL`.
 *  2. Pour chaque délégation : publie 2 emails (1 délégant +
 *     1 délégataire), respectant les préférences notifications de
 *     chaque user (opt-out → INSERT email_log SUPPRIME avec motif).
 *  3. UPDATE delegation.derniere_notification_j3 = now() pour
 *     idempotencer les exécutions multiples le même jour.
 *  4. Audit `DELEGATION_RAPPEL_J3` (1 entrée par délégation).
 *
 * Le service délègue au pattern in-house (INSERT email_log + publish
 * queue) plutôt qu'à NotificationsService.envoyer pour rester
 * découplé du Worker BullMQ (cf. dette EmailQueueModule du Lot
 * 6.4.C — éviter de propager BullExplorer au DelegationsModule).
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import { EmailQueueProducer } from '../notifications/email-queue.producer';
import {
  EmailLog,
  type StatutEmail,
  type TypeEvenement,
} from '../notifications/entities/email-log.entity';
import { User } from '../users/entities/user.entity';
import { Delegation } from './entities/delegation.entity';

const SUJETS_J3: Record<
  'DELEGATION_RAPPEL_J3_DELEGANT' | 'DELEGATION_RAPPEL_J3_DELEGATAIRE',
  string
> = {
  DELEGATION_RAPPEL_J3_DELEGANT:
    '[MIZNAS] Votre délégation expire dans 3 jours',
  DELEGATION_RAPPEL_J3_DELEGATAIRE:
    '[MIZNAS] Délégation reçue : expiration dans 3 jours',
};

const TEMPLATES_J3: Record<
  'DELEGATION_RAPPEL_J3_DELEGANT' | 'DELEGATION_RAPPEL_J3_DELEGATAIRE',
  string
> = {
  DELEGATION_RAPPEL_J3_DELEGANT: 'delegation-rappel-delegant',
  DELEGATION_RAPPEL_J3_DELEGATAIRE: 'delegation-rappel-delegataire',
};

interface RappelJ3Result {
  notifiees: number;
  emailsPublies: number;
  emailsSupprimes: number;
}

@Injectable()
export class DelegationsRappelService {
  private readonly logger = new Logger(DelegationsRappelService.name);
  private readonly dryRun: boolean;

  constructor(
    @InjectRepository(Delegation)
    private readonly delegationRepo: Repository<Delegation>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(EmailLog)
    private readonly emailLogRepo: Repository<EmailLog>,
    private readonly auditService: AuditService,
    private readonly emailQueue: EmailQueueProducer,
    config: ConfigService,
  ) {
    this.dryRun = config.get<string>('EMAIL_DRY_RUN', 'true') !== 'false';
  }

  /**
   * Vérifie si un user a coupé un type d'event (toggle global ou
   * filtre liste blanche). Retourne le motif (string) si suppression,
   * null sinon. Aligné sur `NotificationsService.motifSuppression`.
   */
  private motifSuppression(
    evenement: TypeEvenement,
    user: User,
  ): string | null {
    if (!user.notificationsEmailActives) {
      return 'PREF_TOGGLE_GLOBAL_OFF';
    }
    if (
      user.notificationsEmailTypes !== null &&
      !user.notificationsEmailTypes.includes(evenement)
    ) {
      return 'PREF_TYPE_NON_SOUSCRIT';
    }
    return null;
  }

  /**
   * INSERT email_log + publie la queue (ou INSERT SUPPRIME si opt-out
   * / dry-run). Aligné sur le contrat de
   * NotificationsService.envoyer mais sans dépendance au module
   * (évite de propager le Worker BullMQ).
   */
  private async envoyerEmail(
    evenement:
      | 'DELEGATION_RAPPEL_J3_DELEGANT'
      | 'DELEGATION_RAPPEL_J3_DELEGATAIRE',
    destinataire: User,
    payload: Record<string, unknown>,
  ): Promise<{ supprime: boolean; emailLogId: string }> {
    const motif = this.motifSuppression(evenement, destinataire);
    const statut: StatutEmail =
      motif !== null || this.dryRun ? 'SUPPRIME' : 'EN_ATTENTE';
    const motifFinal = motif ?? (this.dryRun ? 'EMAIL_DRY_RUN=true' : null);

    const log = this.emailLogRepo.create({
      evenement,
      fkDestinataire: destinataire.id,
      destinataireEmail: destinataire.email,
      sujet: SUJETS_J3[evenement],
      template: TEMPLATES_J3[evenement],
      payload:
        motifFinal !== null
          ? { ...payload, _motifSuppression: motifFinal }
          : payload,
      statut,
      tentatives: 0,
    });
    const saved = await this.emailLogRepo.save(log);

    if (statut === 'EN_ATTENTE') {
      await this.emailQueue.publier(saved.id);
    }
    return { supprime: statut === 'SUPPRIME', emailLogId: saved.id };
  }

  /**
   * Cron principal — sélectionne les délégations dont la date de
   * fin tombe à J+3 et qui n'ont pas encore reçu de rappel J-3,
   * puis publie les emails et marque la délégation notifiée.
   *
   * Idempotence : la combinaison `derniere_notification_j3 IS NULL`
   * + UPDATE après publication garantit qu'une délégation n'est
   * notifiée qu'une seule fois (même si le cron tourne plusieurs
   * fois le même jour à cause d'un restart).
   */
  async notifierJ3(): Promise<RappelJ3Result> {
    // PostgreSQL `date_fin` est un type DATE → comparaison sur jour
    // entier, pas timestamp. CURRENT_DATE + 3 jours.
    const matches = (await this.delegationRepo.query(
      `SELECT id FROM delegations
        WHERE date_fin = CURRENT_DATE + INTERVAL '3 days'
          AND actif = true
          AND derniere_notification_j3 IS NULL`,
    )) as Array<{ id: string }>;

    if (matches.length === 0) {
      return { notifiees: 0, emailsPublies: 0, emailsSupprimes: 0 };
    }

    let emailsPublies = 0;
    let emailsSupprimes = 0;

    for (const { id } of matches) {
      const d = await this.delegationRepo.findOne({
        where: { id, actif: true, derniereNotificationJ3: IsNull() },
        relations: ['delegant', 'delegataire'],
      });
      // Garde-fou : si la délégation a été modifiée entre le SELECT
      // et le findOne (ex: désactivée manuellement), on skip
      // silencieusement — l'idempotence reste vraie.
      if (!d) continue;

      const payloadCommun: Record<string, unknown> = {
        nomDelegant: `${d.delegant.prenom} ${d.delegant.nom}`,
        nomDelegataire: `${d.delegataire.prenom} ${d.delegataire.nom}`,
        dateFin: d.dateFin,
        permissionsDeleguees: d.permissions,
      };

      const r1 = await this.envoyerEmail(
        'DELEGATION_RAPPEL_J3_DELEGANT',
        d.delegant,
        payloadCommun,
      );
      const r2 = await this.envoyerEmail(
        'DELEGATION_RAPPEL_J3_DELEGATAIRE',
        d.delegataire,
        payloadCommun,
      );
      if (r1.supprime) emailsSupprimes++;
      else emailsPublies++;
      if (r2.supprime) emailsSupprimes++;
      else emailsPublies++;

      d.derniereNotificationJ3 = new Date();
      d.dateModification = new Date();
      d.utilisateurModification = 'system (cron-j3)';
      await this.delegationRepo.save(d);

      await this.auditService.log({
        utilisateur: 'system (cron)',
        typeAction: 'DELEGATION_RAPPEL_J3',
        entiteCible: 'delegation',
        idCible: String(d.id),
        statut: 'success',
        payloadApres: {
          delegationId: String(d.id),
          delegantEmail: d.delegant.email,
          delegataireEmail: d.delegataire.email,
          dateFin: d.dateFin,
          delegantSupprime: r1.supprime,
          delegataireSupprime: r2.supprime,
        },
        commentaire: `Rappel J-3 envoyé pour délégation ${String(d.id)} (date_fin=${d.dateFin}).`,
      });
    }

    this.logger.log(
      `[Cron] Rappel J-3 : ${String(matches.length)} délégation(s) notifiée(s) (${String(emailsPublies)} email(s) publié(s), ${String(emailsSupprimes)} supprimé(s)).`,
    );
    return {
      notifiees: matches.length,
      emailsPublies,
      emailsSupprimes,
    };
  }
}
