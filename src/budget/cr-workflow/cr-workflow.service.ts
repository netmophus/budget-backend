/**
 * CrWorkflowService (Lot workflow par CR — PR A, palier 2).
 *
 * Transitions du cycle de validation au grain CR × version :
 *   EN_SAISIE → SOUMIS → VALIDE  (rejet/réouverture → EN_SAISIE)
 * + soumission de la version au Comité (PRE_VALIDE → SOUMIS_COMITE).
 *
 * Garde-fous : permission (via @RequirePermissions au controller) +
 * appartenance du CR au périmètre de l'utilisateur (PerimetreService,
 * role-agnostic : 1 CR pour un saisisseur, 5-6 pour un validateur).
 *
 * NB palier 2 : PAS d'automation (bascule auto OUVERT→PRE_VALIDE à la
 * dernière validation) ni de verrou de saisie — ce sont des hooks
 * laissés explicites pour le palier 3.
 */
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { AuditService } from '../../audit/audit.service';
import type { TypeAction } from '../../audit/entities/audit-log.entity';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { DimCentreResponsabilite } from '../../referentiels/centre-responsabilite/entities/dim-centre-responsabilite.entity';
import { DimVersion } from '../../referentiels/version/entities/dim-version.entity';
import { PerimetreService } from '../services/perimetre.service';
import {
  CrStatutResponseDto,
  StatutsCrsResponseDto,
} from './dto/cr-statut-response.dto';
import {
  FaitBudgetCrStatut,
  type StatutCrSaisie,
} from './entities/fait-budget-cr-statut.entity';

@Injectable()
export class CrWorkflowService {
  constructor(
    @InjectRepository(FaitBudgetCrStatut)
    private readonly statutRepo: Repository<FaitBudgetCrStatut>,
    @InjectRepository(DimVersion)
    private readonly versionRepo: Repository<DimVersion>,
    @InjectRepository(DimCentreResponsabilite)
    private readonly crRepo: Repository<DimCentreResponsabilite>,
    private readonly dataSource: DataSource,
    private readonly perimetreService: PerimetreService,
    private readonly auditService: AuditService,
  ) {}

  // ─── Helpers de résolution + garde-fous ───────────────────────────

  private async resolveVersion(versionId: string): Promise<DimVersion> {
    const v = await this.versionRepo.findOne({ where: { id: versionId } });
    if (!v) throw new NotFoundException(`Version ${versionId} introuvable.`);
    return v;
  }

  private async resolveCr(crCode: string): Promise<DimCentreResponsabilite> {
    const cr = await this.crRepo.findOne({
      where: { codeCr: crCode, versionCourante: true, estActif: true },
    });
    if (!cr) {
      throw new NotFoundException(
        `CR ${crCode} introuvable, non courant ou désactivé.`,
      );
    }
    return cr;
  }

  /** CR doit appartenir au périmètre de l'utilisateur (null = admin). */
  private async assertCrAutorise(crId: string, user: AuthUser): Promise<void> {
    const crs = await this.perimetreService.getCrAutorisesPourUser(user.userId);
    if (crs !== null && !crs.includes(String(crId))) {
      throw new ForbiddenException(
        `Ce CR n'est pas dans votre périmètre. Action refusée.`,
      );
    }
  }

  private async findStatut(
    manager: EntityManager,
    versionId: string,
    crId: string,
  ): Promise<FaitBudgetCrStatut | null> {
    return manager.getRepository(FaitBudgetCrStatut).findOne({
      where: { fkVersion: String(versionId), fkCr: String(crId) },
    });
  }

  private async audit(
    manager: EntityManager,
    user: AuthUser,
    typeAction: TypeAction,
    entiteCible: string,
    idCible: string,
    payloadApres: Record<string, unknown>,
    commentaire: string,
  ): Promise<void> {
    await this.auditService.log(
      {
        utilisateur: user.email,
        typeAction,
        entiteCible,
        idCible: String(idCible),
        statut: 'success',
        payloadApres,
        commentaire,
      },
      manager,
    );
  }

