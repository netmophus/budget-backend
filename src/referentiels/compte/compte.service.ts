/**
 * CompteService — 3ᵉ dimension SCD2 réelle (PCB UMOA Révisé).
 *
 * Hérite du socle `Scd2Service` et duplique le pattern PATCH 4-cas
 * de `StructureService` (cf. fix 2.3A.1) — règle « factoriser à 3
 * cas concrets ». La factorisation dans un `Scd2HierarchicalService`
 * est désormais MÉRITÉE (3 dimensions hiérarchiques : structure, CR,
 * compte) — TODO Lot 2.5.
 *
 * Stratégie A en **auto-référence** (cf. `scd2-pattern.md` §8) :
 * quand un compte parent reçoit une nouvelle version SCD2, les
 * comptes enfants pointant vers son ancien `id` sont automatiquement
 * repointés vers le nouvel `id` via `relinkAfterCompteRevision`.
 * Différent de 2.3B (cross-modules) : ici tout est interne au même
 * service, pas besoin de `forwardRef`.
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
import { CreateCompteDto } from './dto/create-compte.dto';
import { CompteResponseDto, ParentCompteDto } from './dto/compte-response.dto';
import { ListComptesQueryDto } from './dto/list-comptes-query.dto';
import { PaginatedComptesDto } from './dto/paginated-comptes.dto';
import { UpdateCompteDto } from './dto/update-compte.dto';
import { DimCompte } from './entities/dim-compte.entity';

const SCD2_TRACKED_FIELDS_COMPTE = [
  'libelle',
  'sousClasse',
  'fkCompteParent',
  'niveau',
  'sens',
  'codePosteBudgetaire',
  'estCompteCollectif',
  'estPorteurInterets',
] as const;
type Scd2TrackedFieldCompte = (typeof SCD2_TRACKED_FIELDS_COMPTE)[number];

function toResponse(c: DimCompte): CompteResponseDto {
  const parentCourant: ParentCompteDto | undefined = c.parent
    ? {
        id: c.parent.id,
        codeCompte: c.parent.codeCompte,
        libelle: c.parent.libelle,
      }
    : undefined;
  return {
    id: c.id,
    codeCompte: c.codeCompte,
    libelle: c.libelle,
    classe: c.classe,
    sousClasse: c.sousClasse,
    fkCompteParent: c.fkCompteParent,
    parentCourant,
    niveau: c.niveau,
    sens: c.sens,
    codePosteBudgetaire: c.codePosteBudgetaire,
    estCompteCollectif: c.estCompteCollectif,
    estPorteurInterets: c.estPorteurInterets,
    dateDebutValidite: c.dateDebutValidite,
    dateFinValidite: c.dateFinValidite,
    versionCourante: c.versionCourante,
    estActif: c.estActif,
    dateCreation: c.dateCreation,
    utilisateurCreation: c.utilisateurCreation,
    dateModification: c.dateModification,
    utilisateurModification: c.utilisateurModification,
  };
}

@Injectable()
export class CompteService extends Scd2Service<DimCompte> {
  constructor(
    @InjectRepository(DimCompte)
    repo: Repository<DimCompte>,
    dataSource: DataSource,
  ) {
    super(repo, 'codeCompte', dataSource);
  }

  // ─── Lecture / liste ──────────────────────────────────────────────

  async findAllPaginated(
    query: ListComptesQueryDto,
  ): Promise<PaginatedComptesDto> {
    const qb = this.repo.createQueryBuilder('c');

    if (query.versionCouranteUniquement !== false) {
      qb.andWhere('c.versionCourante = :true', { true: true });
    }
    if (query.classe !== undefined) {
      qb.andWhere('c.classe = :classe', { classe: query.classe });
    } else if (query.classes && query.classes.length > 0) {
      // `classes` (pluriel) : liste de classes — utilisé par le
      // sélecteur compte de la saisie budgétaire (charges + produits).
      qb.andWhere('c.classe IN (:...classes)', { classes: query.classes });
    }
    if (query.codePosteBudgetaire) {
      qb.andWhere('c.codePosteBudgetaire = :cpb', {
        cpb: query.codePosteBudgetaire,
      });
    }
    if (query.search) {
      qb.andWhere('c.libelle ILIKE :search', {
        search: `%${query.search}%`,
      });
    }
    if (typeof query.estCompteCollectif === 'boolean') {
      qb.andWhere('c.estCompteCollectif = :ecc', {
        ecc: query.estCompteCollectif,
      });
    }
    if (typeof query.estPorteurInterets === 'boolean') {
      qb.andWhere('c.estPorteurInterets = :epi', {
        epi: query.estPorteurInterets,
      });
    }

    qb.orderBy('c.codeCompte', 'ASC')
      .addOrderBy('c.dateDebutValidite', 'ASC')
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

  async findOneResponse(id: string): Promise<CompteResponseDto> {
    const row = await this.repo.findOne({
      where: { id },
      relations: { parent: true },
    });
    if (!row) throw new NotFoundException('Compte introuvable');
    return toResponse(row);
  }

  async findCurrentByCode(codeCompte: string): Promise<CompteResponseDto> {
    const row = await this.repo.findOne({
      where: { codeCompte, versionCourante: true },
      relations: { parent: true },
    });
    if (!row) {
      throw new NotFoundException(`Compte ${codeCompte} introuvable.`);
    }
    return toResponse(row);
  }

  async findHistoryByCode(codeCompte: string): Promise<CompteResponseDto[]> {
    const rows = await this.repo.find({
      where: { codeCompte },
      relations: { parent: true },
      order: { dateDebutValidite: 'ASC' },
    });
    return rows.map(toResponse);
  }

  // ─── Hiérarchie

  async findChildren(idParent: string): Promise<DimCompte[]> {
    return this.repo.find({
      where: { fkCompteParent: idParent, versionCourante: true },
      order: { codeCompte: 'ASC' },
    });
  }

  async findDescendants(idParent: string): Promise<DimCompte[]> {
    const all: DimCompte[] = [];
    let frontier = [idParent];
    while (frontier.length > 0) {
      const children = await this.repo
        .createQueryBuilder('c')
        .where('c.fkCompteParent IN (:...ids)', { ids: frontier })
        .andWhere('c.versionCourante = :true', { true: true })
        .orderBy('c.codeCompte', 'ASC')
        .getMany();
      if (children.length === 0) break;
      all.push(...children);
      frontier = children.map((c) => c.id);
    }
    return all;
  }

  async findAncestors(idCompte: string): Promise<DimCompte[]> {
    const ancestors: DimCompte[] = [];
    let currentId: string | null = idCompte;
    for (let depth = 0; depth < 100 && currentId !== null; depth++) {
      const current: DimCompte | null = await this.repo.findOne({
        where: { id: currentId },
      });
      if (!current || current.fkCompteParent === null) break;
      const parent: DimCompte | null = await this.repo.findOne({
        where: { id: current.fkCompteParent, versionCourante: true },
      });
      if (!parent) break;
      ancestors.push(parent);
      currentId = parent.id;
    }
    return ancestors;
  }

  async findRoots(): Promise<DimCompte[]> {
    return this.repo.find({
      where: { fkCompteParent: IsNull(), versionCourante: true },
      order: { codeCompte: 'ASC' },
    });
  }

  async findByClasse(classe: string): Promise<DimCompte[]> {
    return this.repo.find({
      where: { classe, versionCourante: true },
      order: { codeCompte: 'ASC' },
    });
  }

  async findByCodePosteBudgetaire(code: string): Promise<DimCompte[]> {
    return this.repo.find({
      where: { codePosteBudgetaire: code, versionCourante: true },
      order: { codeCompte: 'ASC' },
    });
  }

  async validateNoCycle(
    idCompte: string,
    nouveauParentId: string,
  ): Promise<void> {
    const target = String(nouveauParentId);
    const self = String(idCompte);
    if (target === self) {
      throw new UnprocessableEntityException(
        'Un compte ne peut pas être son propre parent.',
      );
    }
    const descendants = await this.findDescendants(idCompte);
    if (descendants.some((d) => String(d.id) === target)) {
      throw new UnprocessableEntityException(
        `Cycle hiérarchique détecté : le compte cible ${nouveauParentId} est descendant de ${idCompte}.`,
      );
    }
  }

  // ─── Validations métier

  private async assertParentExistsAndCurrent(
    parentId: string,
  ): Promise<DimCompte> {
    const parent = await this.repo.findOne({
      where: { id: parentId, versionCourante: true },
    });
    if (!parent) {
      throw new UnprocessableEntityException(
        `Compte parent ${parentId} introuvable ou archivé.`,
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

  private assertParentClasseCoherence(
    parentClasse: string,
    enfantClasse: string,
  ): void {
    if (enfantClasse !== parentClasse) {
      throw new UnprocessableEntityException(
        `Incohérence classe : enfant classe ${enfantClasse} ne peut pas avoir un parent classe ${parentClasse}.`,
      );
    }
  }

  /**
   * Résout la FK parent depuis le DTO (fkCompteParent prioritaire,
   * sinon codeCompteParent → id courant). Retourne null si aucun
   * parent fourni (compte racine).
   */
  private async resolveParentFromDto(input: {
    fkCompteParent?: string | null;
    codeCompteParent?: string;
  }): Promise<DimCompte | null> {
    if (input.fkCompteParent != null) {
      return this.assertParentExistsAndCurrent(input.fkCompteParent);
    }
    if (input.codeCompteParent != null) {
      const parent = await this.findCurrent(input.codeCompteParent);
      if (!parent) {
        throw new UnprocessableEntityException(
          `Compte parent codeCompteParent=${input.codeCompteParent} introuvable ou archivé.`,
        );
      }
      return parent;
    }
    return null;
  }

  // ─── Mutation : create / new version / update / desactiver / relink

  async create(
    dto: CreateCompteDto,
    utilisateur: string,
  ): Promise<CompteResponseDto> {
    const existing = await this.findCurrent(dto.codeCompte);
    if (existing) {
      throw new ConflictException(
        `Le compte ${dto.codeCompte} existe déjà (version courante).`,
      );
    }

    // Résoudre + valider le parent (s'il y en a un).
    const parent = await this.resolveParentFromDto(dto);
    if (parent) {
      this.assertParentNiveauCoherence(parent.niveau, dto.niveau);
      this.assertParentClasseCoherence(parent.classe, dto.classe);
    } else {
      // Racine : niveau doit être 1.
      if (dto.niveau !== 1) {
        throw new UnprocessableEntityException(
          'Un compte racine (sans parent) doit avoir niveau=1.',
        );
      }
    }

    const created = await super.createNewVersion(
      dto.codeCompte,
      {
        libelle: dto.libelle,
        classe: dto.classe,
        sousClasse: dto.sousClasse ?? null,
        fkCompteParent: parent ? String(parent.id) : null,
        niveau: dto.niveau,
        sens: dto.sens ?? null,
        codePosteBudgetaire: dto.codePosteBudgetaire ?? null,
        estCompteCollectif: dto.estCompteCollectif ?? false,
        estPorteurInterets: dto.estPorteurInterets ?? false,
      } as Partial<DimCompte>,
      utilisateur,
    );
    return this.findCurrentByCode(dto.codeCompte).catch(() =>
      toResponse(created),
    );
  }

  /**
   * Crée une nouvelle version SCD2 d'un compte avec validations
   * métier (parent existant courant, cohérence niveau/classe, cycle).
   * NE déclenche PAS le relink — c'est `update()` qui s'en charge.
   */
  async createNewVersionCompte(
    codeCompte: string,
    attrs: Partial<DimCompte>,
    utilisateur: string,
  ): Promise<DimCompte> {
    // 1. Parent existant et courant.
    if (attrs.fkCompteParent != null) {
      const parent = await this.assertParentExistsAndCurrent(
        attrs.fkCompteParent,
      );
      // 2. Cohérence niveau / classe (sur les valeurs proposées).
      if (attrs.niveau != null) {
        this.assertParentNiveauCoherence(parent.niveau, attrs.niveau);
      }
      if (attrs.classe != null) {
        this.assertParentClasseCoherence(parent.classe, attrs.classe);
      }
    }

    // 3. Cycle si on change le parent.
    const current = await this.findCurrent(codeCompte);
    if (
      current &&
      attrs.fkCompteParent != null &&
      attrs.fkCompteParent !== current.fkCompteParent
    ) {
      await this.validateNoCycle(current.id, attrs.fkCompteParent);
    }

    return super.createNewVersion(codeCompte, attrs, utilisateur);
  }

  async update(
    codeCompte: string,
    dto: UpdateCompteDto,
    utilisateur: string,
  ): Promise<CompteResponseDto> {
    const current = await this.findCurrent(codeCompte);
    if (!current) {
      throw new NotFoundException(`Compte ${codeCompte} introuvable.`);
    }

    // Résoudre la FK parent si fournie.
    let resolvedFkParent: string | undefined;
    if (
      dto.fkCompteParent !== undefined ||
      dto.codeCompteParent !== undefined
    ) {
      const parent = await this.resolveParentFromDto({
        fkCompteParent: dto.fkCompteParent,
        codeCompteParent: dto.codeCompteParent,
      });
      resolvedFkParent = parent ? String(parent.id) : null!;
    }

    // Détecter changements SCD2-tracés.
    const scd2Diff: Partial<DimCompte> = {};
    let hasScd2Change = false;
    for (const key of SCD2_TRACKED_FIELDS_COMPTE) {
      let dtoVal: unknown;
      if (key === 'fkCompteParent') {
        dtoVal = resolvedFkParent;
      } else {
        dtoVal = (dto as Record<Scd2TrackedFieldCompte, unknown>)[key];
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
      return this.findCurrentByCode(codeCompte);
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
      const refreshed = await this.findCurrentByCode(codeCompte);
      return { ...refreshed, modeMaj: 'in_place_est_actif' };
    }

    // Cas 3 : champ SCD2 + version créée today → écrasement intra-jour.
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
      await this.repo.update({ id: current.id }, updates as never);
      const refreshed = await this.findCurrentByCode(codeCompte);
      return { ...refreshed, modeMaj: 'ecrasement_intra_jour' };
    }

    // Cas 4 : nouvelle version SCD2 + relink auto-référence.
    const attrsForNewVersion: Partial<DimCompte> = {
      libelle: current.libelle,
      classe: current.classe,
      sousClasse: current.sousClasse,
      fkCompteParent: current.fkCompteParent,
      niveau: current.niveau,
      sens: current.sens,
      codePosteBudgetaire: current.codePosteBudgetaire,
      estCompteCollectif: current.estCompteCollectif,
      estPorteurInterets: current.estPorteurInterets,
      ...scd2Diff,
    };
    if (wantsEstActifChange) {
      attrsForNewVersion.estActif = dto.estActif;
    }
    const ancienId = current.id;
    const created = await this.createNewVersionCompte(
      codeCompte,
      attrsForNewVersion,
      utilisateur,
    );

    // Stratégie A auto-référence : repointer les enfants vers le
    // nouvel id du parent (pas de forwardRef nécessaire — interne au
    // service, cf. scd2-pattern.md §8).
    let comptesEnfantsRelinked = 0;
    if (ancienId !== created.id) {
      const result = await this.relinkAfterCompteRevision(
        ancienId,
        created.id,
        utilisateur,
      );
      comptesEnfantsRelinked = result.count;
    }

    const refreshed = await this.findCurrentByCode(codeCompte);
    return {
      ...refreshed,
      modeMaj: 'nouvelle_version',
      comptesEnfantsRelinked,
    };
  }

  async desactiver(codeCompte: string, utilisateur: string): Promise<void> {
    const current = await this.findCurrent(codeCompte);
    if (!current) {
      throw new NotFoundException(`Compte ${codeCompte} introuvable.`);
    }
    const children = await this.findChildren(current.id);
    if (children.length > 0) {
      throw new ConflictException(
        `Impossible de désactiver le compte ${codeCompte} : ${children.length} enfant(s) courant(s) (codes : ${children.map((c) => c.codeCompte).join(', ')}).`,
      );
    }
    await this.softClose(codeCompte, utilisateur);
  }

  /**
   * Stratégie A auto-référence : met à jour TOUS les comptes (toutes
   * versions, courantes ou non) pointant vers `ancienId` pour qu'ils
   * pointent vers `nouvelId`. Identique en logique à
   * `CrService.relinkAfterStructureRevision` (cf. 2.3B).
   */
  async relinkAfterCompteRevision(
    ancienId: string,
    nouvelId: string,
    utilisateur: string,
  ): Promise<{ count: number }> {
    const result = await this.repo
      .createQueryBuilder()
      .update()
      .set({
        fkCompteParent: nouvelId,
        utilisateurModification: utilisateur,
        dateModification: () => 'CURRENT_TIMESTAMP',
      } as never)
      .where('fk_compte_parent = :ancien', { ancien: ancienId })
      .execute();
    return { count: result.affected ?? 0 };
  }
}
