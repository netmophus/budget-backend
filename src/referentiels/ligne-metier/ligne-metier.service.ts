/**
 * LigneMetierService — dimension SCD2 hiérarchique auto-référencée,
 * jumelle structurelle de `CompteService`. Cf. `docs/modele-donnees.md`
 * §3.5.
 *
 * Stratégie A (lien vivant) en auto-référence sur
 * `fk_ligne_metier_parent` — quand un parent reçoit une nouvelle
 * version SCD2, ses enfants sont automatiquement repointés via
 * `relinkAfterLigneMetierRevision`. Pas de `forwardRef` (auto-référence
 * interne au service, pas de cycle inter-modules).
 *
 * Pattern PATCH 4-cas (no-op / in-place estActif / écrasement
 * intra-jour / nouvelle version) — cf. `scd2-pattern.md` §7. Identique
 * à `CompteService.update` à la liste des champs SCD2 tracés près.
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
import { CreateLigneMetierDto } from './dto/create-ligne-metier.dto';
import {
  LigneMetierResponseDto,
  ParentLigneMetierDto,
} from './dto/ligne-metier-response.dto';
import { ListLignesMetierQueryDto } from './dto/list-lignes-metier-query.dto';
import { PaginatedLignesMetierDto } from './dto/paginated-lignes-metier.dto';
import { UpdateLigneMetierDto } from './dto/update-ligne-metier.dto';
import { DimLigneMetier } from './entities/dim-ligne-metier.entity';

const SCD2_TRACKED_FIELDS_LIGNE_METIER = [
  'libelle',
  'fkLigneMetierParent',
  'niveau',
] as const;
type Scd2TrackedFieldLigneMetier =
  (typeof SCD2_TRACKED_FIELDS_LIGNE_METIER)[number];

function toResponse(l: DimLigneMetier): LigneMetierResponseDto {
  const parentCourant: ParentLigneMetierDto | undefined = l.parent
    ? {
        id: l.parent.id,
        codeLigneMetier: l.parent.codeLigneMetier,
        libelle: l.parent.libelle,
      }
    : undefined;
  return {
    id: l.id,
    codeLigneMetier: l.codeLigneMetier,
    libelle: l.libelle,
    fkLigneMetierParent: l.fkLigneMetierParent,
    parentCourant,
    niveau: l.niveau,
    dateDebutValidite: l.dateDebutValidite,
    dateFinValidite: l.dateFinValidite,
    versionCourante: l.versionCourante,
    estActif: l.estActif,
    dateCreation: l.dateCreation,
    utilisateurCreation: l.utilisateurCreation,
    dateModification: l.dateModification,
    utilisateurModification: l.utilisateurModification,
  };
}

@Injectable()
export class LigneMetierService extends Scd2Service<DimLigneMetier> {
  constructor(
    @InjectRepository(DimLigneMetier)
    repo: Repository<DimLigneMetier>,
    dataSource: DataSource,
  ) {
    super(repo, 'codeLigneMetier', dataSource);
  }

  // ─── Lecture / liste

  async findAllPaginated(
    query: ListLignesMetierQueryDto,
  ): Promise<PaginatedLignesMetierDto> {
    // Lot 8.10 — charge la relation parent pour que `toResponse` peuple
    // `parentCourant` (sans ce join, la colonne PARENT de la liste reste
    // vide alors que la donnée existe ; cf. findOneResponse/findCurrentByCode
    // qui chargent déjà `relations: { parent: true }`).
    const qb = this.repo
      .createQueryBuilder('l')
      .leftJoinAndSelect('l.parent', 'parent');

    if (query.versionCouranteUniquement !== false) {
      qb.andWhere('l.versionCourante = :true', { true: true });
    }
    if (query.search) {
      qb.andWhere('l.libelle ILIKE :search', {
        search: `%${query.search}%`,
      });
    }

    qb.orderBy('l.codeLigneMetier', 'ASC')
      .addOrderBy('l.dateDebutValidite', 'ASC')
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

  async findOneResponse(id: string): Promise<LigneMetierResponseDto> {
    const row = await this.repo.findOne({
      where: { id },
      relations: { parent: true },
    });
    if (!row) throw new NotFoundException('Ligne métier introuvable');
    return toResponse(row);
  }

  async findCurrentByCode(
    codeLigneMetier: string,
  ): Promise<LigneMetierResponseDto> {
    const row = await this.repo.findOne({
      where: { codeLigneMetier, versionCourante: true },
      relations: { parent: true },
    });
    if (!row) {
      throw new NotFoundException(
        `Ligne métier ${codeLigneMetier} introuvable.`,
      );
    }
    return toResponse(row);
  }

  async findHistoryByCode(
    codeLigneMetier: string,
  ): Promise<LigneMetierResponseDto[]> {
    const rows = await this.repo.find({
      where: { codeLigneMetier },
      relations: { parent: true },
      order: { dateDebutValidite: 'ASC' },
    });
    return rows.map(toResponse);
  }

  // ─── Hiérarchie

  async findChildren(idParent: string): Promise<DimLigneMetier[]> {
    return this.repo.find({
      where: { fkLigneMetierParent: idParent, versionCourante: true },
      order: { codeLigneMetier: 'ASC' },
    });
  }

  async findDescendants(idParent: string): Promise<DimLigneMetier[]> {
    const all: DimLigneMetier[] = [];
    let frontier = [idParent];
    while (frontier.length > 0) {
      const children = await this.repo
        .createQueryBuilder('l')
        .where('l.fkLigneMetierParent IN (:...ids)', { ids: frontier })
        .andWhere('l.versionCourante = :true', { true: true })
        .orderBy('l.codeLigneMetier', 'ASC')
        .getMany();
      if (children.length === 0) break;
      all.push(...children);
      frontier = children.map((c) => c.id);
    }
    return all;
  }

  async findAncestors(idLigneMetier: string): Promise<DimLigneMetier[]> {
    const ancestors: DimLigneMetier[] = [];
    let currentId: string | null = idLigneMetier;
    for (let depth = 0; depth < 100 && currentId !== null; depth++) {
      const current: DimLigneMetier | null = await this.repo.findOne({
        where: { id: currentId },
      });
      if (!current || current.fkLigneMetierParent === null) break;
      const parent: DimLigneMetier | null = await this.repo.findOne({
        where: { id: current.fkLigneMetierParent, versionCourante: true },
      });
      if (!parent) break;
      ancestors.push(parent);
      currentId = parent.id;
    }
    return ancestors;
  }

  async findRoots(): Promise<DimLigneMetier[]> {
    return this.repo.find({
      where: { fkLigneMetierParent: IsNull(), versionCourante: true },
      order: { codeLigneMetier: 'ASC' },
    });
  }

  async validateNoCycle(
    idLigneMetier: string,
    nouveauParentId: string,
  ): Promise<void> {
    const target = String(nouveauParentId);
    const self = String(idLigneMetier);
    if (target === self) {
      throw new UnprocessableEntityException(
        'Une ligne métier ne peut pas être son propre parent.',
      );
    }
    const descendants = await this.findDescendants(idLigneMetier);
    if (descendants.some((d) => String(d.id) === target)) {
      throw new UnprocessableEntityException(
        `Cycle hiérarchique détecté : la ligne métier cible ${nouveauParentId} est descendante de ${idLigneMetier}.`,
      );
    }
  }

  // ─── Validations métier

  private async assertParentExistsAndCurrent(
    parentId: string,
  ): Promise<DimLigneMetier> {
    const parent = await this.repo.findOne({
      where: { id: parentId, versionCourante: true },
    });
    if (!parent) {
      throw new UnprocessableEntityException(
        `Ligne métier parent ${parentId} introuvable ou archivée.`,
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
    fkLigneMetierParent?: string | null;
    codeLigneMetierParent?: string;
  }): Promise<DimLigneMetier | null> {
    if (input.fkLigneMetierParent != null) {
      return this.assertParentExistsAndCurrent(input.fkLigneMetierParent);
    }
    if (input.codeLigneMetierParent != null) {
      const parent = await this.findCurrent(input.codeLigneMetierParent);
      if (!parent) {
        throw new UnprocessableEntityException(
          `Ligne métier parent codeLigneMetierParent=${input.codeLigneMetierParent} introuvable ou archivée.`,
        );
      }
      return parent;
    }
    return null;
  }

  // ─── Mutation

  async create(
    dto: CreateLigneMetierDto,
    utilisateur: string,
  ): Promise<LigneMetierResponseDto> {
    const existing = await this.findCurrent(dto.codeLigneMetier);
    if (existing) {
      throw new ConflictException(
        `La ligne métier ${dto.codeLigneMetier} existe déjà (version courante).`,
      );
    }

    const parent = await this.resolveParentFromDto(dto);
    if (parent) {
      this.assertParentNiveauCoherence(parent.niveau, dto.niveau);
    } else {
      if (dto.niveau !== 1) {
        throw new UnprocessableEntityException(
          'Une ligne métier racine (sans parent) doit avoir niveau=1.',
        );
      }
    }

    const created = await super.createNewVersion(
      dto.codeLigneMetier,
      {
        libelle: dto.libelle,
        fkLigneMetierParent: parent ? String(parent.id) : null,
        niveau: dto.niveau,
      },
      utilisateur,
    );
    return this.findCurrentByCode(dto.codeLigneMetier).catch(() =>
      toResponse(created),
    );
  }

  async createNewVersionLigneMetier(
    codeLigneMetier: string,
    attrs: Partial<DimLigneMetier>,
    utilisateur: string,
  ): Promise<DimLigneMetier> {
    if (attrs.fkLigneMetierParent != null) {
      const parent = await this.assertParentExistsAndCurrent(
        attrs.fkLigneMetierParent,
      );
      if (attrs.niveau != null) {
        this.assertParentNiveauCoherence(parent.niveau, attrs.niveau);
      }
    }

    const current = await this.findCurrent(codeLigneMetier);
    if (
      current &&
      attrs.fkLigneMetierParent != null &&
      attrs.fkLigneMetierParent !== current.fkLigneMetierParent
    ) {
      await this.validateNoCycle(current.id, attrs.fkLigneMetierParent);
    }

    return super.createNewVersion(codeLigneMetier, attrs, utilisateur);
  }

  async update(
    codeLigneMetier: string,
    dto: UpdateLigneMetierDto,
    utilisateur: string,
  ): Promise<LigneMetierResponseDto> {
    const current = await this.findCurrent(codeLigneMetier);
    if (!current) {
      throw new NotFoundException(
        `Ligne métier ${codeLigneMetier} introuvable.`,
      );
    }

    let resolvedFkParent: string | undefined;
    if (
      dto.fkLigneMetierParent !== undefined ||
      dto.codeLigneMetierParent !== undefined
    ) {
      const parent = await this.resolveParentFromDto({
        fkLigneMetierParent: dto.fkLigneMetierParent,
        codeLigneMetierParent: dto.codeLigneMetierParent,
      });
      resolvedFkParent = parent ? String(parent.id) : null!;
    }

    const scd2Diff: Partial<DimLigneMetier> = {};
    let hasScd2Change = false;
    for (const key of SCD2_TRACKED_FIELDS_LIGNE_METIER) {
      let dtoVal: unknown;
      if (key === 'fkLigneMetierParent') {
        dtoVal = resolvedFkParent;
      } else {
        dtoVal = (dto as Record<Scd2TrackedFieldLigneMetier, unknown>)[key];
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
      return this.findCurrentByCode(codeLigneMetier);
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
      const refreshed = await this.findCurrentByCode(codeLigneMetier);
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
      const refreshed = await this.findCurrentByCode(codeLigneMetier);
      return { ...refreshed, modeMaj: 'ecrasement_intra_jour' };
    }

    const attrsForNewVersion: Partial<DimLigneMetier> = {
      libelle: current.libelle,
      fkLigneMetierParent: current.fkLigneMetierParent,
      niveau: current.niveau,
      ...scd2Diff,
    };
    if (wantsEstActifChange) {
      attrsForNewVersion.estActif = dto.estActif;
    }
    const ancienId = current.id;
    const created = await this.createNewVersionLigneMetier(
      codeLigneMetier,
      attrsForNewVersion,
      utilisateur,
    );

    let lignesMetierEnfantsRelinked = 0;
    if (ancienId !== created.id) {
      const result = await this.relinkAfterLigneMetierRevision(
        ancienId,
        created.id,
        utilisateur,
      );
      lignesMetierEnfantsRelinked = result.count;
    }

    const refreshed = await this.findCurrentByCode(codeLigneMetier);
    return {
      ...refreshed,
      modeMaj: 'nouvelle_version',
      lignesMetierEnfantsRelinked,
    };
  }

  async desactiver(
    codeLigneMetier: string,
    utilisateur: string,
  ): Promise<void> {
    const current = await this.findCurrent(codeLigneMetier);
    if (!current) {
      throw new NotFoundException(
        `Ligne métier ${codeLigneMetier} introuvable.`,
      );
    }
    const children = await this.findChildren(current.id);
    if (children.length > 0) {
      throw new ConflictException(
        `Impossible de désactiver la ligne métier ${codeLigneMetier} : ${children.length} enfant(s) courant(s) (codes : ${children
          .map((c) => c.codeLigneMetier)
          .join(', ')}).`,
      );
    }
    await this.softClose(codeLigneMetier, utilisateur);
  }

  /**
   * Stratégie A auto-référence : met à jour TOUTES les lignes métier
   * (toutes versions) pointant vers `ancienId` pour qu'elles pointent
   * vers `nouvelId`. Identique en logique à
   * `CompteService.relinkAfterCompteRevision`.
   */
  async relinkAfterLigneMetierRevision(
    ancienId: string,
    nouvelId: string,
    utilisateur: string,
  ): Promise<{ count: number }> {
    const result = await this.repo
      .createQueryBuilder()
      .update()
      .set({
        fkLigneMetierParent: nouvelId,
        utilisateurModification: utilisateur,
        dateModification: () => 'CURRENT_TIMESTAMP',
      })
      .where('fk_ligne_metier_parent = :ancien', { ancien: ancienId })
      .execute();
    return { count: result.affected ?? 0 };
  }
}
