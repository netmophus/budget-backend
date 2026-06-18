/**
 * Tests unitaires CrWorkflowService (Lot workflow par CR, palier 2).
 *
 * Couvre : transitions (soumettre/valider/rejeter/rouvrir), garde-fous
 * (périmètre, CR vide, statut incohérent, réouverture réservée au
 * validateur), vue d'ensemble + compteur, soumission Comité, et la
 * trace d'audit écrite à chaque action.
 *
 * DB pg-mem avec seed minimal : 1 structure, 2 CR (CR_A, CR_B), 1
 * version ouverte, 1 saisisseur (périmètre [CR_A]), 1 validateur
 * (périmètre [CR_A, CR_B]).
 */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource } from 'typeorm';

import { AuditService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import type { AuthUser } from '../../auth/decorators/current-user.decorator';
import { DimCentreResponsabilite } from '../../referentiels/centre-responsabilite/entities/dim-centre-responsabilite.entity';
import { DimCompte } from '../../referentiels/compte/entities/dim-compte.entity';
import { DimDevise } from '../../referentiels/devise/entities/dim-devise.entity';
import { DimLigneMetier } from '../../referentiels/ligne-metier/entities/dim-ligne-metier.entity';
import { DimProduit } from '../../referentiels/produit/entities/dim-produit.entity';
import { DimScenario } from '../../referentiels/scenario/entities/dim-scenario.entity';
import { DimSegment } from '../../referentiels/segment/entities/dim-segment.entity';
import { DimStructure } from '../../referentiels/structure/entities/dim-structure.entity';
import { DimTemps } from '../../referentiels/temps/entities/dim-temps.entity';
import { DimVersion } from '../../referentiels/version/entities/dim-version.entity';
import { FaitBudget } from '../../faits/budget/entities/fait-budget.entity';
import { Permission } from '../../roles/entities/permission.entity';
import { Role } from '../../roles/entities/role.entity';
import { RolePermission } from '../../roles/entities/role-permission.entity';
import { UserPerimetre } from '../../users/entities/user-perimetre.entity';
import { UserRole } from '../../users/entities/user-role.entity';
import { User } from '../../users/entities/user.entity';
import { PerimetreService } from '../services/perimetre.service';
import { CrWorkflowService } from './cr-workflow.service';
import { DimVersionCrAttendu } from './entities/dim-version-cr-attendu.entity';
import { FaitBudgetCrStatut } from './entities/fait-budget-cr-statut.entity';

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
    implementation: () => 'PostgreSQL 15 (pg-mem)',
  });
  return db;
}

async function createDataSource(): Promise<DataSource> {
  const db = buildMemDb();
  const ds: DataSource = db.adapters.createTypeormDataSource({
    type: 'postgres',
    entities: [
      User,
      UserRole,
      UserPerimetre,
      Role,
      Permission,
      RolePermission,
      DimStructure,
      DimCentreResponsabilite,
      DimVersion,
      DimScenario,
      DimCompte,
      DimTemps,
      DimLigneMetier,
      DimProduit,
      DimSegment,
      DimDevise,
      FaitBudget,
      AuditLog,
      FaitBudgetCrStatut,
      DimVersionCrAttendu,
    ],
    synchronize: true,
  });
  await ds.initialize();
  return ds;
}

