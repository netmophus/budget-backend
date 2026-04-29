/**
 * FaitBudgetService — CRUD basique sur la table de faits
 * `fait_budget`. Cf. `docs/modele-donnees.md` §4.1.
 *
 * **Portée Lot 3.2A** :
 *  - CRUD des 10 FK (fournies par le caller, pas résolues
 *    automatiquement)
 *  - Validation grain unique (uq_fait_budget_grain)
 *  - Refus PATCH/DELETE si la version cible n'est pas 'ouvert'
 *  - PAS de résolution SCD2 dynamique (Option B §6.3) → Lot 3.2B
 *  - PAS de calcul automatique `montant_fcfa = montant_devise ×
 *    taux_change_applique` → Lot 3.2B
 *  - PAS d'agrégation/synthèse → Lot 5
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DimVersion } from '../../referentiels/version/entities/dim-version.entity';
import { CreateFaitBudgetDto } from './dto/create-fait-budget.dto';
import {
  FaitBudgetDimensionRef,
  FaitBudgetResponseDto,
  FaitBudgetTempsRef,
} from './dto/fait-budget-response.dto';
import { ListFaitBudgetQueryDto } from './dto/list-fait-budget-query.dto';
import { PaginatedFaitBudgetDto } from './dto/paginated-fait-budget.dto';
import { UpdateFaitBudgetDto } from './dto/update-fait-budget.dto';
import { FaitBudget } from './entities/fait-budget.entity';

const FK_FIELDS_INTERDITES_PATCH = [
  'fkTemps',
  'fkCompte',
  'fkStructure',
  'fkCentre',
  'fkLigneMetier',
  'fkProduit',
  'fkSegment',
  'fkDevise',
  'fkVersion',
  'fkScenario',
] as const;

interface DimRefSource {
  id: string;
  code?: string;
  libelle?: string;
}

function buildDimRef(
  source: DimRefSource | undefined,
  codeField: keyof DimRefSource = 'code',
): FaitBudgetDimensionRef | undefined {
  if (!source) return undefined;
  return {
    id: String(source.id),
    code: String(source[codeField] ?? ''),
    libelle: String(source.libelle ?? ''),
  };
}

function toResponse(f: FaitBudget): FaitBudgetResponseDto {
  return {
    id: f.id,
    fkTemps: String(f.fkTemps),
    fkCompte: String(f.fkCompte),
    fkStructure: String(f.fkStructure),
    fkCentre: String(f.fkCentre),
    fkLigneMetier: String(f.fkLigneMetier),
    fkProduit: String(f.fkProduit),
    fkSegment: String(f.fkSegment),
    fkDevise: String(f.fkDevise),
    fkVersion: String(f.fkVersion),
    fkScenario: String(f.fkScenario),
    montantDevise: f.montantDevise,
    montantFcfa: f.montantFcfa,
    tauxChangeApplique: f.tauxChangeApplique,
    dateCreation: f.dateCreation,
    utilisateurCreation: f.utilisateurCreation,
    dateModification: f.dateModification,
    utilisateurModification: f.utilisateurModification,
    temps: f.temps
      ? ({
          id: String(f.temps.id),
          date: f.temps.date,
          mois: f.temps.mois,
          annee: f.temps.annee,
        } as FaitBudgetTempsRef)
      : undefined,
    compte: buildDimRef({
      id: f.compte?.id ?? '',
      code: f.compte?.codeCompte,
      libelle: f.compte?.libelle,
    }),
    structure: buildDimRef({
      id: f.structure?.id ?? '',
      code: f.structure?.codeStructure,
      libelle: f.structure?.libelle,
    }),
    centre: buildDimRef({
      id: f.centre?.id ?? '',
      code: f.centre?.codeCr,
      libelle: f.centre?.libelle,
    }),
    ligneMetier: buildDimRef({
      id: f.ligneMetier?.id ?? '',
      code: f.ligneMetier?.codeLigneMetier,
      libelle: f.ligneMetier?.libelle,
    }),
    produit: buildDimRef({
      id: f.produit?.id ?? '',
      code: f.produit?.codeProduit,
      libelle: f.produit?.libelle,
    }),
    segment: buildDimRef({
      id: f.segment?.id ?? '',
      code: f.segment?.codeSegment,
      libelle: f.segment?.libelle,
    }),
    devise: buildDimRef({
      id: f.devise?.id ?? '',
      code: f.devise?.codeIso,
      libelle: f.devise?.libelle,
    }),
    version: buildDimRef({
      id: f.version?.id ?? '',
      code: f.version?.codeVersion,
      libelle: f.version?.libelle,
    }),
    scenario: buildDimRef({
      id: f.scenario?.id ?? '',
      code: f.scenario?.codeScenario,
      libelle: f.scenario?.libelle,
    }),
  };
}

@Injectable()
export class FaitBudgetService {
  constructor(
    @InjectRepository(FaitBudget)
    private readonly repo: Repository<FaitBudget>,
    @InjectRepository(DimVersion)
    private readonly versionRepo: Repository<DimVersion>,
  ) {}

  // ─── Lecture

  async findAll(
    query: ListFaitBudgetQueryDto,
  ): Promise<PaginatedFaitBudgetDto> {
    const qb = this.repo
      .createQueryBuilder('f')
      .leftJoinAndSelect('f.temps', 'tps')
      .leftJoinAndSelect('f.compte', 'cpt')
      .leftJoinAndSelect('f.structure', 'str')
      .leftJoinAndSelect('f.centre', 'ctr')
      .leftJoinAndSelect('f.ligneMetier', 'lm')
      .leftJoinAndSelect('f.produit', 'prd')
      .leftJoinAndSelect('f.segment', 'sgm')
      .leftJoinAndSelect('f.devise', 'dvs')
      .leftJoinAndSelect('f.version', 'vrs')
      .leftJoinAndSelect('f.scenario', 'scn');

    // Filtres par codes business : on s'appuie sur les LEFT JOIN
    // déjà posés (vrs, scn) pour ajouter la contrainte sur le code.
    if (query.codeVersion) {
      qb.andWhere('vrs.codeVersion = :codeVer', {
        codeVer: query.codeVersion,
      });
    }
    if (query.codeScenario) {
      qb.andWhere('scn.codeScenario = :codeScn', {
        codeScn: query.codeScenario,
      });
    }

    if (query.fkVersion) {
      qb.andWhere('f.fkVersion = :fkVersion', { fkVersion: query.fkVersion });
    }
    if (query.fkScenario) {
      qb.andWhere('f.fkScenario = :fkScenario', {
        fkScenario: query.fkScenario,
      });
    }
    if (query.fkTemps) {
      qb.andWhere('f.fkTemps = :fkTemps', { fkTemps: query.fkTemps });
    }
    if (query.fkCentre) {
      qb.andWhere('f.fkCentre = :fkCentre', { fkCentre: query.fkCentre });
    }
    if (query.fkCompte) {
      qb.andWhere('f.fkCompte = :fkCompte', { fkCompte: query.fkCompte });
    }

    if (query.annee !== undefined) {
      qb.andWhere('tps.annee = :annee', { annee: query.annee });
    }
    if (query.mois !== undefined) {
      qb.andWhere('tps.mois = :mois', { mois: query.mois });
    }

    qb.orderBy('tps.date', 'ASC')
      .addOrderBy('f.id', 'ASC')
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

  async findById(id: string): Promise<FaitBudgetResponseDto> {
    const row = await this.repo.findOne({
      where: { id },
      relations: {
        temps: true,
        compte: true,
        structure: true,
        centre: true,
        ligneMetier: true,
        produit: true,
        segment: true,
        devise: true,
        version: true,
        scenario: true,
      },
    });
    if (!row) throw new NotFoundException('Fait budget introuvable');
    return toResponse(row);
  }

  /**
   * Cherche une ligne par son 10-uplet de FK (grain unique).
   * Retourne null si absente — la route GET /par-grain transformera
   * ça en 404 si nécessaire.
   */
  async findByGrain(grain: {
    fkTemps: string;
    fkCompte: string;
    fkStructure: string;
    fkCentre: string;
    fkLigneMetier: string;
    fkProduit: string;
    fkSegment: string;
    fkDevise: string;
    fkVersion: string;
    fkScenario: string;
  }): Promise<FaitBudgetResponseDto | null> {
    const row = await this.repo.findOne({
      where: grain,
      relations: {
        temps: true,
        compte: true,
        structure: true,
        centre: true,
        ligneMetier: true,
        produit: true,
        segment: true,
        devise: true,
        version: true,
        scenario: true,
      },
    });
    return row ? toResponse(row) : null;
  }

  // ─── Mutation

  async create(
    dto: CreateFaitBudgetDto,
    utilisateur: string,
  ): Promise<FaitBudgetResponseDto> {
    // 1. Vérifier que la version cible est 'ouvert' (un fait ne peut
    //    être créé que dans une version ouverte).
    await this.assertVersionOuverte(dto.fkVersion);

    // 2. Vérifier le grain unique côté service (message clair). L'index
    //    UNIQUE composite reste 2ᵉ ligne de défense.
    const existing = await this.repo.findOne({
      where: {
        fkTemps: dto.fkTemps,
        fkCompte: dto.fkCompte,
        fkStructure: dto.fkStructure,
        fkCentre: dto.fkCentre,
        fkLigneMetier: dto.fkLigneMetier,
        fkProduit: dto.fkProduit,
        fkSegment: dto.fkSegment,
        fkDevise: dto.fkDevise,
        fkVersion: dto.fkVersion,
        fkScenario: dto.fkScenario,
      },
    });
    if (existing) {
      throw new ConflictException(
        'Un fait budget existe déjà pour ce grain (10-uplet de FK). ' +
          'Utiliser PATCH pour modifier les mesures, ou DELETE puis POST pour changer la structure.',
      );
    }

    try {
      const created = await this.repo.save(
        this.repo.create({
          fkTemps: dto.fkTemps,
          fkCompte: dto.fkCompte,
          fkStructure: dto.fkStructure,
          fkCentre: dto.fkCentre,
          fkLigneMetier: dto.fkLigneMetier,
          fkProduit: dto.fkProduit,
          fkSegment: dto.fkSegment,
          fkDevise: dto.fkDevise,
          fkVersion: dto.fkVersion,
          fkScenario: dto.fkScenario,
          montantDevise: dto.montantDevise,
          montantFcfa: dto.montantFcfa,
          tauxChangeApplique: dto.tauxChangeApplique,
          utilisateurCreation: utilisateur,
        }),
      );
      return this.findById(created.id);
    } catch (err) {
      // 23503 = FK violation (dimension absente)
      const pgErr = err as { code?: string; message?: string };
      if (pgErr.code === '23503') {
        throw new NotFoundException(
          `Une des FK fournies pointe vers une ligne inexistante : ${pgErr.message ?? 'FK violation'}.`,
        );
      }
      // 23505 = unique violation (race condition après le findOne)
      if (pgErr.code === '23505') {
        throw new ConflictException(
          'Conflit de grain (race condition entre la vérification applicative et l\'INSERT).',
        );
      }
      throw err;
    }
  }

  async update(
    id: string,
    dto: UpdateFaitBudgetDto & Record<string, unknown>,
    utilisateur: string,
  ): Promise<FaitBudgetResponseDto> {
    // 1. Refus si une FK est dans le payload (un fait modifié
    //    structurellement = supprimé + recréé).
    for (const fkField of FK_FIELDS_INTERDITES_PATCH) {
      if (fkField in dto) {
        throw new UnprocessableEntityException(
          `Les FK ne sont pas modifiables après création (un fait modifié = supprimé + recréé). ` +
            `Champ refusé : ${fkField}.`,
        );
      }
    }

    const current = await this.repo.findOne({ where: { id } });
    if (!current) throw new NotFoundException('Fait budget introuvable');

    // 2. Refus si la version est figée (statut != 'ouvert').
    await this.assertVersionOuverte(current.fkVersion);

    // 3. Modifier les mesures.
    if (dto.montantDevise !== undefined) {
      current.montantDevise = dto.montantDevise;
    }
    if (dto.montantFcfa !== undefined) {
      current.montantFcfa = dto.montantFcfa;
    }
    if (dto.tauxChangeApplique !== undefined) {
      current.tauxChangeApplique = dto.tauxChangeApplique;
    }
    current.dateModification = new Date();
    current.utilisateurModification = utilisateur;
    await this.repo.save(current);
    return this.findById(id);
  }

  async remove(id: string): Promise<boolean> {
    const current = await this.repo.findOne({ where: { id } });
    if (!current) return false;

    // Refus si la version est figée.
    await this.assertVersionOuverte(current.fkVersion);

    const result = await this.repo.delete({ id });
    return (result.affected ?? 0) > 0;
  }

  /**
   * Garde-fou intégrité : un fait ne peut être créé / modifié /
   * supprimé que si sa version cible est `'ouvert'`. Le workflow
   * de transition (soumettre / valider / geler) arrive en Lot 3.3 ;
   * d'ici là, seul le SQL direct peut faire passer une version en
   * `'soumis'` / `'valide'` / `'gele'`. Cette garde protège
   * l'intégrité même contre ce cas.
   */
  private async assertVersionOuverte(fkVersion: string): Promise<void> {
    const v = await this.versionRepo.findOne({
      where: { id: fkVersion },
    });
    if (!v) {
      throw new NotFoundException(
        `Version ${fkVersion} introuvable (FK invalide).`,
      );
    }
    if (v.statut !== 'ouvert') {
      throw new ConflictException(
        `Impossible d'écrire dans la version ${v.codeVersion} : statut '${v.statut}'. ` +
          `Seul 'ouvert' autorise les mutations sur fait_budget. Le workflow de réouverture arrive en Lot 3.3.`,
      );
    }
  }
}
