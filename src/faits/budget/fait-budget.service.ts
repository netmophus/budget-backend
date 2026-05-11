/**
 * FaitBudgetService — CRUD sur `fait_budget` + résolution SCD2
 * dynamique (Option B). Cf. `docs/modele-donnees.md` §4.1 et §6.3.
 *
 * **Portée Lot 3.2A** :
 *  - CRUD des 10 FK (fournies par le caller, pas résolues
 *    automatiquement)
 *  - Validation grain unique (uq_fait_budget_grain)
 *  - Refus PATCH/DELETE si la version cible n'est pas 'ouvert'
 *
 * **Portée Lot 3.2B** :
 *  - `createFromBusinessKeys` : résolution SCD2 dynamique des
 *    6 dimensions versionnées vers la version VALIDE À LA DATE
 *    MÉTIER (Option B), résolution des 3 dimensions non-SCD2,
 *    calcul automatique du taux et de `montant_fcfa`.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { Scd2Entity } from '../../common/entities/scd2.entity';
import type { Scd2Service } from '../../common/services/scd2.service';
import { CentreResponsabiliteService } from '../../referentiels/centre-responsabilite/centre-responsabilite.service';
import { CompteService } from '../../referentiels/compte/compte.service';
import { DeviseService } from '../../referentiels/devise/devise.service';
import { LigneMetierService } from '../../referentiels/ligne-metier/ligne-metier.service';
import { ProduitService } from '../../referentiels/produit/produit.service';
import { ScenarioService } from '../../referentiels/scenario/scenario.service';
import { SegmentService } from '../../referentiels/segment/segment.service';
import { StructureService } from '../../referentiels/structure/structure.service';
import { TauxChangeService } from '../../referentiels/taux-change/taux-change.service';
import type { TypeTaux } from '../../referentiels/taux-change/entities/ref-taux-change.entity';
import { TempsService } from '../../referentiels/temps/temps.service';
import { DimVersion } from '../../referentiels/version/entities/dim-version.entity';
import { VersionService } from '../../referentiels/version/version.service';
import { CreateFaitBudgetFromBusinessKeysDto } from './dto/create-fait-budget-from-business-keys.dto';
import { CreateFaitBudgetDto } from './dto/create-fait-budget.dto';
import type { ModeSaisieFaitBudget } from './entities/fait-budget.entity';
import {
  DimensionResolueDto,
  FaitBudgetFromBusinessKeysResponseDto,
  MontantFcfaSource,
  ResolutionDetailsDto,
  TauxChangeSource,
} from './dto/fait-budget-from-business-keys-response.dto';
import {
  FaitBudgetDimensionRef,
  FaitBudgetResponseDto,
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
    modeSaisie: f.modeSaisie,
    encoursMoyen: f.encoursMoyen,
    tie: f.tie,
    commentaire: f.commentaire,
    dateCreation: f.dateCreation,
    utilisateurCreation: f.utilisateurCreation,
    dateModification: f.dateModification,
    utilisateurModification: f.utilisateurModification,
    temps: f.temps
      ? {
          id: String(f.temps.id),
          date: f.temps.date,
          mois: f.temps.mois,
          annee: f.temps.annee,
        }
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
    private readonly tempsService: TempsService,
    private readonly structureService: StructureService,
    private readonly centreService: CentreResponsabiliteService,
    private readonly compteService: CompteService,
    private readonly ligneMetierService: LigneMetierService,
    private readonly produitService: ProduitService,
    private readonly segmentService: SegmentService,
    private readonly deviseService: DeviseService,
    private readonly versionService: VersionService,
    private readonly scenarioService: ScenarioService,
    private readonly tauxChangeService: TauxChangeService,
  ) {}

  // ─── Lecture

  async findAll(
    query: ListFaitBudgetQueryDto,
    crAutorises: string[] | null = null,
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

    // Lot 3.3 — filtrage périmètre (Q5).
    // crAutorises = null → admin global, pas de filtre.
    // crAutorises = []   → aucun CR autorisé, ne rien retourner.
    // crAutorises = [..] → restreindre aux CR autorisés.
    if (crAutorises !== null) {
      if (crAutorises.length === 0) {
        qb.andWhere('1 = 0'); // tautologie fausse → 0 résultat
      } else {
        qb.andWhere('f.fkCentre IN (:...crIds)', { crIds: crAutorises });
      }
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

    // 2. Résoudre le mode de saisie + recalculer le montantDevise
    //    si mode=ENCOURS_TIE (cf. §4.1 modele-donnees).
    const resolvedMode = await this.resolveModeSaisie({
      modeSaisie: dto.modeSaisie ?? 'MONTANT',
      encoursMoyen: dto.encoursMoyen,
      tie: dto.tie,
      montantDeviseFourni: dto.montantDevise,
      fkCompte: dto.fkCompte,
    });

    // 3. Vérifier le grain unique côté service (message clair). L'index
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
          montantDevise: resolvedMode.montantDevise,
          montantFcfa: dto.montantFcfa,
          tauxChangeApplique: dto.tauxChangeApplique,
          modeSaisie: resolvedMode.modeSaisie,
          encoursMoyen: resolvedMode.encoursMoyen,
          tie: resolvedMode.tie,
          commentaire: dto.commentaire ?? null,
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
          "Conflit de grain (race condition entre la vérification applicative et l'INSERT).",
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

    // 3. Mode de saisie : si l'un des 3 champs (modeSaisie, encoursMoyen,
    //    tie) est touché OU si on fournit un nouveau montantDevise sur
    //    un fait actuellement en ENCOURS_TIE, on rebascule via le
    //    helper. Sinon on reste sur l'ancien mode.
    const modeKeysTouched =
      dto.modeSaisie !== undefined || 'encoursMoyen' in dto || 'tie' in dto;
    if (modeKeysTouched) {
      const targetMode: ModeSaisieFaitBudget =
        dto.modeSaisie ?? current.modeSaisie;
      // Quand on bascule vers MONTANT, on n'hérite PAS des anciennes
      // valeurs encoursMoyen/tie : un bascule explicite vers MONTANT
      // doit nettoyer les 2 champs (sauf si l'utilisateur les a
      // explicitement fournis, ce qui sera rejeté par
      // resolveModeSaisie comme incohérent).
      const inheritFromCurrent = targetMode === 'ENCOURS_TIE';
      const resolvedMode = await this.resolveModeSaisie({
        modeSaisie: targetMode,
        encoursMoyen:
          'encoursMoyen' in dto
            ? dto.encoursMoyen
            : inheritFromCurrent
              ? (current.encoursMoyen ?? undefined)
              : undefined,
        tie:
          'tie' in dto
            ? dto.tie
            : inheritFromCurrent
              ? (current.tie ?? undefined)
              : undefined,
        montantDeviseFourni: dto.montantDevise ?? current.montantDevise,
        fkCompte: current.fkCompte,
      });
      current.modeSaisie = resolvedMode.modeSaisie;
      current.encoursMoyen = resolvedMode.encoursMoyen;
      current.tie = resolvedMode.tie;
      current.montantDevise = resolvedMode.montantDevise;
    } else if (dto.montantDevise !== undefined) {
      // Pas de bascule de mode : si l'utilisateur passe un nouveau
      // montantDevise sur un fait en ENCOURS_TIE, on refuse pour
      // forcer la cohérence (sinon le couple encours×tie/12 ne
      // correspondrait plus).
      if (current.modeSaisie === 'ENCOURS_TIE') {
        throw new BadRequestException(
          'Impossible de changer montantDevise sur un fait en mode ENCOURS_TIE ' +
            'sans repasser par modeSaisie / encoursMoyen / tie. Utiliser une bascule explicite.',
        );
      }
      current.montantDevise = dto.montantDevise;
    }

    if (dto.montantFcfa !== undefined) {
      current.montantFcfa = dto.montantFcfa;
    }
    if (dto.tauxChangeApplique !== undefined) {
      current.tauxChangeApplique = dto.tauxChangeApplique;
    }
    if (dto.commentaire !== undefined) {
      current.commentaire = dto.commentaire;
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

  // ─── Lot 3.2B — Résolution SCD2 dynamique (Option B) ──────────────

  /**
   * Crée un fait budget à partir des codes business des dimensions +
   * une date métier. Résout automatiquement :
   *  a) Toutes les FK SCD2 vers la version valide à la date métier
   *     (Option B, cf. `modele-donnees.md` §6.3) — garantit que les
   *     reportings historiques restent stables même quand une
   *     dimension est révisée plus tard.
   *  b) Les FK non-SCD2 (devise, version, scénario, temps).
   *  c) Le taux de change applicable via
   *     `TauxChangeService.findTauxApplicable` (sauf si fourni).
   *  d) `montant_fcfa = montant_devise × taux` (sauf si fourni — la
   *     cohérence est alors validée à 0.01 près).
   *
   * **Choix retenu sur `est_actif=false`** : la résolution réussit
   * (l'inactivité est un signal UI, pas un invariant historique).
   * Cohérent avec `findValidAt` qui ne filtre pas non plus.
   *
   * Point d'entrée principal pour la saisie utilisateur (Lot 3.5).
   * La saisie via FK brutes (`create`) reste disponible pour les
   * imports / scripts.
   */
  async createFromBusinessKeys(
    dto: CreateFaitBudgetFromBusinessKeysDto,
    utilisateur: string,
  ): Promise<FaitBudgetFromBusinessKeysResponseDto> {
    // a) Date métier → fk_temps
    let temps;
    try {
      temps = await this.tempsService.findByDate(dto.dateMetier);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new NotFoundException(
          `Date métier ${dto.dateMetier} introuvable dans dim_temps. ` +
            `Vérifiez le seed temps ou choisissez une date dans le calendrier.`,
        );
      }
      throw err;
    }
    const fkTemps = String(temps.id);

    // b) Résolution SCD2 (6 axes) à la date métier — Option B
    const dimensionsResolues: DimensionResolueDto[] = [];

    const resolveSCD2 = async <T extends Scd2Entity>(
      axe: string,
      codeBusiness: string,
      service: Scd2Service<T>,
    ): Promise<{ id: string; version: T }> => {
      const r = await service.resolveVersionAtDate(
        codeBusiness,
        dto.dateMetier,
      );
      if (!r) {
        throw new UnprocessableEntityException(
          `Aucune version de dim_${axe} '${codeBusiness}' valide au ${dto.dateMetier}. ` +
            `Vérifiez l'existence de la dimension ou ses dates de validité SCD2 ` +
            `(Option B, cf. modele-donnees §6.3).`,
        );
      }
      dimensionsResolues.push({
        axe,
        codeBusiness,
        fkResolu: r.id,
        dateDebutValidite: r.version.dateDebutValidite,
        dateFinValidite: r.version.dateFinValidite,
      });
      return r;
    };

    const structure = await resolveSCD2(
      'structure',
      dto.codeStructure,
      this.structureService,
    );
    const centre = await resolveSCD2(
      'centre_responsabilite',
      dto.codeCentre,
      this.centreService,
    );
    const compte = await resolveSCD2(
      'compte',
      dto.codeCompte,
      this.compteService,
    );
    const ligneMetier = await resolveSCD2(
      'ligne_metier',
      dto.codeLigneMetier,
      this.ligneMetierService,
    );
    const produit = await resolveSCD2(
      'produit',
      dto.codeProduit,
      this.produitService,
    );
    const segment = await resolveSCD2(
      'segment',
      dto.codeSegment,
      this.segmentService,
    );

    // c) Dimensions non-SCD2 : devise, version, scénario
    const devise = await this.deviseService.findByCodeIso(dto.codeDevise);
    if (!devise) {
      throw new NotFoundException(
        `Devise ${dto.codeDevise} introuvable dans dim_devise.`,
      );
    }
    // findByCode lance NotFoundException si introuvable — on laisse
    // remonter (404 cohérent).
    const version = await this.versionService.findByCode(dto.codeVersion);
    const scenario = await this.scenarioService.findByCode(dto.codeScenario);

    // d) Validations business
    if (version.statut !== 'ouvert') {
      throw new ConflictException(
        `Saisie impossible : la version ${version.codeVersion} a le statut ` +
          `'${version.statut}', seul 'ouvert' autorise la saisie. ` +
          `Le workflow soumettre/valider/geler arrive en Lot 3.3.`,
      );
    }
    if (scenario.statut === 'archive') {
      throw new ConflictException(
        `Saisie impossible : le scénario ${scenario.codeScenario} est archivé. ` +
          `Choisissez un scénario actif.`,
      );
    }
    if (
      devise.estDevisePivot &&
      dto.tauxChangeApplique !== undefined &&
      dto.tauxChangeApplique !== 1
    ) {
      throw new UnprocessableEntityException(
        `Devise pivot ${devise.codeIso} : tauxChangeApplique doit valoir 1.0 ` +
          `(reçu : ${dto.tauxChangeApplique}).`,
      );
    }

    // e) Résolution du taux de change
    let tauxChangeApplique: number;
    let tauxChangeSource: TauxChangeSource;
    let dateApplicableTaux: string | null = null;

    if (dto.tauxChangeApplique !== undefined) {
      tauxChangeApplique = dto.tauxChangeApplique;
      tauxChangeSource = 'fourni-utilisateur';
    } else if (devise.estDevisePivot) {
      tauxChangeApplique = 1;
      tauxChangeSource = 'auto-pivot-xof';
    } else {
      const typeTauxRetenu: TypeTaux =
        dto.typeTaux ?? this.defaultTypeTauxFor(version.typeVersion);
      const tauxApplicable = await this.tauxChangeService.findTauxApplicable(
        dto.codeDevise,
        dto.dateMetier,
        typeTauxRetenu,
      );
      if (!tauxApplicable) {
        throw new UnprocessableEntityException(
          `Aucun taux ${typeTauxRetenu} applicable pour ${dto.codeDevise} ` +
            `au ${dto.dateMetier}. Saisissez un taux dans ref_taux_change ` +
            `ou fournissez tauxChangeApplique explicitement.`,
        );
      }
      tauxChangeApplique = Number(tauxApplicable.tauxVersPivot);
      dateApplicableTaux = tauxApplicable.dateApplicable;
      tauxChangeSource = this.tauxSourceFor(typeTauxRetenu);
    }

    // f) Calcul / validation du montant FCFA
    const calcule =
      Math.round(dto.montantDevise * tauxChangeApplique * 10000) / 10000;
    let montantFcfa: number;
    let montantFcfaSource: MontantFcfaSource;
    if (dto.montantFcfa !== undefined) {
      const ecart = Math.abs(dto.montantFcfa - calcule);
      // Tolérance : max(1 centime, 0.01% du calculé) — cohérent avec
      // numeric(20,4) et arrondis intermédiaires.
      const tolerance = Math.max(0.01, Math.abs(calcule) * 0.0001);
      if (ecart > tolerance) {
        throw new UnprocessableEntityException(
          `Incohérence montantFcfa : reçu ${dto.montantFcfa}, attendu ≈ ` +
            `${calcule} (montantDevise=${dto.montantDevise} × taux=${tauxChangeApplique}). ` +
            `Écart ${ecart.toFixed(4)} > tolérance ${tolerance.toFixed(4)}.`,
        );
      }
      montantFcfa = dto.montantFcfa;
      montantFcfaSource = 'fourni-utilisateur';
    } else {
      montantFcfa = calcule;
      montantFcfaSource = 'calcule-automatique';
    }

    // g) Insertion via la méthode `create` (3.2A) qui couvre :
    //    - validation grain unique (uq_fait_budget_grain)
    //    - assertVersionOuverte (déjà fait au d), 2ᵉ ligne de défense)
    //    - mode_saisie + recalcul mensualisation si ENCOURS_TIE
    //    - mapping FK + retour FaitBudgetResponseDto
    //
    // NB : si mode='ENCOURS_TIE', `montantDevise` sera recalculé par
    // `resolveModeSaisie` à partir de encoursMoyen × tie / 12, et
    // `montantFcfa` ne sera donc plus aligné sur le `dto.montantDevise`
    // initial. On laisse le caller (UI Lot 3.5) responsable de cohérer
    // les 2 (typiquement : il appelle d'abord en mode ENCOURS_TIE pour
    // obtenir la valeur calculée puis recalcule montantFcfa).
    const created = await this.create(
      {
        fkTemps,
        fkCompte: compte.id,
        fkStructure: structure.id,
        fkCentre: centre.id,
        fkLigneMetier: ligneMetier.id,
        fkProduit: produit.id,
        fkSegment: segment.id,
        fkDevise: String(devise.id),
        fkVersion: String(version.id),
        fkScenario: String(scenario.id),
        montantDevise: dto.montantDevise,
        montantFcfa,
        tauxChangeApplique,
        modeSaisie: dto.modeSaisie ?? 'MONTANT',
        encoursMoyen: dto.encoursMoyen,
        tie: dto.tie,
        commentaire: dto.commentaire,
      },
      utilisateur,
    );

    // h) Réponse étendue avec les détails de résolution
    const resolutionDetails: ResolutionDetailsDto = {
      tauxChangeSource,
      dateApplicableTaux,
      montantFcfaSource,
      dimensionsResolues,
    };
    return { ...created, resolutionDetails };
  }

  /**
   * Mapping `type_version` → `type_taux` par défaut. Heuristique MVP
   * du contrôle de gestion : budget initial / atterrissage utilisent
   * un taux fixe budgétaire ; les reforecast utilisent le taux de
   * clôture du dernier mois clos. À confirmer en pratique mais bon
   * défaut pour la saisie sans paramètre `typeTaux` explicite.
   */
  private defaultTypeTauxFor(typeVersion: string): TypeTaux {
    if (typeVersion === 'budget_initial' || typeVersion === 'atterrissage') {
      return 'fixe_budgetaire';
    }
    return 'cloture';
  }

  private tauxSourceFor(typeTaux: TypeTaux): TauxChangeSource {
    switch (typeTaux) {
      case 'fixe_budgetaire':
        return 'auto-fixe-budgetaire';
      case 'cloture':
        return 'auto-cloture';
      case 'moyen_mensuel':
        return 'auto-moyen-mensuel';
    }
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

  /**
   * Mensualisation `montantDevise = encoursMoyen × tie / 12` arrondie
   * à 4 décimales (cohérent avec `numeric(20,4)`).
   *
   * Cf. `docs/modele-donnees.md` §4.1.
   */
  private mensualiserMontant(encours: number, tie: number): number {
    return Math.round((encours * tie * 10000) / 12) / 10000;
  }

  /**
   * Valide la cohérence du mode de saisie vs les champs fournis et
   * recalcule `montantDevise` si mode='ENCOURS_TIE'.
   *
   *  - mode='MONTANT' : `encoursMoyen`/`tie` doivent être absents
   *    (rejet sinon avec BadRequest). Le `montantDevise` fourni est
   *    conservé tel quel.
   *  - mode='ENCOURS_TIE' : `encoursMoyen` et `tie` doivent être
   *    présents (rejet sinon). Le compte cible doit avoir
   *    `est_porteur_interets=true` (rejet sinon avec message clair).
   *    `montantDevise` est recalculé via `mensualiserMontant` ;
   *    l'éventuel `montantDeviseFourni` est ignoré (on ne lève pas
   *    d'erreur, on aligne sur la valeur calculée).
   */
  private async resolveModeSaisie(args: {
    modeSaisie: ModeSaisieFaitBudget;
    encoursMoyen: number | undefined;
    tie: number | undefined;
    montantDeviseFourni: number;
    fkCompte: string;
  }): Promise<{
    modeSaisie: ModeSaisieFaitBudget;
    encoursMoyen: number | null;
    tie: number | null;
    montantDevise: number;
  }> {
    if (args.modeSaisie === 'MONTANT') {
      if (args.encoursMoyen !== undefined && args.encoursMoyen !== null) {
        throw new BadRequestException(
          "Mode 'MONTANT' incompatible avec encoursMoyen : retirer encoursMoyen " +
            "ou passer modeSaisie='ENCOURS_TIE'.",
        );
      }
      if (args.tie !== undefined && args.tie !== null) {
        throw new BadRequestException(
          "Mode 'MONTANT' incompatible avec tie : retirer tie " +
            "ou passer modeSaisie='ENCOURS_TIE'.",
        );
      }
      return {
        modeSaisie: 'MONTANT',
        encoursMoyen: null,
        tie: null,
        montantDevise: args.montantDeviseFourni,
      };
    }

    // mode='ENCOURS_TIE' : les 2 champs sont obligatoires.
    if (args.encoursMoyen === undefined || args.encoursMoyen === null) {
      throw new BadRequestException(
        "Mode 'ENCOURS_TIE' requiert encoursMoyen (encours moyen mensuel).",
      );
    }
    if (args.tie === undefined || args.tie === null) {
      throw new BadRequestException(
        "Mode 'ENCOURS_TIE' requiert tie (taux d'intérêt effectif annuel décimal, ex. 0.085).",
      );
    }

    // Le compte cible doit être porteur d'intérêts.
    let compte;
    try {
      compte = await this.compteService.findOneResponse(args.fkCompte);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new NotFoundException(
          `Compte ${args.fkCompte} introuvable (FK invalide).`,
        );
      }
      throw err;
    }
    if (!compte.estPorteurInterets) {
      throw new BadRequestException(
        `Mode 'ENCOURS_TIE' incompatible avec le compte ${compte.codeCompte} ` +
          `qui n'est pas porteur d'intérêts. Choisir un autre compte ou repasser en mode 'MONTANT'.`,
      );
    }

    const montantDevise = this.mensualiserMontant(args.encoursMoyen, args.tie);
    return {
      modeSaisie: 'ENCOURS_TIE',
      encoursMoyen: args.encoursMoyen,
      tie: args.tie,
      montantDevise,
    };
  }
}
