/**
 * StructureService — première utilisation réelle de Scd2Service
 * (cf. `docs/scd2-pattern.md` et `common/services/scd2.service.ts`).
 *
 * Comportements ajoutés au-dessus du pattern SCD2 générique :
 *  - Méthodes hiérarchiques (findChildren / findDescendants /
 *    findAncestors / findRoots / validateNoCycle).
 *  - createNewVersionStructure : valide existence parent + cohérence
 *    type/niveau + absence de cycle AVANT de déléguer au socle.
 *  - update intelligent : distingue les changements SCD2-tracés
 *    (nouvelle version) du toggle `estActif` seul (mise à jour en
 *    place — pas de bruit dans l'historique).
 *  - desactiver : refus si la structure a des enfants courants
 *    (intégrité référentielle de l'arbre).
 *
 * Note de portage hiérarchique — `findDescendants` / `findAncestors`
 * sont implémentées en boucles JS itératives (1 requête par niveau)
 * plutôt qu'avec `WITH RECURSIVE` PostgreSQL : pg-mem 3.x ne supporte
 * pas les CTE récursives (limitation documentée). Pour notre arbre à
 * 5 niveaux max, l'overhead est négligeable. Si la profondeur explose
 * en V2, basculer en CTE récursive ne casse aucun appelant.
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, Repository } from 'typeorm';

import { Scd2Service } from '../../common/services/scd2.service';
import { CreateStructureDto } from './dto/create-structure.dto';
import { ListStructuresQueryDto } from './dto/list-structures-query.dto';
import { PaginatedStructuresDto } from './dto/paginated-structures.dto';
import { StructureResponseDto } from './dto/structure-response.dto';
import { UpdateStructureDto } from './dto/update-structure.dto';
import { DimStructure } from './entities/dim-structure.entity';

const SCD2_TRACKED_FIELDS = [
  'libelle',
  'libelleCourt',
  'typeStructure',
  'niveauHierarchique',
  'fkStructureParent',
  'codePays',
] as const;
type Scd2TrackedField = (typeof SCD2_TRACKED_FIELDS)[number];

function toResponse(s: DimStructure): StructureResponseDto {
  return {
    id: s.id,
    codeStructure: s.codeStructure,
    libelle: s.libelle,
    libelleCourt: s.libelleCourt,
    typeStructure: s.typeStructure,
    niveauHierarchique: s.niveauHierarchique,
    fkStructureParent: s.fkStructureParent,
    codePays: s.codePays,
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
export class StructureService extends Scd2Service<DimStructure> {
  constructor(
    @InjectRepository(DimStructure)
    repo: Repository<DimStructure>,
    dataSource: DataSource,
  ) {
    super(repo, 'codeStructure', dataSource);
  }

  // ─── Lecture / liste ──────────────────────────────────────────────

  async findAllPaginated(
    query: ListStructuresQueryDto,
  ): Promise<PaginatedStructuresDto> {
    const qb = this.repo.createQueryBuilder('s');

    if (query.versionCouranteUniquement !== false) {
      qb.andWhere('s.versionCourante = :true', { true: true });
    }
    if (query.codePays) {
      qb.andWhere('s.codePays = :codePays', { codePays: query.codePays });
    }
    if (query.typeStructure) {
      qb.andWhere('s.typeStructure = :typeStructure', {
        typeStructure: query.typeStructure,
      });
    }
    if (query.search) {
      qb.andWhere('s.libelle ILIKE :search', { search: `%${query.search}%` });
    }

    qb.orderBy('s.codeStructure', 'ASC')
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

  async findOneResponse(id: string): Promise<StructureResponseDto> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Structure introuvable');
    return toResponse(row);
  }

  async findCurrentByCode(
    codeStructure: string,
  ): Promise<StructureResponseDto> {
    const row = await this.findCurrent(codeStructure);
    if (!row) {
      throw new NotFoundException(`Structure ${codeStructure} introuvable.`);
    }
    return toResponse(row);
  }

  async findHistoryByCode(
    codeStructure: string,
  ): Promise<StructureResponseDto[]> {
    const rows = await this.findHistory(codeStructure);
    return rows.map(toResponse);
  }

  // ─── Hiérarchie ───────────────────────────────────────────────────

  async findChildren(idParent: string): Promise<DimStructure[]> {
    return this.repo.find({
      where: { fkStructureParent: idParent, versionCourante: true },
      order: { codeStructure: 'ASC' },
    });
  }

  async findDescendants(idParent: string): Promise<DimStructure[]> {
    // Boucle itérative — 1 requête par niveau. Cf. note du fichier
    // sur la non-disponibilité de WITH RECURSIVE en pg-mem.
    const all: DimStructure[] = [];
    let frontier = [idParent];
    while (frontier.length > 0) {
      const children = await this.repo
        .createQueryBuilder('s')
        .where('s.fkStructureParent IN (:...ids)', { ids: frontier })
        .andWhere('s.versionCourante = :true', { true: true })
        .orderBy('s.codeStructure', 'ASC')
        .getMany();
      if (children.length === 0) break;
      all.push(...children);
      frontier = children.map((c) => c.id);
    }
    return all;
  }

  async findAncestors(idStructure: string): Promise<DimStructure[]> {
    const ancestors: DimStructure[] = [];
    let currentId: string | null = idStructure;
    // Garde-fou : profondeur max 100 pour empêcher une boucle infinie
    // si jamais un cycle s'est glissé en base (ne devrait pas arriver
    // car validateNoCycle est appelé avant tout INSERT/UPDATE).
    for (let depth = 0; depth < 100 && currentId !== null; depth++) {
      const current: DimStructure | null = await this.repo.findOne({
        where: { id: currentId },
      });
      if (!current || current.fkStructureParent === null) break;
      const parent: DimStructure | null = await this.repo.findOne({
        where: { id: current.fkStructureParent, versionCourante: true },
      });
      if (!parent) break;
      ancestors.push(parent);
      currentId = parent.id;
    }
    return ancestors;
  }

  async findRoots(filtres?: {
    codePays?: string;
    typeStructure?: string;
  }): Promise<DimStructure[]> {
    const qb = this.repo
      .createQueryBuilder('s')
      .where('s.fkStructureParent IS NULL')
      .andWhere('s.versionCourante = :true', { true: true });
    if (filtres?.codePays) {
      qb.andWhere('s.codePays = :codePays', { codePays: filtres.codePays });
    }
    if (filtres?.typeStructure) {
      qb.andWhere('s.typeStructure = :typeStructure', {
        typeStructure: filtres.typeStructure,
      });
    }
    qb.orderBy('s.codeStructure', 'ASC');
    return qb.getMany();
  }

  async validateNoCycle(
    idStructure: string,
    nouveauParentId: string,
  ): Promise<void> {
    if (nouveauParentId === idStructure) {
      throw new UnprocessableEntityException(
        'Une structure ne peut pas être son propre parent.',
      );
    }
    const descendants = await this.findDescendants(idStructure);
    if (descendants.some((d) => d.id === nouveauParentId)) {
      throw new UnprocessableEntityException(
        `Cycle hiérarchique détecté : la structure cible ${nouveauParentId} est descendante de ${idStructure}.`,
      );
    }
  }

  // ─── Validation métier ────────────────────────────────────────────

  private async assertParentExistsAndCurrent(parentId: string): Promise<void> {
    const parent = await this.repo.findOne({
      where: { id: parentId, versionCourante: true },
    });
    if (!parent) {
      throw new UnprocessableEntityException(
        `Parent ${parentId} introuvable ou non courant.`,
      );
    }
  }

  private assertTypeNiveauCoherence(
    typeStructure: string | undefined,
    niveau: number | undefined,
    fkParent: string | null | undefined,
  ): void {
    if (typeStructure === 'entite_juridique') {
      if (niveau !== undefined && niveau !== 1) {
        throw new UnprocessableEntityException(
          'Une entité juridique doit avoir un niveau hiérarchique = 1.',
        );
      }
      if (fkParent !== null && fkParent !== undefined) {
        throw new UnprocessableEntityException(
          'Une entité juridique ne peut pas avoir de parent.',
        );
      }
    }
    if (typeStructure === 'agence') {
      if (niveau !== undefined && niveau < 2) {
        throw new UnprocessableEntityException(
          'Une agence doit avoir un niveau hiérarchique >= 2.',
        );
      }
      if (fkParent === null || fkParent === undefined) {
        throw new UnprocessableEntityException(
          'Une agence doit avoir un parent.',
        );
      }
    }
  }

  // ─── Mutation : create / new version / update / desactiver ────────

  async create(
    dto: CreateStructureDto,
    utilisateur: string,
  ): Promise<StructureResponseDto> {
    const existing = await this.findCurrent(dto.codeStructure);
    if (existing) {
      throw new ConflictException(
        `La structure ${dto.codeStructure} existe déjà (version courante).`,
      );
    }
    const created = await this.createNewVersionStructure(
      dto.codeStructure,
      {
        libelle: dto.libelle,
        libelleCourt: dto.libelleCourt ?? null,
        typeStructure: dto.typeStructure,
        niveauHierarchique: dto.niveauHierarchique,
        fkStructureParent: dto.fkStructureParent ?? null,
        codePays: dto.codePays ?? null,
      } as Partial<DimStructure>,
      utilisateur,
    );
    return toResponse(created);
  }

  async createNewVersionStructure(
    codeStructure: string,
    attrs: Partial<DimStructure>,
    utilisateur: string,
  ): Promise<DimStructure> {
    // 1. Référentiel : parent doit exister en version courante.
    if (attrs.fkStructureParent != null) {
      await this.assertParentExistsAndCurrent(attrs.fkStructureParent);
    }

    // 2. Cohérence type / niveau / parent.
    this.assertTypeNiveauCoherence(
      attrs.typeStructure,
      attrs.niveauHierarchique,
      attrs.fkStructureParent,
    );

    // 3. Cycle : si on est en update et qu'on change le parent.
    const current = await this.findCurrent(codeStructure);
    if (
      current &&
      attrs.fkStructureParent != null &&
      attrs.fkStructureParent !== current.fkStructureParent
    ) {
      await this.validateNoCycle(current.id, attrs.fkStructureParent);
    }

    // 4. Délégation au socle Scd2Service.
    return super.createNewVersion(codeStructure, attrs, utilisateur);
  }

  async update(
    codeStructure: string,
    dto: UpdateStructureDto,
    utilisateur: string,
  ): Promise<StructureResponseDto> {
    const current = await this.findCurrent(codeStructure);
    if (!current) {
      throw new NotFoundException(`Structure ${codeStructure} introuvable.`);
    }

    // Détecter les champs SCD2-tracés effectivement modifiés.
    const scd2Diff: Partial<DimStructure> = {};
    let hasScd2Change = false;
    for (const key of SCD2_TRACKED_FIELDS) {
      const dtoVal = (dto as Record<Scd2TrackedField, unknown>)[key];
      if (dtoVal === undefined) continue;
      const currentVal = (current as unknown as Record<string, unknown>)[key];
      if (dtoVal !== currentVal) {
        hasScd2Change = true;
        (scd2Diff as Record<string, unknown>)[key] = dtoVal;
      }
    }

    const wantsEstActifChange =
      dto.estActif !== undefined && dto.estActif !== current.estActif;

    // Cas 1 : aucun changement effectif → no-op.
    if (!hasScd2Change && !wantsEstActifChange) {
      return toResponse(current);
    }

    // Cas 2 : seul `estActif` change → mise à jour en place (pas de
    // nouvelle version SCD2, pas de bruit dans l'historique).
    if (!hasScd2Change && wantsEstActifChange) {
      await this.repo.update(
        { id: current.id },
        {
          estActif: dto.estActif,
          utilisateurModification: utilisateur,
          dateModification: () => 'CURRENT_TIMESTAMP',
        },
      );
      const refreshed = await this.findCurrent(codeStructure);
      return toResponse(refreshed!);
    }

    // Cas 3 : au moins un champ SCD2-tracé change → nouvelle version.
    //         Construire les attrs en partant du courant + diff dto +
    //         estActif si demandé. Le socle 2.1 (refacto 2.3A.0) accepte
    //         maintenant override de estActif via attrs.
    const attrsForNewVersion: Partial<DimStructure> = {
      libelle: current.libelle,
      libelleCourt: current.libelleCourt,
      typeStructure: current.typeStructure,
      niveauHierarchique: current.niveauHierarchique,
      fkStructureParent: current.fkStructureParent,
      codePays: current.codePays,
      ...scd2Diff,
    };
    if (wantsEstActifChange) {
      attrsForNewVersion.estActif = dto.estActif;
    }
    const created = await this.createNewVersionStructure(
      codeStructure,
      attrsForNewVersion,
      utilisateur,
    );
    return toResponse(created);
  }

  async desactiver(codeStructure: string, utilisateur: string): Promise<void> {
    const current = await this.findCurrent(codeStructure);
    if (!current) {
      throw new NotFoundException(`Structure ${codeStructure} introuvable.`);
    }
    const children = await this.findChildren(current.id);
    if (children.length > 0) {
      throw new ConflictException(
        `Impossible de désactiver la structure ${codeStructure} : ${children.length} enfant(s) courant(s) (codes : ${children.map((c) => c.codeStructure).join(', ')}).`,
      );
    }
    await this.softClose(codeStructure, utilisateur);
  }
}
