/**
 * SegmentService — dimension SCD2 PLATE (sans hiérarchie).
 *
 * **Volontairement plat au MVP** — cf. `docs/modele-donnees.md` §3.7.
 * Si une hiérarchie devient nécessaire en V2 (ex.
 * `particulier_premium` / `particulier_mass_market`), ajouter
 * `fk_segment_parent` et `niveau` à l'entité, puis appliquer le
 * pattern hiérarchique de `CompteService` / `LigneMetierService` /
 * `ProduitService` (relink auto-référence stratégie A).
 *
 * Pattern PATCH 4-cas conservé (cf. `scd2-pattern.md` §7) : no-op /
 * in-place estActif / écrasement intra-jour / nouvelle version.
 * **Pas de findChildren / findRoots / validateNoCycle / relink**.
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { Scd2Service } from '../../common/services/scd2.service';
import { CreateSegmentDto } from './dto/create-segment.dto';
import { ListSegmentsQueryDto } from './dto/list-segments-query.dto';
import { PaginatedSegmentsDto } from './dto/paginated-segments.dto';
import { SegmentResponseDto } from './dto/segment-response.dto';
import { UpdateSegmentDto } from './dto/update-segment.dto';
import { CategorieSegment, DimSegment } from './entities/dim-segment.entity';

const SCD2_TRACKED_FIELDS_SEGMENT = ['libelle', 'categorie'] as const;
type Scd2TrackedFieldSegment = (typeof SCD2_TRACKED_FIELDS_SEGMENT)[number];

function toResponse(s: DimSegment): SegmentResponseDto {
  return {
    id: s.id,
    codeSegment: s.codeSegment,
    libelle: s.libelle,
    categorie: s.categorie,
    dateDebutValidite: s.dateDebutValidite,
    dateFinValidite: s.dateFinValidite,
    versionCourante: s.versionCourante,
    estActif: s.estActif,
    dateCreation: s.dateCreation,
    utilisateurCreation: s.utilisateurCreation,
    dateModification: s.dateModification,
    utilisateurModification: s.utilisateurModification,
  };
}

@Injectable()
export class SegmentService extends Scd2Service<DimSegment> {
  constructor(
    @InjectRepository(DimSegment)
    repo: Repository<DimSegment>,
    dataSource: DataSource,
  ) {
    super(repo, 'codeSegment', dataSource);
  }

  // ─── Lecture / liste

  async findAllPaginated(
    query: ListSegmentsQueryDto,
  ): Promise<PaginatedSegmentsDto> {
    const qb = this.repo.createQueryBuilder('s');

    if (query.versionCouranteUniquement !== false) {
      qb.andWhere('s.versionCourante = :true', { true: true });
    }
    if (query.categorie) {
      qb.andWhere('s.categorie = :cat', { cat: query.categorie });
    }
    if (query.search) {
      qb.andWhere('s.libelle ILIKE :search', {
        search: `%${query.search}%`,
      });
    }

    qb.orderBy('s.codeSegment', 'ASC')
      .addOrderBy('s.dateDebutValidite', 'ASC')
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

  async findOneResponse(id: string): Promise<SegmentResponseDto> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Segment introuvable');
    return toResponse(row);
  }

  async findCurrentByCode(codeSegment: string): Promise<SegmentResponseDto> {
    const row = await this.repo.findOne({
      where: { codeSegment, versionCourante: true },
    });
    if (!row) {
      throw new NotFoundException(`Segment ${codeSegment} introuvable.`);
    }
    return toResponse(row);
  }

  async findHistoryByCode(codeSegment: string): Promise<SegmentResponseDto[]> {
    const rows = await this.repo.find({
      where: { codeSegment },
      order: { dateDebutValidite: 'ASC' },
    });
    return rows.map(toResponse);
  }

  async findByCategorie(categorie: CategorieSegment): Promise<DimSegment[]> {
    return this.repo.find({
      where: { categorie, versionCourante: true },
      order: { codeSegment: 'ASC' },
    });
  }

  // ─── Mutation

  async create(
    dto: CreateSegmentDto,
    utilisateur: string,
  ): Promise<SegmentResponseDto> {
    const existing = await this.findCurrent(dto.codeSegment);
    if (existing) {
      throw new ConflictException(
        `Le segment ${dto.codeSegment} existe déjà (version courante).`,
      );
    }
    const created = await super.createNewVersion(
      dto.codeSegment,
      {
        libelle: dto.libelle,
        categorie: dto.categorie,
      },
      utilisateur,
    );
    return this.findCurrentByCode(dto.codeSegment).catch(() =>
      toResponse(created),
    );
  }

  /**
   * Wrapper sur `super.createNewVersion` — pas de validation parent
   * ni de cycle (pas d'auto-référence). Conservé pour cohérence d'API
   * avec les autres dimensions SCD2 hiérarchiques.
   */
  async createNewVersionSegment(
    codeSegment: string,
    attrs: Partial<DimSegment>,
    utilisateur: string,
  ): Promise<DimSegment> {
    return super.createNewVersion(codeSegment, attrs, utilisateur);
  }

  async update(
    codeSegment: string,
    dto: UpdateSegmentDto,
    utilisateur: string,
  ): Promise<SegmentResponseDto> {
    const current = await this.findCurrent(codeSegment);
    if (!current) {
      throw new NotFoundException(`Segment ${codeSegment} introuvable.`);
    }

    const scd2Diff: Partial<DimSegment> = {};
    let hasScd2Change = false;
    for (const key of SCD2_TRACKED_FIELDS_SEGMENT) {
      const dtoVal = (dto as Record<Scd2TrackedFieldSegment, unknown>)[key];
      if (dtoVal === undefined) continue;
      const currentVal = (current as unknown as Record<string, unknown>)[key];
      if (dtoVal !== currentVal) {
        hasScd2Change = true;
        (scd2Diff as Record<string, unknown>)[key] = dtoVal;
      }
    }

    const wantsEstActifChange =
      dto.estActif !== undefined && dto.estActif !== current.estActif;

    if (!hasScd2Change && !wantsEstActifChange) {
      return this.findCurrentByCode(codeSegment);
    }

    if (!hasScd2Change && wantsEstActifChange) {
      await this.repo.update(
        { id: current.id },
        {
          estActif: dto.estActif,
          utilisateurModification: utilisateur,
          dateModification: () => 'CURRENT_TIMESTAMP',
        },
      );
      const refreshed = await this.findCurrentByCode(codeSegment);
      return { ...refreshed, modeMaj: 'in_place_est_actif' };
    }

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
      const refreshed = await this.findCurrentByCode(codeSegment);
      return { ...refreshed, modeMaj: 'ecrasement_intra_jour' };
    }

    const attrsForNewVersion: Partial<DimSegment> = {
      libelle: current.libelle,
      categorie: current.categorie,
      ...scd2Diff,
    };
    if (wantsEstActifChange) {
      attrsForNewVersion.estActif = dto.estActif;
    }
    await this.createNewVersionSegment(
      codeSegment,
      attrsForNewVersion,
      utilisateur,
    );

    const refreshed = await this.findCurrentByCode(codeSegment);
    return { ...refreshed, modeMaj: 'nouvelle_version' };
  }

  /**
   * Soft-close — pas de check enfants car pas de hiérarchie.
   */
  async desactiver(codeSegment: string, utilisateur: string): Promise<void> {
    const current = await this.findCurrent(codeSegment);
    if (!current) {
      throw new NotFoundException(`Segment ${codeSegment} introuvable.`);
    }
    await this.softClose(codeSegment, utilisateur);
  }
}