describe('CrWorkflowService', () => {
  let ds: DataSource;
  let service: CrWorkflowService;
  const ids: Record<string, string> = {};
  let saisisseur: AuthUser;
  let validateur: AuthUser;

  async function scalar(sql: string, params: unknown[] = []): Promise<string> {
    const r = (await ds.query(sql, params)) as Array<{ id: string }>;
    return String(r[0]!.id);
  }

  beforeAll(async () => {
    ds = await createDataSource();
    const perimetreService = new PerimetreService(
      ds.getRepository(UserRole),
      ds.getRepository(UserPerimetre),
    );
    const auditService = new AuditService(ds.getRepository(AuditLog));
    service = new CrWorkflowService(
      ds.getRepository(FaitBudgetCrStatut),
      ds.getRepository(DimVersion),
      ds.getRepository(DimCentreResponsabilite),
      ds.getRepository(DimVersionCrAttendu),
      ds,
      perimetreService,
      auditService,
      { emit: jest.fn() } as unknown as EventEmitter2,
    );

    // Structure + 2 CR
    await ds.query(
      `INSERT INTO dim_structure
        ("code_structure","libelle","libelle_court","type_structure","niveau_hierarchique",
         "fk_structure_parent","code_pays","date_debut_validite","date_fin_validite",
         "version_courante","est_actif","utilisateur_creation")
       VALUES ('AG','Agence',NULL,'agence',1,NULL,NULL,'2026-01-01',NULL,true,true,'system')`,
    );
    ids.struct = await scalar(
      `SELECT id FROM dim_structure WHERE code_structure='AG'`,
    );
    for (const code of ['CR_A', 'CR_B']) {
      await ds.query(
        `INSERT INTO dim_centre_responsabilite
          ("code_cr","libelle","libelle_court","type_cr","fk_structure",
           "date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
         VALUES ($1,$1,NULL,'cdc',$2,'2026-01-01',NULL,true,true,'system')`,
        [code, ids.struct],
      );
    }
    ids.crA = await scalar(
      `SELECT id FROM dim_centre_responsabilite WHERE code_cr='CR_A'`,
    );
    ids.crB = await scalar(
      `SELECT id FROM dim_centre_responsabilite WHERE code_cr='CR_B'`,
    );

    // Version ouverte + scénario
    await ds.query(
      `INSERT INTO dim_version
        ("code_version","libelle","type_version","exercice_fiscal","statut","utilisateur_creation")
       VALUES ('BUDGET_2027','Budget 2027','budget_initial',2027,'ouvert','system')`,
    );
    ids.version = await scalar(
      `SELECT id FROM dim_version WHERE code_version='BUDGET_2027'`,
    );
    await ds.query(
      `INSERT INTO dim_scenario
        ("code_scenario","libelle","type_scenario","statut","exercice_fiscal","utilisateur_creation")
       VALUES ('MEDIAN','Médian','central','actif',2027,'system')`,
    );
    ids.scenario = await scalar(
      `SELECT id FROM dim_scenario WHERE code_scenario='MEDIAN'`,
    );

    // 2 users + bridge_user_role actif + périmètres
    for (const email of ['saisisseur@m.local', 'validateur@m.local']) {
      await ds.query(
        `INSERT INTO "user"
          ("email","mot_de_passe_hash","nom","prenom","est_actif","utilisateur_creation")
         VALUES ($1,'hash','N','P',true,'system')`,
        [email],
      );
    }
    ids.uSaisisseur = await scalar(
      `SELECT id FROM "user" WHERE email='saisisseur@m.local'`,
    );
    ids.uValidateur = await scalar(
      `SELECT id FROM "user" WHERE email='validateur@m.local'`,
    );
    await ds.query(
      `INSERT INTO ref_role
        ("code_role","libelle","description","est_actif","utilisateur_creation")
       VALUES ('R_TEST','Rôle test',NULL,true,'system')`,
    );
    ids.role = await scalar(`SELECT id FROM ref_role WHERE code_role='R_TEST'`);
    for (const uid of [ids.uSaisisseur, ids.uValidateur]) {
      await ds.query(
        `INSERT INTO bridge_user_role
          ("fk_user","fk_role","perimetre_type","est_actif","utilisateur_creation")
         VALUES ($1,$2,'global',true,'system')`,
        [uid, ids.role],
      );
    }
    // Rôle SAISISSEUR pour le saisisseur (initialiserSnapshot filtre dessus).
    await ds.query(
      `INSERT INTO ref_role
        ("code_role","libelle","description","est_actif","utilisateur_creation")
       VALUES ('SAISISSEUR','Saisisseur',NULL,true,'system')`,
    );
    const roleSais = await scalar(
      `SELECT id FROM ref_role WHERE code_role='SAISISSEUR'`,
    );
    await ds.query(
      `INSERT INTO bridge_user_role
        ("fk_user","fk_role","perimetre_type","est_actif","utilisateur_creation")
       VALUES ($1,$2,'global',true,'system')`,
      [ids.uSaisisseur, roleSais],
    );

    // Saisisseur → [CR_A] ; Validateur → [CR_A, CR_B]
    await ds.query(
      `INSERT INTO user_perimetres
        ("fk_user","cible_type","cible_id","cible_cr_ids","origine",
         "date_debut","date_fin","actif","utilisateur_creation")
       VALUES ($1,'CR_SET',NULL,$2,'AFFECTATION','2026-01-01',NULL,true,'system')`,
      [ids.uSaisisseur, [ids.crA]],
    );
    await ds.query(
      `INSERT INTO user_perimetres
        ("fk_user","cible_type","cible_id","cible_cr_ids","origine",
         "date_debut","date_fin","actif","utilisateur_creation")
       VALUES ($1,'CR_SET',NULL,$2,'AFFECTATION','2026-01-01',NULL,true,'system')`,
      [ids.uValidateur, [ids.crA, ids.crB]],
    );

    // Dims référencées par fait_budget (FK enforced par pg-mem).
    await ds.query(
      `INSERT INTO dim_compte
        ("code_compte","libelle","classe","fk_compte_parent","niveau",
         "est_compte_collectif","est_porteur_interets",
         "date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
       VALUES ('611100','Salaires','6',NULL,4,false,false,'2026-01-01',NULL,true,true,'system')`,
    );
    ids.compte = await scalar(
      `SELECT id FROM dim_compte WHERE code_compte='611100'`,
    );
    await ds.query(
      `INSERT INTO dim_ligne_metier
        ("code_ligne_metier","libelle","fk_ligne_metier_parent","niveau",
         "date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
       VALUES ('RETAIL','Retail',NULL,1,'2026-01-01',NULL,true,true,'system')`,
    );
    ids.lm = await scalar(
      `SELECT id FROM dim_ligne_metier WHERE code_ligne_metier='RETAIL'`,
    );
    await ds.query(
      `INSERT INTO dim_temps
        ("date","annee","trimestre","mois","jour","jour_ouvre","est_fin_de_mois",
         "est_fin_de_trimestre","est_fin_d_annee","exercice_fiscal","libelle_mois")
       VALUES ('2027-01-01',2027,1,1,1,true,false,false,false,2027,'Janvier')`,
    );
    ids.temps = await scalar(
      `SELECT id FROM dim_temps WHERE date='2027-01-01'`,
    );
    await ds.query(
      `INSERT INTO dim_devise
        ("code_iso","libelle","symbole","nb_decimales","est_devise_pivot","est_active","utilisateur_creation")
       VALUES ('XOF','Franc CFA','F CFA',0,true,true,'system')`,
    );
    ids.devise = await scalar(`SELECT id FROM dim_devise WHERE code_iso='XOF'`);
    await ds.query(
      `INSERT INTO dim_produit
        ("code_produit","libelle","type_produit","fk_produit_parent","niveau",
         "est_porteur_interets","date_debut_validite","date_fin_validite",
         "version_courante","est_actif","utilisateur_creation")
       VALUES ('PRD','Produit','autre',NULL,1,false,'2026-01-01',NULL,true,true,'system')`,
    );
    ids.produit = await scalar(
      `SELECT id FROM dim_produit WHERE code_produit='PRD'`,
    );
    await ds.query(
      `INSERT INTO dim_segment
        ("code_segment","libelle","categorie",
         "date_debut_validite","date_fin_validite","version_courante","est_actif","utilisateur_creation")
       VALUES ('SEG','Segment','particulier','2026-01-01',NULL,true,true,'system')`,
    );
    ids.segment = await scalar(
      `SELECT id FROM dim_segment WHERE code_segment='SEG'`,
    );

    // 1 ligne fait_budget pour CR_A (garde-fou « ≥1 ligne »)
    await ds.query(
      `INSERT INTO fait_budget
        ("fk_temps","fk_compte","fk_structure","fk_centre","fk_ligne_metier",
         "fk_produit","fk_segment","fk_devise","fk_version","fk_scenario",
         "montant_devise","montant_fcfa","taux_change_applique","mode_saisie","utilisateur_creation")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1000,1000,1,'MONTANT','system')`,
      [
        ids.temps,
        ids.compte,
        ids.struct,
        ids.crA,
        ids.lm,
        ids.produit,
        ids.segment,
        ids.devise,
        ids.version,
        ids.scenario,
      ],
    );

    // Snapshot CR attendus : CR_A + CR_B
    for (const crId of [ids.crA, ids.crB]) {
      await ds.query(
        `INSERT INTO dim_version_cr_attendu
          ("fk_version","fk_cr","source","actif","utilisateur_creation")
         VALUES ($1,$2,'AUTO',true,'system')`,
        [ids.version, crId],
      );
    }

    saisisseur = { userId: ids.uSaisisseur, email: 'saisisseur@m.local' };
    validateur = { userId: ids.uValidateur, email: 'validateur@m.local' };
  });

  afterAll(async () => {
    await ds.destroy();
  });

  async function auditCount(typeAction: string): Promise<number> {
    const r = (await ds.query(
      `SELECT COUNT(*)::int AS n FROM audit_log WHERE type_action=$1`,
      [typeAction],
    )) as Array<{ n: number }>;
    return r[0]?.n ?? 0;
  }

  // Les tests s'enchaînent sur le même CR_A (cycle complet).

  it('soumettre : CR_A vide refusé si pas de ligne → ici OK (a une ligne) → SOUMIS + audit', async () => {
    const res = await service.soumettre(
      ids.version,
      'CR_A',
      'fini',
      saisisseur,
    );
    expect(res.statut).toBe('SOUMIS');
    expect(res.fkSaisisseur).toBe(ids.uSaisisseur);
    expect(await auditCount('SOUMETTRE_CR')).toBe(1);
  });

  it('soumettre : CR hors périmètre du saisisseur → Forbidden', async () => {
    await expect(
      service.soumettre(ids.version, 'CR_B', undefined, saisisseur),
    ).rejects.toThrow(ForbiddenException);
  });

  it('soumettre : CR_B sans ligne fait_budget → 422', async () => {
    await expect(
      service.soumettre(ids.version, 'CR_B', undefined, validateur),
    ).rejects.toThrow(/vide/);
  });

  it('valider : CR_A SOUMIS → VALIDE + audit', async () => {
    const res = await service.valider(ids.version, 'CR_A', 'ok', validateur);
    expect(res.statut).toBe('VALIDE');
    expect(res.fkValidateur).toBe(ids.uValidateur);
    expect(await auditCount('VALIDER_CR')).toBe(1);
  });

  it('rouvrir : un autre user que le validateur → Forbidden', async () => {
    await expect(
      service.rouvrir(ids.version, 'CR_A', 'motif', saisisseur),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rouvrir : le validateur ayant validé → EN_SAISIE + audit', async () => {
    const res = await service.rouvrir(
      ids.version,
      'CR_A',
      'arbitrage DG',
      validateur,
    );
    expect(res.statut).toBe('EN_SAISIE');
    expect(res.motifReouverture).toBe('arbitrage DG');
    expect(await auditCount('ROUVRIR_CR')).toBe(1);
  });

  it('rejeter : re-soumis puis rejeté → EN_SAISIE + motif + audit', async () => {
    await service.soumettre(ids.version, 'CR_A', undefined, saisisseur);
    const res = await service.rejeter(
      ids.version,
      'CR_A',
      'charges sous-évaluées',
      validateur,
    );
    expect(res.statut).toBe('EN_SAISIE');
    expect(res.motifRejet).toBe('charges sous-évaluées');
    expect(await auditCount('REJETER_CR')).toBe(1);
  });

  it('valider : refuse si le CR n’est pas SOUMIS', async () => {
    // CR_A est EN_SAISIE après le rejet précédent.
    await expect(
      service.valider(ids.version, 'CR_A', undefined, validateur),
    ).rejects.toThrow(ConflictException);
  });

  it('getStatutsCrs : compteur sur le snapshot (2 CR attendus)', async () => {
    const vue = await service.getStatutsCrs(ids.version);
    expect(vue.totalAttendus).toBe(2);
    expect(vue.statutVersion).toBe('ouvert');
    expect(vue.crs.map((c) => c.crCode).sort()).toEqual(['CR_A', 'CR_B']);
    // CR_A : 1 ligne fait_budget classe 6 (1000) → PNB = -1000.
    expect(vue.crs.find((c) => c.crCode === 'CR_A')?.pnb).toBe(-1000);
  });

  it('getStatutsCrs : monPerimetre restreint aux CR de l’utilisateur', async () => {
    // Saisisseur : périmètre [CR_A] → ne voit que CR_A.
    const vueSais = await service.getStatutsCrs(ids.version, ids.uSaisisseur);
    expect(vueSais.crs.map((c) => c.crCode)).toEqual(['CR_A']);
    // Validateur : périmètre [CR_A, CR_B] → voit les deux.
    const vueValid = await service.getStatutsCrs(ids.version, ids.uValidateur);
    expect(vueValid.crs.map((c) => c.crCode).sort()).toEqual(['CR_A', 'CR_B']);
  });

  it('soumettreComite : refusé si version pas PRE_VALIDE', async () => {
    await expect(
      service.soumettreComite(ids.version, undefined, validateur),
    ).rejects.toThrow(/PRE_VALIDE/);
  });

  it('soumettreComite : PRE_VALIDE → SOUMIS_COMITE + audit', async () => {
    await ds.query(`UPDATE dim_version SET statut='pre_valide' WHERE id=$1`, [
      ids.version,
    ]);
    const v = await service.soumettreComite(
      ids.version,
      'tous CR validés',
      validateur,
    );
    expect(v.statut).toBe('soumis_comite');
    expect(await auditCount('SOUMETTRE_COMITE')).toBe(1);
  });

  // ─── Palier 3 : verrou + automation + snapshot ──────────────────

  it('verrou : CR VALIDE → CR_VERROUILLE ; CR sans statut → auto-crée EN_SAISIE', async () => {
    await ds.query(`DELETE FROM fait_budget_cr_statut`);
    await ds.query(`UPDATE dim_version SET statut='ouvert' WHERE id=$1`, [
      ids.version,
    ]);
    await ds.query(
      `INSERT INTO fait_budget_cr_statut (fk_version,fk_cr,statut) VALUES ($1,$2,'VALIDE')`,
      [ids.version, ids.crA],
    );
    await expect(
      ds.transaction((m) =>
        service.assertCrModifiable(m, ids.version, ids.crA),
      ),
    ).rejects.toThrow(ForbiddenException);
    // CR_B sans ligne statut → création paresseuse EN_SAISIE.
    await ds.transaction((m) =>
      service.assertCrModifiable(m, ids.version, ids.crB),
    );
    const r = (await ds.query(
      `SELECT statut FROM fait_budget_cr_statut WHERE fk_version=$1 AND fk_cr=$2`,
      [ids.version, ids.crB],
    )) as Array<{ statut: string }>;
    expect(r[0]!.statut).toBe('EN_SAISIE');
  });

  it('automation : dernière validation → version PRE_VALIDE + audit', async () => {
    await ds.query(`DELETE FROM fait_budget_cr_statut`);
    await ds.query(`UPDATE dim_version SET statut='ouvert' WHERE id=$1`, [
      ids.version,
    ]);
    await ds.query(
      `INSERT INTO fait_budget_cr_statut (fk_version,fk_cr,statut) VALUES ($1,$2,'VALIDE')`,
      [ids.version, ids.crA],
    );
    await ds.query(
      `INSERT INTO fait_budget_cr_statut (fk_version,fk_cr,statut) VALUES ($1,$2,'SOUMIS')`,
      [ids.version, ids.crB],
    );
    await service.valider(ids.version, 'CR_B', undefined, validateur);
    const v = (await ds.query(`SELECT statut FROM dim_version WHERE id=$1`, [
      ids.version,
    ])) as Array<{ statut: string }>;
    expect(v[0]!.statut).toBe('pre_valide');
    expect(await auditCount('PRE_VALIDER_VERSION')).toBe(1);
  });

  it('automation : réouverture d’un CR → version repasse OUVERT + audit', async () => {
    // Version PRE_VALIDE + CR_B VALIDE par `validateur` (test précédent).
    const res = await service.rouvrir(
      ids.version,
      'CR_B',
      'correction',
      validateur,
    );
    expect(res.statut).toBe('EN_SAISIE');
    const v = (await ds.query(`SELECT statut FROM dim_version WHERE id=$1`, [
      ids.version,
    ])) as Array<{ statut: string }>;
    expect(v[0]!.statut).toBe('ouvert');
    expect(await auditCount('REOUVRIR_VERSION')).toBe(1);
  });

  it('initialiserSnapshot : peuple depuis les périmètres SAISISSEUR + idempotent', async () => {
    const r1 = await service.initialiserSnapshot(ids.version, validateur);
    expect(r1.total).toBeGreaterThanOrEqual(1); // CR_A (périmètre saisisseur)
    const r2 = await service.initialiserSnapshot(ids.version, validateur);
    expect(r2.ajoutes).toBe(0); // idempotent
  });
});
