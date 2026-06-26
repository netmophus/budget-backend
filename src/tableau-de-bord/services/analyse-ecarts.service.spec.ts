/**
 * Tests AnalyseEcartsService (Lot 5.2.A) via pg-mem.
 *
 * Couvre : calcul écart + pourcentage, niveaux d'alerte
 * (NORMAL/ATTENTION/CRITIQUE/MANQUANT), sens favorable/
 * défavorable selon classe UEMOA, KPI, filtrage périmètre.
 */
import { DataType, IMemoryDb, newDb } from 'pg-mem';
import { DataSource } from 'typeorm';

import { AuditLog } from '../../audit/entities/audit-log.entity';
import { PerimetreService } from '../../budget/services/perimetre.service';
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
import { FaitRealise } from '../../realise/entities/fait-realise.entity';
import { Permission } from '../../roles/entities/permission.entity';
import { Role } from '../../roles/entities/role.entity';
import { RolePermission } from '../../roles/entities/role-permission.entity';
import { User } from '../../users/entities/user.entity';
import { UserPerimetre } from '../../users/entities/user-perimetre.entity';
import { UserRole } from '../../users/entities/user-role.entity';
import { AnalyseEcartsService } from './analyse-ecarts.service';

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
      User,
      UserRole,
      UserPerimetre,
      Role,
      Permission,
      RolePermission,
      DimStructure,
      DimCentreResponsabilite,
      DimCompte,
      DimLigneMetier,
      DimDevise,
      DimProduit,
      DimSegment,
      DimTemps,
      DimVersion,
      DimScenario,
      FaitBudget,
      FaitRealise,
    ],
    synchronize: true,
  }) as DataSource;
  await ds.initialize();
  return ds;
}

interface SeedIds {
  adminId: string;
  saiId: string;
  cr1: string; // dans périmètre saisisseur
  cr2: string; // hors périmètre
  versionId: string;
  scenarioId: string;
  compteCharge: string; // classe 6
  compteProduit: string; // classe 7
  compteBilan: string; // classe 5
  ligneMetier: string;
  devise: string;
  produit: string;
  segment: string;
  structure: string;
  temps1: string; // 2027-01
  temps2: string; // 2027-02
  temps3: string; // 2027-03
}

