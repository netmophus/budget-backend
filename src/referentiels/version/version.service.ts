/**
 * VersionService — gestion des versions de budget.
 *
 * **Pas de SCD2** : une version est immuable une fois gelée. Le
 * workflow de validation/gel sera ajouté en Lot 3.3 via des méthodes
 * dédiées (soumettre / valider / geler) qui transitionneront le
 * statut. Au Lot 3.1, on ne peut que créer / modifier / supprimer
 * une version `'ouvert'` ; toute autre transition est bloquée par
 * `assertOuvert()` (409 Conflict).
 *
 * Cf. `docs/modele-donnees.md` §3.9.
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreateVersionDto } from './dto/create-version.dto';
import { ListVersionsQueryDto } from './dto/list-versions-query.dto';
import { PaginatedVersionsDto } from './dto/paginated-versions.dto';
import { UpdateVersionDto } from './dto/update-version.dto';
import { VersionResponseDto } from './dto/version-response.dto';
import { DimVersion } from './entities/dim-version.entity';

function toResponse(v: DimVersion): VersionResponseDto {
  return {
    id: v.id,
    codeVersion: v.codeVersion,
    libelle: v.libelle,
    typeVersion: v.typeVersion,
    exerciceFiscal: v.exerciceFiscal,
    statut: v.statut,
    dateGel: v.dateGel,
    utilisateurGel: v.utilisateurGel,
    commentaire: v.commentaire,
    dateCreation: v.dateCreation,
    utilisateurCreation: v.utilisateurCreation,
    dateModification: v.dateModification,
    utilisateurModification: v.utilisateurModification,
  };
}

@Injectable()
export class VersionService {
  constructor(
    @InjectRepository(DimVersion)
    private readonly repo: Repository<DimVersion>,
  ) {}

  async findAll(query: ListVersionsQueryDto): Promise<PaginatedVersionsDto> {
    const where: Record<string, unknown> = {};
    if (query.exerciceFiscal !== undefined) {
      where.exerciceFiscal = query.exerciceFiscal;
    }
    if (query.statut) {
      where.statut = query.statut;
    }
    if (query.typeVersion) {
      where.typeVersion = query.typeVersion;
    }

    const [items, total] = await this.repo.findAndCount({
      where,
      order: { exerciceFiscal: 'DESC', codeVersion: 'ASC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return {
      items: items.map(toResponse),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findOne(id: string): Promise<VersionResponseDto> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Version introuvable');
    return toResponse(row);
  }

  async findByCode(codeVersion: string): Promise<VersionResponseDto> {
    const row = await this.repo.findOne({ where: { codeVersion } });
    if (!row) {
      throw new NotFoundException(`Version ${codeVersion} introuvable.`);
    }
    return toResponse(row);
  }

  async create(
    dto: CreateVersionDto,
    utilisateur: string,
  ): Promise<VersionResponseDto> {
    const existing = await this.repo.findOne({
      where: { codeVersion: dto.codeVersion },
    });
    if (existing) {
      throw new ConflictException(
        `La version ${dto.codeVersion} existe déjà.`,
      );
    }
    const created = await this.repo.save(
      this.repo.create({
        codeVersion: dto.codeVersion,
        libelle: dto.libelle,
        typeVersion: dto.typeVersion,
        exerciceFiscal: dto.exerciceFiscal,
        statut: 'ouvert',
        commentaire: dto.commentaire ?? null,
        utilisateurCreation: utilisateur,
      }),
    );
    return toResponse(created);
  }

  async update(
    id: string,
    dto: UpdateVersionDto,
    utilisateur: string,
  ): Promise<VersionResponseDto> {
    const current = await this.repo.findOne({ where: { id } });
    if (!current) throw new NotFoundException('Version introuvable');
    this.assertOuvert(current, 'modifier');

    if (dto.libelle !== undefined) current.libelle = dto.libelle;
    if (dto.typeVersion !== undefined) current.typeVersion = dto.typeVersion;
    if (dto.exerciceFiscal !== undefined)
      current.exerciceFiscal = dto.exerciceFiscal;
    if (dto.commentaire !== undefined)
      current.commentaire = dto.commentaire;

    current.dateModification = new Date();
    current.utilisateurModification = utilisateur;
    const saved = await this.repo.save(current);
    return toResponse(saved);
  }

  async softDelete(id: string): Promise<boolean> {
    const current = await this.repo.findOne({ where: { id } });
    if (!current) return false;
    this.assertOuvert(current, 'supprimer');
    await this.repo.delete({ id });
    return true;
  }

  /**
   * Garde-fou central : seul le statut `'ouvert'` autorise les
   * mutations CRUD au Lot 3.1. Le workflow Lot 3.3 ouvrira soumis →
   * valide → gele.
   */
  private assertOuvert(version: DimVersion, action: string): void {
    if (version.statut !== 'ouvert') {
      throw new ConflictException(
        `Impossible de ${action} la version ${version.codeVersion} : statut '${version.statut}' (seul 'ouvert' autorise les mutations CRUD au Lot 3.1 ; le workflow soumettre/valider/geler arrive en Lot 3.3).`,
      );
    }
  }
}