  private toResponse(
    s: FaitBudgetCrStatut,
    cr: DimCentreResponsabilite,
  ): CrStatutResponseDto {
    return {
      versionId: String(s.fkVersion),
      crId: String(s.fkCr),
      crCode: cr.codeCr,
      statut: s.statut,
      dateSoumission: s.dateSoumission,
      dateValidation: s.dateValidation,
      dateReouverture: s.dateReouverture,
      fkSaisisseur: s.fkSaisisseur,
      fkValidateur: s.fkValidateur,
      motifRejet: s.motifRejet,
      motifReouverture: s.motifReouverture,
    };
  }

  // ─── Soumettre : EN_SAISIE → SOUMIS (saisisseur) ──────────────────

  async soumettre(
    versionId: string,
    crCode: string,
    commentaire: string | undefined,
    user: AuthUser,
  ): Promise<CrStatutResponseDto> {
    const version = await this.resolveVersion(versionId);
    const cr = await this.resolveCr(crCode);
    await this.assertCrAutorise(cr.id, user);

    return this.dataSource.transaction(async (m) => {
      // Garde-fou : au moins une ligne fait_budget pour ce CR.
      const rows = await m.query<Array<{ n: number }>>(
        `SELECT COUNT(*)::int AS n FROM fait_budget
          WHERE fk_version = $1 AND fk_centre = $2`,
        [versionId, cr.id],
      );
      if ((rows[0]?.n ?? 0) === 0) {
        throw new UnprocessableEntityException(
          `Le CR ${cr.codeCr} est vide. Saisissez au moins une ligne ` +
            `budgétaire avant de soumettre.`,
        );
      }

      // Auto-création du statut EN_SAISIE si absent (1ʳᵉ soumission).
      const repo = m.getRepository(FaitBudgetCrStatut);
      let statut = await this.findStatut(m, versionId, cr.id);
      if (!statut) {
        statut = repo.create({
          fkVersion: String(versionId),
          fkCr: String(cr.id),
          statut: 'EN_SAISIE',
        });
      }
      if (statut.statut !== 'EN_SAISIE') {
        throw new ConflictException(
          `Le CR ${cr.codeCr} est déjà au statut '${statut.statut}'. ` +
            `Seul un CR EN_SAISIE peut être soumis.`,
        );
      }

      statut.statut = 'SOUMIS';
      statut.dateSoumission = new Date();
      statut.fkSaisisseur = String(user.userId);
      statut.motifRejet = null;
      statut.fkUserModif = String(user.userId);
      statut.dateModification = new Date();
      const saved = await repo.save(statut);

      await this.audit(
        m,
        user,
        'SOUMETTRE_CR',
        'fait_budget_cr_statut',
        saved.id,
        {
          codeCr: cr.codeCr,
          versionId: String(versionId),
          statutAvant: 'EN_SAISIE',
          statutApres: 'SOUMIS',
          commentaire: commentaire ?? null,
        },
        `Soumission du CR ${cr.codeCr} (version ${version.codeVersion}).`,
      );
      return this.toResponse(saved, cr);
    });
  }

  // ─── Valider : SOUMIS → VALIDE (validateur) ───────────────────────

  async valider(
    versionId: string,
    crCode: string,
    commentaire: string | undefined,
    user: AuthUser,
  ): Promise<CrStatutResponseDto> {
    const version = await this.resolveVersion(versionId);
    const cr = await this.resolveCr(crCode);
    await this.assertCrAutorise(cr.id, user);

    return this.dataSource.transaction(async (m) => {
      const statut = await this.findStatut(m, versionId, cr.id);
      if (!statut || statut.statut !== 'SOUMIS') {
        throw new ConflictException(
          `Seul un CR SOUMIS peut être validé. Statut actuel : ` +
            `'${statut?.statut ?? 'aucun'}'.`,
        );
      }
      statut.statut = 'VALIDE';
      statut.dateValidation = new Date();
      statut.fkValidateur = String(user.userId);
      statut.fkUserModif = String(user.userId);
      statut.dateModification = new Date();
      const saved = await m.getRepository(FaitBudgetCrStatut).save(statut);

      await this.audit(
        m,
        user,
        'VALIDER_CR',
        'fait_budget_cr_statut',
        saved.id,
        {
          codeCr: cr.codeCr,
          versionId: String(versionId),
          statutAvant: 'SOUMIS',
          statutApres: 'VALIDE',
          commentaire: commentaire ?? null,
        },
        `Validation du CR ${cr.codeCr} (version ${version.codeVersion}).`,
      );

      // PALIER 3 (automation) : si tous les CR attendus du snapshot sont
      // VALIDE → bascule auto de la version OUVERT → PRE_VALIDE.
      return this.toResponse(saved, cr);
    });
  }

