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
import { DataSource, Repository } from 'typeorm';

import { AuditService } from '../../audit/audit.service';
import { DimScenario } from '../scenario/entities/dim-scenario.entity';
import { CreateVersionDto } from './dto/create-version.dto';
import { ListVersionsQueryDto } from './dto/list-versions-query.dto';
import { PaginatedVersionsDto } from './dto/paginated-versions.dto';
import { UpdateVersionDto } from './dto/update-version.dto';
import { VersionResponseDto } from './dto/version-response.dto';
import { DimVersion } from './entities/dim-version.entity';

/**
 * Détail de la création — quand le hook Q9 a déclenché une
 * création automatique de scénario, on retourne aussi le code créé
 * pour que le controller le consigne dans l'audit principal.
 */
export interface CreateVersionResult {
  version: VersionResponseDto;
  scenarioAutoCreeCode: string | null;
}

export function toVersionResponse(v: DimVersion): VersionResponseDto {
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
    // Workflow Lot 3.5
    commentaireSoumission: v.commentaireSoumission ?? null,
    commentaireValidation: v.commentaireValidation ?? null,
    commentaireRejet: v.commentaireRejet ?? null,
    commentairePublication: v.commentairePublication ?? null,
    dateSoumission: v.dateSoumission ?? null,
    utilisateurSoumission: v.utilisateurSoumission ?? null,
    dateValidation: v.dateValidation ?? null,
    utilisateurValidation: v.utilisateurValidation ?? null,
    dateRejet: v.dateRejet ?? null,
    utilisateurRejet: v.utilisateurRejet ?? null,
  };
}

const toResponse = toVersionResponse;

@Injectable()
export class VersionService {
  constructor(
    @InjectRepository(DimVersion)
    private readonly repo: Repository<DimVersion>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
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

  /**
   * Création d'une version + hook Q9 (Lot 3.2) : si aucun scénario
   * n'est rattaché à `exercice_fiscal` au moment de la création,
   * on en crée un automatiquement (`MEDIAN_<exercice>`,
   * `type_scenario='central'`, `statut='actif'`). L'opération est
   * transactionnelle : si le scénario échoue (CHECK / unicité), la
   * version n'est pas créée non plus.
   *
   * Retourne `scenarioAutoCreeCode` non-null si le hook a effectivement
   * créé un scénario (utilisé par le controller pour la réponse UI).
   */
  async create(
    dto: CreateVersionDto,
    utilisateur: string,
  ): Promise<CreateVersionResult> {
    return this.dataSource.transaction(async (manager) => {
      const versionRepo = manager.getRepository(DimVersion);
      const scenarioRepo = manager.getRepository(DimScenario);

      const existing = await versionRepo.findOne({
        where: { codeVersion: dto.codeVersion },
      });
      if (existing) {
        throw new ConflictException(
          `La version ${dto.codeVersion} existe déjà.`,
        );
      }

      // 1. INSERT version
      const created = await versionRepo.save(
        versionRepo.create({
          codeVersion: dto.codeVersion,
          libelle: dto.libelle,
          typeVersion: dto.typeVersion,
          exerciceFiscal: dto.exerciceFiscal,
          statut: 'ouvert',
          commentaire: dto.commentaire ?? null,
          utilisateurCreation: utilisateur,
        }),
      );

      // 2. Hook Q9 : si aucun scénario n'est rattaché à cet exercice,
      //    créer MEDIAN_<exercice>. La requête est dans la même
      //    transaction, donc tout rollback ensemble en cas d'erreur.
      const scenariosForExercice = await scenarioRepo.count({
        where: { exerciceFiscal: dto.exerciceFiscal },
      });
      let scenarioAutoCreeCode: string | null = null;
      if (scenariosForExercice === 0) {
        const codeAuto = `MEDIAN_${dto.exerciceFiscal}`;
        // Garde-fou idempotent : si un scénario MEDIAN_<exercice>
        // existe déjà sans exercice_fiscal renseigné (héritage Lot 2.4),
        // on ne crée pas de doublon.
        const exists = await scenarioRepo.findOne({
          where: { codeScenario: codeAuto },
        });
        if (!exists) {
          await scenarioRepo.save(
            scenarioRepo.create({
              codeScenario: codeAuto,
              libelle: `Scénario médian ${dto.exerciceFiscal}`,
              typeScenario: 'central',
              statut: 'actif',
              commentaire:
                `Créé automatiquement à la création de la version ` +
                `${dto.codeVersion} (hook Q9, Lot 3.2).`,
              exerciceFiscal: dto.exerciceFiscal,
              utilisateurCreation: utilisateur,
            }),
          );
          scenarioAutoCreeCode = codeAuto;

          // 3. Audit applicatif AUTO_CREATE_SCENARIO. L'INSERT audit
          //    est dans la même transaction (rollback solidaire).
          await this.auditService.log({
            utilisateur,
            typeAction: 'AUTO_CREATE_SCENARIO',
            entiteCible: 'dim_scenario',
            idCible: codeAuto,
            statut: 'success',
            payloadApres: {
              codeScenario: codeAuto,
              exerciceFiscal: dto.exerciceFiscal,
              declencheur: {
                type: 'creation_version',
                codeVersion: dto.codeVersion,
              },
            },
            commentaire:
              `Hook Q9 : auto-création de ${codeAuto} déclenchée par la ` +
              `création de la version ${dto.codeVersion} (exercice ${dto.exerciceFiscal}).`,
          });
        }
      }

      return {
        version: toResponse(created),
        scenarioAutoCreeCode,
      };
    });
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
    if (dto.commentaire !== undefined) current.commentaire = dto.commentaire;

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