async function seed(ds: DataSource): Promise<SeedIds> {
  // Users + rôles
  await ds.query(
    `INSERT INTO "user" (email, mot_de_passe_hash, nom, prenom, est_actif)
     VALUES ('admin@m.io','h','A','D',true), ('sai@m.io','h','S','I',true)`,
  );
  const users = (await ds.query(`SELECT id, email FROM "user"`)) as Array<{
    id: string;
    email: string;
  }>;
  const adminId = String(users.find((u) => u.email === 'admin@m.io')!.id);
  const saiId = String(users.find((u) => u.email === 'sai@m.io')!.id);

  await ds.query(
    `INSERT INTO ref_role (code_role, libelle, est_actif, utilisateur_creation)
     VALUES ('ADMIN','Admin',true,'system'),('LECTEUR','Lecteur',true,'system')`,
  );
  const roles = (await ds.query(
    `SELECT id, code_role FROM ref_role`,
  )) as Array<{ id: string; code_role: string }>;
  const roleAdminId = String(roles.find((r) => r.code_role === 'ADMIN')!.id);
  const roleLecteurId = String(
    roles.find((r) => r.code_role === 'LECTEUR')!.id,
  );

  await ds.query(
    `INSERT INTO bridge_user_role (fk_user, fk_role, perimetre_type, est_actif, utilisateur_creation)
     VALUES ($1::bigint, $2::bigint, 'global', true, 'system'),
            ($3::bigint, $4::bigint, 'global', true, 'system')`,
    [adminId, roleAdminId, saiId, roleLecteurId],
  );

  // Référentiels
  await ds.query(
    `INSERT INTO dim_structure
       (code_structure, libelle, type_structure, niveau_hierarchique,
        date_debut_validite, version_courante, est_actif, utilisateur_creation)
     VALUES ('S1','Struct1','filiale',1,'2026-01-01',true,true,'system')`,
  );
  const struct = (await ds.query(`SELECT id FROM dim_structure`)) as Array<{
    id: string;
  }>;

  await ds.query(
    `INSERT INTO dim_centre_responsabilite
       (code_cr, libelle, type_cr, fk_structure, date_debut_validite,
        version_courante, est_actif, utilisateur_creation)
     VALUES ('CR_BANDABARI','Bandabari','profit_center',$1::bigint,'2026-01-01',true,true,'system'),
            ('CR_PLATEAU','Plateau','profit_center',$1::bigint,'2026-01-01',true,true,'system')`,
    [struct[0]!.id],
  );
  const crs = (await ds.query(
    `SELECT id, code_cr FROM dim_centre_responsabilite ORDER BY code_cr`,
  )) as Array<{ id: string; code_cr: string }>;
  const cr1 = String(crs.find((c) => c.code_cr === 'CR_BANDABARI')!.id);
  const cr2 = String(crs.find((c) => c.code_cr === 'CR_PLATEAU')!.id);

  // Comptes : 3 classes différentes
  await ds.query(
    `INSERT INTO dim_compte
       (code_compte, libelle, classe, niveau, est_compte_collectif,
        est_porteur_interets, date_debut_validite, version_courante,
        est_actif, utilisateur_creation)
     VALUES
       ('611100','Salaires','6',4,false,false,'2026-01-01',true,true,'system'),
       ('701100','Commissions','7',4,false,false,'2026-01-01',true,true,'system'),
       ('512000','Banque','5',4,false,false,'2026-01-01',true,true,'system')`,
  );
  const comptes = (await ds.query(
    `SELECT id, code_compte FROM dim_compte ORDER BY code_compte`,
  )) as Array<{ id: string; code_compte: string }>;

  await ds.query(
    `INSERT INTO dim_ligne_metier
       (code_ligne_metier, libelle, niveau, date_debut_validite,
        version_courante, est_actif, utilisateur_creation)
     VALUES ('RETAIL','Retail',1,'2026-01-01',true,true,'system')`,
  );
  const lm = (await ds.query(`SELECT id FROM dim_ligne_metier`)) as Array<{
    id: string;
  }>;

  await ds.query(
    `INSERT INTO dim_devise
       (code_iso, libelle, symbole, nb_decimales, est_devise_pivot,
        est_active, utilisateur_creation)
     VALUES ('XOF','Franc CFA','F CFA',0,true,true,'system')`,
  );
  const dev = (await ds.query(`SELECT id FROM dim_devise`)) as Array<{
    id: string;
  }>;

  await ds.query(
    `INSERT INTO dim_produit (code_produit, libelle, type_produit, niveau,
       est_porteur_interets, date_debut_validite, version_courante,
       est_actif, utilisateur_creation)
     VALUES ('P1','Produit transverse','autre',1,false,'2026-01-01',true,true,'system')`,
  );
  const prod = (await ds.query(`SELECT id FROM dim_produit`)) as Array<{
    id: string;
  }>;

  await ds.query(
    `INSERT INTO dim_segment (code_segment, libelle, categorie,
       date_debut_validite, version_courante, est_actif, utilisateur_creation)
     VALUES ('SEG','Segment','particulier','2026-01-01',true,true,'system')`,
  );
  const seg = (await ds.query(`SELECT id FROM dim_segment`)) as Array<{
    id: string;
  }>;

  // Version + scenario
  await ds.query(
    `INSERT INTO dim_version
       (code_version, libelle, type_version, exercice_fiscal, statut, utilisateur_creation)
     VALUES ('BI_2027','Budget','budget_initial',2027,'gele','system')`,
  );
  const ver = (await ds.query(`SELECT id FROM dim_version`)) as Array<{
    id: string;
  }>;
  await ds.query(
    `INSERT INTO dim_scenario
       (code_scenario, libelle, type_scenario, statut, exercice_fiscal, utilisateur_creation)
     VALUES ('OPT_2027','Optimiste','central','actif',2027,'system')`,
  );
  const sce = (await ds.query(`SELECT id FROM dim_scenario`)) as Array<{
    id: string;
  }>;

  // 3 mois
  await ds.query(
    `INSERT INTO dim_temps
       (date, annee, trimestre, mois, jour, jour_ouvre, est_fin_de_mois,
        est_fin_de_trimestre, est_fin_d_annee, exercice_fiscal, libelle_mois)
     VALUES
       ('2027-01-01',2027,1,1,1,true,false,false,false,2027,'Janvier'),
       ('2027-02-01',2027,1,2,1,true,false,false,false,2027,'Février'),
       ('2027-03-01',2027,1,3,1,true,false,false,false,2027,'Mars')`,
  );
  const temps = (await ds.query(
    `SELECT id, date FROM dim_temps ORDER BY date`,
  )) as Array<{ id: string; date: Date }>;

  // user_perimetres saisisseur sur CR_BANDABARI uniquement
  await ds.query(
    `INSERT INTO user_perimetres (fk_user, cible_type, cible_id, origine, date_debut, actif, utilisateur_creation)
     VALUES ($1::bigint, 'CR', $2::bigint, 'AFFECTATION', '2026-01-01', true, 'system')`,
    [saiId, cr1],
  );

  return {
    adminId,
    saiId,
    cr1,
    cr2,
    versionId: String(ver[0]!.id),
    scenarioId: String(sce[0]!.id),
    compteCharge: String(comptes.find((c) => c.code_compte === '611100')!.id),
    compteProduit: String(comptes.find((c) => c.code_compte === '701100')!.id),
    compteBilan: String(comptes.find((c) => c.code_compte === '512000')!.id),
    ligneMetier: String(lm[0]!.id),
    devise: String(dev[0]!.id),
    produit: String(prod[0]!.id),
    segment: String(seg[0]!.id),
    structure: String(struct[0]!.id),
    temps1: String(temps[0]!.id),
    temps2: String(temps[1]!.id),
    temps3: String(temps[2]!.id),
  };
}

