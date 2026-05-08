/**
 * Tests workflow Lot 5.3.A — vérifient que VersionWorkflowService
 * (Lot 3.5) émet les codes audit *_REFORECAST quand
 * type_version='reforecast' au lieu de *_BUDGET, et qu'une version
 * marquée OBSOLETE refuse les transitions.
 */
import { ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource } from 'typeorm';

import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../auth/permissions.service';
import { DimCentreResponsabilite } from '../referentiels/centre-responsabilite/entities/dim-centre-responsabilite.entity';
import { DimCompte } from '../referentiels/compte/entities/dim-compte.entity';
import { DimDevise } from '../referentiels/devise/entities/dim-devise.entity';
import { DimLigneMetier } from '../referentiels/ligne-metier/entities/dim-ligne-metier.entity';
import { DimProduit } from '../referentiels/produit/entities/dim-produit.entity';
import { DimScenario } from '../referentiels/scenario/entities/dim-scenario.entity';
import { DimSegment } from '../referentiels/segment/entities/dim-segment.entity';
import { DimStructure } from '../referentiels/structure/entities/dim-structure.entity';
import { DimTemps } from '../referentiels/temps/entities/dim-temps.entity';
import { DimVersion } from '../referentiels/version/entities/dim-version.entity';
import { VersionWorkflowService } from '../referentiels/version/version-workflow.service';
import { FaitBudget } from '../faits/budget/entities/fait-budget.entity';
import { FaitRealise } from '../realise/entities/fait-realise.entity';
import { Permission } from '../roles/entities/permission.entity';
import { Role } from '../roles/entities/role.entity';
import { RolePermission } from '../roles/entities/role-permission.entity';
import { User } from '../users/entities/user.entity';
import { UserPerimetre } from '../users/entities/user-perimetre.entity';
import { UserRole } from '../users/entities/user-role.entity';

function buildMemDb(): IMemoryDb {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({
    name: 'current_database',
    args: [],
    returns: DataType.text,
    implementation: () => 'test',
  });
  db.public.registerFunction({
    name: 'version',
    args: [],
    returns: DataType.text,
    implementation: () => 'PG 15',
  });
  return db;
}

async function createDataSource(): Promise<DataSource> {
  const db = buildMemDb();
  const ds = db.adapters.createTypeormDataSource({
    type: 'postgres',
    entities: [
      AuditLog,
      User, UserRole, UserPerimetre,
      Role, Permission, RolePermission,
      DimStructure, DimCentreResponsabilite, DimCompte,
      DimLigneMetier, DimDevise, DimProduit, DimSegment,
      DimTemps, DimVersion, DimScenario,
      FaitBudget, FaitRealise,
    ],
    synchronize: true,
  }) as DataSource;
  await ds.initialize();
  return ds;
}

interface SeedIds {
  versionReforecastId: string;
  versionBudgetId: string;
}

