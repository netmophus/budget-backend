/**
 * UserPerimetreService (Lot 4.1.B.2) — orchestre la création et la
 * désactivation (soft-delete) des affectations multi-périmètres,
 * avec audit applicatif et validation métier.
 *
 * Création : la cohérence cible_type ↔ champs (cible_id /
 * cible_cr_ids) est garantie côté SQL par
 * `ck_user_perimetres_cible_coherence`. Le service ajoute :
 *   - Vérification de l'existence du user cible
 *   - Vérification de l'existence des cibles (structure / CR)
 *   - Vérification que `date_fin >= date_debut` si fournie
 *   - Audit `CREER_AFFECTATION` ou `RETIRER_AFFECTATION`
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuditService } from '../../audit/audit.service';
import {
  type AffectationEventPayload,
  EVENT_AFFECTATION_CREATED,
} from '../../notifications/notifications.events';
import { User } from '../entities/user.entity';
import {
  type CiblePerimetreType,
  type OriginePerimetre,
  UserPerimetre,
} from '../entities/user-perimetre.entity';

export interface CreerAffectationPerimetreInput {
  cibleType: CiblePerimetreType;
  cibleId?: string | null;
  cibleCrIds?: string[] | null;
  origine?: OriginePerimetre;
  dateDebut?: string;
  dateFin?: string | null;
  motif?: string | null;
}

/**
 * Forme normalisée d'une affectation de périmètre exposée par l'API
 * REST (cf. AffectationPerimetreResponseDto).
 */
export interface AffectationPerimetreResume {
  id: string;
  cibleType: CiblePerimetreType;
  cibleId: string | null;
  cibleCrIds: string[] | null;
  origine: OriginePerimetre;
  delegationId: string | null;
  dateDebut: string;
  dateFin: string | null;
  actif: boolean;
  motif: string | null;
}

@Injectable()
export class UserPerimetreService {
  constructor(
    @InjectRepository(UserPerimetre)
    private readonly repo: Repository<UserPerimetre>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly auditService: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  // ─── Lecture ─────────────────────────────────────────────────────

  /**
   * Liste les affectations d'un utilisateur (filtres optionnels :
   * actif / origine / dateRef pour ne ramener que celles couvrant
   * une date donnée).
   */
  async lister(
    userId: string,
    options: {
      actif?: boolean;
      origine?: OriginePerimetre;
      dateRef?: string;
    } = {},
  ): Promise<AffectationPerimetreResume[]> {
    const qb = this.repo
      .createQueryBuilder('up')
      .where('up.fkUser = :userId', { userId });
    if (typeof options.actif === 'boolean') {
      qb.andWhere('up.actif = :actif', { actif: options.actif });
    }
    if (options.origine) {
      qb.andWhere('up.origine = :origine', { origine: options.origine });
    }
    if (options.dateRef) {
      qb.andWhere('up.dateDebut <= :d', { d: options.dateRef }).andWhere(
        '(up.dateFin IS NULL OR up.dateFin >= :d)',
        {
          d: options.dateRef,
        },
      );
    }
    qb.orderBy('up.dateDebut', 'DESC').addOrderBy('up.id', 'DESC');
    const rows = await qb.getMany();
    return rows.map(
      (r): AffectationPerimetreResume => ({
        id: String(r.id),
        cibleType: r.cibleType,
        cibleId: r.cibleId === null ? null : String(r.cibleId),
        cibleCrIds:
          r.cibleCrIds === null ? null : r.cibleCrIds.map((x) => String(x)),
        origine: r.origine,
        delegationId: r.delegationId === null ? null : String(r.delegationId),
        dateDebut: r.dateDebut,
        dateFin: r.dateFin,
        actif: r.actif,
        motif: r.motif,
      }),
    );
  }

  // ─── Création ─────────────────────────────────────────────────────

  async creer(
    userId: string,
    dto: CreerAffectationPerimetreInput,
    auteurEmail: string,
  ): Promise<UserPerimetre> {
    // 1. User cible existant ?
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`Utilisateur ${userId} introuvable.`);
    }

    // 2. Cohérence cible_type / champs
    this.validerCible(dto);

    // 3. Cibles existent en base ?
    if (dto.cibleType === 'STRUCTURE') {
      const exists = await this.repo.manager.query<Array<{ id: string }>>(
        `SELECT id FROM dim_structure
          WHERE id = $1 AND version_courante = true`,
        [dto.cibleId],
      );
      if (exists.length === 0) {
        throw new BadRequestException(
          `Structure ${dto.cibleId} introuvable ou non courante.`,
        );
      }
    } else if (dto.cibleType === 'CR') {
      const exists = await this.repo.manager.query<Array<{ id: string }>>(
        `SELECT id FROM dim_centre_responsabilite
          WHERE id = $1 AND version_courante = true AND est_actif = true`,
        [dto.cibleId],
      );
      if (exists.length === 0) {
        throw new BadRequestException(
          `Centre de responsabilité ${dto.cibleId} introuvable ou inactif.`,
        );
      }
    } else if (dto.cibleType === 'CR_SET') {
      if (!dto.cibleCrIds || dto.cibleCrIds.length < 2) {
        throw new BadRequestException(
          `cible_type='CR_SET' exige au moins 2 CR (reçu ${dto.cibleCrIds?.length ?? 0}).`,
        );
      }
      const placeholders = dto.cibleCrIds.map((_, i) => `$${i + 1}`).join(',');
      const found = await this.repo.manager.query<Array<{ id: string }>>(
        `SELECT id FROM dim_centre_responsabilite
          WHERE id IN (${placeholders})
            AND version_courante = true AND est_actif = true`,
        dto.cibleCrIds,
      );
      if (found.length !== dto.cibleCrIds.length) {
        throw new BadRequestException(
          `Certains CR du CR_SET sont introuvables ou inactifs ` +
            `(attendu ${dto.cibleCrIds.length}, trouvé ${found.length}).`,
        );
      }
    }