async function insertBudget(
  ds: DataSource,
  ids: SeedIds,
  fkCompte: string,
  fkTemps: string,
  fkCr: string,
  montant: number,
): Promise<void> {
  await ds.query(
    `INSERT INTO fait_budget
      (fk_temps, fk_compte, fk_structure, fk_centre, fk_ligne_metier,
       fk_produit, fk_segment, fk_devise, fk_version, fk_scenario,
       montant_devise, montant_fcfa, taux_change_applique, mode_saisie,
       utilisateur_creation)
     VALUES ($1::bigint, $2::bigint, $3::bigint, $4::bigint, $5::bigint,
             $6::bigint, $7::bigint, $8::bigint, $9::bigint, $10::bigint,
             $11, $11, 1, 'MONTANT', 'system')`,
    [
      fkTemps,
      fkCompte,
      ids.structure,
      fkCr,
      ids.ligneMetier,
      ids.produit,
      ids.segment,
      ids.devise,
      ids.versionId,
      ids.scenarioId,
      montant,
    ],
  );
}

async function insertRealise(
  ds: DataSource,
  ids: SeedIds,
  fkCompte: string,
  fkTemps: string,
  fkCr: string,
  montant: number,
  statut: 'IMPORTE' | 'VALIDE' = 'VALIDE',
): Promise<void> {
  const fkValide = statut === 'VALIDE' ? `$7::bigint` : 'NULL';
  const valideLe = statut === 'VALIDE' ? `NOW()` : 'NULL';
  const params = [
    fkCr,
    fkCompte,
    ids.ligneMetier,
    fkTemps,
    ids.devise,
    montant,
  ];
  if (statut === 'VALIDE') params.push(ids.adminId);
  await ds.query(
    `INSERT INTO fait_realise
      (fk_centre_responsabilite, fk_compte, fk_ligne_metier, fk_temps,
       fk_devise, montant, taux_change_applique, mode, statut, source,
       valide_le, fk_valide_par, utilisateur_creation)
     VALUES ($1::bigint, $2::bigint, $3::bigint, $4::bigint, $5::bigint,
             $6, 1, 'MNT', '${statut}', 'IMPORT',
             ${valideLe}, ${fkValide}, 'system')`,
    params,
  );
}

