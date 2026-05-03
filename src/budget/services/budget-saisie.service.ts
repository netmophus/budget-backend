/**
 * BudgetSaisieService — orchestration des saisies budgétaires de
 * haut niveau (Lot 3.3).
 *
 * Encapsule les **règles métier** complémentaires aux validations
 * SQL/CHECK de `fait_budget` :
 *
 *  1. Le compte cible doit être une **feuille** (`est_compte_collectif=
 *     false`). Pas de saisie sur agrégat.
 *  2. `fk_temps` doit pointer vers le **1er du mois** (maille mensuelle
 *     stricte du modèle).
 *  3. La version cible doit être en statut `'ouvert'` (BROUILLON UI).
 *     Délégué à `FaitBudgetService.assertVersionOuverte` via `create()`.
 *  4. Le CR cible doit être dans le **périmètre RBAC** du user
 *     (Q5 — délégué à `PerimetreService`).
 *  5. Mode `ENCOURS_TIE` requiert un compte porteur d'intérêts —
 *     déjà fait par `FaitBudgetService.resolveModeSaisie`.
 *
 * Expose aussi 2 endpoints de haut niveau :
 *  - `getGrilleSaisie(query, user)` : matrice (compte feuille × 12 mois)
 *  - `saveGrilleSaisie(dto, user)` : saisie en lot transactionnelle
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { AuditService } from '../../audit/audit.service';
import { DimCompte } from '../../referentiels/compte/entities/dim-compte.entity';
import { DimTemps } from '../../referentiels/temps/entities/dim-temps.entity';
import { DimCentreResponsabilite } from '../../referentiels/centre-responsabilite/entities/dim-centre-responsabilite.entity';
import { DimScenario } from '../../referentiels/scenario/entities/dim-scenario.entity';
import { DimVersion } from '../../referentiels/version/entities/dim-version.entity';
import { FaitBudget } from '../../faits/budget/entities/fait-budget.entity';
import type { ModeSaisieFaitBudget } from '../../faits/budget/entities/fait-budget.entity';
import { PerimetreService } from './perimetre.service';
import {
  CelluleGrilleDto,
  GrilleSaisieReponseDto,
  LigneGrilleDto,
  PostGrilleSaisieDto,
  PostGrilleSaisieReponseDto,
} from '../dto/grille-saisie.dto';

@Injectable()
export class BudgetSaisieService {
  constructor(
    @InjectRepository(FaitBudget)
    private readonly faitRepo: Repository<FaitBudget>,
    @InjectRepository(DimCompte)
    private readonly compteRepo: Repository<DimCompte>,
    @InjectRepository(DimTemps)
    private readonly tempsRepo: Repository<DimTemps>,
    @InjectRepository(DimCentreResponsabilite)
    private readonly crRepo: Repository<DimCentreResponsabilite>,
    @InjectRepository(DimVersion)
    private readonly versionRepo: Repository<DimVersion>,
    @InjectRepository(DimScenario)
    private readonly scenarioRepo: Repository<DimScenario>,
    private readonly perimetreService: PerimetreService,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  // ─── Helpers de validation métier (Lot 3.3) ───────────────────────

  /**
   * Garantit que le compte cible est une feuille saisissable
   * (`est_compte_collectif=false`). Lance BadRequest sinon.
   */
  async assertCompteFeuille(fkCompte: string): Promise<DimCompte> {
    const compte = await this.compteRepo.findOne({ where: { id: fkCompte } });
    if (!compte) {
      throw new NotFoundException(`Compte ${fkCompte} introuvable.`);
    }
    if (compte.estCompteCollectif) {
      throw new BadRequestException(
        `Saisie sur compte agrégé interdite. Le compte ${compte.codeCompte} ` +
          `est marqué est_compte_collectif=true. Choisir un compte feuille.`,
      );
    }
    return compte;
  }

  /**
   * Garantit que la maille budgétaire est mensuelle (jour=1 dans
   * dim_temps). Lance BadRequest sinon.
   */
  async assertTempsPremierDuMois(fkTemps: string): Promise<DimTemps> {
    const temps = await this.tempsRepo.findOne({ where: { id: fkTemps } });
    if (!temps) {
      throw new NotFoundException(`Période ${fkTemps} introuvable dans dim_temps.`);
    }
    if (temps.jour !== 1) {
      throw new BadRequestException(
        `La maille budgétaire est mensuelle. La période doit pointer vers le ` +
          `1er jour du mois (date='YYYY-MM-01'). Reçu : ${temps.date} (jour=${temps.jour}).`,
      );
    }
    return temps;
  }

  /**
   * Garantit que le CR cible est dans le périmètre RBAC du user.
   * `crAutorises = null` → admin, pas de check. Sinon, vérifier
   * l'appartenance.
   */
  assertCrAutorise(fkCentre: string, crAutorises: string[] | null): void {
    if (crAutorises === null) return; // admin global
    if (!crAutorises.includes(String(fkCentre))) {
      throw new ForbiddenException(
        `Vous n'avez pas accès au centre de responsabilité ${fkCentre} ` +
          `selon vos rôles actifs (Q5 — filtrage périmètre).`,
      );
    }
  }

  // ─── GET /fait-budget/par-grille ──────────────────────────────────

  /**
   * Construit la matrice de saisie (compte feuille × 12 mois) pour un
   * (version, scenario, CR, exercice). Cf. mandat Lot 3.3 Phase C.1.
   */
  async getGrilleSaisie(
    query: {
      versionId: string;
      scenarioId: string;
      crId: string;
      exerciceFiscal: number;
      classeCompte?: string;
    },
    userId: string,
  ): Promise<GrilleSaisieReponseDto> {
    // 1. Vérifier le périmètre
    const crAutorises = await this.perimetreService.getCrAutorisesPourUser(userId);
    this.assertCrAutorise(query.crId, crAutorises);

    // 2. Charger version + scenario + CR (avec rattachement structure)
    const [version, scenario, cr] = await Promise.all([
      this.versionRepo.findOne({ where: { id: query.versionId } }),
      this.scenarioRepo.findOne({ where: { id: query.scenarioId } }),
      this.crRepo.findOne({
        where: { id: query.crId },
        relations: { structure: true },
      }),
    ]);
    if (!version) throw new NotFoundException('Version introuvable.');
    if (!scenario) throw new NotFoundException('Scénario introuvable.');
    if (!cr) throw new NotFoundException('Centre de responsabilité introuvable.');

    // 3. Charger les 12 mois de l'exercice
    const mois = await this.tempsRepo
      .createQueryBuilder('t')
      .where('t.annee = :annee', { annee: query.exerciceFiscal })
      .andWhere('t.jour = 1')
      .orderBy('t.mois', 'ASC')
      .getMany();
    if (mois.length === 0) {
      throw new NotFoundException(
        `Aucun mois trouvé pour l'exercice ${query.exerciceFiscal} dans dim_temps.`,
      );
    }

    // 4. Charger les comptes feuilles (option : filtre par classe)
    const compteQb = this.compteRepo
      .createQueryBuilder('c')
      .where('c.estCompteCollectif = :collectif', { collectif: false })
      .andWhere('c.versionCourante = :vc', { vc: true })
      .andWhere('c.estActif = :ea', { ea: true });
    if (query.classeCompte) {
      compteQb.andWhere('c.classe = :cl', { cl: query.classeCompte });
    }
    const comptes = await compteQb
      .orderBy('c.codeCompte', 'ASC')
      .getMany();

    // 5. Charger toutes les lignes fait_budget pour (version, scenario,
    //    cr, mois de l'exercice).
    const idsMois = mois.map((m) => m.id);
    const lignesQb = this.faitRepo
      .createQueryBuilder('f')
      .leftJoinAndSelect('f.compte', 'cpt')
      .leftJoinAndSelect('f.ligneMetier', 'lm')
      .leftJoinAndSelect('f.temps', 'tps')
      .where('f.fkVersion = :v', { v: query.versionId })
      .andWhere('f.fkScenario = :s', { s: query.scenarioId })
      .andWhere('f.fkCentre = :c', { c: query.crId });
    if (idsMois.length > 0) {
      lignesQb.andWhere('f.fkTemps IN (:...mois)', { mois: idsMois });
    }
    const lignes = await lignesQb.getMany();

    // 6. Indexer les lignes par (compteId, ligneMetierId, mois) pour
    //    la matrice
    const cellulesIndex = new Map<string, FaitBudget>();
    for (const f of lignes) {
      const key = `${f.fkCompte}_${f.fkLigneMetier}_${f.fkTemps}`;
      cellulesIndex.set(key, f);
    }

    // 7. Construire la réponse matricielle. Pour chaque combinaison
    //    (compte × ligneMetier) effectivement présente dans la
    //    saisie, retourner les 12 mois. Si aucune saisie, retourner
    //    juste la liste des comptes feuilles potentiels (UI vide).
    type ComboKey = string;
    const combosVus = new Set<ComboKey>();
    for (const f of lignes) {
      combosVus.add(`${f.fkCompte}_${f.fkLigneMetier}`);
    }

    const lignesGrille: LigneGrilleDto[] = [];
    for (const combo of combosVus) {
      const [compteId, ligneMetierId] = combo.split('_');
      const compte = lignes.find((l) => String(l.fkCompte) === compteId)
        ?.compte;
      const ligneMetier = lignes.find(
        (l) => String(l.fkLigneMetier) === ligneMetierId,
      )?.ligneMetier;
      if (!compte || !ligneMetier) continue;

      const cellules: CelluleGrilleDto[] = mois.map((m) => {
        const key = `${compteId}_${ligneMetierId}_${m.id}`;
        const fait = cellulesIndex.get(key);
        return {
          mois: m.date,
          montant: fait ? Number(fait.montantDevise) : 0,
          modeSaisie: fait ? fait.modeSaisie : null,
          encoursMoyen: fait ? fait.encoursMoyen : null,
          tie: fait ? fait.tie : null,
          commentaire: fait ? fait.commentaire : null,
          ligneId: fait ? String(fait.id) : null,
        };
      });
      const totalAnnee = cellules.reduce((s, c) => s + c.montant, 0);
      lignesGrille.push({
        compte: {
          id: String(compte.id),
          codeCompte: compte.codeCompte,
          libelle: compte.libelle,
          classe: compte.classe,
          sens: compte.sens,
          estPorteurInterets: compte.estPorteurInterets,
        },
        ligneMetier: {
          id: String(ligneMetier.id),
          codeLigneMetier: ligneMetier.codeLigneMetier,
          libelle: ligneMetier.libelle,
        },
        cellules,
        totalAnnee,
      });
    }

    // 8. Totaux mensuels CR
    const totauxMensuels = mois.map((m) => {
      const total = lignes
        .filter((l) => String(l.fkTemps) === String(m.id))
        .reduce((s, l) => s + Number(l.montantDevise), 0);
      return { mois: m.date, total };
    });
    const totalAnneeCr = totauxMensuels.reduce((s, t) => s + t.total, 0);

    return {
      version: {
        id: String(version.id),
        codeVersion: version.codeVersion,
        libelle: version.libelle,
        statut: version.statut,
      },
      scenario: {
        id: String(scenario.id),
        codeScenario: scenario.codeScenario,
        libelle: scenario.libelle,
        typeScenario: scenario.typeScenario,
      },
      cr: {
        id: String(cr.id),
        codeCr: cr.codeCr,
        libelle: cr.libelle,
        structureRattachee: cr.structure
          ? {
              codeStructure: cr.structure.codeStructure,
              libelle: cr.structure.libelle,
            }
          : null,
      },
      exerciceFiscal: query.exerciceFiscal,
      moisLabels: mois.map((m) => `${m.libelleMois} ${m.annee}`),
      comptesFeuillesEligibles: comptes.map((c) => ({
        id: String(c.id),
        codeCompte: c.codeCompte,
        libelle: c.libelle,
        classe: c.classe,
        sens: c.sens,
        estPorteurInterets: c.estPorteurInterets,
      })),
      lignes: lignesGrille,
      totauxMensuels,
      totalAnneeCr,
    };
  }

  // ─── POST /fait-budget/grille (saisie en lot) ─────────────────────

  /**
   * Saisie en lot transactionnelle d'une grille (CR × période).
   * Insert / update / delete intelligent par cellule.
   * Audit `IMPORT_BUDGET` = 1 ligne par appel (rapport global).
   */
  async saveGrilleSaisie(
    dto: PostGrilleSaisieDto,
    userId: string,
    userEmail: string,
  ): Promise<PostGrilleSaisieReponseDto> {
    const start = Date.now();

    // 1. Périmètre
    const crAutorises = await this.perimetreService.getCrAutorisesPourUser(userId);
    this.assertCrAutorise(dto.crId, crAutorises);

    // 2. Charger version pour vérifier statut
    const version = await this.versionRepo.findOne({
      where: { id: dto.versionId },
    });
    if (!version) {
      throw new NotFoundException(`Version ${dto.versionId} introuvable.`);
    }
    if (version.statut !== 'ouvert') {
      throw new ForbiddenException(
        `Saisie interdite sur la version ${version.codeVersion} : ` +
          `statut '${version.statut}' (seul 'ouvert' autorise la saisie).`,
      );
    }

    // 3. Tous les CR/scénario doivent être courants/actifs
    const cr = await this.crRepo.findOne({ where: { id: dto.crId } });
    if (!cr || !cr.versionCourante || !cr.estActif) {
      throw new BadRequestException(
        `CR ${dto.crId} introuvable, non courant ou désactivé.`,
      );
    }
    const scenario = await this.scenarioRepo.findOne({
      where: { id: dto.scenarioId },
    });
    if (!scenario) {
      throw new NotFoundException(`Scénario ${dto.scenarioId} introuvable.`);
    }
    if (scenario.statut === 'archive') {
      throw new BadRequestException(
        `Scénario ${scenario.codeScenario} archivé : saisie interdite.`,
      );
    }

    // 4. Compteurs + erreurs
    let inserees = 0;
    let modifiees = 0;
    let supprimees = 0;
    let ignorees = 0;
    const erreurs: Array<{
      ligneIndex: number;
      mois: string;
      message: string;
      code: string;
    }> = [];
    let totalCellules = 0;

    // 5. Tout en transaction
    await this.dataSource.transaction(async (manager) => {
      const faitRepoTx = manager.getRepository(FaitBudget);
      const compteRepoTx = manager.getRepository(DimCompte);
      const tempsRepoTx = manager.getRepository(DimTemps);

      for (let i = 0; i < dto.lignes.length; i++) {
        const ligne = dto.lignes[i]!;
        // Compte feuille check
        const compte = await compteRepoTx.findOne({
          where: { id: ligne.compteId },
        });
        if (!compte) {
          for (const c of ligne.cellules) {
            erreurs.push({
              ligneIndex: i,
              mois: c.mois,
              message: `Compte ${ligne.compteId} introuvable.`,
              code: 'COMPTE_INCONNU',
            });
            totalCellules++;
          }
          continue;
        }
        if (compte.estCompteCollectif) {
          for (const c of ligne.cellules) {
            erreurs.push({
              ligneIndex: i,
              mois: c.mois,
              message: `Compte ${compte.codeCompte} agrégé : saisie interdite.`,
              code: 'COMPTE_AGREGE',
            });
            totalCellules++;
          }
          continue;
        }

        for (const cell of ligne.cellules) {
          totalCellules++;
          // Validation mois = 1er
          const tps = await tempsRepoTx.findOne({
            where: { date: cell.mois },
          });
          if (!tps) {
            erreurs.push({
              ligneIndex: i,
              mois: cell.mois,
              message: `Période ${cell.mois} introuvable dans dim_temps.`,
              code: 'TEMPS_INCONNU',
            });
            continue;
          }
          if (tps.jour !== 1) {
            erreurs.push({
              ligneIndex: i,
              mois: cell.mois,
              message: `Maille mensuelle requise (jour=1).`,
              code: 'TEMPS_PAS_PREMIER',
            });
            continue;
          }
          // Validation mode ENCOURS_TIE
          const mode: ModeSaisieFaitBudget =
            (cell.modeSaisie ?? 'MONTANT') as ModeSaisieFaitBudget;
          if (mode === 'ENCOURS_TIE' && !compte.estPorteurInterets) {
            erreurs.push({
              ligneIndex: i,
              mois: cell.mois,
              message: `Mode ENCOURS_TIE incompatible avec ${compte.codeCompte} (pas porteur d'intérêts).`,
              code: 'COMPTE_NON_PORTEUR',
            });
            continue;
          }

          // Recherche cellule existante
          const existant = await faitRepoTx.findOne({
            where: {
              fkVersion: dto.versionId,
              fkScenario: dto.scenarioId,
              fkCentre: dto.crId,
              fkCompte: ligne.compteId,
              fkLigneMetier: ligne.ligneMetierId,
              fkTemps: String(tps.id),
            },
          });

          // Si montant=0 et pas de mode encours_tie : delete si existe
          if (
            cell.montant === 0 &&
            mode === 'MONTANT' &&
            (cell.encoursMoyen ?? null) === null &&
            (cell.tie ?? null) === null
          ) {
            if (existant) {
              await faitRepoTx.delete({ id: existant.id });
              supprimees++;
            } else {
              ignorees++;
            }
            continue;
          }

          // Recalculer montant si ENCOURS_TIE
          let montantDevise = cell.montant;
          if (mode === 'ENCOURS_TIE') {
            if (
              cell.encoursMoyen === null ||
              cell.encoursMoyen === undefined ||
              cell.tie === null ||
              cell.tie === undefined
            ) {
              erreurs.push({
                ligneIndex: i,
                mois: cell.mois,
                message: `ENCOURS_TIE requiert encoursMoyen + tie.`,
                code: 'ENCOURS_TIE_INCOMPLET',
              });
              continue;
            }
            montantDevise =
              Math.round(
                (cell.encoursMoyen * cell.tie * 10000) / 12,
              ) / 10000;
          }

          if (existant) {
            // Update si différent
            const inchange =
              Number(existant.montantDevise) === montantDevise &&
              existant.modeSaisie === mode &&
              (existant.encoursMoyen ?? null) ===
                (mode === 'ENCOURS_TIE' ? cell.encoursMoyen ?? null : null) &&
              (existant.tie ?? null) ===
                (mode === 'ENCOURS_TIE' ? cell.tie ?? null : null) &&
              (existant.commentaire ?? null) === (cell.commentaire ?? null);
            if (inchange) {
              ignorees++;
              continue;
            }
            existant.montantDevise = montantDevise;
            existant.montantFcfa = montantDevise; // XOF pivot par défaut
            existant.tauxChangeApplique = 1; // simplification
            existant.modeSaisie = mode;
            existant.encoursMoyen =
              mode === 'ENCOURS_TIE' ? cell.encoursMoyen ?? null : null;
            existant.tie = mode === 'ENCOURS_TIE' ? cell.tie ?? null : null;
            existant.commentaire = cell.commentaire ?? null;
            existant.dateModification = new Date();
            existant.utilisateurModification = userEmail;
            await faitRepoTx.save(existant);
            modifiees++;
          } else {
            // Trouver fkDevise XOF par défaut
            const xof = await manager.query<Array<{ id: string }>>(
              `SELECT id FROM dim_devise WHERE code_iso='XOF' LIMIT 1`,
            );
            if (xof.length === 0) {
              erreurs.push({
                ligneIndex: i,
                mois: cell.mois,
                message: 'Devise pivot XOF introuvable dans dim_devise.',
                code: 'DEVISE_PIVOT_ABSENTE',
              });
              continue;
            }
            // Trouver fkProduit + fkSegment + fkStructure « par défaut »
            // depuis la 1re ligne existante du grain (compromis MVP).
            // Si rien à reprendre, on considère que la grille ne peut
            // créer une cellule que pour des grains déjà esquissés —
            // pour MVP, exiger ces FK dans le DTO si nouvelle ligne.
            erreurs.push({
              ligneIndex: i,
              mois: cell.mois,
              message:
                "Création d'une nouvelle cellule (compte × ligne_metier) " +
                'inexistante non supportée par /grille au MVP. Utiliser ' +
                'POST /fait-budget pour la première ligne, /grille ensuite.',
              code: 'CELLULE_NEUVE_NON_SUPPORTEE',
            });
            continue;
          }
        }
      }
    });

    const dureeMs = Date.now() - start;

    // 6. Audit
    await this.auditService.log({
      utilisateur: userEmail,
      typeAction: 'IMPORT_BUDGET',
      entiteCible: 'fait_budget',
      idCible: `version=${dto.versionId}/scenario=${dto.scenarioId}/cr=${dto.crId}`,
      statut: erreurs.length === 0 ? 'success' : 'failure',
      payloadApres: {
        totalCellules,
        inserees,
        modifiees,
        supprimees,
        ignorees,
        erreursCount: erreurs.length,
      },
      commentaire: `Saisie en lot grille — ${dto.lignes.length} lignes, ${totalCellules} cellules.`,
      dureeMs,
    });

    return {
      totalCellules,
      inserees,
      modifiees,
      supprimees,
      ignorees,
      erreurs,
      dureeMs,
    };
  }
}
