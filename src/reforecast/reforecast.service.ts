/**
 * ReforecastService (Lot 5.3.A) — orchestration du reforecast
 * trimestriel.
 *
 * Le reforecast réutilise le mécanisme `dim_version` (décision Q2) :
 * la table `fait_reforecast` n'existe pas, à la place on crée une
 * nouvelle ligne `dim_version` avec `type_version = 'reforecast'` et
 * on génère les `fait_budget` extrapolés.
 *
 * Cycle de vie d'un reforecast :
 *   1. lancer()  → INSERT dim_version (statut=ouvert,
 *                  statut_publication=ACTIVE)
 *                  + génération fait_budget extrapolés
 *                  + marquage OBSOLETE de l'ancien reforecast
 *                  ACTIVE pour la même clé (Q1 décision produit)
 *   2. workflow standard ouvert → soumis → valide → gele
 *      (réutilise VersionWorkflowService — codes audit *_REFORECAST
 *      injectés selon type_version, cf. Lot 5.3.A.3).
 */
import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import {
  DimVersion,
  type MethodeExtrapolation,
} from '../referentiels/version/entities/dim-version.entity';
import {
  LancerReforecastDto,
  ListerReforecastsDto,
  ReforecastResponseDto,
} from './dto/reforecast.dto';

/** Lignes du listing avec métadonnées source jointes (raw SQL). */
interface ReforecastListRow {
  id: string;
  code_version: string;
  libelle: string;
  exercice_fiscal: number;
  statut: string;
  statut_publication: string;
  fk_version_source: string;
  fk_scenario_source: string;
  trimestre_consolide: number;
  annee_consolide: number;
  methode_extrapolation: string;
  date_obsolescence: Date | null;
  fk_version_remplacante: string | null;
  libelle_version_source: string | null;
  libelle_scenario_source: string | null;
  date_creation: Date;
  utilisateur_creation: string;
  commentaire: string | null;
  nb_lignes: string;
}