describe('AnalyseEcartsService', () => {
  let ds: DataSource;
  let svc: AnalyseEcartsService;
  let perimSvc: PerimetreService;
  let ids: SeedIds;

  beforeAll(async () => {
    ds = await createDataSource();
  });
  afterAll(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    await ds.query('DELETE FROM fait_realise');
    await ds.query('DELETE FROM fait_budget');
    await ds.query('DELETE FROM bridge_user_role');
    await ds.query('DELETE FROM ref_role');
    await ds.query('DELETE FROM user_perimetres');
    await ds.query('DELETE FROM dim_temps');
    await ds.query('DELETE FROM dim_scenario');
    await ds.query('DELETE FROM dim_version');
    await ds.query('DELETE FROM dim_segment');
    await ds.query('DELETE FROM dim_produit');
    await ds.query('DELETE FROM dim_devise');
    await ds.query('DELETE FROM dim_ligne_metier');
    await ds.query('DELETE FROM dim_compte');
    await ds.query('DELETE FROM dim_centre_responsabilite');
    await ds.query('DELETE FROM dim_structure');
    await ds.query('DELETE FROM "user"');
    ids = await seed(ds);
    perimSvc = new PerimetreService(
      ds.getRepository(UserRole),
      ds.getRepository(UserPerimetre),
    );
    svc = new AnalyseEcartsService(ds, perimSvc);
  });

  function admin() {
    return { userId: ids.adminId, email: 'admin@m.io' };
  }
  function sai() {
    return { userId: ids.saiId, email: 'sai@m.io' };
  }
  function filtres(over: Partial<{ crIds: string[] | undefined }> = {}) {
    return {
      versionId: ids.versionId,
      scenarioId: ids.scenarioId,
      moisDebut: '2027-01',
      moisFin: '2027-03',
      crIds: over.crIds,
    } as never;
  }

  // ─── Calcul écart nominal ─────────────────────────────────

  it('calcule un écart -200K (réalisé < budget) avec ecartPct -4 sur classe 7', async () => {
    await insertBudget(
      ds,
      ids,
      ids.compteProduit,
      ids.temps3,
      ids.cr1,
      5_000_000,
    );
    await insertRealise(
      ds,
      ids,
      ids.compteProduit,
      ids.temps3,
      ids.cr1,
      4_800_000,
    );

    const r = await svc.getBudgetVsRealise(filtres(), admin());
    expect(r.lignes).toHaveLength(1);
    const l = r.lignes[0]!;
    expect(l.montantBudget).toBe(5_000_000);
    expect(l.montantRealise).toBe(4_800_000);
    expect(l.ecart).toBe(-200_000);
    expect(l.ecartAbs).toBe(200_000);
    expect(l.ecartPct).toBe(-4);
    expect(l.classeCompte).toBe('7');
    expect(l.natureCompte).toBe('PRODUIT');
  });

  // ─── Niveaux d'alerte ─────────────────────────────────────

  it('niveau NORMAL quand |ecartPct| < seuilAttention (5)', async () => {
    await insertBudget(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      1_000_000,
    );
    await insertRealise(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      1_030_000,
    ); // +3%
    const r = await svc.getBudgetVsRealise(filtres(), admin());
    expect(r.lignes[0]!.niveauAlerte).toBe('NORMAL');
  });

  it('niveau ATTENTION quand seuilAttention <= |ecartPct| < seuilCritique', async () => {
    await insertBudget(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      1_000_000,
    );
    await insertRealise(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      1_070_000,
    ); // +7%
    const r = await svc.getBudgetVsRealise(filtres(), admin());
    expect(r.lignes[0]!.niveauAlerte).toBe('ATTENTION');
  });

  it('niveau CRITIQUE quand |ecartPct| >= seuilCritique', async () => {
    await insertBudget(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      1_000_000,
    );
    await insertRealise(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      1_150_000,
    ); // +15%
    const r = await svc.getBudgetVsRealise(filtres(), admin());
    expect(r.lignes[0]!.niveauAlerte).toBe('CRITIQUE');
  });

  it('niveau MANQUANT quand fait_realise absent', async () => {
    await insertBudget(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      1_000_000,
    );
    const r = await svc.getBudgetVsRealise(filtres(), admin());
    expect(r.lignes).toHaveLength(1);
    expect(r.lignes[0]!.niveauAlerte).toBe('MANQUANT');
    expect(r.lignes[0]!.montantRealise).toBeNull();
    expect(r.lignes[0]!.ecart).toBeNull();
    expect(r.lignes[0]!.sensEcart).toBeNull();
  });

  // ─── Sens favorable / défavorable ─────────────────────────

  it('classe 6 (CHARGE) : réalisé > budget → DEFAVORABLE', async () => {
    await insertBudget(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      1_000_000,
    );
    await insertRealise(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      1_500_000,
    );
    const r = await svc.getBudgetVsRealise(filtres(), admin());
    expect(r.lignes[0]!.natureCompte).toBe('CHARGE');
    expect(r.lignes[0]!.sensEcart).toBe('DEFAVORABLE');
  });

  it('classe 7 (PRODUIT) : réalisé > budget → FAVORABLE', async () => {
    await insertBudget(
      ds,
      ids,
      ids.compteProduit,
      ids.temps1,
      ids.cr1,
      1_000_000,
    );
    await insertRealise(
      ds,
      ids,
      ids.compteProduit,
      ids.temps1,
      ids.cr1,
      1_500_000,
    );
    const r = await svc.getBudgetVsRealise(filtres(), admin());
    expect(r.lignes[0]!.natureCompte).toBe('PRODUIT');
    expect(r.lignes[0]!.sensEcart).toBe('FAVORABLE');
  });

  it('classe 5 (BILAN) : ecart non nul → NEUTRE', async () => {
    await insertBudget(
      ds,
      ids,
      ids.compteBilan,
      ids.temps1,
      ids.cr1,
      1_000_000,
    );
    await insertRealise(
      ds,
      ids,
      ids.compteBilan,
      ids.temps1,
      ids.cr1,
      1_500_000,
    );
    const r = await svc.getBudgetVsRealise(filtres(), admin());
    expect(r.lignes[0]!.natureCompte).toBe('BILAN');
    expect(r.lignes[0]!.sensEcart).toBe('NEUTRE');
  });

  it('ecart=0 → NEUTRE peu importe la classe', async () => {
    await insertBudget(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      1_000_000,
    );
    await insertRealise(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      1_000_000,
    );
    const r = await svc.getBudgetVsRealise(filtres(), admin());
    expect(r.lignes[0]!.sensEcart).toBe('NEUTRE');
    expect(r.lignes[0]!.ecart).toBe(0);
  });

  // ─── Realise statut IMPORTE ignoré ────────────────────────

  it('fait_realise statut=IMPORTE ignoré (seul VALIDE est comptabilisé)', async () => {
    await insertBudget(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      1_000_000,
    );
    await insertRealise(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      999_999,
      'IMPORTE',
    );
    const r = await svc.getBudgetVsRealise(filtres(), admin());
    // La ligne est MANQUANT car le réalisé IMPORTE n'est pas pris
    expect(r.lignes[0]!.niveauAlerte).toBe('MANQUANT');
    expect(r.lignes[0]!.montantRealise).toBeNull();
  });

  // ─── KPI agrégés ──────────────────────────────────────────

  it('KPI : 1 CRITIQUE + 1 ATTENTION + 1 MANQUANT + sommes', async () => {
    // CR1 / charge / janvier : +15% → CRITIQUE défavorable
    await insertBudget(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      1_000_000,
    );
    await insertRealise(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      1_150_000,
    );
    // CR1 / produit / février : +7% → ATTENTION favorable
    await insertBudget(
      ds,
      ids,
      ids.compteProduit,
      ids.temps2,
      ids.cr1,
      1_000_000,
    );
    await insertRealise(
      ds,
      ids,
      ids.compteProduit,
      ids.temps2,
      ids.cr1,
      1_070_000,
    );
    // CR1 / charge / mars : MANQUANT
    await insertBudget(ds, ids, ids.compteCharge, ids.temps3, ids.cr1, 500_000);

    const r = await svc.getBudgetVsRealise(filtres(), admin());
    expect(r.lignes).toHaveLength(3);
    expect(r.kpi.nbEcartsCritique).toBe(1);
    expect(r.kpi.nbEcartsAttention).toBe(1);
    expect(r.kpi.nbLignesManquantes).toBe(1);
    expect(r.kpi.nbEcartsTotal).toBe(3);
    expect(r.kpi.ecartTotalAbs).toBe(150_000 + 70_000); // 220K
    expect(r.kpi.ecartTotalDefavorable).toBe(150_000); // CHARGE +
    expect(r.kpi.ecartTotalFavorable).toBe(70_000); // PRODUIT +
  });

  // ─── Filtrage périmètre ───────────────────────────────────

  it('filtrage périmètre user_perimetres : SAI ne voit pas CR_PLATEAU', async () => {
    await insertBudget(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      1_000_000,
    );
    await insertBudget(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr2,
      5_000_000,
    );
    const r = await svc.getBudgetVsRealise(filtres(), sai());
    expect(r.lignes).toHaveLength(1);
    expect(r.lignes[0]!.codeCr).toBe('CR_BANDABARI');
  });

  it('admin global voit les 2 CR', async () => {
    await insertBudget(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      1_000_000,
    );
    await insertBudget(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr2,
      5_000_000,
    );
    const r = await svc.getBudgetVsRealise(filtres(), admin());
    expect(r.lignes).toHaveLength(2);
  });

  it('filtres.crIds explicite : intersection avec périmètre user', async () => {
    await insertBudget(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      1_000_000,
    );
    await insertBudget(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr2,
      5_000_000,
    );
    // SAI demande explicitement CR_PLATEAU (hors périmètre) → résultat vide
    const r = await svc.getBudgetVsRealise(
      filtres({ crIds: [ids.cr2] }),
      sai(),
    );
    expect(r.lignes).toHaveLength(0);
  });

  // ─── Tri ──────────────────────────────────────────────────

  it('tri par défaut : ecart_abs décroissant', async () => {
    await insertBudget(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      1_000_000,
    );
    await insertRealise(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      1_050_000,
    ); // 50K
    await insertBudget(
      ds,
      ids,
      ids.compteProduit,
      ids.temps2,
      ids.cr1,
      1_000_000,
    );
    await insertRealise(
      ds,
      ids,
      ids.compteProduit,
      ids.temps2,
      ids.cr1,
      1_300_000,
    ); // 300K
    const r = await svc.getBudgetVsRealise(filtres(), admin());
    expect(r.lignes[0]!.ecartAbs).toBe(300_000);
    expect(r.lignes[1]!.ecartAbs).toBe(50_000);
  });

  // ─── Seuils paramétrables ─────────────────────────────────

  it('seuils paramétrables (3/7) : un écart de 6% devient ATTENTION', async () => {
    await insertBudget(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      1_000_000,
    );
    await insertRealise(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      1_060_000,
    ); // 6%
    const r = await svc.getBudgetVsRealise(
      {
        ...(filtres() as Record<string, unknown>),
        seuilEcartPctAttention: 3,
        seuilEcartPctCritique: 7,
      } as never,
      admin(),
    );
    expect(r.lignes[0]!.niveauAlerte).toBe('ATTENTION');
  });

  // ─── FULL JOIN : réalisé sans budget (SANS_BUDGET) ────────

  it('FULL JOIN : réalisé sans budget → niveau SANS_BUDGET', async () => {
    // Réalisé seul (aucune ligne de budget pour cette combinaison).
    await insertRealise(
      ds,
      ids,
      ids.compteProduit,
      ids.temps1,
      ids.cr1,
      800_000,
    );
    const r = await svc.getBudgetVsRealise(filtres(), admin());
    expect(r.lignes).toHaveLength(1);
    const l = r.lignes[0]!;
    expect(l.niveauAlerte).toBe('SANS_BUDGET');
    expect(l.montantBudget).toBeNull();
    expect(l.montantRealise).toBe(800_000);
    expect(l.ecart).toBe(800_000);
    expect(l.ecartPct).toBeNull();
    expect(l.tauxExecution).toBeNull();
    expect(r.kpi.nbSansBudget).toBe(1);
  });

  // ─── Totaux compte de résultat ────────────────────────────

  it('totaux : sous-totaux produits/charges + solde Budget vs Réalisé', async () => {
    // Produits (classe 7) : budget 5M, réalisé 4.8M
    await insertBudget(
      ds,
      ids,
      ids.compteProduit,
      ids.temps1,
      ids.cr1,
      5_000_000,
    );
    await insertRealise(
      ds,
      ids,
      ids.compteProduit,
      ids.temps1,
      ids.cr1,
      4_800_000,
    );
    // Charges (classe 6) : budget 3M, réalisé 3.2M
    await insertBudget(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      3_000_000,
    );
    await insertRealise(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      3_200_000,
    );
    const r = await svc.getBudgetVsRealise(filtres(), admin());
    expect(r.totaux.produits.budget).toBe(5_000_000);
    expect(r.totaux.produits.realise).toBe(4_800_000);
    expect(r.totaux.produits.tauxExecution).toBe(96); // 4.8 / 5
    expect(r.totaux.charges.budget).toBe(3_000_000);
    expect(r.totaux.charges.realise).toBe(3_200_000);
    expect(r.totaux.solde.budget).toBe(2_000_000); // 5M − 3M
    expect(r.totaux.solde.realise).toBe(1_600_000); // 4.8M − 3.2M
  });

  it('totaux : PNB exclut les charges d’intérêts (67xx) + coefficient d’exploitation', async () => {
    // Compte de charges d'intérêts 671100 (classe 6, sous-classe 67).
    await ds.query(
      `INSERT INTO dim_compte
         (code_compte, libelle, classe, niveau, est_compte_collectif,
          est_porteur_interets, date_debut_validite, version_courante,
          est_actif, utilisateur_creation)
       VALUES ('671100','Intérêts payés','6',4,false,false,'2026-01-01',true,true,'system')`,
    );
    const cmpt = (await ds.query(
      `SELECT id FROM dim_compte WHERE code_compte='671100'`,
    )) as Array<{ id: string }>;
    const compteInterets = String(cmpt[0]!.id);

    // Produits 10M / 10M
    await insertBudget(
      ds,
      ids,
      ids.compteProduit,
      ids.temps1,
      ids.cr1,
      10_000_000,
    );
    await insertRealise(
      ds,
      ids,
      ids.compteProduit,
      ids.temps1,
      ids.cr1,
      10_000_000,
    );
    // Charges hors intérêts (611100) 4M / 4M
    await insertBudget(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      4_000_000,
    );
    await insertRealise(
      ds,
      ids,
      ids.compteCharge,
      ids.temps1,
      ids.cr1,
      4_000_000,
    );
    // Charges d'intérêts (671100) 2M / 2M
    await insertBudget(ds, ids, compteInterets, ids.temps1, ids.cr1, 2_000_000);
    await insertRealise(
      ds,
      ids,
      compteInterets,
      ids.temps1,
      ids.cr1,
      2_000_000,
    );

    const r = await svc.getBudgetVsRealise(filtres(), admin());
    // PNB = produits − charges d'intérêts = 10M − 2M = 8M
    expect(r.totaux.pnb.budget).toBe(8_000_000);
    expect(r.totaux.pnb.realise).toBe(8_000_000);
    // Solde = produits − toutes charges = 10M − 6M = 4M
    expect(r.totaux.solde.budget).toBe(4_000_000);
    // CE = charges hors intérêts / PNB = 4M / 8M = 50 %
    expect(r.totaux.coefExploitationBudget).toBe(50);
    expect(r.totaux.coefExploitationRealise).toBe(50);
  });
});
