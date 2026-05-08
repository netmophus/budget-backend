/**
 * VersionWorkflowService (Lot 3.5) — transitions de statut du
 * workflow de validation budgétaire (Q4).
 *
 * Cycle linéaire avec rejet possible :
 *   ouvert (Brouillon)
 *     ↓ soumettre (BUDGET.SOUMETTRE)
 *   soumis
 *     ├─→ valider (BUDGET.VALIDER) → valide
 *     │                                ↓ publier (BUDGET.PUBLIER)
 *     │                              gele (Publié, IMMUABLE)
 *     └─→ rejeter (BUDGET.VALIDER) → ouvert (avec commentaire de
 *                                              rejet conservé)
 *
 * Les permissions sont vérifiées par le `PermissionsGuard` global
 * via le décorateur `@RequirePermissions` du controller — le service
 * suppose que la permission est déjà satisfaite et se concentre sur
 * la cohérence métier (statut + audit).
 *
 * Toutes les transitions sont **transactionnelles** et écrivent une
 * entrée `audit_log` (4 nouveaux `type_action` :
 * SOUMETTRE_BUDGET / VALIDER_BUDGET / REJETER_BUDGET / PUBLIER_BUDGET).
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { AuditService } from '../../audit/audit.service';
import { PermissionsService } from '../../auth/permissions.service';
import {
  type BudgetEventPayload,
  EVENT_BUDGET_PUBLISHED,
  EVENT_BUDGET_REJECTED,
  EVENT_BUDGET_SUBMITTED,
  EVENT_BUDGET_VALIDATED,
} from '../../notifications/notifications.events';
import { DimVersion } from './entities/dim-version.entity';
import type { TypeAction } from '../../audit/entities/audit-log.entity';
import { VersionResponseDto } from './dto/version-response.dto';
import {
  PublierVersionDto,
  RejeterVersionDto,
  SoumettreVersionDto,
  ValiderVersionDto,
} from './dto/workflow.dto';
import { toVersionResponse } from './version.service';

interface AuthCaller {
  userId: string;
  email: string;
}

/**
 * Lot 5.3.A — émission du code audit polymorphe selon
 * `type_version`. Pour les versions de type 'reforecast' (Lot 5.3),
 * on émet le code `*_REFORECAST` au lieu de `*_BUDGET`.
 */
function codeAudit(
  type: string,
  base: 'SOUMETTRE' | 'VALIDER' | 'REJETER' | 'PUBLIER',
): TypeAction {
  if (type === 'reforecast') {
    return `${base}_REFORECAST` as TypeAction;
  }
  return `${base}_BUDGET` as TypeAction;
}

/**
 * Garde-fou : une version de type 'reforecast' marquée OBSOLETE ne
 * peut plus changer de statut workflow (Q1 décision produit Lot
 * 5.3 — l'écrasement est définitif).
 */
function assertReforecastNonObsolete(v: DimVersion): void {
  if (
    v.typeVersion === 'reforecast' &&
    v.statutPublication === 'OBSOLETE'
  ) {
    throw new ConflictException(
      'Ce reforecast est OBSOLETE (remplacé par un nouveau reforecast). ' +
        "Aucune transition de workflow n'est possible.",
    );
  }
}

@Injectable()
export class VersionWorkflowService {
  constructor(
    @InjectRepository(DimVersion)
    private readonly versionRepo: Repository<DimVersion>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly permissionsService: PermissionsService,
    private readonly events: EventEmitter2,
  ) {}

  // ─── Soumettre : ouvert → soumis ────────────────────────────────

