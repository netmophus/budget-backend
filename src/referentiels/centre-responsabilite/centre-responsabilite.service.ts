/**
 * CentreResponsabiliteService — 2ᵉ dimension SCD2 réelle.
 *
 * Hérite du socle `Scd2Service` (cf. `common/services/scd2.service.ts`)
 * et duplique le pattern PATCH 4-cas de `StructureService` (cf. fix
 * 2.3A.1) :
 *   1. no-op
 *   2. in_place_est_actif      (toggle estActif seul)
 *   3. ecrasement_intra_jour   (champ SCD2-tracé sur version du jour)
 *   4. nouvelle_version        (champ SCD2-tracé sur version d'hier+)
 *
 * Cette duplication est volontaire — règle « factoriser à 3 cas
 * concrets ». TODO Lot 2.5 ou plus tard : extraire dans un
 * `Scd2HierarchicalService` quand `dim_compte` aura le même besoin.
 *
 * FK vers `dim_structure` SCD2 : stratégie A (cf. `scd2-pattern.md`
 * §8). La méthode `relinkAfterStructureRevision` est appelée par
 * `StructureService` (via forwardRef) après la création d'une
 * nouvelle version de structure, pour repointer les CR existants
 * vers le nouvel `id` de la structure.
 */
import {
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { Scd2Service } from '../../common/services/scd2.service';
import { StructureService } from '../structure/structure.service';
import { CreateCrDto } from './dto/create-cr.dto';
import { CrResponseDto, StructureCouranteDto } from './dto/cr-response.dto';
import { ListCrsQueryDto } from './dto/list-crs-query.dto';
import { PaginatedCrsDto } from './dto/paginated-crs.dto';
import { UpdateCrDto } from './dto/update-cr.dto';
import { DimCentreResponsabilite } from './entities/dim-centre-responsabilite.entity';

const SCD2_TRACKED_FIELDS_CR = [
  'libelle',
  'libelleCourt',
  'typeCr',
  'fkStructure',
] as const;
type Scd2TrackedFieldCr = (typeof SCD2_TRACKED_FIELDS_CR)[number];

function toResponse(cr: DimCentreResponsabilite): CrResponseDto {
  const sc: StructureCouranteDto | undefined = cr.structure
    ? {
        id: cr.structure.id,
        codeStructure: cr.structure.codeStructure,
        libelle: cr.structure.libelle,
      }
    : undefined;
  return {
    id: cr.id,
    codeCr: cr.codeCr,
    libelle: cr.libelle,
    libelleCourt: cr.libelleCourt,
    typeCr: cr.typeCr,
    fkStructure: cr.fkStructure,
    structureCourante: sc,
    dateDebutValidite: cr.dateDebutValidite,
    dateFinValidite: cr.dateFinValidite,
    versionCourante: cr.versionCourante,
    estActif: cr.estActif,
    dateCreation: cr.dateCreation,
    utilisateurCreation: cr.utilisateurCreation,
    dateModification: cr.dateModification,
    utilisateurModification: cr.utilisateurModification,
  };
}

@Injectable()
export class CentreResponsabiliteService extends Scd2Service<DimCentreResponsabilite> {
  constructor(
    @InjectRepository(DimCentreResponsabilite)
    repo: Repository<DimCentreResponsabilite>,
    dataSource: DataSource,
    /**
     * `@Inject(forwardRef(...))` car StructureService est dans un
     * cycle avec ce service (cf. `scd2-pattern.md` §8). Symétrique du
     * forwardRef côté StructureService.
     */
    @Inject(forwardRef(() => StructureService))
    private readonly structureService: StructureService,
  ) {
    super(repo, 'codeCr', dataSource);
  }

  // ─── Lecture / liste ──────────────────────────────────────────────

  async findAllPaginated(query: ListCrsQueryDto): Promise<PaginatedCrsDto> {
    const qb = this.repo
      .createQueryBuilder('cr')
      .leftJoinAndSelect('cr.structure', 'structure');

    if (query.versionCouranteUniquement !== false) {
      qb.andWhere('cr.versionCourante = :true', { true: true });
    }
    if (query.codeStructure) {
      qb.andWhere('structure.codeStructure = :codeStructure', {
        codeStructure: query.codeStructure,
      });
    }
    if (query.typeCr) {
      qb.andWhere('cr.typeCr = :typeCr', { typeCr: query.typeCr });
    }
    if (query.search) {
      qb.andWhere('cr.libelle ILIKE :search', { search: `%${query.search}%` });
    }

    qb.orderBy('cr.codeCr', 'ASC')
      .addOrderBy('cr.dateDebutValidite', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [items, total] = await qb.getManyAndCount();
    return {
      items: items.map(toResponse),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findOneResponse(id: string): Promise<CrResponseDto> {
    const cr = await this.repo.findOne({
      where: { id },
      relations: { structure: true },
    });
    if (!cr) throw new NotFoundException('CR introuvable');
    return toResponse(cr);
  }

  async findCurrentByCode(codeCr: string): Promise<CrResponseDto> {
    const cr = await this.repo.findOne({
      where: { codeCr, versionCourante: true },
      relations: { structure: true },
    });
    if (!cr) {
      throw new NotFoundException(`CR ${codeCr} introuvable.`);
    }
    return toResponse(cr);
  }

  async findHistoryByCode(codeCr: string): Promise<CrResponseDto[]> {
    const rows = await this.repo.find({
      where: { codeCr },
      relations: { structure: true },
      order: { dateDebutValidite: 'ASC' },
    });
    return rows.map(toResponse);
  }

  async findByStructure(idStructure: string): Promise<CrResponseDto[]> {
    const rows = await this.repo.find({
      where: { fkStructure: idStructure, versionCourante: true },
      relations: { structure: true },
      order: { codeCr: 'ASC' },
    });
    return rows.map(toResponse);
  }

  async findByStructureCode(codeStructure: string): Promise<CrResponseDto[]> {
    const structure = await this.structureService.findCurrent(codeStructure);
    if (!structure) {
      throw new NotFoundException(
        `Structure ${codeStructure} introuvable ou non courante.`,
      );
    }
    return this.findByStructure(structure.id);
  }

  // ─── Validations ──────────────────────────────────────────────────

  /**
   * Résout la structure parente depuis le DTO (fkStructure prioritaire,
   * sinon codeStructure → id courant). Vérifie que la structure existe
   * et est en version courante. Retourne l'id à stocker en FK.
   */
  private async resolveAndAssertStructure(input: {
    fkStructure?: string;
    codeStructure?: string;
  }): Promise<string> {
    if (input.fkStructure != null) {
      const struct = await this.structureService['repo'].findOne({
        where: { id: input.fkStructure, versionCourante: true },
      });
      if (!struct) {
        throw new UnprocessableEntityException(
          `Structure parente fkStructure=${input.fkStructure} introuvable ou archivée.`,
        );
      }
      return String(struct.id);
    }
    if (input.codeStructure != null) {
      const struct = await this.structureService.findCurrent(
        input.codeStructure,
      );
      if (!struct) {
        throw new UnprocessableEntityException(
          `Structure parente codeStructure=${input.codeStructure} introuvable ou archivée.`,
        );
      }
      return String(struct.id);
    }
    throw new UnprocessableEntityException(
      'fkStructure ou codeStructure obligatoire.',
    );
  }

  // ─── Mutation ─────────────────────────────────────────────────────

  async create(dto: CreateCrDto, utilisateur: string): Promise<CrResponseDto> {
    const existing = await this.findCurrent(dto.codeCr);
    if (existing) {
      throw new ConflictException(
        `Le CR ${dto.codeCr} existe déjà (version courante).`,
      );
    }

    const fkStructure = await this.resolveAndAssertStructure(dto);

    const created = await super.createNewVersion(
      dto.codeCr,
      {
        libelle: dto.libelle,
        libelleCourt: dto.libelleCourt ?? null,
        typeCr: dto.typeCr,
        fkStructure,
      },
      utilisateur,
    );
    return this.findCurrentByCode(dto.codeCr).catch(() => toResponse(created));
  }

  /**
   * PATCH avec sémantique 4-cas (cf. fix 2.3A.1 répliqué).
   */
  async update(
    codeCr: string,
    dto: UpdateCrDto,
    utilisateur: string,
  ): Promise<CrResponseDto> {
    const current = await this.findCurrent(codeCr);
    if (!current) {
      throw new NotFoundException(`CR ${codeCr} introuvable.`);
    }

    // Résoudre la structure cible si fournie (par id ou par code).
    let resolvedFkStructure: string | undefined;
    if (dto.fkStructure !== undefined || dto.codeStructure !== undefined) {
      resolvedFkStructure = await this.resolveAndAssertStructure({
        fkStructure: dto.fkStructure,
        codeStructure: dto.codeStructure,
      });
    }

    // Détecter les changements SCD2-tracés.
    const scd2Diff: Partial<DimCentreResponsabilite> = {};
    let hasScd2Change = false;
    for (const key of SCD2_TRACKED_FIELDS_CR) {
      let dtoVal: unknown;
      if (key === 'fkStructure') {
        dtoVal = resolvedFkStructure;
      } else {
        dtoVal = (dto as Record<Scd2TrackedFieldCr, unknown>)[key];
      }
      if (dtoVal === undefined) continue;
      const currentVal = (current as unknown as Record<string, unknown>)[key];
      if (dtoVal !== currentVal) {
        hasScd2Change = true;
        (scd2Diff as Record<string, unknown>)[key] = dtoVal;
      }
    }

    const wantsEstActifChange =
      dto.estActif !== undefined && dto.estActif !== current.estActif;

    // Cas 1 : no-op.
    if (!hasScd2Change && !wantsEstActifChange) {
      return this.findCurrentByCode(codeCr);
    }

    // Cas 2 : seul estActif change → in-place.
    if (!hasScd2Change && wantsEstActifChange) {
      await this.repo.update(
        { id: current.id },
        {
          estActif: dto.estActif,
          utilisateurModification: utilisateur,
          dateModification: () => 'CURRENT_TIMESTAMP',
        },
      );
      const refreshed = await this.findCurrentByCode(codeCr);
      return { ...refreshed, modeMaj: 'in_place_est_actif' };
    }

    // Cas 3 : champ SCD2-tracé + version créée today → écrasement intra-jour.
    const today = new Date().toISOString().slice(0, 10);
    if (current.dateDebutValidite === today) {
      const updates: Record<string, unknown> = {
        ...scd2Diff,
        utilisateurModification: utilisateur,
        dateModification: () => 'CURRENT_TIMESTAMP',
      };
      if (wantsEstActifChange) {
        updates.estActif = dto.estActif;
      }
      await this.repo.update({ id: current.id }, updates);
      const refreshed = await this.findCurrentByCode(codeCr);
      return { ...refreshed, modeMaj: 'ecrasement_intra_jour' };
    }

    // Cas 4 : nouvelle version SCD2.
    const attrsForNewVersion: Partial<DimCentreResponsabilite> = {
      libelle: current.libelle,
      libelleCourt: current.libelleCourt,
      typeCr: current.typeCr,
      fkStructure: current.fkStructure,
      ...scd2Diff,
    };
    if (wantsEstActifChange) {
      attrsForNewVersion.estActif = dto.estActif;
    }
    await super.createNewVersion(codeCr, attrsForNewVersion, utilisateur);
    const refreshed = await this.findCurrentByCode(codeCr);
    return { ...refreshed, modeMaj: 'nouvelle_version' };
  }

  async desactiver(codeCr: string, utilisateur: string): Promise<void> {
    const current = await this.findCurrent(codeCr);
    if (!current) {
      throw new NotFoundException(`CR ${codeCr} introuvable.`);
    }
    await this.softClose(codeCr, utilisateur);
  }

  // ─── Hook stratégie A : relink en cascade ────────────────────────

  /**
   * Met à jour TOUS les CR (toutes versions, courantes ou non) qui
   * pointaient vers `ancienIdStructure` pour qu'ils pointent vers
   * `nouvelIdStructure`. Pas de nouvelle version SCD2 — un CR n'a
   * pas d'historique de rattachement propre (cf. `scd2-pattern.md`
   * §8). Idempotent : si aucun CR ne pointait vers l'ancien id,
   * retourne `{ count: 0 }`.
   */
  async relinkAfterStructureRevision(
    ancienIdStructure: string,
    nouvelIdStructure: string,
    utilisateur: string,
  ): Promise<{ count: number }> {
    const result = await this.repo
      .createQueryBuilder()
      .update()
      .set({
        fkStructure: nouvelIdStructure,
        utilisateurModification: utilisateur,
        dateModification: () => 'CURRENT_TIMESTAMP',
      })
      .where('fk_structure = :ancien', { ancien: ancienIdStructure })
      .execute();
    return { count: result.affected ?? 0 };
  }
}
