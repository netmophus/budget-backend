/**
 * Service générique des référentiels secondaires (énumérations).
 *
 * 13 services concrets héritent de cette classe en passant leur
 * entité TypeORM. Le seul comportement métier que les sous-classes
 * peuvent surcharger est `isReferenced(code)` — qui interroge la
 * dimension consommatrice (ex. dim_structure pour ref_type_structure)
 * pour empêcher la suppression d'une valeur encore utilisée.
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ILike, Repository, type FindOptionsWhere } from 'typeorm';

import {
  type BaseRefSecondaire,
  type RefSecondaireWithId,
} from './entities/base-ref-secondaire.entity';
import { CreateRefSecondaireDto } from './dto/create-ref-secondaire.dto';
import {
  ListRefSecondaireDto,
  PaginatedRefSecondaireDto,
} from './dto/list-ref-secondaire.dto';
import { UpdateRefSecondaireDto } from './dto/update-ref-secondaire.dto';

export interface ToggleActifResult<T> {
  entity: T;
  /**
   * Avertissement non-bloquant. Renvoyé quand on désactive une valeur
   * référencée par une dimension : les saisies existantes restent
   * intactes, mais la valeur n'apparaîtra plus dans les selects.
   */
  warning: string | null;
}

@Injectable()
export class BaseRefSecondaireService<T extends RefSecondaireWithId> {
  constructor(protected readonly repo: Repository<T>) {}

  /**
   * Hook surchargé par les sous-classes pour interroger la dimension
   * qui consomme cette énumération. Par défaut : aucun blocage.
   *
   * Doit retourner true si au moins une ligne dimensionnelle
   * référence ce code. La méthode est appelée :
   *  - dans `softDelete` (refus si true)
   *  - dans `toggleActif` (warning si on passe à false)
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async isReferenced(_code: string): Promise<boolean> {
    return false;
  }

  /**
   * Libellé de l'entité consommatrice — permet aux toasts d'afficher
   * un message clair ("référencé par dim_structure").
   * Surchargé par les sous-classes ; par défaut chaîne vide.
   */
  protected get consumerLabel(): string {
    return '';
  }

  // ─── Lecture

