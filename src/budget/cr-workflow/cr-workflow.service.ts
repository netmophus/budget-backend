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
 * Palier 3 : automation (bascule auto OUVERT↔PRE_VALIDE selon le
 * snapshot), verrou de saisie (assertCrModifiable), gestion du snapshot
 * des CR attendus, et émission des 6 événements (emails câblés à part).
 */
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { AuditService } from '../../audit/audit.service';
import type { TypeAction } from '../../audit/entities/audit-log.entity';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import {
  type CrWorkflowEventPayload,
  EVENT_CR_REJECTED,
  EVENT_CR_REOPENED,
  EVENT_CR_REVISION_DEMANDEE,
  EVENT_CR_SUBMITTED,
  EVENT_CR_VALIDATED,
  EVENT_VERSION_PRE_VALIDATED,
  EVENT_VERSION_SUBMITTED_COMITE,
} from '../../notifications/notifications.events';
import { DimCentreResponsabilite } from '../../referentiels/centre-responsabilite/entities/dim-centre-responsabilite.entity';
import { DimVersion } from '../../referentiels/version/entities/dim-version.entity';
import { PerimetreService } from '../services/perimetre.service';
import {
  CrStatutResponseDto,
  StatutsCrsResponseDto,
} from './dto/cr-statut-response.dto';
import { DimVersionCrAttendu } from './entities/dim-version-cr-attendu.entity';
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
    @InjectRepository(DimVersionCrAttendu)
    private readonly attenduRepo: Repository<DimVersionCrAttendu>,
    private readonly dataSource: DataSource,
    private readonly perimetreService: PerimetreService,
    private readonly auditService: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  private emit(
    event: string,
    versionId: string,
    codeVersion: string,
    cr: { id: string; codeCr: string },
    user: AuthUser,
    extra: { motif?: string | null; commentaire?: string | null } = {},
  ): void {
    this.events.emit(event, {
      versionId: String(versionId),
      codeVersion,
      crCode: cr.codeCr,
      crId: String(cr.id),
      auteurEmail: user.email,
      auteurId: String(user.userId),
      motif: extra.motif ?? null,
      commentaire: extra.commentaire ?? null,
    } satisfies CrWorkflowEventPayload);
  }

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
      this.emit(EVENT_CR_SUBMITTED, versionId, version.codeVersion, cr, user, {
        commentaire,
      });
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
      this.emit(EVENT_CR_VALIDATED, versionId, version.codeVersion, cr, user, {
        commentaire,
      });

      // Automation : si tous les CR attendus (snapshot actif) sont
      // VALIDE → bascule OUVERT → PRE_VALIDE.
      await this.basculerVersionSiTousValides(m, version, user);
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
      this.emit(EVENT_CR_REJECTED, versionId, version.codeVersion, cr, user, {
        motif,
      });
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
      this.emit(EVENT_CR_REOPENED, versionId, version.codeVersion, cr, user, {
        motif,
      });

      // Automation : un CR validé redevient EN_SAISIE → si la version
      // était PRE_VALIDE, elle repasse OUVERT.
      if (version.statut === 'pre_valide') {
        await m.getRepository(DimVersion).update(
          { id: String(versionId) },
          {
            statut: 'ouvert',
            dateModification: new Date(),
            utilisateurModification: user.email,
          },
        );
        await this.audit(
          m,
          user,
          'REOUVRIR_VERSION',
          'dim_version',
          String(versionId),
          {
            codeVersion: version.codeVersion,
            statutAvant: 'pre_valide',
            statutApres: 'ouvert',
            declencheur: cr.codeCr,
          },
          `Réouverture auto de ${version.codeVersion} (CR ${cr.codeCr} rouvert).`,
        );
      }
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

  /**
   * @param monPerimetrePourUserId si fourni, restreint la liste aux CR
   *   du périmètre de cet utilisateur (via PerimetreService — gère CR /
   *   CR_SET / STRUCTURE). `null` retourné par le périmètre = admin =
   *   pas de restriction. Sans ce paramètre : tous les CR du snapshot
   *   (cas Coordinateur / vue globale).
   */
  async getStatutsCrs(
    versionId: string,
    monPerimetrePourUserId?: string,
  ): Promise<StatutsCrsResponseDto> {
    const version = await this.resolveVersion(versionId);

    const crsAutorises = monPerimetrePourUserId
      ? await this.perimetreService.getCrAutorisesPourUser(
          monPerimetrePourUserId,
        )
      : null;

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

    // PNB par CR (Produits cl.7 − Charges cl.6) sur fait_budget × version.
    const pnbRows = await this.dataSource.query<
      Array<{ cr_id: string; pnb: string }>
    >(
      `SELECT fb.fk_centre AS cr_id,
              COALESCE(SUM(CASE WHEN c.classe = '7' THEN fb.montant_devise ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN c.classe = '6' THEN fb.montant_devise ELSE 0 END), 0) AS pnb
         FROM fait_budget fb
         JOIN dim_compte c ON c.id = fb.fk_compte
        WHERE fb.fk_version = $1
        GROUP BY fb.fk_centre`,
      [versionId],
    );
    const pnbParCr = new Map(
      pnbRows.map((r) => [String(r.cr_id), Number(r.pnb)]),
    );

    const tous = rows.map((r) => ({
      crId: String(r.cr_id),
      crCode: r.cr_code,
      libelle: r.libelle,
      statut: r.statut,
      saisisseurEmail: r.saisisseur_email,
      validateurEmail: r.validateur_email,
      dateSoumission: r.date_soumission,
      dateValidation: r.date_validation,
      pnb: pnbParCr.get(String(r.cr_id)) ?? 0,
    }));

    // Restriction périmètre si demandée (crsAutorises null = pas de filtre).
    const crs = crsAutorises
      ? tous.filter((c) => crsAutorises.includes(c.crId))
      : tous;

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
      this.events.emit(EVENT_VERSION_SUBMITTED_COMITE, {
        versionId: String(versionId),
        codeVersion: v.codeVersion,
        auteurEmail: user.email,
        auteurId: String(user.userId),
        commentaire: commentaire ?? null,
      });
      return saved;
    });
  }

  // ─── Approuver (Comité) : SOUMIS_COMITE → VALIDE (membre Comité) ───
  //
  // Mini-PR additive (transitions Comité) : le workflow version-globale
  // legacy (POST /referentiels/versions/:id/valider, garde-fou statut
  // 'soumis') reste inchangé — coexistence Option A. Ici on couvre la
  // sortie du statut 'soumis_comite' propre au workflow par CR.

  async approuverComite(
    versionId: string,
    commentaire: string | undefined,
    user: AuthUser,
  ): Promise<DimVersion> {
    return this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(DimVersion);
      const v = await repo.findOne({ where: { id: versionId } });
      if (!v) throw new NotFoundException(`Version ${versionId} introuvable.`);
      if (v.statut !== 'soumis_comite') {
        throw new ConflictException(
          `Seule une version SOUMIS_COMITE peut être approuvée par le Comité. ` +
            `Statut actuel : '${v.statut}'.`,
        );
      }
      v.statut = 'valide';
      v.dateModification = new Date();
      v.utilisateurModification = user.email;
      const saved = await repo.save(v);

      await this.audit(
        m,
        user,
        'APPROUVER_COMITE',
        'dim_version',
        String(versionId),
        {
          codeVersion: v.codeVersion,
          statutAvant: 'soumis_comite',
          statutApres: 'valide',
          commentaire: commentaire ?? null,
        },
        `Approbation par le Comité de ${v.codeVersion}.`,
      );
      return saved;
    });
  }

  // ─── Demander révision (Comité) : SOUMIS_COMITE → OUVERT ───────────
  //   + CR ciblé VALIDE → EN_SAISIE (transaction unique).
  //
  // À la différence de rouvrir() (réservé au validateur ayant validé),
  // l'action est portée par le Comité : pas de contrôle de périmètre sur
  // le CR (les membres du Comité statuent sur l'ensemble de la version).
  // Le garde-fou réel est le statut 'soumis_comite' (phase Comité) +
  // la permission BUDGET.VALIDER.

  async demanderRevision(
    versionId: string,
    crCode: string,
    motif: string,
    user: AuthUser,
  ): Promise<{
    versionId: string;
    crCode: string;
    statutVersion: string;
    statutCr: StatutCrSaisie;
  }> {
    const version = await this.resolveVersion(versionId);
    const cr = await this.resolveCr(crCode);

    if (version.statut !== 'soumis_comite') {
      throw new ConflictException(
        `Demande de révision impossible : la version doit être ` +
          `SOUMIS_COMITE. Statut actuel : '${version.statut}'.`,
      );
    }

    return this.dataSource.transaction(async (m) => {
      const statut = await this.findStatut(m, versionId, cr.id);
      if (!statut || statut.statut !== 'VALIDE') {
        throw new ConflictException(
          `Seul un CR VALIDE peut être renvoyé en révision. Statut ` +
            `actuel : '${statut?.statut ?? 'aucun'}'.`,
        );
      }

      // a) CR ciblé : VALIDE → EN_SAISIE (logique rouvrir, sans le
      //    garde-fou « version OUVERT » ni la restriction validateur).
      statut.statut = 'EN_SAISIE';
      statut.dateReouverture = new Date();
      statut.motifReouverture = motif;
      statut.fkUserModif = String(user.userId);
      statut.dateModification = new Date();
      const savedCr = await m.getRepository(FaitBudgetCrStatut).save(statut);

      // b) Version : SOUMIS_COMITE → OUVERT.
      await m.getRepository(DimVersion).update(
        { id: String(versionId) },
        {
          statut: 'ouvert',
          dateModification: new Date(),
          utilisateurModification: user.email,
        },
      );

      await this.audit(
        m,
        user,
        'DEMANDER_REVISION_COMITE',
        'dim_version',
        String(versionId),
        {
          codeVersion: version.codeVersion,
          crCible: cr.codeCr,
          statutVersionAvant: 'soumis_comite',
          statutVersionApres: 'ouvert',
          statutCrAvant: 'VALIDE',
          statutCrApres: 'EN_SAISIE',
          motif,
        },
        `Demande de révision du Comité sur ${version.codeVersion} — ` +
          `CR ${cr.codeCr} : ${motif.slice(0, 200)}`,
      );

      // Notifie le saisisseur ET le validateur du CR ciblé. Les listeners
      // email sont câblés dans le sous-lot notifications dédié (comme les
      // autres événements du cycle par CR).
      this.emit(
        EVENT_CR_REVISION_DEMANDEE,
        versionId,
        version.codeVersion,
        cr,
        user,
        {
          motif,
        },
      );

      return {
        versionId: String(versionId),
        crCode: cr.codeCr,
        statutVersion: 'ouvert',
        statutCr: savedCr.statut,
      };
    });
  }

  // ─── Automation : bascule version selon l'état du snapshot ─────────

  /**
   * Compte les CR attendus (snapshot actif) et combien sont VALIDE,
   * via LEFT JOIN sur le statut courant (défaut EN_SAISIE).
   */
  private async compterSnapshot(
    m: EntityManager,
    versionId: string,
  ): Promise<{ total: number; valides: number }> {
    const rows = await m.query<Array<{ statut: StatutCrSaisie }>>(
      `SELECT COALESCE(s.statut, 'EN_SAISIE') AS statut
         FROM dim_version_cr_attendu a
         LEFT JOIN fait_budget_cr_statut s
                ON s.fk_version = a.fk_version AND s.fk_cr = a.fk_cr
        WHERE a.fk_version = $1 AND a.actif = true`,
      [versionId],
    );
    return {
      total: rows.length,
      valides: rows.filter((r) => r.statut === 'VALIDE').length,
    };
  }

  /** OUVERT → PRE_VALIDE si tous les CR attendus du snapshot sont VALIDE. */
  private async basculerVersionSiTousValides(
    m: EntityManager,
    version: DimVersion,
    user: AuthUser,
  ): Promise<void> {
    if (version.statut !== 'ouvert') return;
    const { total, valides } = await this.compterSnapshot(m, version.id);
    if (total === 0 || valides !== total) return;
    await m.getRepository(DimVersion).update(
      { id: String(version.id) },
      {
        statut: 'pre_valide',
        dateModification: new Date(),
        utilisateurModification: user.email,
      },
    );
    await this.audit(
      m,
      user,
      'PRE_VALIDER_VERSION',
      'dim_version',
      String(version.id),
      {
        codeVersion: version.codeVersion,
        statutAvant: 'ouvert',
        statutApres: 'pre_valide',
        crValides: valides,
        crAttendus: total,
      },
      `Pré-validation auto de ${version.codeVersion} (${valides}/${total} CR validés).`,
    );
    this.events.emit(EVENT_VERSION_PRE_VALIDATED, {
      versionId: String(version.id),
      codeVersion: version.codeVersion,
      auteurEmail: user.email,
      auteurId: String(user.userId),
    });
  }

  // ─── Verrou de saisie ─────────────────────────────────────────────

  /**
   * Garde-fou appelé par la saisie/l'import AVANT toute écriture de
   * ligne budgétaire. Refuse (403 CR_VERROUILLE) si le CR est SOUMIS
   * ou VALIDE. Sinon garantit l'existence d'une ligne statut EN_SAISIE
   * (auto-création paresseuse à la 1ʳᵉ saisie — gère les saisies
   * préexistantes sans migration de données).
   */
  async assertCrModifiable(
    m: EntityManager,
    versionId: string,
    crId: string,
  ): Promise<void> {
    const repo = m.getRepository(FaitBudgetCrStatut);
    const statut = await repo.findOne({
      where: { fkVersion: String(versionId), fkCr: String(crId) },
    });
    if (statut && (statut.statut === 'SOUMIS' || statut.statut === 'VALIDE')) {
      throw new ForbiddenException({
        message: `Saisie verrouillée : ce CR est au statut '${statut.statut}'. Demandez une réouverture au validateur.`,
        code: 'CR_VERROUILLE',
      });
    }
    if (!statut) {
      await repo.insert({
        fkVersion: String(versionId),
        fkCr: String(crId),
        statut: 'EN_SAISIE',
      });
    }
  }

  // ─── Snapshot des CR attendus (Coordinateur) ──────────────────────

  /**
   * (Ré)initialise le snapshot des CR attendus = union des périmètres
   * effectifs des utilisateurs actifs portant le rôle SAISISSEUR.
   * Idempotent : n'insère que les CR manquants (figés une fois posés).
   */
  async initialiserSnapshot(
    versionId: string,
    user: AuthUser,
  ): Promise<{ ajoutes: number; total: number }> {
    const version = await this.resolveVersion(versionId);
    const users = await this.dataSource.query<Array<{ fk_user: string }>>(
      `SELECT DISTINCT bur.fk_user
         FROM bridge_user_role bur
         JOIN ref_role r ON r.id = bur.fk_role
         JOIN "user" u ON u.id = bur.fk_user
        WHERE r.code_role = 'SAISISSEUR'
          AND bur.est_actif = true
          AND u.est_actif = true`,
    );
    const crSet = new Set<string>();
    for (const u of users) {
      const crs = await this.perimetreService.getPerimetreEffectif(
        String(u.fk_user),
      );
      crs.forEach((c) => crSet.add(String(c)));
    }
    return this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(DimVersionCrAttendu);
      let ajoutes = 0;
      for (const crId of crSet) {
        const exists = await repo.findOne({
          where: { fkVersion: String(versionId), fkCr: crId },
        });
        if (!exists) {
          await repo.insert({
            fkVersion: String(versionId),
            fkCr: crId,
            source: 'AUTO',
            actif: true,
          });
          ajoutes++;
        }
      }
      await this.audit(
        m,
        user,
        'INIT_SNAPSHOT_CR',
        'dim_version',
        String(versionId),
        {
          codeVersion: version.codeVersion,
          crAttendus: crSet.size,
          ajoutes,
        },
        `Initialisation snapshot ${version.codeVersion} : ${crSet.size} CR attendus (${ajoutes} ajoutés).`,
      );
      return { ajoutes, total: crSet.size };
    });
  }

  /** Retrait manuel d'un CR du snapshot (actif=false, tracé). */
  async retirerCrSnapshot(
    versionId: string,
    crCode: string,
    motif: string,
    user: AuthUser,
  ): Promise<{ crCode: string; retire: boolean }> {
    const version = await this.resolveVersion(versionId);
    const cr = await this.resolveCr(crCode);
    return this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(DimVersionCrAttendu);
      const row = await repo.findOne({
        where: {
          fkVersion: String(versionId),
          fkCr: String(cr.id),
          actif: true,
        },
      });
      if (!row) {
        throw new NotFoundException(
          `CR ${crCode} absent du snapshot actif de la version.`,
        );
      }
      row.actif = false;
      row.motifRetrait = motif;
      row.dateModification = new Date();
      row.utilisateurModification = user.email;
      await repo.save(row);
      await this.audit(
        m,
        user,
        'RETIRER_CR_SNAPSHOT',
        'dim_version_cr_attendu',
        String(row.id),
        {
          codeVersion: version.codeVersion,
          codeCr: cr.codeCr,
          motif,
        },
        `Retrait du CR ${cr.codeCr} du snapshot ${version.codeVersion} : ${motif.slice(0, 200)}`,
      );
      return { crCode: cr.codeCr, retire: true };
    });
  }
}