async function seed(ds: DataSource): Promise<SeedIds> {
  // Insertion minimale : 1 version source + 1 reforecast en ouvert
  // avec 1 ligne fait_budget (pour passer le check "vide" à
  // soumettre()).
  await ds.query(
    `INSERT INTO dim_structure
       (code_structure, libelle, type_structure, niveau_hierarchique,
        date_debut_validite, version_courante, est_actif, utilisateur_creation)
     VALUES ('S','S','filiale',1,'2026-01-01',true,true,'system')`,
  );
  const struct = (await ds.query(`SELECT id FROM dim_structure`)) as Array<{ id: string }>;
  await ds.query(
    `INSERT INTO dim_centre_responsabilite
       (code_cr, libelle, type_cr, fk_structure, date_debut_validite,
        version_courante, est_actif, utilisateur_creation)
     VALUES ('CR','CR','profit_center',$1::bigint,'2026-01-01',true,true,'system')`,
    [struct[0]!.id],
  );
  const cr = (await ds.query(`SELECT id FROM dim_centre_responsabilite`)) as Array<{ id: string }>;
  await ds.query(
    `INSERT INTO dim_compte
       (code_compte, libelle, classe, niveau, est_compte_collectif,
        est_porteur_interets, date_debut_validite, version_courante,
        est_actif, utilisateur_creation)
     VALUES ('611','C','6',4,false,false,'2026-01-01',true,true,'system')`,
  );
  const cpt = (await ds.query(`SELECT id FROM dim_compte`)) as Array<{ id: string }>;
  await ds.query(
    `INSERT INTO dim_ligne_metier
       (code_ligne_metier, libelle, niveau, date_debut_validite,
        version_courante, est_actif, utilisateur_creation)
     VALUES ('LM','LM',1,'2026-01-01',true,true,'system')`,
  );
  const lm = (await ds.query(`SELECT id FROM dim_ligne_metier`)) as Array<{ id: string }>;
  await ds.query(
    `INSERT INTO dim_devise (code_iso, libelle, symbole, nb_decimales,
       est_devise_pivot, est_active, utilisateur_creation)
     VALUES ('XOF','F CFA','F CFA',0,true,true,'system')`,
  );
  const dev = (await ds.query(`SELECT id FROM dim_devise`)) as Array<{ id: string }>;
  await ds.query(
    `INSERT INTO dim_produit (code_produit, libelle, type_produit, niveau,
       est_porteur_interets, date_debut_validite, version_courante,
       est_actif, utilisateur_creation)
     VALUES ('P','P','autre',1,false,'2026-01-01',true,true,'system')`,
  );
  const prod = (await ds.query(`SELECT id FROM dim_produit`)) as Array<{ id: string }>;
  await ds.query(
    `INSERT INTO dim_segment (code_segment, libelle, categorie,
       date_debut_validite, version_courante, est_actif, utilisateur_creation)
     VALUES ('S','S','particulier','2026-01-01',true,true,'system')`,
  );
  const seg = (await ds.query(`SELECT id FROM dim_segment`)) as Array<{ id: string }>;
  await ds.query(
    `INSERT INTO dim_temps
       (date, annee, trimestre, mois, jour, jour_ouvre, est_fin_de_mois,
        est_fin_de_trimestre, est_fin_d_annee, exercice_fiscal, libelle_mois)
     VALUES ('2027-01-01',2027,1,1,1,true,false,false,false,2027,'M1')`,
  );
  const t = (await ds.query(`SELECT id FROM dim_temps`)) as Array<{ id: string }>;
  await ds.query(
    `INSERT INTO dim_scenario (code_scenario, libelle, type_scenario,
       statut, exercice_fiscal, utilisateur_creation)
     VALUES ('S','S','central','actif',2027,'system')`,
  );
  const sce = (await ds.query(`SELECT id FROM dim_scenario`)) as Array<{ id: string }>;

  // Version BUDGET (publiée) qui sert de source
  await ds.query(
    `INSERT INTO dim_version
       (code_version, libelle, type_version, exercice_fiscal, statut,
        statut_publication, utilisateur_creation)
     VALUES ('BI','Budget','budget_initial',2027,'gele','ACTIVE','system')`,
  );
  // Version REFORECAST en BROUILLON
  await ds.query(
    `INSERT INTO dim_version
       (code_version, libelle, type_version, exercice_fiscal, statut,
        statut_publication, fk_version_source, fk_scenario_source,
        trimestre_consolide, annee_consolide, methode_extrapolation,
        utilisateur_creation)
     VALUES ('REF','Refo','reforecast',2027,'ouvert','ACTIVE',
             1, 1, 1, 2027, 'BUDGET_INITIAL', 'system')`,
  );
  const versions = (await ds.query(
    `SELECT id, type_version FROM dim_version ORDER BY id`,
  )) as Array<{ id: string; type_version: string }>;
  const versionBudgetId = String(
    versions.find((v) => v.type_version === 'budget_initial')!.id,
  );
  const versionReforecastId = String(
    versions.find((v) => v.type_version === 'reforecast')!.id,
  );

  // 1 ligne fait_budget pour les 2 versions (pour qu'elles ne soient pas vides)
  for (const fkVer of [versionBudgetId, versionReforecastId]) {
    await ds.query(
      `INSERT INTO fait_budget
        (fk_temps, fk_compte, fk_structure, fk_centre, fk_ligne_metier,
         fk_produit, fk_segment, fk_devise, fk_version, fk_scenario,
         montant_devise, montant_fcfa, taux_change_applique, mode_saisie,
         utilisateur_creation)
       VALUES ($1::bigint, $2::bigint, $3::bigint, $4::bigint, $5::bigint,
               $6::bigint, $7::bigint, $8::bigint, $9::bigint, $10::bigint,
               1000, 1000, 1, 'MONTANT', 'system')`,
      [
        t[0]!.id, cpt[0]!.id, struct[0]!.id, cr[0]!.id, lm[0]!.id,
        prod[0]!.id, seg[0]!.id, dev[0]!.id, fkVer, sce[0]!.id,
      ],
    );
  }

  return { versionReforecastId, versionBudgetId };
}

function buildWorkflow(ds: DataSource): VersionWorkflowService {
  const versionRepo = ds.getRepository(DimVersion);
  const audit = new AuditService(ds.getRepository(AuditLog));
  const events = new EventEmitter2();
  // Stub PermissionsService.getDelegationContextPour → toujours null
  const perms = {
    getDelegationContextPour: async () => null,
  } as unknown as PermissionsService;
  return new VersionWorkflowService(versionRepo, ds, audit, perms, events);
}

const USER = { userId: 'u1', email: 'admin@m.io' };