  async findAll(
    query: ListRefSecondaireDto,
  ): Promise<PaginatedRefSecondaireDto<T>> {
    const where: FindOptionsWhere<T> = {} as FindOptionsWhere<T>;
    if (typeof query.estActif === 'boolean') {
      (where as Record<string, unknown>).estActif = query.estActif;
    }
    if (typeof query.estSysteme === 'boolean') {
      (where as Record<string, unknown>).estSysteme = query.estSysteme;
    }
    if (query.search) {
      (where as Record<string, unknown>).libelle = ILike(`%${query.search}%`);
    }

    const [items, total] = await this.repo.findAndCount({
      where,
      order: { ordre: 'ASC', code: 'ASC' } as never,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return { items, total, page: query.page, limit: query.limit };
  }

  async findById(id: string): Promise<T> {
    const row = await this.repo.findOne({
      where: { id } as FindOptionsWhere<T>,
    });
    if (!row) throw new NotFoundException(`Valeur ${id} introuvable.`);
    return row;
  }

  async findByCode(code: string): Promise<T> {
    const row = await this.repo.findOne({
      where: { code } as FindOptionsWhere<T>,
    });
    if (!row) throw new NotFoundException(`Code '${code}' introuvable.`);
    return row;
  }

  // ─── Mutation

  async create(dto: CreateRefSecondaireDto, utilisateur: string): Promise<T> {
    const existing = await this.repo.findOne({
      where: { code: dto.code } as FindOptionsWhere<T>,
    });
    if (existing) {
      throw new ConflictException(`Le code '${dto.code}' existe déjà.`);
    }
    // Les valeurs créées par un admin via l'API sont toujours
    // estSysteme=false. Seul le seed initial (migration) pose
    // estSysteme=true sur les valeurs critiques.
    const row = this.repo.create({
      code: dto.code,
      libelle: dto.libelle,
      description: dto.description ?? null,
      ordre: dto.ordre ?? 0,
      estActif: true,
      estSysteme: false,
      utilisateurCreation: utilisateur,
    } as never);
    const saved = await this.repo.save(row);
    return Array.isArray(saved) ? saved[0]! : saved;
  }

  async update(
    id: string,
    dto: UpdateRefSecondaireDto,
    utilisateur: string,
  ): Promise<T> {
    const current = await this.findById(id);

    // Renommer un code n'est autorisé que sur les valeurs custom
    // (estSysteme=false), car le code applicatif s'appuie sur les
    // codes système pour le workflow (statut version, type action audit).
    if (dto.code !== undefined && dto.code !== current.code) {
      if (current.estSysteme) {
        throw new UnprocessableEntityException(
          `Impossible de renommer le code '${current.code}' (estSysteme=true). ` +
            `Pour modifier une valeur système, contactez l'éditeur.`,
        );
      }
      // Vérifier l'unicité du nouveau code
      const collision = await this.repo.findOne({
        where: { code: dto.code } as FindOptionsWhere<T>,
      });
      if (collision && collision.id !== current.id) {
        throw new ConflictException(`Le code '${dto.code}' existe déjà.`);
      }
      (current as Record<string, unknown>).code = dto.code;
    }

    if (dto.libelle !== undefined) current.libelle = dto.libelle;
    if (dto.description !== undefined) current.description = dto.description;
    if (dto.ordre !== undefined) current.ordre = dto.ordre;
    if (dto.estActif !== undefined) current.estActif = dto.estActif;

    current.dateModification = new Date();
    current.utilisateurModification = utilisateur;

    const saved = await this.repo.save(current);
    return Array.isArray(saved) ? saved[0]! : saved;
  }

  /**
   * Bascule `est_actif`. Si on passe à false sur une valeur référencée
   * par une dimension, l'opération est autorisée mais on retourne un
   * `warning` pour que l'UI affiche un message d'avertissement.
   * Les saisies historiques restent intactes (FK varchar conservée).
   */
  async toggleActif(
    id: string,
    utilisateur: string,
  ): Promise<ToggleActifResult<T>> {
    const current = await this.findById(id);
    const newValue = !current.estActif;
    current.estActif = newValue;
    current.dateModification = new Date();
    current.utilisateurModification = utilisateur;
    const saved = await this.repo.save(current);
    const entity = Array.isArray(saved) ? saved[0]! : saved;

    let warning: string | null = null;
    if (newValue === false) {
      const referenced = await this.isReferenced(entity.code);
      if (referenced) {
        const cl = this.consumerLabel
          ? ` ${this.consumerLabel}`
          : '';
        warning =
          `La valeur '${entity.code}' est utilisée par des lignes${cl}. ` +
          `Les saisies existantes restent intactes, mais la valeur ne pourra ` +
          `plus être choisie pour de nouvelles.`;
      }
    }
    return { entity, warning };
  }

  /**
   * Soft-delete avec garde-fous :
   *  - 409 si estSysteme=true (valeur applicative critique).
   *  - 409 si la valeur est référencée par une dimension.
   *  - sinon, DELETE physique de la ligne (la valeur custom n'est
   *    jamais référencée historiquement, donc pas besoin de
   *    soft-close type SCD).
   */
  async softDelete(id: string, _utilisateur: string): Promise<void> {
    void _utilisateur;
    const current = await this.findById(id);
    if (current.estSysteme) {
      throw new ConflictException(
        `La valeur système '${current.code}' ne peut pas être supprimée.`,
      );
    }
    const referenced = await this.isReferenced(current.code);
    if (referenced) {
      const cl = this.consumerLabel ? ` ${this.consumerLabel}` : '';
      throw new ConflictException(
        `La valeur '${current.code}' est référencée${cl} et ne peut pas ` +
          `être supprimée. Désactivez-la (toggle-actif) pour la masquer ` +
          `des futurs selects.`,
      );
    }
    await this.repo.delete(id as never);
  }
}