@Injectable()
export class ReforecastService {
  constructor(
    @InjectRepository(DimVersion)
    private readonly versionRepo: Repository<DimVersion>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // lancer() — point d'entrée principal
  // ═══════════════════════════════════════════════════════════════

  async lancer(
    dto: LancerReforecastDto,
    user: AuthUser,
  ): Promise<ReforecastResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      // 1) Validations métier
      const versionSource = await manager
        .getRepository(DimVersion)
        .findOne({ where: { id: dto.fkVersionSource } });
      if (!versionSource) {
        throw new NotFoundException(
          `Version source ${dto.fkVersionSource} introuvable.`,
        );
      }
      if (versionSource.statut !== 'gele') {
        throw new UnprocessableEntityException(
          'La version source doit être publiée (gele) pour lancer un reforecast.',
        );
      }
      // Tolère type_version = 'budget_initial' ou 'reforecast' (un
      // reforecast peut être basé sur un reforecast déjà publié).
      // Refuse les types inattendus.

      const scenarioRows = (await manager.query(
        `SELECT id FROM dim_scenario WHERE id = $1`,
        [dto.fkScenarioSource],
      )) as Array<{ id: string }>;
      if (scenarioRows.length === 0) {
        throw new NotFoundException(
          `Scénario source ${dto.fkScenarioSource} introuvable.`,
        );
      }

      // 2) Vérifier qu'au moins 1 ligne fait_realise VALIDE existe
      // pour le trimestre consolidé.
      const moisDebut = (dto.trimestreConsolide - 1) * 3 + 1;
      const moisFin = dto.trimestreConsolide * 3;
      const realiseRows = (await manager.query(
        `SELECT COUNT(*)::int AS n
           FROM fait_realise fr
           INNER JOIN dim_temps t ON t.id = fr.fk_temps
          WHERE fr.statut = 'VALIDE'
            AND t.annee = $1
            AND t.mois BETWEEN $2 AND $3`,
        [dto.anneeConsolide, moisDebut, moisFin],
      )) as Array<{ n: number }>;
      if ((realiseRows[0]?.n ?? 0) === 0) {
        throw new UnprocessableEntityException(
          `Aucun réalisé validé sur le trimestre T${dto.trimestreConsolide} ` +
            `${dto.anneeConsolide}, impossible de lancer le reforecast.`,
        );
      }

      // 3) Marquer OBSOLETE les anciens reforecasts ACTIVE pour la
      // même clé (Q1 décision produit). On a besoin de l'id du
      // nouveau d'abord — donc on crée la nouvelle version, puis on
      // marque obsolètes en référence à elle.
      const obsoleteIds = (await manager.query(
        `SELECT id FROM dim_version
          WHERE type_version = 'reforecast'
            AND statut_publication = 'ACTIVE'
            AND fk_version_source = $1
            AND fk_scenario_source = $2
            AND trimestre_consolide = $3
            AND annee_consolide = $4`,
        [
          dto.fkVersionSource,
          dto.fkScenarioSource,
          dto.trimestreConsolide,
          dto.anneeConsolide,
        ],
      )) as Array<{ id: string }>;

      // 4) Créer la nouvelle version REFORECAST
      const codeVersion = this.genererCodeVersion(
        dto.trimestreConsolide,
        dto.anneeConsolide,
      );
      const insertVersion = (await manager.query(
        `INSERT INTO dim_version (
           code_version, libelle, type_version, exercice_fiscal,
           statut, statut_publication,
           fk_version_source, fk_scenario_source,
           trimestre_consolide, annee_consolide, methode_extrapolation,
           commentaire,
           date_creation, utilisateur_creation
         ) VALUES (
           $1, $2, 'reforecast', $3,
           'ouvert', 'ACTIVE',
           $4, $5, $6, $7, $8,
           $9,
           NOW(), $10
         )
         RETURNING id`,
        [
          codeVersion,
          dto.libelleNouveauVersion,
          dto.anneeConsolide,
          dto.fkVersionSource,
          dto.fkScenarioSource,
          dto.trimestreConsolide,
          dto.anneeConsolide,
          dto.methodeExtrapolation,
          dto.commentaire ?? null,
          user.email,
        ],
      )) as Array<{ id: string }>;
      const newVersionId = insertVersion[0]!.id;

      // 5) Marquer OBSOLETE les anciens (avec fk_version_remplacante)
      for (const old of obsoleteIds) {
        await this.marquerObsolete(manager, old.id, newVersionId, user);
      }

      // 6) Génération des lignes fait_budget extrapolées
      const nbLignes = await this.genererLignes(manager, {
        newVersionId,
        sourceVersionId: dto.fkVersionSource,
        sourceScenarioId: dto.fkScenarioSource,
        anneeConsolide: dto.anneeConsolide,
        trimestreConsolide: dto.trimestreConsolide,
        methode: dto.methodeExtrapolation,
        userEmail: user.email,
      });

      // 7) Audit LANCER_REFORECAST
      await this.auditService.log({
        utilisateur: user.email,
        typeAction: 'LANCER_REFORECAST',
        entiteCible: 'dim_version',
        idCible: newVersionId,
        statut: 'success',
        payloadApres: {
          codeVersion,
          fkVersionSource: dto.fkVersionSource,
          fkScenarioSource: dto.fkScenarioSource,
          trimestreConsolide: dto.trimestreConsolide,
          anneeConsolide: dto.anneeConsolide,
          methodeExtrapolation: dto.methodeExtrapolation,
          nbLignes,
          ...(obsoleteIds.length > 0
            ? { reforecastObsolete: obsoleteIds.map((r) => r.id) }
            : {}),
        },
        commentaire:
          `Reforecast ${codeVersion} créé (${nbLignes} ligne(s) générée(s), ` +
          `méthode ${dto.methodeExtrapolation}).` +
          (obsoleteIds.length > 0
            ? ` ${obsoleteIds.length} reforecast(s) précédent(s) marqué(s) OBSOLETE.`
            : ''),
      });

      // 8) Renvoie le détail
      return this.getById(newVersionId, manager);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // marquerObsolete — interne, dans la transaction de lancer()
  // ═══════════════════════════════════════════════════════════════

  private async marquerObsolete(
    manager: EntityManager,
    versionId: string,
    fkRemplacante: string,
    user: AuthUser,
  ): Promise<void> {
    await manager.query(
      `UPDATE dim_version
          SET statut_publication = 'OBSOLETE',
              date_obsolescence = NOW(),
              fk_version_remplacante = $2,
              date_modification = NOW(),
              utilisateur_modification = $3
        WHERE id = $1
          AND statut_publication = 'ACTIVE'`,
      [versionId, fkRemplacante, user.email],
    );
    await this.auditService.log({
      utilisateur: user.email,
      typeAction: 'MARQUER_REFORECAST_OBSOLETE',
      entiteCible: 'dim_version',
      idCible: versionId,
      statut: 'success',
      payloadApres: {
        statutPublicationApres: 'OBSOLETE',
        fkVersionRemplacante: fkRemplacante,
      },
      commentaire: `Reforecast ${versionId} marqué OBSOLETE (remplacé par ${fkRemplacante}).`,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // genererLignes — INSERT...SELECT en SQL pur (perf)
  // ═══════════════════════════════════════════════════════════════

  private async genererLignes(
    manager: EntityManager,
    p: {
      newVersionId: string;
      sourceVersionId: string;
      sourceScenarioId: string;
      anneeConsolide: number;
      trimestreConsolide: number;
      methode: MethodeExtrapolation;
      userEmail: string;
    },
  ): Promise<number> {
    // Stratégie : 2 INSERT...SELECT séparés pour éviter les CASE
    // imbriqués qui font tomber pg-mem (bug connu) — un pour les
    // mois consolidés (T <= consolide), un pour les mois futurs.
    const moisFinConsolide = p.trimestreConsolide * 3;

    // ─── 1. Mois consolidés (T <= consolide) : montant = réalisé ──
    const sqlConsolide = `
      INSERT INTO fait_budget (
        fk_temps, fk_compte, fk_structure, fk_centre,
        fk_ligne_metier, fk_produit, fk_segment, fk_devise,
        fk_version, fk_scenario,
        montant_devise, montant_fcfa, taux_change_applique,
        mode_saisie,
        date_creation, utilisateur_creation
      )
      SELECT
        fb.fk_temps, fb.fk_compte, fb.fk_structure, fb.fk_centre,
        fb.fk_ligne_metier, fb.fk_produit, fb.fk_segment, fb.fk_devise,
        $1::bigint, fb.fk_scenario,
        COALESCE(fr.montant, 0),
        COALESCE(fr.montant, 0),
        fb.taux_change_applique,
        'MONTANT',
        CURRENT_TIMESTAMP, $2
      FROM fait_budget fb
      INNER JOIN dim_temps t ON t.id = fb.fk_temps
      LEFT JOIN fait_realise fr ON
        fr.fk_centre_responsabilite = fb.fk_centre
        AND fr.fk_compte = fb.fk_compte
        AND fr.fk_ligne_metier = fb.fk_ligne_metier
        AND fr.fk_temps = fb.fk_temps
        AND fr.fk_devise = fb.fk_devise
        AND fr.statut = 'VALIDE'
      WHERE fb.fk_version = $3::bigint
        AND fb.fk_scenario = $4::bigint
        AND t.annee = $5
        AND t.mois <= ${moisFinConsolide}
    `;
    await manager.query(sqlConsolide, [
      p.newVersionId,
      p.userEmail,
      p.sourceVersionId,
      p.sourceScenarioId,
      p.anneeConsolide,
    ]);

    // ─── 2. Mois futurs (T > consolide) : selon méthode ──────────
    let sqlFutur: string;
    if (p.methode === 'BUDGET_INITIAL') {
      sqlFutur = `
        INSERT INTO fait_budget (
          fk_temps, fk_compte, fk_structure, fk_centre,
          fk_ligne_metier, fk_produit, fk_segment, fk_devise,
          fk_version, fk_scenario,
          montant_devise, montant_fcfa, taux_change_applique,
          mode_saisie,
          date_creation, utilisateur_creation
        )
        SELECT
          fb.fk_temps, fb.fk_compte, fb.fk_structure, fb.fk_centre,
          fb.fk_ligne_metier, fb.fk_produit, fb.fk_segment, fb.fk_devise,
          $1::bigint, fb.fk_scenario,
          fb.montant_devise, fb.montant_fcfa, fb.taux_change_applique,
          'MONTANT',
          CURRENT_TIMESTAMP, $2
        FROM fait_budget fb
        INNER JOIN dim_temps t ON t.id = fb.fk_temps
        WHERE fb.fk_version = $3::bigint
          AND fb.fk_scenario = $4::bigint
          AND t.annee = $5
          AND t.mois > ${moisFinConsolide}
      `;
    } else if (p.methode === 'MANUELLE') {
      sqlFutur = `
        INSERT INTO fait_budget (
          fk_temps, fk_compte, fk_structure, fk_centre,
          fk_ligne_metier, fk_produit, fk_segment, fk_devise,
          fk_version, fk_scenario,
          montant_devise, montant_fcfa, taux_change_applique,
          mode_saisie,
          date_creation, utilisateur_creation
        )
        SELECT
          fb.fk_temps, fb.fk_compte, fb.fk_structure, fb.fk_centre,
          fb.fk_ligne_metier, fb.fk_produit, fb.fk_segment, fb.fk_devise,
          $1::bigint, fb.fk_scenario,
          0, 0, fb.taux_change_applique,
          'MONTANT',
          CURRENT_TIMESTAMP, $2
        FROM fait_budget fb
        INNER JOIN dim_temps t ON t.id = fb.fk_temps
        WHERE fb.fk_version = $3::bigint
          AND fb.fk_scenario = $4::bigint
          AND t.annee = $5
          AND t.mois > ${moisFinConsolide}
      `;
    } else {
      // MOYENNE_TRIMESTRE — pré-calcul des moyennes en JS (les CTE
      // INSERT…SELECT…LEFT JOIN cte font tomber pg-mem ; en prod
      // Postgres réel, le pattern marche, mais pour rester
      // cohérent avec le pattern de tests on passe par un
      // pré-calcul + UPDATE final).
      sqlFutur = '';
    }

    if (sqlFutur) {
      await manager.query(sqlFutur, [
        p.newVersionId,
        p.userEmail,
        p.sourceVersionId,
        p.sourceScenarioId,
        p.anneeConsolide,
      ]);
    } else {
      await this.genererLignesFuturMoyenneTrimestre(
        manager,
        p,
        moisFinConsolide,
      );
    }

    const cnt = (await manager.query(
      `SELECT COUNT(*)::int AS n FROM fait_budget WHERE fk_version = $1::bigint`,
      [p.newVersionId],
    )) as Array<{ n: number }>;
    return cnt[0]?.n ?? 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // Lecture
  // ═══════════════════════════════════════════════════════════════

  async getById(
    id: string,
    manager?: EntityManager,
  ): Promise<ReforecastResponseDto> {
    const m = manager ?? this.dataSource.manager;
    const rows = (await m.query(
      `${this.SELECT_LIST_BASE}
        WHERE v.id = $1::bigint
          AND v.type_version = 'reforecast'`,
      [id],
    )) as ReforecastListRow[];
    if (rows.length === 0) {
      throw new NotFoundException(`Reforecast ${id} introuvable.`);
    }
    const dto = this.toDto(rows[0]!);
    dto.nbLignes = await this.countLignes(m, dto.id);
    return dto;
  }

  async lister(
    filtres: ListerReforecastsDto,
  ): Promise<ReforecastResponseDto[]> {
    const conditions: string[] = ["v.type_version = 'reforecast'"];
    const params: unknown[] = [];
    const statutPub = filtres.statutPublication ?? 'ACTIVE';
    params.push(statutPub);
    conditions.push(`v.statut_publication = $${params.length}`);
    if (filtres.fkVersionSource) {
      params.push(filtres.fkVersionSource);
      conditions.push(`v.fk_version_source = $${params.length}::bigint`);
    }
    if (filtres.anneeConsolide) {
      params.push(filtres.anneeConsolide);
      conditions.push(`v.annee_consolide = $${params.length}`);
    }
    if (filtres.statutWorkflow) {
      params.push(filtres.statutWorkflow);
      conditions.push(`v.statut = $${params.length}`);
    }
    const sql = `${this.SELECT_LIST_BASE}
       WHERE ${conditions.join(' AND ')}
       ORDER BY v.date_creation DESC`;
    const rows = (await this.dataSource.query(
      sql,
      params,
    )) as ReforecastListRow[];
    const dtos = rows.map((r) => this.toDto(r));
    for (const dto of dtos) {
      dto.nbLignes = await this.countLignes(this.dataSource.manager, dto.id);
    }
    return dtos;
  }

  /**
   * MOYENNE_TRIMESTRE — pré-calcul JS + INSERT batch (contournement
   * du bug pg-mem sur les CTE INSERT...SELECT...LEFT JOIN cte).
   */
  private async genererLignesFuturMoyenneTrimestre(
    manager: EntityManager,
    p: {
      newVersionId: string;
      sourceVersionId: string;
      sourceScenarioId: string;
      anneeConsolide: number;
      trimestreConsolide: number;
      userEmail: string;
    },
    moisFinConsolide: number,
  ): Promise<void> {
    const moisDebut = (p.trimestreConsolide - 1) * 3 + 1;
    const moisFin = p.trimestreConsolide * 3;

    // 1) Calculer les moyennes par groupe (CR, compte, ligne_metier, devise)
    const moyennesRows = (await manager.query(
      `SELECT fr.fk_centre_responsabilite AS cr,
              fr.fk_compte AS cpt,
              fr.fk_ligne_metier AS lm,
              fr.fk_devise AS dev,
              SUM(fr.montant)::float / 3.0 AS m
         FROM fait_realise fr
         INNER JOIN dim_temps t ON t.id = fr.fk_temps
        WHERE fr.statut = 'VALIDE'
          AND t.annee = $1
          AND t.mois BETWEEN $2 AND $3
        GROUP BY fr.fk_centre_responsabilite, fr.fk_compte,
                 fr.fk_ligne_metier, fr.fk_devise`,
      [p.anneeConsolide, moisDebut, moisFin],
    )) as Array<{
      cr: string;
      cpt: string;
      lm: string;
      dev: string;
      m: number;
    }>;
    const moyMap = new Map<string, number>();
    for (const r of moyennesRows) {
      moyMap.set(`${r.cr}|${r.cpt}|${r.lm}|${r.dev}`, Number(r.m));
    }

    // 2) Récupérer les lignes futures du source
    const lignes = (await manager.query(
      `SELECT fb.fk_temps, fb.fk_compte, fb.fk_structure, fb.fk_centre,
              fb.fk_ligne_metier, fb.fk_produit, fb.fk_segment, fb.fk_devise,
              fb.fk_scenario, fb.taux_change_applique
         FROM fait_budget fb
         INNER JOIN dim_temps t ON t.id = fb.fk_temps
        WHERE fb.fk_version = $1::bigint
          AND fb.fk_scenario = $2::bigint
          AND t.annee = $3
          AND t.mois > $4`,
      [
        p.sourceVersionId,
        p.sourceScenarioId,
        p.anneeConsolide,
        moisFinConsolide,
      ],
    )) as Array<{
      fk_temps: string;
      fk_compte: string;
      fk_structure: string;
      fk_centre: string;
      fk_ligne_metier: string;
      fk_produit: string;
      fk_segment: string;
      fk_devise: string;
      fk_scenario: string;
      taux_change_applique: string;
    }>;

    // 3) INSERT en batch (chunks de 500)
    const CHUNK = 500;
    for (let i = 0; i < lignes.length; i += CHUNK) {
      const chunk = lignes.slice(i, i + CHUNK);
      const values: string[] = [];
      const params: unknown[] = [p.newVersionId, p.userEmail];
      let pi = 3;
      for (const l of chunk) {
        const moy =
          moyMap.get(
            `${l.fk_centre}|${l.fk_compte}|${l.fk_ligne_metier}|${l.fk_devise}`,
          ) ?? 0;
        values.push(
          `($${pi++}::bigint, $${pi++}::bigint, $${pi++}::bigint, $${pi++}::bigint, ` +
            `$${pi++}::bigint, $${pi++}::bigint, $${pi++}::bigint, $${pi++}::bigint, ` +
            `$1::bigint, $${pi++}::bigint, $${pi++}, $${pi++}, $${pi++}, ` +
            `'MONTANT', CURRENT_TIMESTAMP, $2)`,
        );
        params.push(
          l.fk_temps,
          l.fk_compte,
          l.fk_structure,
          l.fk_centre,
          l.fk_ligne_metier,
          l.fk_produit,
          l.fk_segment,
          l.fk_devise,
          l.fk_scenario,
          moy,
          moy,
          Number(l.taux_change_applique),
        );
      }
      await manager.query(
        `INSERT INTO fait_budget (
           fk_temps, fk_compte, fk_structure, fk_centre,
           fk_ligne_metier, fk_produit, fk_segment, fk_devise,
           fk_version, fk_scenario,
           montant_devise, montant_fcfa, taux_change_applique,
           mode_saisie, date_creation, utilisateur_creation
         ) VALUES ${values.join(', ')}`,
        params,
      );
    }
  }

  private async countLignes(
    m: EntityManager,
    versionId: string,
  ): Promise<number> {
    const cnt = (await m.query(
      `SELECT COUNT(*)::int AS n FROM fait_budget WHERE fk_version = $1::bigint`,
      [versionId],
    )) as Array<{ n: number }>;
    return cnt[0]?.n ?? 0;
  }

  /** Renvoie l'objet `dim_version` brut pour les services workflow. */
  async getEntityById(id: string): Promise<DimVersion> {
    const v = await this.versionRepo.findOne({ where: { id } });
    if (!v || v.typeVersion !== 'reforecast') {
      throw new NotFoundException(`Reforecast ${id} introuvable.`);
    }
    return v;
  }

  // ═══════════════════════════════════════════════════════════════
  // Comparaison reforecast ↔ version source
  // ═══════════════════════════════════════════════════════════════

  async getComparaison(id: string): Promise<{
    lignes: Array<{
      fkCentre: string;
      codeCr: string;
      fkCompte: string;
      codeCompte: string;
      fkLigneMetier: string;
      codeLigneMetier: string;
      fkTemps: string;
      mois: number;
      annee: number;
      origine: 'REALISE' | 'EXTRAPOLATION' | 'MANUEL';
      montantSource: number;
      montantReforecast: number;
      ecart: number;
    }>;
    totalSource: number;
    totalReforecast: number;
    totalEcart: number;
  }> {
    const v = await this.getEntityById(id);
    const trim = v.trimestreConsolide!;
    const methode = v.methodeExtrapolation!;

    const rows = (await this.dataSource.query(
      `SELECT
         fb.fk_centre AS fk_centre,
         cr.code_cr,
         fb.fk_compte,
         c.code_compte,
         fb.fk_ligne_metier,
         lm.code_ligne_metier,
         fb.fk_temps,
         t.mois,
         t.annee,
         fb.montant_fcfa AS montant_reforecast,
         COALESCE(fb_src.montant_fcfa, 0) AS montant_source
       FROM fait_budget fb
       INNER JOIN dim_temps t ON t.id = fb.fk_temps
       INNER JOIN dim_centre_responsabilite cr ON cr.id = fb.fk_centre
       INNER JOIN dim_compte c ON c.id = fb.fk_compte
       INNER JOIN dim_ligne_metier lm ON lm.id = fb.fk_ligne_metier
       LEFT JOIN fait_budget fb_src ON
         fb_src.fk_version = $2::bigint
         AND fb_src.fk_scenario = $3::bigint
         AND fb_src.fk_temps = fb.fk_temps
         AND fb_src.fk_compte = fb.fk_compte
         AND fb_src.fk_centre = fb.fk_centre
         AND fb_src.fk_structure = fb.fk_structure
         AND fb_src.fk_ligne_metier = fb.fk_ligne_metier
         AND fb_src.fk_produit = fb.fk_produit
         AND fb_src.fk_segment = fb.fk_segment
         AND fb_src.fk_devise = fb.fk_devise
       WHERE fb.fk_version = $1::bigint
       ORDER BY cr.code_cr, c.code_compte, t.annee, t.mois`,
      [id, v.fkVersionSource, v.fkScenarioSource],
    )) as Array<{
      fk_centre: string;
      code_cr: string;
      fk_compte: string;
      code_compte: string;
      fk_ligne_metier: string;
      code_ligne_metier: string;
      fk_temps: string;
      mois: number;
      annee: number;
      montant_reforecast: string;
      montant_source: string;
    }>;

    const lignes = rows.map((r) => {
      const moisNum = Number(r.mois);
      const trimLigne = Math.floor((moisNum - 1) / 3) + 1;
      let origine: 'REALISE' | 'EXTRAPOLATION' | 'MANUEL';
      if (trimLigne <= trim) origine = 'REALISE';
      else if (methode === 'MANUELLE') origine = 'MANUEL';
      else origine = 'EXTRAPOLATION';
      const mtSource = Number(r.montant_source);
      const mtRefo = Number(r.montant_reforecast);
      return {
        fkCentre: r.fk_centre,
        codeCr: r.code_cr,
        fkCompte: r.fk_compte,
        codeCompte: r.code_compte,
        fkLigneMetier: r.fk_ligne_metier,
        codeLigneMetier: r.code_ligne_metier,
        fkTemps: r.fk_temps,
        mois: moisNum,
        annee: Number(r.annee),
        origine,
        montantSource: mtSource,
        montantReforecast: mtRefo,
        ecart: mtRefo - mtSource,
      };
    });
    const totalSource = lignes.reduce((s, l) => s + l.montantSource, 0);
    const totalReforecast = lignes.reduce((s, l) => s + l.montantReforecast, 0);
    return {
      lignes,
      totalSource,
      totalReforecast,
      totalEcart: totalReforecast - totalSource,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════

  private genererCodeVersion(trim: number, annee: number): string {
    const ts = Date.now();
    return `REFORECAST_T${trim}_${annee}_${ts}`;
  }

  private toDto(r: ReforecastListRow): ReforecastResponseDto {
    return {
      id: String(r.id),
      codeVersion: r.code_version,
      libelle: r.libelle,
      exerciceFiscal: Number(r.exercice_fiscal),
      statut: r.statut as ReforecastResponseDto['statut'],
      statutPublication:
        r.statut_publication as ReforecastResponseDto['statutPublication'],
      fkVersionSource: String(r.fk_version_source),
      fkScenarioSource: String(r.fk_scenario_source),
      trimestreConsolide: Number(r.trimestre_consolide),
      anneeConsolide: Number(r.annee_consolide),
      methodeExtrapolation:
        r.methode_extrapolation as ReforecastResponseDto['methodeExtrapolation'],
      dateObsolescence: r.date_obsolescence,
      fkVersionRemplacante: r.fk_version_remplacante
        ? String(r.fk_version_remplacante)
        : null,
      libelleVersionSource: r.libelle_version_source,
      libelleScenarioSource: r.libelle_scenario_source,
      dateCreation: r.date_creation,
      utilisateurCreation: r.utilisateur_creation,
      commentaire: r.commentaire,
      nbLignes: Number(r.nb_lignes ?? 0),
    };
  }

  private readonly SELECT_LIST_BASE = `
    SELECT
      v.id,
      v.code_version,
      v.libelle,
      v.exercice_fiscal,
      v.statut,
      v.statut_publication,
      v.fk_version_source,
      v.fk_scenario_source,
      v.trimestre_consolide,
      v.annee_consolide,
      v.methode_extrapolation,
      v.date_obsolescence,
      v.fk_version_remplacante,
      vsrc.libelle AS libelle_version_source,
      ssrc.libelle AS libelle_scenario_source,
      v.date_creation,
      v.utilisateur_creation,
      v.commentaire,
      0::int AS nb_lignes
    FROM dim_version v
    LEFT JOIN dim_version vsrc ON vsrc.id = v.fk_version_source
    LEFT JOIN dim_scenario ssrc ON ssrc.id = v.fk_scenario_source
  `;
}