describe('VersionWorkflowService — comportement spécifique reforecast (Lot 5.3.A)', () => {
  let ds: DataSource;
  let ids: SeedIds;

  beforeEach(async () => {
    ds = await createDataSource();
    ids = await seed(ds);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('soumettre un reforecast émet SOUMETTRE_REFORECAST (et non SOUMETTRE_BUDGET)', async () => {
    const wf = buildWorkflow(ds);
    await wf.soumettre(ids.versionReforecastId, { commentaire: 'go' }, USER);
    const audits = (await ds.query(
      `SELECT type_action FROM audit_log WHERE id_cible = $1::text`,
      [ids.versionReforecastId],
    )) as Array<{ type_action: string }>;
    expect(audits.map((a) => a.type_action)).toContain('SOUMETTRE_REFORECAST');
    expect(audits.map((a) => a.type_action)).not.toContain('SOUMETTRE_BUDGET');
  });

  it('soumettre une version normale (budget_initial) émet toujours SOUMETTRE_BUDGET (rétrocompat)', async () => {
    // La version source est en gele, on la repasse en ouvert + ligne pour soumettre
    await ds.query(
      `UPDATE dim_version SET statut = 'ouvert' WHERE id = $1::bigint`,
      [ids.versionBudgetId],
    );
    const wf = buildWorkflow(ds);
    await wf.soumettre(ids.versionBudgetId, { commentaire: 'go' }, USER);
    const audits = (await ds.query(
      `SELECT type_action FROM audit_log WHERE id_cible = $1::text`,
      [ids.versionBudgetId],
    )) as Array<{ type_action: string }>;
    expect(audits.map((a) => a.type_action)).toContain('SOUMETTRE_BUDGET');
    expect(audits.map((a) => a.type_action)).not.toContain('SOUMETTRE_REFORECAST');
  });

  it('valider un reforecast émet VALIDER_REFORECAST', async () => {
    await ds.query(
      `UPDATE dim_version SET statut = 'soumis' WHERE id = $1::bigint`,
      [ids.versionReforecastId],
    );
    const wf = buildWorkflow(ds);
    await wf.valider(ids.versionReforecastId, {}, USER);
    const audits = (await ds.query(
      `SELECT type_action FROM audit_log WHERE id_cible = $1::text`,
      [ids.versionReforecastId],
    )) as Array<{ type_action: string }>;
    expect(audits.map((a) => a.type_action)).toContain('VALIDER_REFORECAST');
  });

  it('rejeter un reforecast émet REJETER_REFORECAST avec motif', async () => {
    await ds.query(
      `UPDATE dim_version SET statut = 'soumis' WHERE id = $1::bigint`,
      [ids.versionReforecastId],
    );
    const wf = buildWorkflow(ds);
    await wf.rejeter(
      ids.versionReforecastId,
      { commentaire: 'Mauvaise méthode' },
      USER,
    );
    const audits = (await ds.query(
      `SELECT type_action, payload_apres FROM audit_log
        WHERE id_cible = $1::text AND type_action = 'REJETER_REFORECAST'`,
      [ids.versionReforecastId],
    )) as Array<{ type_action: string; payload_apres: { commentaireRejet?: string } }>;
    expect(audits).toHaveLength(1);
    expect(audits[0]!.payload_apres.commentaireRejet).toBe('Mauvaise méthode');
  });

  it('publier un reforecast émet PUBLIER_REFORECAST', async () => {
    await ds.query(
      `UPDATE dim_version SET statut = 'valide' WHERE id = $1::bigint`,
      [ids.versionReforecastId],
    );
    const wf = buildWorkflow(ds);
    await wf.publier(ids.versionReforecastId, {}, USER);
    const audits = (await ds.query(
      `SELECT type_action FROM audit_log WHERE id_cible = $1::text`,
      [ids.versionReforecastId],
    )) as Array<{ type_action: string }>;
    expect(audits.map((a) => a.type_action)).toContain('PUBLIER_REFORECAST');
  });

  it('refuse soumettre si reforecast OBSOLETE', async () => {
    await ds.query(
      `UPDATE dim_version SET statut_publication = 'OBSOLETE' WHERE id = $1::bigint`,
      [ids.versionReforecastId],
    );
    const wf = buildWorkflow(ds);
    await expect(
      wf.soumettre(ids.versionReforecastId, {}, USER),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuse valider si reforecast OBSOLETE (même en statut soumis)', async () => {
    await ds.query(
      `UPDATE dim_version SET statut = 'soumis', statut_publication = 'OBSOLETE'
        WHERE id = $1::bigint`,
      [ids.versionReforecastId],
    );
    const wf = buildWorkflow(ds);
    await expect(
      wf.valider(ids.versionReforecastId, {}, USER),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuse publier si reforecast OBSOLETE (même en statut valide)', async () => {
    await ds.query(
      `UPDATE dim_version SET statut = 'valide', statut_publication = 'OBSOLETE'
        WHERE id = $1::bigint`,
      [ids.versionReforecastId],
    );
    const wf = buildWorkflow(ds);
    await expect(
      wf.publier(ids.versionReforecastId, {}, USER),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuse de re-soumettre une version déjà soumise (ConflictException standard)', async () => {
    await ds.query(
      `UPDATE dim_version SET statut = 'soumis' WHERE id = $1::bigint`,
      [ids.versionReforecastId],
    );
    const wf = buildWorkflow(ds);
    await expect(
      wf.soumettre(ids.versionReforecastId, {}, USER),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
