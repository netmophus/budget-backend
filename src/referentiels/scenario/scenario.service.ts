/**
 * ScenarioService — gestion des scénarios budgétaires.
 *
 * **Pas de SCD2**. Pas de DELETE physique : un scénario référencé
 * par `fait_budget` ne doit jamais disparaître. Seul un archivage
 * (transition unique 'actif' → 'archive') est exposé. Cf.
 * `docs/modele-donnees.md` §3.10.
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreateScenarioDto } from './dto/create-scenario.dto';
import { ListScenariosQueryDto } from './dto/list-scenarios-query.dto';
import { PaginatedScenariosDto } from './dto/paginated-scenarios.dto';
import { ScenarioResponseDto } from './dto/scenario-response.dto';
import { UpdateScenarioDto } from './dto/update-scenario.dto';
import { DimScenario } from './entities/dim-scenario.entity';

function toResponse(s: DimScenario): ScenarioResponseDto {
  return {
    id: s.id,
    codeScenario: s.codeScenario,
    libelle: s.libelle,
    typeScenario: s.typeScenario,
    statut: s.statut,
    commentaire: s.commentaire,
    exerciceFiscal: s.exerciceFiscal,
    dateCreation: s.dateCreation,
    utilisateurCreation: s.utilisateurCreation,
    dateModification: s.dateModification,
    utilisateurModification: s.utilisateurModification,
  };
}

@Injectable()
export class ScenarioService {
  constructor(
    @InjectRepository(DimScenario)
    private readonly repo: Repository<DimScenario>,
  ) {}

  async findAll(query: ListScenariosQueryDto): Promise<PaginatedScenariosDto> {
    const where: Record<string, unknown> = {};
    if (query.statut) where.statut = query.statut;
    if (query.typeScenario) where.typeScenario = query.typeScenario;
    if (query.exerciceFiscal !== undefined) {
      where.exerciceFiscal = query.exerciceFiscal;
    }

    const [items, total] = await this.repo.findAndCount({
      where,
      order: { codeScenario: 'ASC' },
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

  async findOne(id: string): Promise<ScenarioResponseDto> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Scenario introuvable');
    return toResponse(row);
  }

  async findByCode(codeScenario: string): Promise<ScenarioResponseDto> {
    const row = await this.repo.findOne({ where: { codeScenario } });
    if (!row) {
      throw new NotFoundException(`Scenario ${codeScenario} introuvable.`);
    }
    return toResponse(row);
  }

  async create(
    dto: CreateScenarioDto,
    utilisateur: string,
  ): Promise<ScenarioResponseDto> {
    const existing = await this.repo.findOne({
      where: { codeScenario: dto.codeScenario },
    });
    if (existing) {
      throw new ConflictException(
        `Le scénario ${dto.codeScenario} existe déjà.`,
      );
    }
    const created = await this.repo.save(
      this.repo.create({
        codeScenario: dto.codeScenario,
        libelle: dto.libelle,
        typeScenario: dto.typeScenario,
        statut: 'actif',
        commentaire: dto.commentaire ?? null,
        exerciceFiscal: dto.exerciceFiscal ?? null,
        utilisateurCreation: utilisateur,
      }),
    );
    return toResponse(created);
  }

  /**
   * Lookup helper utilisé par le hook Q9 (Lot 3.2) — vérifie s'il
   * existe au moins un scénario rattaché à l'exercice fiscal donné.
   * Optimisé via l'index partiel `ix_dim_scenario_exercice`.
   */
  async existsForExercice(exerciceFiscal: number): Promise<boolean> {
    const count = await this.repo.count({ where: { exerciceFiscal } });
    return count > 0;
  }

  async update(
    id: string,
    dto: UpdateScenarioDto,
    utilisateur: string,
  ): Promise<ScenarioResponseDto> {
    const current = await this.repo.findOne({ where: { id } });
    if (!current) throw new NotFoundException('Scenario introuvable');
    if (current.statut === 'archive') {
      throw new ConflictException(
        `Impossible de modifier le scénario ${current.codeScenario} : il est archivé.`,
      );
    }
    if (dto.libelle !== undefined) current.libelle = dto.libelle;
    if (dto.typeScenario !== undefined) current.typeScenario = dto.typeScenario;
    if (dto.commentaire !== undefined) current.commentaire = dto.commentaire;
    if (dto.exerciceFiscal !== undefined)
      current.exerciceFiscal = dto.exerciceFiscal;

    current.dateModification = new Date();
    current.utilisateurModification = utilisateur;
    const saved = await this.repo.save(current);
    return toResponse(saved);
  }

  /**
   * Transition unique : actif → archive. Idempotent : si déjà
   * archivé, retourne 409 (rien à faire).
   */
  async archive(id: string, utilisateur: string): Promise<ScenarioResponseDto> {
    const current = await this.repo.findOne({ where: { id } });
    if (!current) throw new NotFoundException('Scenario introuvable');
    if (current.statut === 'archive') {
      throw new ConflictException(
        `Le scénario ${current.codeScenario} est déjà archivé.`,
      );
    }
    current.statut = 'archive';
    current.dateModification = new Date();
    current.utilisateurModification = utilisateur;
    const saved = await this.repo.save(current);
    return toResponse(saved);
  }
}
