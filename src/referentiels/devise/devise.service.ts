import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';

import { CreateDeviseDto } from './dto/create-devise.dto';
import { DeviseResponseDto } from './dto/devise-response.dto';
import { ListDevisesQueryDto } from './dto/list-devises-query.dto';
import { PaginatedDevisesDto } from './dto/paginated-devises.dto';
import { UpdateDeviseDto } from './dto/update-devise.dto';
import { DimDevise } from './entities/dim-devise.entity';

/** Code Postgres pour violation d'index unique. */
const PG_UNIQUE_VIOLATION = '23505';

function trimCode(value: string): string {
  return value.trim().toUpperCase();
}

function toResponse(d: DimDevise): DeviseResponseDto {
  return {
    id: d.id,
    codeIso: trimCode(d.codeIso),
    libelle: d.libelle,
    symbole: d.symbole,
    nbDecimales: d.nbDecimales,
    estDevisePivot: d.estDevisePivot,
    estActive: d.estActive,
    dateCreation: d.dateCreation,
    utilisateurCreation: d.utilisateurCreation,
    dateModification: d.dateModification,
    utilisateurModification: d.utilisateurModification,
  };
}

interface PgError {
  code?: string;
  detail?: string;
  message?: string;
}

@Injectable()
export class DeviseService {
  constructor(
    @InjectRepository(DimDevise)
    private readonly repo: Repository<DimDevise>,
  ) {}

  async findAll(query: ListDevisesQueryDto): Promise<PaginatedDevisesDto> {
    const where: Record<string, unknown> = {};
    if (typeof query.estActive === 'boolean') {
      where.estActive = query.estActive;
    }
    if (query.codeIso) {
      where.codeIso = ILike(`%${query.codeIso}%`);
    }

    const [items, total] = await this.repo.findAndCount({
      where,
      order: { codeIso: 'ASC' },
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

  async findOne(id: string): Promise<DeviseResponseDto> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Devise introuvable');
    }
    return toResponse(row);
  }

  async findByCodeIso(codeIso: string): Promise<DeviseResponseDto | null> {
    const code = trimCode(codeIso);
    const row = await this.repo.findOne({ where: { codeIso: code } });
    return row ? toResponse(row) : null;
  }

  async findPivot(): Promise<DeviseResponseDto> {
    const row = await this.repo.findOne({ where: { estDevisePivot: true } });
    if (!row) {
      throw new InternalServerErrorException(
        'Invariant violé : aucune devise pivot configurée. Lancer `npm run seed:devises`.',
      );
    }
    return toResponse(row);
  }

  async create(
    dto: CreateDeviseDto,
    utilisateur: string,
  ): Promise<DeviseResponseDto> {
    const code = trimCode(dto.codeIso);

    // 1. Vérifier l'unicité du code ISO côté service (message clair).
    const existing = await this.repo.findOne({ where: { codeIso: code } });
    if (existing) {
      throw new ConflictException(`La devise ${code} existe déjà.`);
    }

    // 2. Si on demande pivot, vérifier qu'aucune autre n'est pivot.
    if (dto.estDevisePivot) {
      const pivot = await this.repo.findOne({
        where: { estDevisePivot: true },
      });
      if (pivot) {
        throw new ConflictException(
          `Une devise pivot existe déjà : ${trimCode(pivot.codeIso)}. Une seule devise peut être pivot.`,
        );
      }
    }

    // 3. INSERT — protégé contre les race conditions par l'index partiel
    //    et par l'unique sur code_iso (cf. migration). Si l'application
    //    laisse passer (timing rare), on rattrape l'erreur 23505 et on la
    //    présente comme un Conflict métier.
    const created = this.repo.create({
      codeIso: code,
      libelle: dto.libelle,
      symbole: dto.symbole ?? null,
      nbDecimales: dto.nbDecimales ?? 2,
      estDevisePivot: dto.estDevisePivot ?? false,
      estActive: true,
      utilisateurCreation: utilisateur,
    });

    try {
      const saved = await this.repo.save(created);
      return toResponse(saved);
    } catch (e) {
      const pgErr = e as PgError;
      if (pgErr.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException(
          `Conflit d'unicité sur la devise ${code} (race condition).`,
        );
      }
      throw e;
    }
  }

  async update(
    id: string,
    dto: UpdateDeviseDto,
    utilisateur: string,
  ): Promise<DeviseResponseDto> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Devise introuvable');
    }

    // Désactivation interdite sur la devise pivot.
    if (dto.estActive === false && row.estDevisePivot) {
      throw new ConflictException(
        'Impossible de désactiver la devise pivot. Désigner une autre pivot avant.',
      );
    }

    // Retrait du flag pivot interdit (un autre update doit poser pivot
    // ailleurs en amont — l'invariant exige toujours exactement 1 pivot).
    if (dto.estDevisePivot === false && row.estDevisePivot) {
      throw new ConflictException(
        'Impossible de retirer le statut pivot sans en désigner une autre.',
      );
    }

    // Promotion à pivot : refuser s'il y en a déjà une autre.
    if (dto.estDevisePivot === true && !row.estDevisePivot) {
      const otherPivot = await this.repo.findOne({
        where: { estDevisePivot: true },
      });
      if (otherPivot) {
        throw new ConflictException(
          `Une devise pivot existe déjà : ${trimCode(otherPivot.codeIso)}. Une seule devise peut être pivot.`,
        );
      }
    }

    // Application des changements.
    if (dto.libelle !== undefined) row.libelle = dto.libelle;
    if (dto.symbole !== undefined) row.symbole = dto.symbole;
    if (dto.nbDecimales !== undefined) row.nbDecimales = dto.nbDecimales;
    if (dto.estDevisePivot !== undefined) {
      row.estDevisePivot = dto.estDevisePivot;
    }
    if (dto.estActive !== undefined) row.estActive = dto.estActive;
    row.dateModification = new Date();
    row.utilisateurModification = utilisateur;

    try {
      const saved = await this.repo.save(row);
      return toResponse(saved);
    } catch (e) {
      const pgErr = e as PgError;
      if (pgErr.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException(
          'Conflit d\'unicité sur l\'invariant pivot (race condition).',
        );
      }
      throw e;
    }
  }

  async desactiver(
    id: string,
    utilisateur: string,
  ): Promise<DeviseResponseDto> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Devise introuvable');
    }
    if (row.estDevisePivot) {
      throw new ConflictException(
        'Impossible de désactiver la devise pivot. Désigner une autre pivot avant.',
      );
    }
    row.estActive = false;
    row.dateModification = new Date();
    row.utilisateurModification = utilisateur;
    const saved = await this.repo.save(row);
    return toResponse(saved);
  }
}
