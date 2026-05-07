/**
 * DelegationsService (Lot 4.2) — orchestre la création, la
 * révocation et l'expiration des délégations temporaires.
 *
 * Règles métier strictes :
 *  1. fk_delegant ≠ fk_delegataire (CHECK SQL doublé applicatif)
 *  2. date_fin ≥ date_debut (CHECK SQL)
 *  3. ANTI-CHAÎNAGE strict (D2) : un user_perimetre dont
 *     `origine='DELEGATION'` ne peut PAS être délégué à son tour.
 *  4. INCLUSION PÉRIMÈTRE : tous les `perimetre_user_perimetre_ids`
 *     doivent appartenir au délégant et être actifs à `date_debut`.
 *  5. INCLUSION PERMISSIONS : le délégant doit posséder la
 *     permission RBAC sous-jacente (BUDGET.SAISIR/SOUMETTRE/
 *     VALIDER/PUBLIER) pour pouvoir déléguer le verbe
 *     correspondant.
 *  6. CHEVAUCHEMENT : warning (pas blocage) si une délégation
 *     active existe déjà pour (delegant, delegataire) avec
 *     chevauchement périmètre/permission/dates.
 *
 * Effets de bord à la création :
 *  - Pour chaque user_perimetre du délégant inclus, créer une
 *    ligne `user_perimetres` MIROIR pour le délégataire avec
 *    `origine='DELEGATION'`, `delegation_id=id`, dates de la
 *    délégation. Le tout en transaction atomique avec l'audit
 *    `CREER_DELEGATION`.
 *
 * Effets de bord à la révocation :
 *  - delegation.actif = false, revoquee_le, fk_revoque_par,
 *    motif_revocation
 *  - user_perimetres miroir → actif=false (soft delete)
 *  - audit `REVOQUER_DELEGATION`
 *
 * expirerAutomatiquement (cron) :
 *  - delegations actives avec date_fin < CURRENT_DATE :
 *    actif=false + miroirs désactivés + audit `EXPIRER_DELEGATION`.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../auth/permissions.service';
import { UserPerimetre } from '../users/entities/user-perimetre.entity';
import { User } from '../users/entities/user.entity';
import {
  type CreerDelegationDto,
  type DelegationResponseDto,
  type ListerDelegationsQueryDto,
  type RevoquerDelegationDto,
} from './dto/delegation.dto';
import {
  Delegation,
  type PermissionDelegable,
} from './entities/delegation.entity';

const PERM_MAPPING: Record<PermissionDelegable, string> = {
  SAISIE: 'BUDGET.SAISIR',
  SOUMISSION: 'BUDGET.SOUMETTRE',
  VALIDATION: 'BUDGET.VALIDER',
  PUBLICATION: 'BUDGET.PUBLIER',
};

interface CreerResult {
  delegation: Delegation;
  warnings: string[];
}

@Injectable()
export class DelegationsService {
  private readonly logger = new Logger(DelegationsService.name);

  constructor(
    @InjectRepository(Delegation)
    private readonly delegRepo: Repository<Delegation>,
    @InjectRepository(UserPerimetre)
    private readonly perimetreRepo: Repository<UserPerimetre>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly auditService: AuditService,
    private readonly permissionsService: PermissionsService,
  ) {}

  // ─── Création ────────────────────────────────────────────────────

  async creer(
    dto: CreerDelegationDto,
    currentUser: { userId: string; email: string },
  ): Promise<CreerResult> {
    const fkDelegant = currentUser.userId;
    const fkDelegataire = dto.fkDelegataire;

    // Règle 1 : délégant ≠ délégataire
    if (fkDelegant === fkDelegataire) {
      throw new BadRequestException(
        `Impossible de se déléguer à soi-même.`,
      );
    }

    // Vérifier l'existence du délégataire
    const delegataire = await this.userRepo.findOne({
      where: { id: fkDelegataire },
    });
    if (!delegataire || !delegataire.estActif) {
      throw new BadRequestException(
        `Délégataire ${fkDelegataire} introuvable ou inactif.`,
      );
    }

    // Règle 2 : dates
    if (dto.dateFin < dto.dateDebut) {
      throw new BadRequestException(
        `date_fin (${dto.dateFin}) ne peut pas être antérieure à date_debut (${dto.dateDebut}).`,
      );
    }

    // Règle 5 : permissions sous-jacentes
    const effectivePerms = await this.permissionsService.getEffectivePermissions(
      fkDelegant,
    );
    const possessedCodes = new Set(
      effectivePerms.map((p) => p.code_permission),
    );
    for (const verb of dto.permissions) {
      const required = PERM_MAPPING[verb];
      if (!possessedCodes.has(required)) {
        throw new BadRequestException(
          `Vous ne possédez pas la permission ${required} requise pour déléguer le verbe ${verb}.`,
        );
      }
    }

    // Règles 3 + 4 : anti-chaînage + inclusion périmètre
    const sourcePerimetres = await this.perimetreRepo.find({
      where: {
        id: In(dto.perimetreUserPerimetreIds),
      },
    });
    if (sourcePerimetres.length !== dto.perimetreUserPerimetreIds.length) {
      throw new BadRequestException(
        `Certains périmètres demandés sont introuvables ` +
          `(attendu ${dto.perimetreUserPerimetreIds.length}, trouvé ${sourcePerimetres.length}).`,
      );
    }
    for (const p of sourcePerimetres) {
      // Règle 4 : inclusion (le périmètre appartient au délégant)
      if (String(p.fkUser) !== fkDelegant) {
        throw new BadRequestException(
          `Le périmètre ${p.id} n'appartient pas à l'utilisateur courant.`,
        );
      }
      // Règle 4bis : actif à date_debut
      if (!p.actif) {
        throw new BadRequestException(
          `Le périmètre ${p.id} est inactif — impossible de le déléguer.`,
        );
      }
      if (p.dateDebut > dto.dateDebut) {
        throw new BadRequestException(
          `Le périmètre ${p.id} ne sera actif qu'à partir de ${p.dateDebut} ` +
            `— vous ne pouvez pas le déléguer pour ${dto.dateDebut}.`,
        );
      }
      if (p.dateFin && p.dateFin < dto.dateDebut) {
        throw new BadRequestException(
          `Le périmètre ${p.id} a expiré le ${p.dateFin} — impossible de le déléguer.`,
        );
      }
      // Règle 3 : ANTI-CHAÎNAGE STRICT (D2 — non négociable)
      if (p.origine === 'DELEGATION') {
        throw new BadRequestException(
          `Vous ne pouvez pas déléguer une permission que vous tenez ` +
            `vous-même d'une délégation. La chaîne de délégation est ` +
            `interdite (auditabilité BCEAO). Demandez à un administrateur ` +
            `de réassigner directement.`,
        );
      }
    }

    // Règle 6 : chevauchement → warning (pas blocage)
    const warnings: string[] = [];
    const chevauchements = await this.delegRepo
      .createQueryBuilder('d')
      .where('d.fkDelegant = :delegant', { delegant: fkDelegant })
      .andWhere('d.fkDelegataire = :delegataire', {
        delegataire: fkDelegataire,
      })
      .andWhere('d.actif = true')
      .andWhere('d.dateDebut <= :dateFin', { dateFin: dto.dateFin })
      .andWhere('d.dateFin >= :dateDebut', { dateDebut: dto.dateDebut })
      .getMany();
    for (const ch of chevauchements) {
      const sharedPerms = ch.permissions.filter((p) =>
        dto.permissions.includes(p),
      );
      const sharedPerim = ch.perimetreUserPerimetreIds.filter((id) =>
        dto.perimetreUserPerimetreIds.includes(String(id)),
      );
      if (sharedPerms.length > 0 && sharedPerim.length > 0) {
        warnings.push(
          `Chevauchement avec délégation #${ch.id} ` +
            `(perms ${sharedPerms.join(',')}, ${sharedPerim.length} périmètre(s)).`,
        );
      }
    }

    // Création atomique : delegations + miroirs user_perimetres + audit
    const created = await this.delegRepo.manager.transaction(async (tx) => {
      const dRepo = tx.getRepository(Delegation);
      const upRepo = tx.getRepository(UserPerimetre);

      const entity = dRepo.create({
        fkDelegant,
        fkDelegataire,
        perimetreUserPerimetreIds: dto.perimetreUserPerimetreIds,
        permissions: dto.permissions,
        motif: dto.motif,
        dateDebut: dto.dateDebut,
        dateFin: dto.dateFin,
        actif: true,
        utilisateurCreation: currentUser.email,
      });
      const saved = await dRepo.save(entity);

      // Miroirs user_perimetres pour le délégataire
      for (const sourceP of sourcePerimetres) {
        const miroir = upRepo.create({
          fkUser: fkDelegataire,
          cibleType: sourceP.cibleType,
          cibleId: sourceP.cibleId,
          cibleCrIds: sourceP.cibleCrIds,
          origine: 'DELEGATION',
          delegationId: String(saved.id),
          dateDebut: dto.dateDebut,
          dateFin: dto.dateFin,
          actif: true,
          motif: `Délégation #${saved.id} de ${currentUser.email} : ${dto.motif}`,
          utilisateurCreation: currentUser.email,
        });
        await upRepo.save(miroir);
      }

      await this.auditService.log(
        {
          utilisateur: currentUser.email,
          typeAction: 'CREER_DELEGATION',
          entiteCible: 'delegations',
          idCible: String(saved.id),
          statut: 'success',
          payloadApres: {
            fkDelegant,
            fkDelegataire,
            permissions: dto.permissions,
            perimetreIds: dto.perimetreUserPerimetreIds,
            dateDebut: dto.dateDebut,
            dateFin: dto.dateFin,
            motif: dto.motif,
            warnings: warnings.length,
          },
          commentaire:
            `Délégation #${saved.id} créée — ${dto.permissions.join(',')} ` +
            `sur ${sourcePerimetres.length} périmètre(s) ` +
            `du ${dto.dateDebut} au ${dto.dateFin}. Motif : ${dto.motif.slice(0, 200)}`,
        },
        tx,
      );
      return saved;
    });

    return { delegation: created, warnings };
  }

  // ─── Révocation ──────────────────────────────────────────────────

  async revoquer(
    delegationId: string,
    dto: RevoquerDelegationDto,
    currentUser: { userId: string; email: string },
    isAdmin: boolean,
  ): Promise<Delegation> {
    const d = await this.delegRepo.findOne({ where: { id: delegationId } });
    if (!d) {
      throw new NotFoundException(`Délégation ${delegationId} introuvable.`);
    }
    if (!d.actif) {
      throw new BadRequestException(
        `Délégation ${delegationId} déjà inactive (révoquée ou expirée).`,
      );
    }
    // Autorisation : délégant ou ADMIN
    if (String(d.fkDelegant) !== currentUser.userId && !isAdmin) {
      throw new ForbiddenException(
        `Seul le délégant ou un administrateur peut révoquer cette délégation.`,
      );
    }

    return this.delegRepo.manager.transaction(async (tx) => {
      const dRepo = tx.getRepository(Delegation);
      const upRepo = tx.getRepository(UserPerimetre);

      d.actif = false;
      d.revoqueeLe = new Date();
      d.fkRevoquePar = currentUser.userId;
      d.motifRevocation = dto.motif;
      d.dateModification = new Date();
      d.utilisateurModification = currentUser.email;
      const saved = await dRepo.save(d);

      // Désactiver les miroirs user_perimetres
      await upRepo
        .createQueryBuilder()
        .update()
        .set({
          actif: false,
          dateModification: () => 'CURRENT_TIMESTAMP',
          utilisateurModification: currentUser.email,
        })
        .where('delegation_id = :id', { id: delegationId })
        .andWhere('actif = true')
        .execute();

      await this.auditService.log(
        {
          utilisateur: currentUser.email,
          typeAction: 'REVOQUER_DELEGATION',
          entiteCible: 'delegations',
          idCible: String(saved.id),
          statut: 'success',
          payloadApres: {
            fkDelegant: saved.fkDelegant,
            fkDelegataire: saved.fkDelegataire,
            motifRevocation: dto.motif,
            revoqueePar: currentUser.userId,
            isAdmin,
          },
          commentaire:
            `Délégation #${saved.id} révoquée par ${currentUser.email}` +
            (isAdmin ? ' (admin)' : '') +
            ` — motif : ${dto.motif.slice(0, 200)}`,
        },
        tx,
      );
      return saved;
    });
  }

  // ─── Listing ─────────────────────────────────────────────────────

  async listerEnTantQueDelegataire(
    userId: string,
    options: { actif?: boolean; dateRef?: string } = {},
  ): Promise<DelegationResponseDto[]> {
    const qb = this.delegRepo
      .createQueryBuilder('d')
      .where('d.fkDelegataire = :userId', { userId });
    if (typeof options.actif === 'boolean') {
      qb.andWhere('d.actif = :actif', { actif: options.actif });
    }
    if (options.dateRef) {
      qb.andWhere('d.dateDebut <= :d', { d: options.dateRef })
        .andWhere('d.dateFin >= :d', { d: options.dateRef });
    }
    qb.orderBy('d.dateCreation', 'DESC');
    const rows = await qb.getMany();
    return Promise.all(rows.map((r) => this.toResponse(r)));
  }

  async listerEmises(
    userId: string,
    options: { actif?: boolean; statut?: 'ACTIVE' | 'REVOQUEE' | 'EXPIREE' } = {},
  ): Promise<DelegationResponseDto[]> {
    const qb = this.delegRepo
      .createQueryBuilder('d')
      .where('d.fkDelegant = :userId', { userId });
    if (typeof options.actif === 'boolean') {
      qb.andWhere('d.actif = :actif', { actif: options.actif });
    }
    qb.orderBy('d.dateCreation', 'DESC');
    let rows = await qb.getMany();
    if (options.statut) {
      const today = new Date().toISOString().slice(0, 10);
      rows = rows.filter((r) => this.calculerStatut(r, today) === options.statut);
    }
    return Promise.all(rows.map((r) => this.toResponse(r)));
  }

  async listerToutes(
    filters: ListerDelegationsQueryDto,
  ): Promise<DelegationResponseDto[]> {
    const qb = this.delegRepo.createQueryBuilder('d');
    if (filters.delegantId) {
      qb.andWhere('d.fkDelegant = :delegantId', {
        delegantId: filters.delegantId,
      });
    }
    if (filters.delegataireId) {
      qb.andWhere('d.fkDelegataire = :delegataireId', {
        delegataireId: filters.delegataireId,
      });
    }
    if (typeof filters.actif === 'boolean') {
      qb.andWhere('d.actif = :actif', { actif: filters.actif });
    }
    qb.orderBy('d.dateCreation', 'DESC');
    qb.skip(((filters.page ?? 1) - 1) * (filters.limit ?? 50));
    qb.take(filters.limit ?? 50);
    let rows = await qb.getMany();
    if (filters.statut) {
      const today = new Date().toISOString().slice(0, 10);
      rows = rows.filter((r) => this.calculerStatut(r, today) === filters.statut);
    }
    return Promise.all(rows.map((r) => this.toResponse(r)));
  }

  // ─── Expiration auto (cron) ──────────────────────────────────────

  async expirerAutomatiquement(): Promise<{ nbExpirees: number }> {
    const today = new Date().toISOString().slice(0, 10);
    const aExpirer = await this.delegRepo
      .createQueryBuilder('d')
      .where('d.actif = true')
      .andWhere('d.dateFin < :today', { today })
      .getMany();

    let nb = 0;
    for (const d of aExpirer) {
      await this.delegRepo.manager.transaction(async (tx) => {
        const dRepo = tx.getRepository(Delegation);
        const upRepo = tx.getRepository(UserPerimetre);

        d.actif = false;
        d.dateModification = new Date();
        d.utilisateurModification = 'system (cron expiration)';
        await dRepo.save(d);

        await upRepo
          .createQueryBuilder()
          .update()
          .set({
            actif: false,
            dateModification: () => 'CURRENT_TIMESTAMP',
            utilisateurModification: 'system (cron expiration)',
          })
          .where('delegation_id = :id', { id: d.id })
          .andWhere('actif = true')
          .execute();

        await this.auditService.log(
          {
            utilisateur: 'system',
            typeAction: 'EXPIRER_DELEGATION',
            entiteCible: 'delegations',
            idCible: String(d.id),
            statut: 'success',
            payloadApres: {
              fkDelegant: d.fkDelegant,
              fkDelegataire: d.fkDelegataire,
              dateFin: d.dateFin,
            },
            commentaire: `Délégation #${d.id} expirée automatiquement (date_fin ${d.dateFin}).`,
          },
          tx,
        );
        nb++;
      });
    }
    if (nb > 0) {
      this.logger.log(`Cron expiration : ${nb} délégation(s) désactivée(s).`);
    }
    return { nbExpirees: nb };
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  private async toResponse(d: Delegation): Promise<DelegationResponseDto> {
    const today = new Date().toISOString().slice(0, 10);
    const [delegant, delegataire] = await Promise.all([
      this.userRepo.findOne({ where: { id: d.fkDelegant } }),
      this.userRepo.findOne({ where: { id: d.fkDelegataire } }),
    ]);
    return {
      id: String(d.id),
      fkDelegant: String(d.fkDelegant),
      fkDelegataire: String(d.fkDelegataire),
      delegantEmail: delegant?.email,
      delegataireEmail: delegataire?.email,
      perimetreUserPerimetreIds: d.perimetreUserPerimetreIds.map(String),
      permissions: d.permissions,
      motif: d.motif,
      dateDebut: d.dateDebut,
      dateFin: d.dateFin,
      actif: d.actif,
      revoqueeLe: d.revoqueeLe ? d.revoqueeLe.toISOString() : null,
      fkRevoquePar: d.fkRevoquePar === null ? null : String(d.fkRevoquePar),
      motifRevocation: d.motifRevocation,
      statut: this.calculerStatut(d, today),
    };
  }

  private calculerStatut(
    d: Delegation,
    today: string,
  ): 'ACTIVE' | 'REVOQUEE' | 'EXPIREE' {
    if (d.revoqueeLe) return 'REVOQUEE';
    if (!d.actif || d.dateFin < today) return 'EXPIREE';
    return 'ACTIVE';
  }

  /**
   * Périmètre d'une délégation active (à dateRef) reçue par le user
   * — utilisée par PermissionsService pour étendre les permissions
   * effectives. Retourne la liste des permissions déléguées avec
   * leur `delegation_id` source.
   */
  async getPermissionsRecues(
    userId: string,
    dateRef?: string,
  ): Promise<
    Array<{ permission: PermissionDelegable; delegationId: string }>
  > {
    const today = dateRef ?? new Date().toISOString().slice(0, 10);
    const rows = await this.delegRepo
      .createQueryBuilder('d')
      .where('d.fkDelegataire = :userId', { userId })
      .andWhere('d.actif = true')
      .andWhere('d.dateDebut <= :today', { today })
      .andWhere('d.dateFin >= :today', { today })
      .getMany();
    const out: Array<{ permission: PermissionDelegable; delegationId: string }> = [];
    for (const d of rows) {
      for (const p of d.permissions) {
        out.push({ permission: p, delegationId: String(d.id) });
      }
    }
    return out;
  }
}
