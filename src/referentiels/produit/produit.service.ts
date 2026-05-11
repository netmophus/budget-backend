/**
 * ProduitService — dimension SCD2 hiérarchique auto-référencée,
 * jumelle structurelle de `CompteService` et `LigneMetierService`.
 * Cf. `docs/modele-donnees.md` §3.6.
 *
 * SCD2_TRACKED_FIELDS : libelle, typeProduit, fkProduitParent, niveau,
 * estPorteurInterets — toute modification de l'un d'entre eux
 * déclenche le pattern PATCH 4-cas (cf. `scd2-pattern.md` §7).
 *
 * Stratégie A en auto-référence sur `fk_produit_parent` — quand un
 * parent reçoit une nouvelle version SCD2, ses enfants sont repointés
 * via `relinkAfterProduitRevision`. Pas de `forwardRef` nécessaire.
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';

import { Scd2Service } from '../../common/services/scd2.service';
import { CreateProduitDto } from './dto/create-produit.dto';
import { ListProduitsQueryDto } from './dto/list-produits-query.dto';
import { PaginatedProduitsDto } from './dto/paginated-produits.dto';
import {
  ParentProduitDto,
  ProduitResponseDto,
} from './dto/produit-response.dto';
import { UpdateProduitDto } from './dto/update-produit.dto';
import { DimProduit, TypeProduit } from './entities/dim-produit.entity';

const SCD2_TRACKED_FIELDS_PRODUIT = [
  'libelle',
  'typeProduit',
  'fkProduitParent',
  'niveau',
  'estPorteurInterets',
] as const;
type Scd2TrackedFieldProduit = (typeof SCD2_TRACKED_FIELDS_PRODUIT)[number];

function toResponse(p: DimProduit): ProduitResponseDto {
  const parentCourant: ParentProduitDto | undefined = p.parent
    ? {
        id: p.parent.id,
        codeProduit: p.parent.codeProduit,
        libelle: p.parent.libelle,
      }
    : undefined;
  return {
    id: p.id,
    codeProduit: p.codeProduit,
    libelle: p.libelle,
    typeProduit: p.typeProduit,
    fkProduitParent: p.fkProduitParent,
    parentCourant,
    niveau: p.niveau,
    estPorteurInterets: p.estPorteurInterets,
    dateDebutValidite: p.dateDebutValidite,
    dateFinValidite: p.dateFinValidite,
    versionCourante: p.versionCourante,
    estActif: p.estActif,
    dateCreation: p.dateCreation,
    utilisateurCreation: p.utilisateurCreation,
    dateModification: p.dateModification,
    utilisateurModification: p.utilisateurModification,
  };
}

@Injectable()
export class ProduitService extends Scd2Service<DimProduit> {
  constructor(
    @InjectRepository(DimProduit)
    repo: Repository<DimProduit>,
    dataSource: DataSource,
  ) {
    super(repo, 'codeProduit', dataSource);
  }

  // ─── Lecture / liste

  async findAllPaginated(
    query: ListProduitsQueryDto,
  ): Promise<PaginatedProduitsDto> {
    const qb = this.repo.createQueryBuilder('p');

    if (query.versionCouranteUniquement !== false) {
      qb.andWhere('p.versionCourante = :true', { true: true });
    }
    if (query.typeProduit) {
      qb.andWhere('p.typeProduit = :tp', { tp: query.typeProduit });
    }
    if (query.search) {
      qb.andWhere('p.libelle ILIKE :search', {
        search: `%${query.search}%`,
      });
    }
    if (typeof query.estPorteurInterets === 'boolean') {
      qb.andWhere('p.estPorteurInterets = :epi', {
        epi: query.estPorteurInterets,
      });
    }

    qb.orderBy('p.codeProduit', 'ASC')
      .addOrderBy('p.dateDebutValidite', 'ASC')
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

  async findOneResponse(id: string): Promise<ProduitResponseDto> {
    const row = await this.repo.findOne({
      where: { id },
      relations: { parent: true },
    });
    if (!row) throw new NotFoundException('Produit introuvable');
    return toResponse(row);
  }

  async findCurrentByCode(codeProduit: string): Promise<ProduitResponseDto> {
    const row = await this.repo.findOne({
      where: { codeProduit, versionCourante: true },
      relations: { parent: true },
    });
    if (!row) {
      throw new NotFoundException(`Produit ${codeProduit} introuvable.`);
    }
    return toResponse(row);
  }

  async findHistoryByCode(codeProduit: string): Promise<ProduitResponseDto[]> {
    const rows = await this.repo.find({
      where: { codeProduit },
      relations: { parent: true },
      order: { dateDebutValidite: 'ASC' },
    });
    return rows.map(toResponse);
  }

  async findByType(typeProduit: TypeProduit): Promise<DimProduit[]> {
    return this.repo.find({
      where: { typeProduit, versionCourante: true },
      order: { codeProduit: 'ASC' },
    });
  }

  // ─── Hiérarchie

  async findChildren(idParent: string): Promise<DimProduit[]> {
    return this.repo.find({
      where: { fkProduitParent: idParent, versionCourante: true },
      order: { codeProduit: 'ASC' },
    });
  }

  async findDescendants(idParent: string): Promise<DimProduit[]> {
    const all: DimProduit[] = [];
    let frontier = [idParent];
    while (frontier.length > 0) {
      const children = await this.repo
        .createQueryBuilder('p')
        .where('p.fkProduitParent IN (:...ids)', { ids: frontier })
        .andWhere('p.versionCourante = :true', { true: true })
        .orderBy('p.codeProduit', 'ASC')
        .getMany();
      if (children.length === 0) break;
      all.push(...children);
      frontier = children.map((c) => c.id);
    }
    return all;
  }

  async findAncestors(idProduit: string): Promise<DimProduit[]> {
    const ancestors: DimProduit[] = [];
    let currentId: string | null = idProduit;
    for (let depth = 0; depth < 100 && currentId !== null; depth++) {
      const current: DimProduit | null = await this.repo.findOne({
        where: { id: currentId },
      });
      if (!current || current.fkProduitParent === null) break;
      const parent: DimProduit | null = await this.repo.findOne({
        where: { id: current.fkProduitParent, versionCourante: true },
      });
      if (!parent) break;
      ancestors.push(parent);
      currentId = parent.id;
    }
    return ancestors;
  }

  async findRoots(): Promise<DimProduit[]> {
    return this.repo.find({
      where: { fkProduitParent: IsNull(), versionCourante: true },
      order: { codeProduit: 'ASC' },
    });
  }

  async validateNoCycle(
    idProduit: string,
    nouveauParentId: string,
  ): Promise<void> {
    const target = String(nouveauParentId);
    const self = String(idProduit);
    if (target === self) {
      throw new UnprocessableEntityException(
        'Un produit ne peut pas être son propre parent.',
      );
    }
    const descendants = await this.findDescendants(idProduit);
    if (descendants.some((d) => String(d.id) === target)) {
      throw new UnprocessableEntityException(
        `Cycle hiérarchique détecté : le produit cible ${nouveauParentId} est descendant de ${idProduit}.`,
      );
    }
  }

  // ─── Validations métier

  private async assertParentExistsAndCurrent(
    parentId: string,
  ): Promise<DimProduit> {
    const parent = await this.repo.findOne({
      where: { id: parentId, versionCourante: true },
    });
    if (!parent) {
      throw new UnprocessableEntityException(
        `Produit parent ${parentId} introuvable ou archivé.`,
      );
    }
    return parent;
  }

  private assertParentNiveauCoherence(
    parentNiveau: number,
    enfantNiveau: number,
  ): void {
    if (enfantNiveau !== parentNiveau + 1) {
      throw new UnprocessableEntityException(
        `Incohérence niveau hiérarchique : enfant ${enfantNiveau} doit être parent ${parentNiveau} + 1.`,
      );
    }
  }

  private async resolveParentFromDto(input: {
    fkProduitParent?: string | null;
    codeProduitParent?: string;
  }): Promise<DimProduit | null> {
    if (input.fkProduitParent != null) {
      return this.assertParentExistsAndCurrent(input.fkProduitParent);
    }
    if (input.codeProduitParent != null) {
      const parent = await this.findCurrent(input.codeProduitParent);
      if (!parent) {
        throw new UnprocessableEntityException(
          `Produit parent codeProduitParent=${input.codeProduitParent} introuvable ou archivé.`,
        );
      }
      return parent;
    }
    return null;
  }

  // ─── Mutation

  async create(
    dto: CreateProduitDto,
    utilisateur: string,
  ): Promise<ProduitResponseDto> {
    const existing = await this.findCurrent(dto.codeProduit);
    if (existing) {
      throw new ConflictException(
        `Le produit ${dto.codeProduit} existe déjà (version courante).`,
      );
    }

    const parent = await this.resolveParentFromDto(dto);
    if (parent) {
      this.assertParentNiveauCoherence(parent.niveau, dto.niveau);
    } else {
      if (dto.niveau !== 1) {
        throw new UnprocessableEntityException(
          'Un produit racine (sans parent) doit avoir niveau=1.',
        );
      }
    }

    const created = await super.createNewVersion(
      dto.codeProduit,
      {
        libelle: dto.libelle,
        typeProduit: dto.typeProduit,
        fkProduitParent: parent ? String(parent.id) : null,
        niveau: dto.niveau,
        estPorteurInterets: dto.estPorteurInterets ?? false,
      },
      utilisateur,
    );
    return this.findCurrentByCode(dto.codeProduit).catch(() =>
      toResponse(created),
    );
  }

  async createNewVersionProduit(
    codeProduit: string,
    attrs: Partial<DimProduit>,
    utilisateur: string,
  ): Promise<DimProduit> {
    if (attrs.fkProduitParent != null) {
      const parent = await this.assertParentExistsAndCurrent(
        attrs.fkProduitParent,
      );
      if (attrs.niveau != null) {
        this.assertParentNiveauCoherence(parent.niveau, attrs.niveau);
      }
    }

    const current = await this.findCurrent(codeProduit);
    if (
      current &&
      attrs.fkProduitParent != null &&
      attrs.fkProduitParent !== current.fkProduitParent
    ) {
      await this.validateNoCycle(current.id, attrs.fkProduitParent);
    }

    return super.createNewVersion(codeProduit, attrs, utilisateur);
  }

  async update(
    codeProduit: string,
    dto: UpdateProduitDto,
    utilisateur: string,
  ): Promise<ProduitResponseDto> {
    const current = await this.findCurrent(codeProduit);
    if (!current) {
      throw new NotFoundException(`Produit ${codeProduit} introuvable.`);
    }

    let resolvedFkParent: string | undefined;
    if (
      dto.fkProduitParent !== undefined ||
      dto.codeProduitParent !== undefined
    ) {
      const parent = await this.resolveParentFromDto({
        fkProduitParent: dto.fkProduitParent,
        codeProduitParent: dto.codeProduitParent,
      });
      resolvedFkParent = parent ? String(parent.id) : null!;
    }

    const scd2Diff: Partial<DimProduit> = {};
    let hasScd2Change = false;
    for (const key of SCD2_TRACKED_FIELDS_PRODUIT) {
      let dtoVal: unknown;
      if (key === 'fkProduitParent') {
        dtoVal = resolvedFkParent;
      } else {
        dtoVal = (dto as Record<Scd2TrackedFieldProduit, unknown>)[key];
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

    if (!hasScd2Change && !wantsEstActifChange) {
      return this.findCurrentByCode(codeProduit);
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
      const refreshed = await this.findCurrentByCode(codeProduit);
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
      const refreshed = await this.findCurrentByCode(codeProduit);
      return { ...refreshed, modeMaj: 'ecrasement_intra_jour' };
    }

    const attrsForNewVersion: Partial<DimProduit> = {
      libelle: current.libelle,
      typeProduit: current.typeProduit,
      fkProduitParent: current.fkProduitParent,
      niveau: current.niveau,
      estPorteurInterets: current.estPorteurInterets,
      ...scd2Diff,
    };
    if (wantsEstActifChange) {
      attrsForNewVersion.estActif = dto.estActif;
    }
    const ancienId = current.id;
    const created = await this.createNewVersionProduit(
      codeProduit,
      attrsForNewVersion,
      utilisateur,
    );

    let produitsEnfantsRelinked = 0;
    if (ancienId !== created.id) {
      const result = await this.relinkAfterProduitRevision(
        ancienId,
        created.id,
        utilisateur,
      );
      produitsEnfantsRelinked = result.count;
    }

    const refreshed = await this.findCurrentByCode(codeProduit);
    return {
      ...refreshed,
      modeMaj: 'nouvelle_version',
      produitsEnfantsRelinked,
    };
  }

  async desactiver(codeProduit: string, utilisateur: string): Promise<void> {
    const current = await this.findCurrent(codeProduit);
    if (!current) {
      throw new NotFoundException(`Produit ${codeProduit} introuvable.`);
    }
    const children = await this.findChildren(current.id);
    if (children.length > 0) {
      throw new ConflictException(
        `Impossible de désactiver le produit ${codeProduit} : ${children.length} enfant(s) courant(s) (codes : ${children
          .map((c) => c.codeProduit)
          .join(', ')}).`,
      );
    }
    await this.softClose(codeProduit, utilisateur);
  }

  async relinkAfterProduitRevision(
    ancienId: string,
    nouvelId: string,
    utilisateur: string,
  ): Promise<{ count: number }> {
    const result = await this.repo
      .createQueryBuilder()
      .update()
      .set({
        fkProduitParent: nouvelId,
        utilisateurModification: utilisateur,
        dateModification: () => 'CURRENT_TIMESTAMP',
      })
      .where('fk_produit_parent = :ancien', { ancien: ancienId })
      .execute();
    return { count: result.affected ?? 0 };
  }
}