    // 4. Cohérence dates
    const dateDebut = dto.dateDebut ?? new Date().toISOString().slice(0, 10);
    if (dto.dateFin && dto.dateFin < dateDebut) {
      throw new BadRequestException(
        `date_fin (${dto.dateFin}) ne peut pas être antérieure à date_debut (${dateDebut}).`,
      );
    }

    // 5. INSERT + audit dans une transaction atomique (Lot 4.1-fix2.B).
    //    Si l'audit échoue, l'affectation est rollback automatiquement.
    try {
      const saved = await this.repo.manager.transaction(async (tx) => {
        const upRepo = tx.getRepository(UserPerimetre);
        const entity = upRepo.create({
          fkUser: userId,
          cibleType: dto.cibleType,
          cibleId: dto.cibleId ?? null,
          cibleCrIds: dto.cibleCrIds ?? null,
          origine: dto.origine ?? 'AFFECTATION',
          dateDebut,
          dateFin: dto.dateFin ?? null,
          actif: true,
          motif: dto.motif ?? null,
          utilisateurCreation: auteurEmail,
        });
        const saved = await upRepo.save(entity);

        await this.auditService.log(
          {
            utilisateur: auteurEmail,
            typeAction: 'CREER_AFFECTATION',
            entiteCible: 'user_perimetres',
            idCible: String(saved.id),
            statut: 'success',
            payloadApres: {
              userId,
              cibleType: saved.cibleType,
              cibleId: saved.cibleId,
              cibleCrIds: saved.cibleCrIds,
              origine: saved.origine,
              dateDebut: saved.dateDebut,
              dateFin: saved.dateFin,
            },
            commentaire:
              `Affectation ${saved.cibleType} créée pour user ${userId} ` +
              `(origine ${saved.origine}).`,
          },
          tx,
        );
        return saved;
      });

      // Lot 4.3 — émission post-commit (couplage faible).
      this.events.emit(EVENT_AFFECTATION_CREATED, {
        affectationId: String(saved.id),
        fkUser: userId,
        cibleType: saved.cibleType,
        cibleId: saved.cibleId === null ? null : String(saved.cibleId),
        cibleCrIds:
          saved.cibleCrIds === null
            ? null
            : saved.cibleCrIds.map((x) => String(x)),
        dateDebut: saved.dateDebut,
        motif: saved.motif,
      } satisfies AffectationEventPayload);

      return saved;
    } catch (err) {
      // Conflit unique (mêmes user/cible/origine déjà actif, ou
      // CR_SET strictement identique pour le même user — index
      // uq_user_perimetres_cr_set_actif posé au Lot 4.1-fix2.C).
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('uq_user_perimetres_actif') ||
        msg.includes('uq_user_perimetres_cr_set_actif') ||
        msg.includes('duplicate')
      ) {
        throw new ConflictException(
          `Affectation déjà existante pour ce user / cible / origine.`,
        );
      }
      throw err;
    }
  }

  // ─── Désactivation soft ──────────────────────────────────────────

  async retirer(
    userId: string,
    perimetreId: string,
    auteurEmail: string,
  ): Promise<void> {
    const p = await this.repo.findOne({
      where: { id: perimetreId, fkUser: userId },
    });
    if (!p) {
      throw new NotFoundException(
        `Affectation ${perimetreId} introuvable pour user ${userId}.`,
      );
    }
    if (!p.actif) {
      throw new ConflictException(`Affectation ${perimetreId} déjà inactive.`);
    }
    // Désactivation soft + audit en transaction atomique (Lot 4.1-fix2.B).
    await this.repo.manager.transaction(async (tx) => {
      const upRepo = tx.getRepository(UserPerimetre);
      p.actif = false;
      p.dateModification = new Date();
      p.utilisateurModification = auteurEmail;
      await upRepo.save(p);

      await this.auditService.log(
        {
          utilisateur: auteurEmail,
          typeAction: 'RETIRER_AFFECTATION',
          entiteCible: 'user_perimetres',
          idCible: String(p.id),
          statut: 'success',
          payloadApres: {
            userId,
            cibleType: p.cibleType,
            cibleId: p.cibleId,
            cibleCrIds: p.cibleCrIds,
            origine: p.origine,
          },
          commentaire: `Affectation ${p.cibleType} ${p.id} retirée (soft).`,
        },
        tx,
      );
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  private validerCible(dto: CreerAffectationPerimetreInput): void {
    if (dto.cibleType === 'CR_SET') {
      if (dto.cibleId) {
        throw new BadRequestException(
          `cible_type='CR_SET' interdit cible_id (utiliser cible_cr_ids).`,
        );
      }
      if (!dto.cibleCrIds || dto.cibleCrIds.length < 2) {
        throw new BadRequestException(
          `cible_type='CR_SET' exige cible_cr_ids avec au moins 2 éléments.`,
        );
      }
    } else {
      if (!dto.cibleId) {
        throw new BadRequestException(
          `cible_type='${dto.cibleType}' exige cible_id.`,
        );
      }
      if (dto.cibleCrIds) {
        throw new BadRequestException(
          `cible_type='${dto.cibleType}' interdit cible_cr_ids.`,
        );
      }
    }
  }
}