  // ─── Rejeter : SOUMIS → EN_SAISIE (validateur, motif obligatoire) ─

  async rejeter(
    versionId: string,
    crCode: string,
    motif: string,
    user: AuthUser,
  ): Promise<CrStatutResponseDto> {
    const version = await this.resolveVersion(versionId);
    const cr = await this.resolveCr(crCode);
    await this.assertCrAutorise(cr.id, user);

    return this.dataSource.transaction(async (m) => {
      const statut = await this.findStatut(m, versionId, cr.id);
      if (!statut || statut.statut !== 'SOUMIS') {
        throw new ConflictException(
          `Seul un CR SOUMIS peut être rejeté. Statut actuel : ` +
            `'${statut?.statut ?? 'aucun'}'.`,
        );
      }
      statut.statut = 'EN_SAISIE';
      statut.motifRejet = motif;
      statut.fkUserModif = String(user.userId);
      statut.dateModification = new Date();
      const saved = await m.getRepository(FaitBudgetCrStatut).save(statut);

      await this.audit(
        m,
        user,
        'REJETER_CR',
        'fait_budget_cr_statut',
        saved.id,
        {
          codeCr: cr.codeCr,
          versionId: String(versionId),
          statutAvant: 'SOUMIS',
          statutApres: 'EN_SAISIE',
          motif,
        },
        `Rejet du CR ${cr.codeCr} (version ${version.codeVersion}) : ${motif.slice(0, 200)}`,
      );
      return this.toResponse(saved, cr);
    });
  }

  // ─── Rouvrir : VALIDE → EN_SAISIE (validateur ayant validé) ───────

  async rouvrir(
    versionId: string,
    crCode: string,
    motif: string,
    user: AuthUser,
  ): Promise<CrStatutResponseDto> {
    const version = await this.resolveVersion(versionId);
    const cr = await this.resolveCr(crCode);
    await this.assertCrAutorise(cr.id, user);

    // Garde-fou version : réouverture interdite une fois la version
    // soumise au Comité / approuvée / gelée. (En palier 3, la bascule
    // PRE_VALIDE → OUVERT sera automatique ici.)
    if (version.statut !== 'ouvert' && version.statut !== 'pre_valide') {
      throw new ConflictException(
        `Réouverture impossible : la version est au statut ` +
          `'${version.statut}'.`,
      );
    }

    return this.dataSource.transaction(async (m) => {
      const statut = await this.findStatut(m, versionId, cr.id);
      if (!statut || statut.statut !== 'VALIDE') {
        throw new ConflictException(
          `Seul un CR VALIDE peut être rouvert. Statut actuel : ` +
            `'${statut?.statut ?? 'aucun'}'.`,
        );
      }
      // Seul le validateur qui a validé peut rouvrir (décision Lot —
      // simplicité 1er exercice).
      if (String(statut.fkValidateur) !== String(user.userId)) {
        throw new ForbiddenException(
          `Seul le validateur ayant validé ce CR peut le rouvrir.`,
        );
      }
      statut.statut = 'EN_SAISIE';
      statut.dateReouverture = new Date();
      statut.motifReouverture = motif;
      statut.fkUserModif = String(user.userId);
      statut.dateModification = new Date();
      const saved = await m.getRepository(FaitBudgetCrStatut).save(statut);

      await this.audit(
        m,
        user,
        'ROUVRIR_CR',
        'fait_budget_cr_statut',
        saved.id,
        {
          codeCr: cr.codeCr,
          versionId: String(versionId),
          statutAvant: 'VALIDE',
          statutApres: 'EN_SAISIE',
          motif,
        },
        `Réouverture du CR ${cr.codeCr} (version ${version.codeVersion}) : ${motif.slice(0, 200)}`,
      );

      // PALIER 3 (automation) : si la version était PRE_VALIDE → OUVERT.
      return this.toResponse(saved, cr);
    });
  }

  // ─── Lecture : statut d'un CR ─────────────────────────────────────