  async soumettre(
    versionId: string,
    dto: SoumettreVersionDto,
    user: AuthCaller,
  ): Promise<VersionResponseDto> {
    // Lot 4.2-fix.A : si l'action passe par une délégation, on
    // l'enregistre dans le payload audit (priorité NATIF appliquée
    // par PermissionsService.getDelegationContextPour).
    const viaDelegationId = await this.permissionsService.getDelegationContextPour(
      user.userId,
      'BUDGET.SOUMETTRE',
    );
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(DimVersion);
      const v = await repo.findOne({ where: { id: versionId } });
      if (!v) {
        throw new NotFoundException(`Version ${versionId} introuvable.`);
      }
      if (v.statut !== 'ouvert') {
        throw new ConflictException(
          `Seule une version en Brouillon peut être soumise. ` +
            `Statut actuel : '${v.statut}'.`,
        );
      }
      assertReforecastNonObsolete(v);

      // Une version vide (aucune ligne fait_budget) ne peut pas être
      // soumise — sinon on transmet pour validation un travail nul.
      // Raw query SQL pour éviter d'importer FaitBudget (couplage
      // entité indésirable côté VersionModule, cf. version.module.ts).
      const rows = (await manager.query(
        `SELECT COUNT(*)::int AS n FROM fait_budget WHERE fk_version = $1`,
        [versionId],
      )) as Array<{ n: number }>;
      const nbLignes = rows[0]?.n ?? 0;
      if (nbLignes === 0) {
        throw new UnprocessableEntityException(
          `Cette version est vide. Saisissez au moins une ligne ` +
            `budgétaire avant de la soumettre à validation.`,
        );
      }

      v.statut = 'soumis';
      v.commentaireSoumission = dto.commentaire ?? null;
      v.dateSoumission = new Date();
      v.utilisateurSoumission = user.email;
      // Réinitialiser les champs des transitions ultérieures (cas
      // d'un précédent rejet → re-soumission).
      v.commentaireValidation = null;
      v.dateValidation = null;
      v.utilisateurValidation = null;
      v.commentaireRejet = null;
      v.dateRejet = null;
      v.utilisateurRejet = null;
      const saved = await repo.save(v);

      await this.auditService.log({
        utilisateur: user.email,
        typeAction: codeAudit(v.typeVersion, 'SOUMETTRE'),
        entiteCible: 'dim_version',
        idCible: String(versionId),
        statut: 'success',
        payloadApres: {
          codeVersion: v.codeVersion,
          statutAvant: 'ouvert',
          statutApres: 'soumis',
          commentaire: dto.commentaire ?? null,
          ...(viaDelegationId !== null
            ? { via_delegation_id: viaDelegationId }
            : {}),
        },
        commentaire: `Soumission de ${v.codeVersion} (${nbLignes} ligne(s) à valider).`,
      });

      // Lot 4.3 — émission événement (couplage faible). Le listener
      // NotificationsModule s'abonne et déclenche les emails. Si aucun
      // listener n'est enregistré, l'émission ne casse rien.
      this.events.emit(EVENT_BUDGET_SUBMITTED, {
        versionId: String(versionId),
        codeVersion: v.codeVersion,
        auteurEmail: user.email,
        auteurId: user.userId,
        commentaire: dto.commentaire ?? null,
      } satisfies BudgetEventPayload);

      return toVersionResponse(saved);
    });
  }

  // ─── Valider : soumis → valide ──────────────────────────────────

  async valider(
    versionId: string,
    dto: ValiderVersionDto,
    user: AuthCaller,
  ): Promise<VersionResponseDto> {
    const viaDelegationId = await this.permissionsService.getDelegationContextPour(
      user.userId,
      'BUDGET.VALIDER',
    );
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(DimVersion);
      const v = await repo.findOne({ where: { id: versionId } });
      if (!v) {
        throw new NotFoundException(`Version ${versionId} introuvable.`);
      }
      if (v.statut !== 'soumis') {
        throw new ConflictException(
          `Seule une version Soumise peut être validée. ` +
            `Statut actuel : '${v.statut}'.`,
        );
      }
      assertReforecastNonObsolete(v);

      v.statut = 'valide';
      v.commentaireValidation = dto.commentaire ?? null;
      v.dateValidation = new Date();
      v.utilisateurValidation = user.email;
      const saved = await repo.save(v);

      await this.auditService.log({
        utilisateur: user.email,
        typeAction: codeAudit(v.typeVersion, 'VALIDER'),
        entiteCible: 'dim_version',
        idCible: String(versionId),
        statut: 'success',
        payloadApres: {
          codeVersion: v.codeVersion,
          statutAvant: 'soumis',
          statutApres: 'valide',
          commentaire: dto.commentaire ?? null,
          ...(viaDelegationId !== null
            ? { via_delegation_id: viaDelegationId }
            : {}),
        },
        commentaire: `Validation de ${v.codeVersion}.`,
      });

      this.events.emit(EVENT_BUDGET_VALIDATED, {
        versionId: String(versionId),
        codeVersion: v.codeVersion,
        auteurEmail: user.email,
        auteurId: user.userId,
        commentaire: dto.commentaire ?? null,
      } satisfies BudgetEventPayload);

      return toVersionResponse(saved);
    });
  }

  // ─── Rejeter : soumis → ouvert (avec commentaire OBLIGATOIRE) ───

  async rejeter(
    versionId: string,
    dto: RejeterVersionDto,
    user: AuthCaller,
  ): Promise<VersionResponseDto> {
    // Rejet utilise BUDGET.VALIDER (cf. controller).
    const viaDelegationId = await this.permissionsService.getDelegationContextPour(
      user.userId,
      'BUDGET.VALIDER',
    );
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(DimVersion);
      const v = await repo.findOne({ where: { id: versionId } });
      if (!v) {
        throw new NotFoundException(`Version ${versionId} introuvable.`);
      }
      if (v.statut !== 'soumis') {
        throw new ConflictException(
          `Seule une version Soumise peut être rejetée. ` +
            `Statut actuel : '${v.statut}'.`,
        );
      }
      assertReforecastNonObsolete(v);

      // Retour en Brouillon, conservation du commentaire de rejet
      // pour le préparateur. Effacer les champs de soumission
      // (la prochaine soumission les ré-écrira).
      v.statut = 'ouvert';
      v.commentaireRejet = dto.commentaire;
      v.dateRejet = new Date();
      v.utilisateurRejet = user.email;
      v.commentaireSoumission = null;
      v.dateSoumission = null;
      v.utilisateurSoumission = null;
      const saved = await repo.save(v);

      await this.auditService.log({
        utilisateur: user.email,
        typeAction: codeAudit(v.typeVersion, 'REJETER'),
        entiteCible: 'dim_version',
        idCible: String(versionId),
        statut: 'success',
        payloadApres: {
          codeVersion: v.codeVersion,
          statutAvant: 'soumis',
          statutApres: 'ouvert',
          commentaireRejet: dto.commentaire,
          ...(viaDelegationId !== null
            ? { via_delegation_id: viaDelegationId }
            : {}),
        },
        commentaire: `Rejet de ${v.codeVersion} : ${dto.commentaire.slice(0, 200)}`,
      });

      this.events.emit(EVENT_BUDGET_REJECTED, {
        versionId: String(versionId),
        codeVersion: v.codeVersion,
        auteurEmail: user.email,
        auteurId: user.userId,
        commentaire: dto.commentaire,
      } satisfies BudgetEventPayload);

      return toVersionResponse(saved);
    });
  }

  // ─── Publier : valide → gele (IMMUABLE) ─────────────────────────

  async publier(
    versionId: string,
    dto: PublierVersionDto,
    user: AuthCaller,
  ): Promise<VersionResponseDto> {
    const viaDelegationId = await this.permissionsService.getDelegationContextPour(
      user.userId,
      'BUDGET.PUBLIER',
    );
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(DimVersion);
      const v = await repo.findOne({ where: { id: versionId } });
      if (!v) {
        throw new NotFoundException(`Version ${versionId} introuvable.`);
      }
      if (v.statut !== 'valide') {
        throw new ConflictException(
          `Seule une version Validée peut être publiée. ` +
            `Statut actuel : '${v.statut}'.`,
        );
      }
      assertReforecastNonObsolete(v);

      v.statut = 'gele';
      v.commentairePublication = dto.commentaire ?? null;
      // Conserver date_gel/utilisateur_gel comme alias de
      // date_publication/utilisateur_publication (cf. mapping
      // vocabulaire docs/modele-donnees.md §4.1.2).
      v.dateGel = new Date();
      v.utilisateurGel = user.email;
      const saved = await repo.save(v);

      await this.auditService.log({
        utilisateur: user.email,
        typeAction: codeAudit(v.typeVersion, 'PUBLIER'),
        entiteCible: 'dim_version',
        idCible: String(versionId),
        statut: 'success',
        payloadApres: {
          codeVersion: v.codeVersion,
          statutAvant: 'valide',
          statutApres: 'gele',
          commentaire: dto.commentaire ?? null,
          ...(viaDelegationId !== null
            ? { via_delegation_id: viaDelegationId }
            : {}),
        },
        commentaire:
          `Publication (gel) de ${v.codeVersion} — action irréversible. ` +
          'Conservation BCEAO 10 ans.',
      });

      this.events.emit(EVENT_BUDGET_PUBLISHED, {
        versionId: String(versionId),
        codeVersion: v.codeVersion,
        auteurEmail: user.email,
        auteurId: user.userId,
        commentaire: dto.commentaire ?? null,
      } satisfies BudgetEventPayload);

      return toVersionResponse(saved);
    });
  }
}