  async getStatut(
    versionId: string,
    crCode: string,
  ): Promise<CrStatutResponseDto> {
    await this.resolveVersion(versionId);
    const cr = await this.resolveCr(crCode);
    const statut = await this.statutRepo.findOne({
      where: { fkVersion: String(versionId), fkCr: String(cr.id) },
    });
    if (!statut) {
      // Aucun statut encore enregistré = CR jamais entré en saisie.
      return {
        versionId: String(versionId),
        crId: String(cr.id),
        crCode: cr.codeCr,
        statut: 'EN_SAISIE',
        dateSoumission: null,
        dateValidation: null,
        dateReouverture: null,
        fkSaisisseur: null,
        fkValidateur: null,
        motifRejet: null,
        motifReouverture: null,
      };
    }
    return this.toResponse(statut, cr);
  }

  // ─── Lecture : vue d'ensemble des CR d'une version ────────────────

  async getStatutsCrs(versionId: string): Promise<StatutsCrsResponseDto> {
    const version = await this.resolveVersion(versionId);

    // Snapshot des CR attendus (actif) joint au statut courant + emails.
    const rows = await this.dataSource.query<
      Array<{
        cr_id: string;
        cr_code: string;
        libelle: string;
        statut: StatutCrSaisie;
        saisisseur_email: string | null;
        validateur_email: string | null;
        date_soumission: Date | null;
        date_validation: Date | null;
      }>
    >(
      `SELECT
         a.fk_cr                                   AS cr_id,
         cr.code_cr                                AS cr_code,
         cr.libelle                                AS libelle,
         COALESCE(s.statut, 'EN_SAISIE')           AS statut,
         us.email                                  AS saisisseur_email,
         uv.email                                  AS validateur_email,
         s.date_soumission                         AS date_soumission,
         s.date_validation                         AS date_validation
       FROM dim_version_cr_attendu a
       JOIN dim_centre_responsabilite cr ON cr.id = a.fk_cr
       LEFT JOIN fait_budget_cr_statut s
              ON s.fk_version = a.fk_version AND s.fk_cr = a.fk_cr
       LEFT JOIN "user" us ON us.id = s.fk_saisisseur
       LEFT JOIN "user" uv ON uv.id = s.fk_validateur
       WHERE a.fk_version = $1 AND a.actif = true
       ORDER BY cr.code_cr`,
      [versionId],
    );

    const crs = rows.map((r) => ({
      crId: String(r.cr_id),
      crCode: r.cr_code,
      libelle: r.libelle,
      statut: r.statut,
      saisisseurEmail: r.saisisseur_email,
      validateurEmail: r.validateur_email,
      dateSoumission: r.date_soumission,
      dateValidation: r.date_validation,
    }));

    return {
      versionId: String(versionId),
      statutVersion: version.statut,
      totalAttendus: crs.length,
      nbValides: crs.filter((c) => c.statut === 'VALIDE').length,
      nbSoumis: crs.filter((c) => c.statut === 'SOUMIS').length,
      nbEnSaisie: crs.filter((c) => c.statut === 'EN_SAISIE').length,
      crs,
    };
  }

  // ─── Soumettre au Comité : PRE_VALIDE → SOUMIS_COMITE (Coordinateur)

  async soumettreComite(
    versionId: string,
    commentaire: string | undefined,
    user: AuthUser,
  ): Promise<DimVersion> {
    return this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(DimVersion);
      const v = await repo.findOne({ where: { id: versionId } });
      if (!v) throw new NotFoundException(`Version ${versionId} introuvable.`);
      if (v.statut !== 'pre_valide') {
        throw new ConflictException(
          `Seule une version PRE_VALIDE peut être soumise au Comité. ` +
            `Statut actuel : '${v.statut}'.`,
        );
      }
      v.statut = 'soumis_comite';
      v.dateModification = new Date();
      v.utilisateurModification = user.email;
      const saved = await repo.save(v);

      await this.audit(
        m,
        user,
        'SOUMETTRE_COMITE',
        'dim_version',
        String(versionId),
        {
          codeVersion: v.codeVersion,
          statutAvant: 'pre_valide',
          statutApres: 'soumis_comite',
          commentaire: commentaire ?? null,
        },
        `Soumission au Comité de ${v.codeVersion}.`,
      );
      return saved;
    });
  }
}
